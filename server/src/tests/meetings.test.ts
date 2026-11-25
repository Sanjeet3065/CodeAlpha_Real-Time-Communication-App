import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { meetingService } from '../services/meeting.service.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';
import type { Server } from 'node:http';

describe('Phase 08 Meeting Room Management — REST API, Permissions, Lifecycle & Concurrency Suite', () => {
  let server: Server;
  let baseUrl: string;

  const users: Array<{ id: string; email: string; token: string; name: string }> = [];

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_meetings_phase08_test');
    await User.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');
    const profiles = [
      { email: 'host@connectly.io', firstName: 'Elena', lastName: 'Host' },
      { email: 'cohost@connectly.io', firstName: 'Marcus', lastName: 'CoHost' },
      { email: 'alice@connectly.io', firstName: 'Alice', lastName: 'Participant' },
      { email: 'bob@connectly.io', firstName: 'Bob', lastName: 'Participant' },
      { email: 'charlie@connectly.io', firstName: 'Charlie', lastName: 'Participant' },
    ];

    for (const p of profiles) {
      const created = await User.create({
        email: p.email,
        passwordHash,
        firstName: p.firstName,
        lastName: p.lastName,
        isEmailVerified: true,
      });
      const id = created._id.toString();
      users.push({
        id,
        email: p.email,
        name: `${p.firstName} ${p.lastName}`,
        token: generateAccessToken({
          sub: id,
          email: p.email,
          firstName: p.firstName,
          lastName: p.lastName,
        }),
      });
    }

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await MeetingParticipant.deleteMany({});
    await Meeting.deleteMany({});
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  const authHeaders = (token: string) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  it('1. Rejects unauthenticated meeting creation with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/meetings/instant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Room' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('2. Creates authenticated meeting with unique CSPRNG cly-xxx-xxx code, shareable link, and rejects mass assignment', async () => {
    const res1 = await fetch(`${baseUrl}/api/v1/meetings/instant`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({
        title: 'Architecture Review',
        maxParticipants: 60,
        settings: { waitingRoomEnabled: false },
      }),
    });
    assert.strictEqual(res1.status, 201);
    const body1 = (await res1.json()) as any;
    assert.strictEqual(body1.success, true);
    assert.match(body1.data.meeting.meetingCode, /^cly-[a-z0-9]{3}-[a-z0-9]{3}$/);
    assert.strictEqual(body1.data.meeting.status, 'CREATED');
    assert.strictEqual(body1.data.meeting.hostId, users[0].id);
    assert.ok(body1.data.meeting.joinUrl.endsWith(`/join/${body1.data.meeting.meetingCode}`));

    const res2 = await fetch(`${baseUrl}/api/v1/meetings`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({ title: 'Second Room' }),
    });
    assert.strictEqual(res2.status, 201);
    const body2 = (await res2.json()) as any;
    assert.notStrictEqual(body1.data.meeting.meetingCode, body2.data.meeting.meetingCode);

    // Mass assignment defense
    const badRes = await fetch(`${baseUrl}/api/v1/meetings/instant`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({ title: 'Evil', status: 'ACTIVE', hostId: users[1].id }),
    });
    assert.strictEqual(badRes.status, 400);
    const badBody = (await badRes.json()) as any;
    assert.strictEqual(badBody.code, 'VALIDATION_ERROR');
  });

  it('3. Rejects invalid meeting codes (400) and non-existent codes (404)', async () => {
    const invalidRes = await fetch(`${baseUrl}/api/v1/meetings/validate/not-a-valid-code!!`, {
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as any;
    assert.strictEqual(invalidBody.code, 'INVALID_MEETING_CODE');

    const missingRes = await fetch(`${baseUrl}/api/v1/meetings/validate/cly-zzz-999`, {
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(missingRes.status, 404);
    const missingBody = (await missingRes.json()) as any;
    assert.strictEqual(missingBody.code, 'MEETING_NOT_FOUND');
  });

  it('4. Host join activates meeting (CREATED -> ACTIVE), participant joins directly, duplicate join is idempotent, and direct state access without joining is blocked (403)', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Direct Join Room',
      settings: { waitingRoomEnabled: false },
    });
    const code = meeting.meetingCode;

    // Direct access to state/participants before joining must fail with 403
    const bypassState = await fetch(`${baseUrl}/api/v1/meetings/${code}/state`, {
      headers: authHeaders(users[2].token),
    });
    assert.strictEqual(bypassState.status, 403);

    const bypassRoster = await fetch(`${baseUrl}/api/v1/meetings/${code}/participants`, {
      headers: authHeaders(users[2].token),
    });
    assert.strictEqual(bypassRoster.status, 403);

    // Host joins -> activates meeting
    const hostJoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(hostJoin.status, 200);
    const hostBody = (await hostJoin.json()) as any;
    assert.strictEqual(hostBody.data.joinResult, 'ADMITTED');
    assert.strictEqual(hostBody.data.meeting.status, 'ACTIVE');
    assert.strictEqual(hostBody.data.meeting.activeParticipantCount, 1);
    assert.strictEqual(hostBody.data.participant.role, 'host');

    // Participant joins directly
    const pJoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[2].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(pJoin.status, 200);
    const pBody = (await pJoin.json()) as any;
    assert.strictEqual(pBody.data.joinResult, 'ADMITTED');
    assert.strictEqual(pBody.data.meeting.activeParticipantCount, 2);
    assert.strictEqual(pBody.data.participant.role, 'participant');

    // Duplicate join by same participant is idempotent with zero duplicate records
    const dupJoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[2].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(dupJoin.status, 200);
    const dupBody = (await dupJoin.json()) as any;
    assert.strictEqual(dupBody.data.joinResult, 'ALREADY_ADMITTED');
    assert.strictEqual(dupBody.data.meeting.activeParticipantCount, 2);

    const countInDb = await MeetingParticipant.countDocuments({
      meetingId: meeting.id,
      userId: users[2].id,
    });
    assert.strictEqual(countInDb, 1);
  });

  it('5. Meeting lock blocks new non-host joins (403 MEETING_LOCKED), preserves existing participants, and unlock restores joining', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Lock Test Room',
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id);
    await meetingService.joinMeeting(code, users[2].id);

    // Host locks meeting
    const lockRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/lock`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(lockRes.status, 200);
    const lockBody = (await lockRes.json()) as any;
    assert.strictEqual(lockBody.data.meeting.isLocked, true);

    // New user blocked
    const blockedJoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[3].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(blockedJoin.status, 403);
    const blockedBody = (await blockedJoin.json()) as any;
    assert.strictEqual(blockedBody.code, 'MEETING_LOCKED');

    // Existing admitted participant still has access
    const existingState = await fetch(`${baseUrl}/api/v1/meetings/${code}/state`, {
      headers: authHeaders(users[2].token),
    });
    assert.strictEqual(existingState.status, 200);

    // Unlock restores joining
    const unlockRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/unlock`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(unlockRes.status, 200);

    const allowedJoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[3].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(allowedJoin.status, 200);
  });

  it('6. Enforces maxParticipants capacity limit (403 MEETING_FULL)', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Capacity 2 Room',
      maxParticipants: 2,
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id);
    await meetingService.joinMeeting(code, users[1].id);

    const fullRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[2].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(fullRes.status, 403);
    const fullBody = (await fullRes.json()) as any;
    assert.strictEqual(fullBody.code, 'MEETING_FULL');
  });

  it('7. Waiting room workflow: pending queue, no self-admission bypass, host admit, host reject, and cancelled request cannot be admitted later', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Waiting Room Sync',
      settings: { waitingRoomEnabled: true },
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id);

    // Alice requests join -> enters WAITING
    const waitRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[2].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(waitRes.status, 200);
    const waitBody = (await waitRes.json()) as any;
    assert.strictEqual(waitBody.data.joinResult, 'WAITING');
    assert.strictEqual(waitBody.data.participant.admissionStatus, 'WAITING');

    // Duplicate waiting join is safe & idempotent
    const dupWait = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[2].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(dupWait.status, 200);
    assert.strictEqual(((await dupWait.json()) as any).data.joinResult, 'WAITING');

    // Waiting user CANNOT view active roster (403) or self-admit (403)
    const rosterAttempt = await fetch(`${baseUrl}/api/v1/meetings/${code}/participants`, {
      headers: authHeaders(users[2].token),
    });
    assert.strictEqual(rosterAttempt.status, 403);

    const selfAdmit = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/waiting-room/${users[2].id}/admit`,
      { method: 'POST', headers: authHeaders(users[2].token) }
    );
    assert.strictEqual(selfAdmit.status, 403);

    // Host sees Alice in waiting room and admits her
    const listWait = await fetch(`${baseUrl}/api/v1/meetings/${code}/waiting-room`, {
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(listWait.status, 200);
    const listBody = (await listWait.json()) as any;
    assert.strictEqual(listBody.data.count, 1);
    assert.strictEqual(listBody.data.waitingList[0].userId, users[2].id);

    const admitRes = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/waiting-room/${users[2].id}/admit`,
      { method: 'POST', headers: authHeaders(users[0].token) }
    );
    assert.strictEqual(admitRes.status, 200);
    const admitBody = (await admitRes.json()) as any;
    assert.strictEqual(admitBody.data.participant.admissionStatus, 'ADMITTED');
    assert.strictEqual(admitBody.data.activeParticipantCount, 2);

    // Bob requests join -> Host rejects Bob
    await meetingService.joinMeeting(code, users[3].id);
    const rejectRes = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/waiting-room/${users[3].id}/reject`,
      {
        method: 'POST',
        headers: authHeaders(users[0].token),
        body: JSON.stringify({ reason: 'Private session' }),
      }
    );
    assert.strictEqual(rejectRes.status, 200);

    // Rejected request cannot subsequently be admitted (409)
    const admitRejected = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/waiting-room/${users[3].id}/admit`,
      { method: 'POST', headers: authHeaders(users[0].token) }
    );
    assert.strictEqual(admitRejected.status, 409);

    // Charlie requests join, then cancels via /leave -> Host cannot admit cancelled request (409)
    await meetingService.joinMeeting(code, users[4].id);
    await meetingService.leaveMeeting(code, users[4].id);
    const admitCancelled = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/waiting-room/${users[4].id}/admit`,
      { method: 'POST', headers: authHeaders(users[0].token) }
    );
    assert.strictEqual(admitCancelled.status, 409);
  });

  it('8. Enforces Host / Co-Host / Participant permission matrix strictly on the backend', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Permission Matrix Room',
      settings: {
        waitingRoomEnabled: false,
        allowCoHostAdmit: true,
        allowCoHostRemove: true,
        allowCoHostLock: false,
      },
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id); // Host
    await meetingService.joinMeeting(code, users[1].id); // Soon Co-Host
    await meetingService.joinMeeting(code, users[2].id); // Participant Alice
    await meetingService.joinMeeting(code, users[3].id); // Participant Bob

    // Regular participant CANNOT promote self, lock, change settings, remove others, or end meeting
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/participants/${users[2].id}/role`, {
          method: 'PATCH',
          headers: authHeaders(users[2].token),
          body: JSON.stringify({ role: 'co-host' }),
        })
      ).status,
      403
    );
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/lock`, {
          method: 'POST',
          headers: authHeaders(users[2].token),
        })
      ).status,
      403
    );
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/end`, {
          method: 'POST',
          headers: authHeaders(users[2].token),
        })
      ).status,
      403
    );

    // Host promotes Marcus to Co-Host
    const promoteRes = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/participants/${users[1].id}/role`,
      {
        method: 'PATCH',
        headers: authHeaders(users[0].token),
        body: JSON.stringify({ role: 'co-host' }),
      }
    );
    assert.strictEqual(promoteRes.status, 200);
    assert.strictEqual(((await promoteRes.json()) as any).data.participant.role, 'co-host');

    // Co-Host CANNOT promote another user (Host-only)
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/participants/${users[2].id}/role`, {
          method: 'PATCH',
          headers: authHeaders(users[1].token),
          body: JSON.stringify({ role: 'co-host' }),
        })
      ).status,
      403
    );

    // Co-Host CANNOT remove Host
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/participants/${users[0].id}`, {
          method: 'DELETE',
          headers: authHeaders(users[1].token),
          body: JSON.stringify({}),
        })
      ).status,
      403
    );

    // Co-Host CANNOT end meeting for everyone
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/end`, {
          method: 'POST',
          headers: authHeaders(users[1].token),
        })
      ).status,
      403
    );

    // Co-Host CANNOT lock while allowCoHostLock is false
    assert.strictEqual(
      (
        await fetch(`${baseUrl}/api/v1/meetings/${code}/lock`, {
          method: 'POST',
          headers: authHeaders(users[1].token),
        })
      ).status,
      403
    );

    // Co-Host CAN remove regular participant Bob (allowCoHostRemove = true)
    const cohostRemove = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/participants/${users[3].id}`,
      {
        method: 'DELETE',
        headers: authHeaders(users[1].token),
        body: JSON.stringify({ reason: 'Disruptive' }),
      }
    );
    assert.strictEqual(cohostRemove.status, 200);

    // Removed participant Bob CANNOT rejoin (403 PARTICIPANT_REMOVED)
    const bobRejoin = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[3].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(bobRejoin.status, 403);
    assert.strictEqual(((await bobRejoin.json()) as any).code, 'PARTICIPANT_REMOVED');

    // Host updates settings to delegate lock to co-host -> Co-Host can now lock!
    const settingsRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/settings`, {
      method: 'PATCH',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({ allowCoHostLock: true, waitingRoomEnabled: true }),
    });
    assert.strictEqual(settingsRes.status, 200);

    const cohostLock = await fetch(`${baseUrl}/api/v1/meetings/${code}/lock`, {
      method: 'POST',
      headers: authHeaders(users[1].token),
    });
    assert.strictEqual(cohostLock.status, 200);

    // Host revokes Co-Host -> Marcus loses lock permission immediately
    const revokeRes = await fetch(
      `${baseUrl}/api/v1/meetings/${code}/participants/${users[1].id}/role`,
      {
        method: 'PATCH',
        headers: authHeaders(users[0].token),
        body: JSON.stringify({ role: 'participant' }),
      }
    );
    assert.strictEqual(revokeRes.status, 200);

    const revokedUnlock = await fetch(`${baseUrl}/api/v1/meetings/${code}/unlock`, {
      method: 'POST',
      headers: authHeaders(users[1].token),
    });
    assert.strictEqual(revokedUnlock.status, 403);
  });

  it('9. Host departure transfers ownership deterministically to Co-Host, and last-member host departure ends the meeting cleanly', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Handover Policy Room',
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id);
    await meetingService.joinMeeting(code, users[2].id); // joined earlier as participant
    await meetingService.joinMeeting(code, users[1].id); // joined later, promoted to co-host
    await meetingService.updateParticipantRole(code, users[0].id, users[1].id, { role: 'co-host' });

    // Host leaves -> Co-Host (users[1]) must inherit Host role
    const leaveRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/leave`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(leaveRes.status, 200);
    const leaveBody = (await leaveRes.json()) as any;
    assert.strictEqual(leaveBody.data.meetingEnded, false);
    assert.strictEqual(leaveBody.data.newHostId, users[1].id);

    const updatedMeeting = await Meeting.findById(meeting.id);
    assert.strictEqual(updatedMeeting?.hostId.toString(), users[1].id);
    assert.strictEqual(updatedMeeting?.status, 'ACTIVE');

    // Participant Alice leaves, then new Host Marcus leaves alone -> meeting terminates cleanly
    await meetingService.leaveMeeting(code, users[2].id);
    const lastLeave = await meetingService.leaveMeeting(code, users[1].id);
    assert.strictEqual(lastLeave.meetingEnded, true);

    const endedMeeting = await Meeting.findById(meeting.id);
    assert.strictEqual(endedMeeting?.status, 'ENDED');
    assert.strictEqual(endedMeeting?.activeParticipantCount, 0);
  });

  it('10. Host ending meeting cancels waiting room requests, blocks new joins (410), and cannot be reopened', async () => {
    const { meeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Termination Room',
      settings: { waitingRoomEnabled: true },
    });
    const code = meeting.meetingCode;
    await meetingService.joinMeeting(code, users[0].id);
    await meetingService.joinMeeting(code, users[2].id); // waiting

    const endRes = await fetch(`${baseUrl}/api/v1/meetings/${code}/end`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
    });
    assert.strictEqual(endRes.status, 200);
    assert.strictEqual(((await endRes.json()) as any).data.meeting.status, 'ENDED');

    // Waiting participant must now be CANCELLED
    const waitDoc = await MeetingParticipant.findOne({ meetingId: meeting.id, userId: users[2].id });
    assert.strictEqual(waitDoc?.admissionStatus, 'CANCELLED');

    // Ended meeting rejects joins with 410 MEETING_ENDED
    const joinEnded = await fetch(`${baseUrl}/api/v1/meetings/${code}/join`, {
      method: 'POST',
      headers: authHeaders(users[3].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(joinEnded.status, 410);
    assert.strictEqual(((await joinEnded.json()) as any).code, 'MEETING_ENDED');
  });

  it('11. Expired meeting automatically transitions to EXPIRED and rejects joins with 410', async () => {
    const { meeting } = await meetingService.createMeeting(
      users[0].id,
      { title: 'Expiring Room' },
      -1000 // already expired 1s ago
    );

    const res = await fetch(`${baseUrl}/api/v1/meetings/${meeting.meetingCode}/join`, {
      method: 'POST',
      headers: authHeaders(users[0].token),
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 410);
    const body = (await res.json()) as any;
    assert.strictEqual(body.code, 'MEETING_EXPIRED');

    const persisted = await Meeting.findById(meeting.id);
    assert.strictEqual(persisted?.status, 'EXPIRED');
  });

  it('12. Concurrency: simultaneous joins by same user and multiple users racing against capacity/lock/end maintain exact consistency', async () => {
    // Subcase A: 4 simultaneous joins by same user + 4 distinct users racing for capacity = 3
    const { meeting: capMeeting } = await meetingService.createMeeting(users[0].id, {
      title: 'Concurrent Capacity Room',
      maxParticipants: 3,
    });
    await meetingService.joinMeeting(capMeeting.meetingCode, users[0].id); // 1/3

    // Same user firing 4 concurrent joins must result in exactly 1 record and +1 count
    const sameUserResults = await Promise.all([
      meetingService.joinMeeting(capMeeting.meetingCode, users[1].id),
      meetingService.joinMeeting(capMeeting.meetingCode, users[1].id),
      meetingService.joinMeeting(capMeeting.meetingCode, users[1].id),
      meetingService.joinMeeting(capMeeting.meetingCode, users[1].id),
    ]);
    assert.strictEqual(sameUserResults.length, 4);
    assert.strictEqual(
      await MeetingParticipant.countDocuments({ meetingId: capMeeting.id, userId: users[1].id }),
      1
    );

    // 3 distinct remaining users racing for the single remaining slot (2/3 -> max 3/3)
    const raceOutcomes = await Promise.allSettled([
      meetingService.joinMeeting(capMeeting.meetingCode, users[2].id),
      meetingService.joinMeeting(capMeeting.meetingCode, users[3].id),
      meetingService.joinMeeting(capMeeting.meetingCode, users[4].id),
    ]);
    const admittedCount = raceOutcomes.filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = raceOutcomes.filter((r) => r.status === 'rejected').length;
    assert.strictEqual(admittedCount, 1, 'Exactly 1 user must claim the final capacity slot');
    assert.strictEqual(rejectedCount, 2, 'Remaining 2 users must be rejected with MEETING_FULL');

    const persistedCap = await Meeting.findById(capMeeting.id);
    assert.strictEqual(persistedCap?.activeParticipantCount, 3);

    // Subcase B: Concurrent join vs meeting lock
    const { meeting: lockRace } = await meetingService.createMeeting(users[0].id, {
      title: 'Lock Race Room',
    });
    await meetingService.joinMeeting(lockRace.meetingCode, users[0].id);

    await Promise.allSettled([
      meetingService.setMeetingLock(lockRace.meetingCode, users[0].id, true),
      meetingService.joinMeeting(lockRace.meetingCode, users[2].id),
    ]);

    const afterLockRace = await Meeting.findById(lockRace.id);
    assert.strictEqual(afterLockRace?.isLocked, true);
    // Any subsequent non-host join after lock is committed MUST fail
    await assert.rejects(
      () => meetingService.joinMeeting(lockRace.meetingCode, users[3].id),
      (err: any) => err.code === 'MEETING_LOCKED'
    );

    // Subcase C: Concurrent host admission vs meeting termination
    const { meeting: endRace } = await meetingService.createMeeting(users[0].id, {
      title: 'End vs Admit Race',
      settings: { waitingRoomEnabled: true },
    });
    await meetingService.joinMeeting(endRace.meetingCode, users[0].id);
    await meetingService.joinMeeting(endRace.meetingCode, users[2].id); // waiting

    await Promise.allSettled([
      meetingService.admitParticipant(endRace.meetingCode, users[0].id, users[2].id),
      meetingService.endMeeting(endRace.meetingCode, users[0].id),
    ]);

    const afterEndRace = await Meeting.findById(endRace.id);
    assert.strictEqual(afterEndRace?.status, 'ENDED');
    const admittedAfterEnd = await MeetingParticipant.countDocuments({
      meetingId: endRace.id,
      admissionStatus: 'ADMITTED',
    });
    // Wait briefly if admit postCheck compensation is completing; ensure clean terminal state
    assert.strictEqual(admittedAfterEnd, 0, 'No participant may remain ADMITTED in an ENDED meeting');
  });
});
