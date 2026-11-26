import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { MeetingService } from '../services/meeting.service.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';

/**
 * Deterministic synchronization barrier (no arbitrary sleeps).
 * `arrived` resolves the exact instant the paused coroutine hits the hook;
 * `release()` unblocks the coroutine deterministically after the racing write commits.
 */
function createBarrier() {
  let markArrived!: () => void;
  let releaseWaiter!: () => void;
  const arrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseWaiter = resolve;
  });
  return {
    arrived,
    release: () => releaseWaiter(),
    pause: async () => {
      markArrived();
      await gate;
    },
  };
}

function connectSocket(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out'));
    }, 4000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

function subscribeSocket(
  socket: ClientSocket,
  meetingCode: string
): Promise<{ ok: boolean; code?: string; status?: string }> {
  return new Promise((resolve) => {
    socket.emit('meeting:subscribe', { meetingCode }, (ack: any) => resolve(ack));
  });
}

function waitForEvent<T = any>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event "${event}"`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function flushEventLoop(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Phase 08 Deterministic Concurrency, Rejoin/Reconnect & Event Ordering Gate Suite', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const realtimeHub = new MeetingRealtimeHub();
  const baseService = new MeetingService(realtimeHub);

  const users: Array<{ id: string; token: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const openSockets: ClientSocket[] = [];

  before(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Ensure unique compound index exists on meeting_participants
    await MeetingParticipant.syncIndexes();

    const app = createApp();
    httpServer = http.createServer(app);
    realtimeHub.attach(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test HTTP server');
    }
    serverUrl = `http://127.0.0.1:${addr.port}`;

    const passwordHash = await hashPassword('StrongPass!2026');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    for (let i = 0; i < 4; i += 1) {
      const email = `conc_p8_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `ConcUser${i}`,
        lastName: 'Gate',
        email,
        passwordHash,
      });
      const token = generateAccessToken({
        sub: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      users.push({ id: user._id.toString(), token, email });
    }
  });

  after(async () => {
    for (const s of openSockets) {
      try {
        s.disconnect();
      } catch {
        // ignore
      }
    }
    realtimeHub.close();
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    if (createdMeetingIds.length > 0) {
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
    }
    if (users.length > 0) {
      await User.deleteMany({ _id: { $in: users.map((u) => u.id) } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  async function createActiveMeeting(options?: { waitingRoomEnabled?: boolean }) {
    const { meeting: created } = await baseService.createMeeting(users[0].id, {
      title: 'Concurrency Gate Room',
      maxParticipants: 10,
      settings: {
        waitingRoomEnabled: options?.waitingRoomEnabled ?? false,
        allowCoHostAdmit: true,
        allowCoHostRemove: true,
        allowCoHostLock: true,
      },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(created.id));
    await baseService.joinMeeting(created.meetingCode, users[0].id);
    return created;
  }

  // =========================================================================
  // TEST A — CONCURRENT JOIN VERSUS MEETING LOCK (BOTH COMMIT ORDERS)
  // =========================================================================
  it('Test A1 — Concurrent join vs meeting lock (Order 1: Lock commits first -> join blocked with 403 MEETING_LOCKED)', async () => {
    const meeting = await createActiveMeeting({ waitingRoomEnabled: false });
    const hostSocket = await connectSocket(serverUrl, users[0].token);
    openSockets.push(hostSocket);
    const sub = await subscribeSocket(hostSocket, meeting.meetingCode);
    assert.strictEqual(sub.ok, true);

    const joinedEvents: any[] = [];
    hostSocket.on('meeting:participant-joined', (ev) => joinedEvents.push(ev));

    const barrier = createBarrier();
    const joinService = new MeetingService(realtimeHub, {
      beforeDirectJoinReserve: barrier.pause,
    });
    const lockService = new MeetingService(realtimeHub);

    // 1. Start participant join; pauses right before authoritative Meeting reserve write
    const joinPromise = joinService.joinMeeting(meeting.meetingCode, users[1].id);
    await barrier.arrived;

    // 2. Host locks meeting via independent service instance
    const lockRes = await lockService.setMeetingLock(meeting.meetingCode, users[0].id, true);
    assert.strictEqual(lockRes.meeting.isLocked, true);

    // 3. Release paused join -> MUST fail with MEETING_LOCKED
    barrier.release();
    await assert.rejects(
      () => joinPromise,
      (err: any) => err.statusCode === 403 && err.code === 'MEETING_LOCKED'
    );

    await flushEventLoop();

    // 4. Verify authoritative MongoDB invariants
    const dbMeeting = await Meeting.findById(meeting.id);
    assert.strictEqual(dbMeeting?.isLocked, true);
    assert.strictEqual(dbMeeting?.activeParticipantCount, 1);

    const guestRecord = await MeetingParticipant.findOne({
      meetingId: meeting.id,
      userId: users[1].id,
    });
    assert.strictEqual(guestRecord, null);
    assert.strictEqual(joinedEvents.length, 0, 'No participant-joined event may emit for blocked join');
  });

  it('Test A2 — Concurrent join vs meeting lock (Order 2: Join commits first -> lock succeeds preserving admitted participant; waiting-room join vs lock also safe)', async () => {
    // Part 1: Direct join commits first, then lock commits
    const meeting = await createActiveMeeting({ waitingRoomEnabled: false });
    const barrier = createBarrier();
    const lockService = new MeetingService(realtimeHub, {
      beforeLockWrite: barrier.pause,
    });
    const joinService = new MeetingService(realtimeHub);

    const lockPromise = lockService.setMeetingLock(meeting.meetingCode, users[0].id, true);
    await barrier.arrived;

    const joinRes = await joinService.joinMeeting(meeting.meetingCode, users[1].id);
    assert.strictEqual(joinRes.joinResult, 'ADMITTED');

    barrier.release();
    const lockRes = await lockPromise;
    assert.strictEqual(lockRes.meeting.isLocked, true);

    const dbMeeting = await Meeting.findById(meeting.id);
    assert.strictEqual(dbMeeting?.isLocked, true);
    assert.strictEqual(dbMeeting?.activeParticipantCount, 2);

    const admittedCount = await MeetingParticipant.countDocuments({
      meetingId: meeting.id,
      admissionStatus: 'ADMITTED',
    });
    assert.strictEqual(admittedCount, 2);

    // Part 2: Waiting-room join paused before write while host locks -> rolled back cleanly
    const waitRoom = await createActiveMeeting({ waitingRoomEnabled: true });
    const waitBarrier = createBarrier();
    const waitJoinService = new MeetingService(realtimeHub, {
      beforeWaitingJoinWrite: waitBarrier.pause,
    });
    const waitJoinPromise = waitJoinService.joinMeeting(waitRoom.meetingCode, users[2].id);
    await waitBarrier.arrived;

    await baseService.setMeetingLock(waitRoom.meetingCode, users[0].id, true);
    waitBarrier.release();

    await assert.rejects(
      () => waitJoinPromise,
      (err: any) => err.statusCode === 403 && err.code === 'MEETING_LOCKED'
    );

    const waitingCount = await MeetingParticipant.countDocuments({
      meetingId: waitRoom.id,
      admissionStatus: 'WAITING',
    });
    assert.strictEqual(waitingCount, 0, 'Locked meeting must not retain waiting entry from stale read');
  });

  // =========================================================================
  // TEST B — CONCURRENT ADMISSION VERSUS MEETING TERMINATION (BOTH ORDERS)
  // =========================================================================
  it('Test B1 — Concurrent admission vs meeting termination (Order 1: End commits before reserve AND mid-commit -> no admission, no post-end event, stays ENDED)', async () => {
    // Subcase 1a: Pause admission immediately before Step A reserve write
    const m1 = await createActiveMeeting({ waitingRoomEnabled: true });
    const joinW1 = await baseService.joinMeeting(m1.meetingCode, users[1].id);
    assert.strictEqual(joinW1.joinResult, 'WAITING');

    const waitSock1 = await connectSocket(serverUrl, users[1].token);
    openSockets.push(waitSock1);
    assert.strictEqual((await subscribeSocket(waitSock1, m1.meetingCode)).status, 'WAITING');

    const approvedEvents1: any[] = [];
    waitSock1.on('meeting:admission-approved', (e) => approvedEvents1.push(e));
    const endedPromise1 = waitForEvent(waitSock1, 'meeting:ended');

    const b1 = createBarrier();
    const admitSvc1 = new MeetingService(realtimeHub, { beforeAdmitReserve: b1.pause });
    const endSvc1 = new MeetingService(realtimeHub);

    const admitPromise1 = admitSvc1.admitParticipant(m1.meetingCode, users[0].id, users[1].id);
    await b1.arrived;

    await endSvc1.endMeeting(m1.meetingCode, users[0].id);
    await endedPromise1;

    b1.release();
    await assert.rejects(
      () => admitPromise1,
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
    await flushEventLoop();

    const dbM1 = await Meeting.findById(m1.id);
    assert.strictEqual(dbM1?.status, 'ENDED');
    assert.strictEqual(dbM1?.activeParticipantCount, 0);
    const dbP1 = await MeetingParticipant.findOne({ meetingId: m1.id, userId: users[1].id });
    assert.strictEqual(dbP1?.admissionStatus, 'CANCELLED');
    assert.strictEqual(approvedEvents1.length, 0);

    // Subcase 1b: Pause admission AFTER Step A reserve write, BEFORE Step B participant write
    const m2 = await createActiveMeeting({ waitingRoomEnabled: true });
    await baseService.joinMeeting(m2.meetingCode, users[1].id);

    const waitSock2 = await connectSocket(serverUrl, users[1].token);
    openSockets.push(waitSock2);
    assert.strictEqual((await subscribeSocket(waitSock2, m2.meetingCode)).status, 'WAITING');

    const approvedEvents2: any[] = [];
    waitSock2.on('meeting:admission-approved', (e) => approvedEvents2.push(e));
    const endedPromise2 = waitForEvent(waitSock2, 'meeting:ended');

    const b2 = createBarrier();
    const admitSvc2 = new MeetingService(realtimeHub, { beforeAdmitParticipantWrite: b2.pause });
    const endSvc2 = new MeetingService(realtimeHub);

    const admitPromise2 = admitSvc2.admitParticipant(m2.meetingCode, users[0].id, users[1].id);
    await b2.arrived;

    await endSvc2.endMeeting(m2.meetingCode, users[0].id);
    await endedPromise2;

    b2.release();
    await assert.rejects(
      () => admitPromise2,
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
    await flushEventLoop();

    const dbM2 = await Meeting.findById(m2.id);
    assert.strictEqual(dbM2?.status, 'ENDED', 'Ended meeting must NEVER revert to ACTIVE');
    assert.strictEqual(dbM2?.activeParticipantCount, 0);
    const admittedInM2 = await MeetingParticipant.countDocuments({
      meetingId: m2.id,
      admissionStatus: 'ADMITTED',
    });
    assert.strictEqual(admittedInM2, 0);
    const waitingInM2 = await MeetingParticipant.countDocuments({
      meetingId: m2.id,
      admissionStatus: 'WAITING',
    });
    assert.strictEqual(waitingInM2, 0);
    assert.strictEqual(approvedEvents2.length, 0, 'No admission-approved event after termination');
  });

  it('Test B2 — Concurrent admission vs meeting termination (Order 2: Admission commits first -> termination ends room and transitions admitted user to LEFT)', async () => {
    const m = await createActiveMeeting({ waitingRoomEnabled: true });
    await baseService.joinMeeting(m.meetingCode, users[1].id);

    const barrier = createBarrier();
    const endSvc = new MeetingService(realtimeHub, { beforeEndWrite: barrier.pause });
    const admitSvc = new MeetingService(realtimeHub);

    const endPromise = endSvc.endMeeting(m.meetingCode, users[0].id);
    await barrier.arrived;

    // Admission commits completely BEFORE endMeeting writes
    const admitRes = await admitSvc.admitParticipant(m.meetingCode, users[0].id, users[1].id);
    assert.strictEqual(admitRes.participant.admissionStatus, 'ADMITTED');

    // Release endMeeting
    barrier.release();
    const endRes = await endPromise;
    assert.strictEqual(endRes.meeting.status, 'ENDED');

    const dbM = await Meeting.findById(m.id);
    assert.strictEqual(dbM?.status, 'ENDED');
    assert.strictEqual(dbM?.activeParticipantCount, 0);

    const admittedRemaining = await MeetingParticipant.countDocuments({
      meetingId: m.id,
      admissionStatus: 'ADMITTED',
    });
    assert.strictEqual(admittedRemaining, 0);

    // Ended meeting cannot return to ACTIVE on subsequent join
    await assert.rejects(
      () => baseService.joinMeeting(m.meetingCode, users[2].id),
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
    const dbMAfter = await Meeting.findById(m.id);
    assert.strictEqual(dbMAfter?.status, 'ENDED');
  });

  // =========================================================================
  // TEST C — CONCURRENT DIRECT JOIN VERSUS MEETING TERMINATION
  // =========================================================================
  it('Test C — Concurrent direct join vs meeting termination (paused pre-reserve AND mid-commit -> zero admitted participants after end)', async () => {
    // Subcase C1: Paused before Step A reserve
    const m1 = await createActiveMeeting({ waitingRoomEnabled: false });
    const b1 = createBarrier();
    const joinSvc1 = new MeetingService(realtimeHub, { beforeDirectJoinReserve: b1.pause });

    const joinP1 = joinSvc1.joinMeeting(m1.meetingCode, users[1].id);
    await b1.arrived;
    await baseService.endMeeting(m1.meetingCode, users[0].id);
    b1.release();

    await assert.rejects(
      () => joinP1,
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: m1.id, admissionStatus: 'ADMITTED' }),
      0
    );

    // Subcase C2: Paused AFTER Step A reserve, BEFORE Step B participant write
    const m2 = await createActiveMeeting({ waitingRoomEnabled: false });
    const hostSock = await connectSocket(serverUrl, users[0].token);
    openSockets.push(hostSock);
    await subscribeSocket(hostSock, m2.meetingCode);

    const joinedEvents: any[] = [];
    hostSock.on('meeting:participant-joined', (e) => joinedEvents.push(e));

    const b2 = createBarrier();
    const joinSvc2 = new MeetingService(realtimeHub, { beforeDirectJoinParticipantWrite: b2.pause });

    const joinP2 = joinSvc2.joinMeeting(m2.meetingCode, users[2].id);
    await b2.arrived;

    // Host terminates meeting while joinSvc2 is paused right between Step A and Step B
    await baseService.endMeeting(m2.meetingCode, users[0].id);

    b2.release();
    await assert.rejects(
      () => joinP2,
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
    await flushEventLoop();

    const dbM2 = await Meeting.findById(m2.id);
    assert.strictEqual(dbM2?.status, 'ENDED');
    assert.strictEqual(dbM2?.activeParticipantCount, 0);
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: m2.id, admissionStatus: 'ADMITTED' }),
      0,
      'Post-write guard must prevent admitted participant from persisting in ENDED room'
    );
    assert.strictEqual(joinedEvents.length, 0, 'No participant-joined event emitted after termination');
  });

  // =========================================================================
  // TEST D — WAITING-ROOM CANCELLATION / REJECTION RACE AGAINST ADMISSION
  // =========================================================================
  it('Test D — Waiting-room rejection/cancellation raced against admission: exactly one terminal decision wins and delayed duplicate cannot reverse it', async () => {
    // Subcase D1: Reject commits first while Admit is paused -> Admit gets 409, capacity rolls back, no participant-joined emitted
    const m1 = await createActiveMeeting({ waitingRoomEnabled: true });
    await baseService.joinMeeting(m1.meetingCode, users[1].id);

    const hostSock = await connectSocket(serverUrl, users[0].token);
    openSockets.push(hostSock);
    await subscribeSocket(hostSock, m1.meetingCode);
    const joinedEvents: any[] = [];
    hostSock.on('meeting:participant-joined', (e) => joinedEvents.push(e));

    const b1 = createBarrier();
    const admitSvc = new MeetingService(realtimeHub, { beforeAdmitParticipantWrite: b1.pause });
    const rejectSvc = new MeetingService(realtimeHub);

    const admitPromise = admitSvc.admitParticipant(m1.meetingCode, users[0].id, users[1].id);
    await b1.arrived;

    await rejectSvc.rejectParticipant(m1.meetingCode, users[0].id, users[1].id, 'Session full');
    b1.release();

    await assert.rejects(
      () => admitPromise,
      (err: any) => err.statusCode === 409 && err.code === 'WAITING_REQUEST_NOT_PENDING'
    );

    // Delayed duplicate rejection must also fail without altering state
    await assert.rejects(
      () => rejectSvc.rejectParticipant(m1.meetingCode, users[0].id, users[1].id, 'Duplicate'),
      (err: any) => err.statusCode === 409 && err.code === 'WAITING_REQUEST_NOT_PENDING'
    );

    await flushEventLoop();
    const dbM1 = await Meeting.findById(m1.id);
    const dbP1 = await MeetingParticipant.findOne({ meetingId: m1.id, userId: users[1].id });
    assert.strictEqual(dbM1?.activeParticipantCount, 1, 'Reserved capacity must be cleanly compensated');
    assert.strictEqual(dbP1?.admissionStatus, 'REJECTED');
    assert.strictEqual(joinedEvents.length, 0, 'No participant-joined event for rejected admission');

    // Subcase D2: Admit commits first while Reject is paused -> Reject fails 409 and cannot reverse ADMITTED
    const m2 = await createActiveMeeting({ waitingRoomEnabled: true });
    await baseService.joinMeeting(m2.meetingCode, users[2].id);

    const b2 = createBarrier();
    const slowRejectSvc = new MeetingService(realtimeHub, { beforeRejectWrite: b2.pause });
    const fastAdmitSvc = new MeetingService(realtimeHub);

    const rejectPromise = slowRejectSvc.rejectParticipant(m2.meetingCode, users[0].id, users[2].id);
    await b2.arrived;

    const admitRes = await fastAdmitSvc.admitParticipant(m2.meetingCode, users[0].id, users[2].id);
    assert.strictEqual(admitRes.participant.admissionStatus, 'ADMITTED');

    b2.release();
    await assert.rejects(
      () => rejectPromise,
      (err: any) => err.statusCode === 409 && err.code === 'WAITING_REQUEST_NOT_PENDING'
    );

    const dbP2 = await MeetingParticipant.findOne({ meetingId: m2.id, userId: users[2].id });
    assert.strictEqual(dbP2?.admissionStatus, 'ADMITTED', 'Delayed rejection must never reverse ADMITTED');

    // Subcase D3: Waiting user cancels (leaveMeeting) while Host Admit is paused -> Cancel wins, Admit fails 409 & rolls back capacity
    const m3 = await createActiveMeeting({ waitingRoomEnabled: true });
    await baseService.joinMeeting(m3.meetingCode, users[3].id);

    const b3 = createBarrier();
    const pausedAdmitSvc = new MeetingService(realtimeHub, { beforeAdmitParticipantWrite: b3.pause });
    const admitP3 = pausedAdmitSvc.admitParticipant(m3.meetingCode, users[0].id, users[3].id);
    await b3.arrived;

    await baseService.leaveMeeting(m3.meetingCode, users[3].id);
    b3.release();

    await assert.rejects(
      () => admitP3,
      (err: any) => err.statusCode === 409 && err.code === 'WAITING_REQUEST_NOT_PENDING'
    );
    const dbM3 = await Meeting.findById(m3.id);
    const dbP3 = await MeetingParticipant.findOne({ meetingId: m3.id, userId: users[3].id });
    assert.strictEqual(dbM3?.activeParticipantCount, 1, 'Capacity rolled back after user cancel');
    assert.strictEqual(dbP3?.admissionStatus, 'CANCELLED');
  });

  // =========================================================================
  // SECTION 3 — PARTICIPANT LEAVE, REJOIN, UNIQUE INDEX & CONCURRENT REJOIN
  // =========================================================================
  it('Test E — Leave & rejoin reactivates existing unique {meetingId, userId} doc, concurrent rejoins never duplicate or over-count, and locked/ended rejoin enforces policy', async () => {
    // 1. Verify unique compound index { meetingId: 1, userId: 1 } is intact
    const indexes = await MeetingParticipant.collection.indexes();
    const uniqueMemberIdx = indexes.find(
      (idx: any) => idx.key?.meetingId === 1 && idx.key?.userId === 1 && idx.unique === true
    );
    assert.ok(uniqueMemberIdx, 'Unique compound index { meetingId: 1, userId: 1 } must remain intact');

    const m = await createActiveMeeting({ waitingRoomEnabled: false });

    // 2. Join -> Leave -> Rejoin
    const firstJoin = await baseService.joinMeeting(m.meetingCode, users[1].id);
    assert.strictEqual(firstJoin.joinResult, 'ADMITTED');
    const originalRecordId = firstJoin.participant.id;
    assert.strictEqual((await Meeting.findById(m.id))?.activeParticipantCount, 2);

    await baseService.leaveMeeting(m.meetingCode, users[1].id);
    assert.strictEqual((await Meeting.findById(m.id))?.activeParticipantCount, 1);
    const afterLeave = await MeetingParticipant.findOne({ meetingId: m.id, userId: users[1].id });
    assert.strictEqual(afterLeave?.admissionStatus, 'LEFT');

    const rejoin = await baseService.joinMeeting(m.meetingCode, users[1].id);
    assert.strictEqual(rejoin.joinResult, 'ADMITTED');
    assert.strictEqual(rejoin.participant.id, originalRecordId, 'Must reactivate existing record');
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: m.id, userId: users[1].id }),
      1
    );
    assert.strictEqual((await Meeting.findById(m.id))?.activeParticipantCount, 2);

    // 3. Leave and fire 3 concurrent rejoin requests across 3 independent MeetingService instances
    await baseService.leaveMeeting(m.meetingCode, users[1].id);
    assert.strictEqual((await Meeting.findById(m.id))?.activeParticipantCount, 1);

    const svc1 = new MeetingService(realtimeHub);
    const svc2 = new MeetingService(realtimeHub);
    const svc3 = new MeetingService(realtimeHub);

    const concurrentRejoins = await Promise.all([
      svc1.joinMeeting(m.meetingCode, users[1].id),
      svc2.joinMeeting(m.meetingCode, users[1].id),
      svc3.joinMeeting(m.meetingCode, users[1].id),
    ]);

    assert.ok(
      concurrentRejoins.every((r) => r.joinResult === 'ADMITTED' || r.joinResult === 'ALREADY_ADMITTED')
    );
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: m.id, userId: users[1].id }),
      1,
      'Concurrent rejoins must never create duplicate participant documents'
    );
    assert.strictEqual(
      (await Meeting.findById(m.id))?.activeParticipantCount,
      2,
      'Participant count must increment exactly once across concurrent rejoins'
    );

    // 4. Rejoining a locked meeting is blocked with 403 MEETING_LOCKED
    await baseService.leaveMeeting(m.meetingCode, users[1].id);
    await baseService.setMeetingLock(m.meetingCode, users[0].id, true);
    await assert.rejects(
      () => baseService.joinMeeting(m.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'MEETING_LOCKED'
    );

    // 5. Rejoining an ended meeting is blocked with 410 MEETING_ENDED
    await baseService.endMeeting(m.meetingCode, users[0].id);
    await assert.rejects(
      () => baseService.joinMeeting(m.meetingCode, users[1].id),
      (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
    );
  });

  // =========================================================================
  // SECTION 3 & 4 — SOCKET RECONNECT, OLD-SOCKET EVICTION & REMOVAL LOCKOUT
  // =========================================================================
  it('Test F — Reconnect keeps single membership & fresh state; leaving co-host old socket loses privileged events; removed user cannot regain admission via reconnect', async () => {
    const m = await createActiveMeeting({ waitingRoomEnabled: false });

    // Admit user 1 and promote to co-host; admit user 2 as regular participant
    await baseService.joinMeeting(m.meetingCode, users[1].id);
    await baseService.updateParticipantRole(m.meetingCode, users[0].id, users[1].id, {
      role: 'co-host',
    });
    await baseService.joinMeeting(m.meetingCode, users[2].id);

    // Connect co-host socket & participant socket
    const coHostSock = await connectSocket(serverUrl, users[1].token);
    const partSock = await connectSocket(serverUrl, users[2].token);
    openSockets.push(coHostSock, partSock);

    assert.strictEqual((await subscribeSocket(coHostSock, m.meetingCode)).status, 'ADMITTED');
    assert.strictEqual((await subscribeSocket(partSock, m.meetingCode)).status, 'ADMITTED');

    // 1. Participant disconnects and reconnects -> single membership preserved & fresh state synced
    partSock.disconnect();
    await flushEventLoop(100);
    const offlineDoc = await MeetingParticipant.findOne({ meetingId: m.id, userId: users[2].id });
    assert.strictEqual(offlineDoc?.presenceStatus, 'OFFLINE');
    assert.strictEqual(offlineDoc?.admissionStatus, 'ADMITTED');

    const partSock2 = await connectSocket(serverUrl, users[2].token);
    openSockets.push(partSock2);
    assert.strictEqual((await subscribeSocket(partSock2, m.meetingCode)).status, 'ADMITTED');
    const onlineDoc = await MeetingParticipant.findOne({ meetingId: m.id, userId: users[2].id });
    assert.strictEqual(onlineDoc?.presenceStatus, 'ONLINE');
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: m.id, userId: users[2].id }),
      1
    );
    const freshState = await baseService.getMeetingState(m.meetingCode, users[2].id);
    assert.strictEqual(freshState.participants.length, 3);
    assert.strictEqual(freshState.waitingList, undefined, 'Regular participant must not receive waiting list');

    // 2. Co-host leaves while keeping old socket open -> must NEVER receive subsequent waiting-room updates
    const coHostPostLeaveEvents: any[] = [];
    coHostSock.on('meeting:waiting-room-updated', (e) => coHostPostLeaveEvents.push(e));
    coHostSock.on('meeting:participant-joined', (e) => coHostPostLeaveEvents.push(e));

    await baseService.leaveMeeting(m.meetingCode, users[1].id);
    await baseService.updateSettings(m.meetingCode, users[0].id, { waitingRoomEnabled: true });

    // User 3 enters waiting room -> triggers waiting-room-updated on :hosts channel
    const waitRes = await baseService.joinMeeting(m.meetingCode, users[3].id);
    assert.strictEqual(waitRes.joinResult, 'WAITING');
    await flushEventLoop(100);
    assert.strictEqual(
      coHostPostLeaveEvents.length,
      0,
      'Old socket of departed co-host must be evicted from privileged channels'
    );

    // 3. Remove participant user 2 -> socket evicted, reconnect subscribe rejected, rejoin rejected
    const removedEventPromise = waitForEvent(partSock2, 'meeting:participant-removed');
    await baseService.removeParticipant(m.meetingCode, users[0].id, users[2].id, 'Policy violation');
    await removedEventPromise;

    const reconnectAttempt = await connectSocket(serverUrl, users[2].token);
    openSockets.push(reconnectAttempt);
    const reSubAck = await subscribeSocket(reconnectAttempt, m.meetingCode);
    assert.strictEqual(reSubAck.ok, false);
    assert.strictEqual(reSubAck.code, 'FORBIDDEN');

    await assert.rejects(
      () => baseService.joinMeeting(m.meetingCode, users[2].id),
      (err: any) => err.statusCode === 403 && err.code === 'PARTICIPANT_REMOVED'
    );
  });

  // =========================================================================
  // SECTION 4 — STALE LOCK/UNLOCK EVENT ORDERING PROTECTION
  // =========================================================================
  it('Test G — Out-of-order stale lock event cannot contradict newer authoritative unlocked room state', async () => {
    const m = await createActiveMeeting({ waitingRoomEnabled: false });
    const hostSock = await connectSocket(serverUrl, users[0].token);
    openSockets.push(hostSock);
    await subscribeSocket(hostSock, m.meetingCode);

    const lockTimeline: Array<{ event: string; isLocked: boolean; version?: number }> = [];
    hostSock.on('meeting:locked', (p) =>
      lockTimeline.push({ event: 'locked', isLocked: p.isLocked, version: p.version })
    );
    hostSock.on('meeting:unlocked', (p) =>
      lockTimeline.push({ event: 'unlocked', isLocked: p.isLocked, version: p.version })
    );

    const barrier = createBarrier();
    const slowLockSvc = new MeetingService(realtimeHub, { beforeLockEmit: barrier.pause });
    const fastUnlockSvc = new MeetingService(realtimeHub);

    // 1. Lock commits in MongoDB (version N) and pauses right before Socket.IO emit
    const lockPromise = slowLockSvc.setMeetingLock(m.meetingCode, users[0].id, true);
    await barrier.arrived;

    // 2. Unlock commits in MongoDB (version N+1) and emits meeting:unlocked immediately
    const unlockedPromise = waitForEvent(hostSock, 'meeting:unlocked');
    await fastUnlockSvc.setMeetingLock(m.meetingCode, users[0].id, false);
    await unlockedPromise;

    // 3. Release paused lock emission -> MUST be suppressed because version N < authoritative N+1
    barrier.release();
    await lockPromise;
    await flushEventLoop(100);

    const authoritativeDb = await Meeting.findById(m.id);
    assert.strictEqual(authoritativeDb?.isLocked, false);
    assert.strictEqual(lockTimeline.length, 1, 'Stale meeting:locked event must be suppressed');
    assert.strictEqual(lockTimeline[0].event, 'unlocked');
    assert.strictEqual(lockTimeline[0].isLocked, false);
  });
});
