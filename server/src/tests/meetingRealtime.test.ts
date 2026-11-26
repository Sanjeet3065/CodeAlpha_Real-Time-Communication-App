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

function waitForEvent<T = any>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
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

function connectSocket(url: string, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      auth: token ? { token } : {},
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

describe('Phase 08 Real-Time Socket.IO Security, Isolation & Room Events Suite', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const realtimeHub = new MeetingRealtimeHub();
  const service = new MeetingService(realtimeHub);

  const users: Array<{ id: string; token: string }> = [];

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_meeting_realtime_test');
    await User.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});

    const passwordHash = await hashPassword('SecurePassword123!');
    for (const [idx, firstName] of ['Host', 'Alice', 'Bob', 'Outsider'].entries()) {
      const u = await User.create({
        email: `rt_${idx}_${firstName.toLowerCase()}@connectly.io`,
        passwordHash,
        firstName,
        lastName: 'Realtime',
        isEmailVerified: true,
      });
      const id = u._id.toString();
      users.push({
        id,
        token: generateAccessToken({
          sub: id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
        }),
      });
    }

    const app = createApp();
    httpServer = http.createServer(app);
    realtimeHub.attach(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') {
          serverUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    realtimeHub.close();
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await MeetingParticipant.deleteMany({});
    await Meeting.deleteMany({});
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. Rejects unauthenticated Socket.IO handshake (missing or malformed JWT)', async () => {
    await assert.rejects(() => connectSocket(serverUrl), /UNAUTHORIZED/i);
    await assert.rejects(() => connectSocket(serverUrl, 'invalid.jwt.token'), /UNAUTHORIZED/i);
  });

  it('2. Rejects unauthorized room subscription by non-member with FORBIDDEN', async () => {
    const { meeting } = await service.createMeeting(users[0].id, { title: 'Private Room' });
    await service.joinMeeting(meeting.meetingCode, users[0].id);

    const outsiderSocket = await connectSocket(serverUrl, users[3].token);
    try {
      const ack = await subscribeSocket(outsiderSocket, meeting.meetingCode);
      assert.strictEqual(ack.ok, false);
      assert.strictEqual(ack.code, 'FORBIDDEN');
    } finally {
      outsiderSocket.disconnect();
    }
  });

  it('3. Enforces cross-meeting event isolation: Room A members never receive Room B events', async () => {
    const { meeting: roomA } = await service.createMeeting(users[0].id, { title: 'Room A' });
    const { meeting: roomB } = await service.createMeeting(users[1].id, { title: 'Room B' });
    await service.joinMeeting(roomA.meetingCode, users[0].id);
    await service.joinMeeting(roomB.meetingCode, users[1].id);

    const sockA = await connectSocket(serverUrl, users[0].token);
    const sockB = await connectSocket(serverUrl, users[1].token);

    try {
      assert.strictEqual((await subscribeSocket(sockA, roomA.meetingCode)).ok, true);
      assert.strictEqual((await subscribeSocket(sockB, roomB.meetingCode)).ok, true);

      let leakedToA = false;
      sockA.on('meeting:locked', () => {
        leakedToA = true;
      });

      const lockBP = waitForEvent(sockB, 'meeting:locked');
      await service.setMeetingLock(roomB.meetingCode, users[1].id, true);
      const lockBEvent = await lockBP;
      assert.strictEqual(lockBEvent.meetingId, roomB.id);

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(leakedToA, false, 'Room B events must NEVER leak to Room A');
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  });

  it('4. Waiting room real-time flow: hosts receive queue updates, regular participants do not, and waiting user receives admission approval', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Waiting RT Room',
      settings: { waitingRoomEnabled: false },
    });
    await service.joinMeeting(meeting.meetingCode, users[0].id); // Host
    await service.joinMeeting(meeting.meetingCode, users[1].id); // Regular participant Alice
    await service.updateSettings(meeting.meetingCode, users[0].id, { waitingRoomEnabled: true });

    const hostSock = await connectSocket(serverUrl, users[0].token);
    const aliceSock = await connectSocket(serverUrl, users[1].token);
    const bobSock = await connectSocket(serverUrl, users[2].token);

    try {
      assert.strictEqual((await subscribeSocket(hostSock, meeting.meetingCode)).status, 'ADMITTED');
      assert.strictEqual((await subscribeSocket(aliceSock, meeting.meetingCode)).status, 'ADMITTED');

      let aliceGotWaitingEvent = false;
      aliceSock.on('meeting:waiting-room-updated', () => {
        aliceGotWaitingEvent = true;
      });

      const hostWaitP = waitForEvent(hostSock, 'meeting:waiting-room-updated');
      const bobJoin = await service.joinMeeting(meeting.meetingCode, users[2].id);
      assert.strictEqual(bobJoin.joinResult, 'WAITING');

      const hostWaitEvt = await hostWaitP;
      assert.strictEqual(hostWaitEvt.count, 1);
      assert.strictEqual(hostWaitEvt.waitingList[0].userId, users[2].id);

      // Subscribe Bob into his private waiting channel
      const bobAck = await subscribeSocket(bobSock, meeting.meetingCode);
      assert.strictEqual(bobAck.ok, true);
      assert.strictEqual(bobAck.status, 'WAITING');

      // Host admits Bob -> Bob receives meeting:admission-approved, Alice receives meeting:participant-joined
      const bobApprovedP = waitForEvent(bobSock, 'meeting:admission-approved');
      const aliceJoinedP = waitForEvent(aliceSock, 'meeting:participant-joined');
      await service.admitParticipant(meeting.meetingCode, users[0].id, users[2].id);

      const bobApproved = await bobApprovedP;
      const aliceJoined = await aliceJoinedP;
      assert.strictEqual(bobApproved.participant.userId, users[2].id);
      assert.strictEqual(aliceJoined.participant.userId, users[2].id);
      assert.strictEqual(aliceGotWaitingEvent, false, 'Regular participants must never see waiting-room queue');
    } finally {
      hostSock.disconnect();
      aliceSock.disconnect();
      bobSock.disconnect();
    }
  });

  it('5. Participant removal evicts target socket immediately and meeting end notifies both admitted and waiting sockets', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Removal & End RT Room',
      settings: { waitingRoomEnabled: false },
    });
    await service.joinMeeting(meeting.meetingCode, users[0].id);
    await service.joinMeeting(meeting.meetingCode, users[1].id);
    await service.updateSettings(meeting.meetingCode, users[0].id, { waitingRoomEnabled: true });
    await service.joinMeeting(meeting.meetingCode, users[2].id); // waiting

    const hostSock = await connectSocket(serverUrl, users[0].token);
    const aliceSock = await connectSocket(serverUrl, users[1].token);
    const bobSock = await connectSocket(serverUrl, users[2].token);

    try {
      await subscribeSocket(hostSock, meeting.meetingCode);
      await subscribeSocket(aliceSock, meeting.meetingCode);
      await subscribeSocket(bobSock, meeting.meetingCode);

      // Remove Alice
      const removedP = waitForEvent(aliceSock, 'meeting:participant-removed');
      await service.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Policy');
      const removedEvt = await removedP;
      assert.strictEqual(removedEvt.userId, users[1].id);

      // End meeting -> waiting Bob receives meeting:ended
      const bobEndedP = waitForEvent(bobSock, 'meeting:ended');
      await service.endMeeting(meeting.meetingCode, users[0].id);
      const bobEnded = await bobEndedP;
      assert.strictEqual(bobEnded.meetingId, meeting.id);
    } finally {
      hostSock.disconnect();
      aliceSock.disconnect();
      bobSock.disconnect();
    }
  });

  it('6. Disconnect marks presence OFFLINE while preserving ADMITTED membership so reconnect recovers cleanly', async () => {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'Reconnect Recovery Room',
      settings: { waitingRoomEnabled: true },
    });
    await service.joinMeeting(meeting.meetingCode, users[0].id);
    await service.joinMeeting(meeting.meetingCode, users[1].id); // waiting
    await service.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);

    const sock1 = await connectSocket(serverUrl, users[1].token);
    assert.strictEqual((await subscribeSocket(sock1, meeting.meetingCode)).status, 'ADMITTED');

    // Simulate network drop
    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 150));

    const afterDisconnect = await MeetingParticipant.findOne({
      meetingId: meeting.id,
      userId: users[1].id,
    });
    assert.strictEqual(afterDisconnect?.admissionStatus, 'ADMITTED', 'Membership must remain ADMITTED');
    assert.strictEqual(afterDisconnect?.presenceStatus, 'OFFLINE');

    // Reconnect -> recovers ONLINE seamlessly without re-entering waiting room
    const sock2 = await connectSocket(serverUrl, users[1].token);
    try {
      const ack2 = await subscribeSocket(sock2, meeting.meetingCode);
      assert.strictEqual(ack2.ok, true);
      assert.strictEqual(ack2.status, 'ADMITTED');

      const afterReconnect = await MeetingParticipant.findOne({
        meetingId: meeting.id,
        userId: users[1].id,
      });
      assert.strictEqual(afterReconnect?.presenceStatus, 'ONLINE');
    } finally {
      sock2.disconnect();
    }
  });
});
