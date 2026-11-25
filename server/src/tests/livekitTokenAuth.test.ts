import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  authorizeLiveKitSignalHandshake,
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
} from '../realtime/livekitSignalGateway.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  parseLiveKitParticipantUserId,
  getLiveKitRoomName,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIconnectlyIntegKey01';
const TEST_API_SECRET = 'SuperSecureLiveKitIntegSecretKeyForPhase09Tests987654321';

function createBarrier() {
  let markArrived!: () => void;
  let releaseWaiter!: () => void;
  const arrived = new Promise<void>((r) => {
    markArrived = r;
  });
  const gate = new Promise<void>((r) => {
    releaseWaiter = r;
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

describe('Phase 09 LiveKit Token Authorization, Security & Concurrency Integration Suite', () => {
  let httpServer: http.Server;
  let baseUrl: string;
  const users: Array<{ id: string; token: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const realtimeHub = new MeetingRealtimeHub();

  const stubCalls = { createRoom: 0, removeParticipant: 0, deleteRoom: 0 };
  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => {
      stubCalls.createRoom += 1;
      return {};
    },
    removeParticipant: async () => {
      stubCalls.removeParticipant += 1;
      return {};
    },
    deleteRoom: async () => {
      stubCalls.deleteRoom += 1;
      return {};
    },
  };

  const configuredLiveKit = new LiveKitService({
    config: {
      url: 'ws://127.0.0.1:7880',
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      tokenTtlSeconds: 600,
    },
    nodeEnv: 'development',
    roomClientFactory: () => stubAdapter,
  });

  const service = new MeetingService(realtimeHub, {}, configuredLiveKit);
  let originalEnv: { url?: string; key?: string; secret?: string } = {};

  before(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    originalEnv = {
      url: process.env.LIVEKIT_URL,
      key: process.env.LIVEKIT_API_KEY,
      secret: process.env.LIVEKIT_API_SECRET,
    };

    const app = createApp();
    httpServer = http.createServer(app);
    const testGateway = new LiveKitSignalGateway(configuredLiveKit);
    testGateway.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const passwordHash = await hashPassword('StrongPass!2026');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    for (let i = 0; i < 4; i += 1) {
      const email = `lk_auth_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `LkUser${i}`,
        lastName: 'Auth',
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
    if (originalEnv.url === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = originalEnv.url;
    if (originalEnv.key === undefined) delete process.env.LIVEKIT_API_KEY;
    else process.env.LIVEKIT_API_KEY = originalEnv.key;
    if (originalEnv.secret === undefined) delete process.env.LIVEKIT_API_SECRET;
    else process.env.LIVEKIT_API_SECRET = originalEnv.secret;

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

  async function createMeetingWithHost(waitingRoomEnabled = false) {
    const { meeting } = await service.createMeeting(users[0].id, {
      title: 'LiveKit Auth Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await service.joinMeeting(meeting.meetingCode, users[0].id);
    return meeting;
  }

  it('1. HTTP route rejects unauthenticated requests (401), invalid code (400), missing room (404), and forged body fields (400)', async () => {
    const m = await createMeetingWithHost(false);

    // Unauthenticated
    const r401 = await fetch(`${baseUrl}/api/v1/meetings/${m.meetingCode}/livekit-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(r401.status, 401);

    // Untrusted Origin rejected by CSRF Origin check (403)
    const rCsrf = await fetch(`${baseUrl}/api/v1/meetings/${m.meetingCode}/livekit-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`,
        Origin: 'https://evil-attacker.example',
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(rCsrf.status, 403);
    const csrfBody = await rCsrf.json();
    assert.strictEqual(csrfBody.code, 'CSRF_INVALID_ORIGIN');

    // Forged client role/roomName/identity/canPublish rejected by strict Zod schema
    const rForged = await fetch(`${baseUrl}/api/v1/meetings/${m.meetingCode}/livekit-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`,
      },
      body: JSON.stringify({
        role: 'host',
        roomName: 'forged_room',
        identity: 'spoofed_identity',
        canPublish: true,
      }),
    });
    assert.strictEqual(rForged.status, 400);
    const forgedBody = await rForged.json();
    assert.strictEqual(forgedBody.code, 'VALIDATION_ERROR');

    // Invalid code
    const rInvalid = await fetch(`${baseUrl}/api/v1/meetings/not-valid-code/livekit-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(rInvalid.status, 400);

    // Non-existent meeting
    const rMissing = await fetch(`${baseUrl}/api/v1/meetings/cly-999-zzz/livekit-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(rMissing.status, 404);
  });

  it('2. Rejects WAITING, REJECTED, REMOVED, LEFT, and non-member callers with 403', async () => {
    const m = await createMeetingWithHost(true);

    // Non-member (never joined)
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Waiting participant
    const waitRes = await service.joinMeeting(m.meetingCode, users[1].id);
    assert.strictEqual(waitRes.joinResult, 'WAITING');
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Rejected participant
    await service.rejectParticipant(m.meetingCode, users[0].id, users[1].id, 'Declined');
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[1].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );

    // Admit user 2, then remove -> triggers LiveKit eviction + blocks token
    await service.joinMeeting(m.meetingCode, users[2].id);
    await service.admitParticipant(m.meetingCode, users[0].id, users[2].id);
    const prevRemoveCalls = stubCalls.removeParticipant;
    await service.removeParticipant(m.meetingCode, users[0].id, users[2].id, 'Removed');
    assert.strictEqual(stubCalls.removeParticipant, prevRemoveCalls + 1);
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[2].id),
      (err: any) => err.statusCode === 403 && err.code === 'PARTICIPANT_REMOVED'
    );

    // Admit user 3, then leave -> blocks token
    await service.joinMeeting(m.meetingCode, users[3].id);
    await service.admitParticipant(m.meetingCode, users[0].id, users[3].id);
    await service.leaveMeeting(m.meetingCode, users[3].id);
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[3].id),
      (err: any) => err.statusCode === 403 && err.code === 'LIVEKIT_ACCESS_DENIED'
    );
  });

  it('3. Admitted Host, Co-Host, and Participant map to same opaque room with distinct opaque identities and least-privilege grants; different meetings never share rooms', async () => {
    const m1 = await createMeetingWithHost(false);
    const m2 = await createMeetingWithHost(false);

    await service.joinMeeting(m1.meetingCode, users[1].id);
    await service.updateParticipantRole(m1.meetingCode, users[0].id, users[1].id, {
      role: 'co-host',
    });
    await service.joinMeeting(m1.meetingCode, users[2].id);

    const [hostTok, coHostTok, partTok, m2Tok] = await Promise.all([
      service.issueLiveKitToken(m1.meetingCode, users[0].id),
      service.issueLiveKitToken(m1.meetingCode, users[1].id),
      service.issueLiveKitToken(m1.meetingCode, users[2].id),
      service.issueLiveKitToken(m2.meetingCode, users[0].id),
    ]);

    assert.strictEqual(hostTok.roomName, getLiveKitRoomName(m1.id));
    assert.strictEqual(coHostTok.roomName, hostTok.roomName);
    assert.strictEqual(partTok.roomName, hostTok.roomName);
    assert.notStrictEqual(m2Tok.roomName, hostTok.roomName);

    assert.strictEqual(parseLiveKitParticipantUserId(hostTok.participantIdentity), users[0].id);
    assert.strictEqual(parseLiveKitParticipantUserId(coHostTok.participantIdentity), users[1].id);
    assert.strictEqual(parseLiveKitParticipantUserId(partTok.participantIdentity), users[2].id);

    const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
    for (const bundle of [hostTok, coHostTok, partTok]) {
      const claims = await verifier.verify(bundle.token);
      assert.strictEqual(claims.video?.roomJoin, true);
      assert.strictEqual(claims.video?.canPublish, true);
      assert.deepStrictEqual(claims.video?.canPublishSources, [
        'camera',
        'microphone',
        'screen_share',
        'screen_share_audio',
      ]);
      assert.strictEqual(claims.video?.canSubscribe, true);
      assert.strictEqual(claims.video?.canPublishData, false);
      assert.strictEqual(claims.video?.roomAdmin, false);
      assert.strictEqual(claims.video?.roomCreate, false);
      assert.strictEqual(claims.video?.roomList, false);
      assert.strictEqual(claims.video?.roomRecord, false);
    }
  });

  it('4. Locked meeting blocks non-member token (403 MEETING_LOCKED) while preserving already-admitted participant; ended meeting rejects tokens (410) & deletes LiveKit room', async () => {
    const m = await createMeetingWithHost(false);
    await service.joinMeeting(m.meetingCode, users[1].id);
    await service.setMeetingLock(m.meetingCode, users[0].id, true);

    // Non-member blocked by lock
    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[2].id),
      (err: any) => err.statusCode === 403 && err.code === 'MEETING_LOCKED'
    );

    // Already admitted user still receives token under Phase 08 policy
    const admittedToken = await service.issueLiveKitToken(m.meetingCode, users[1].id);
    assert.strictEqual(admittedToken.roomName, getLiveKitRoomName(m.id));

    // Ending meeting deletes LiveKit room and blocks subsequent token requests with 410
    const prevDeleteCalls = stubCalls.deleteRoom;
    await service.endMeeting(m.meetingCode, users[0].id);
    assert.strictEqual(stubCalls.deleteRoom, prevDeleteCalls + 1);

    await assert.rejects(
      () => service.issueLiveKitToken(m.meetingCode, users[0].id),
      (err: any) => err.statusCode === 410 && err.code === 'LIVEKIT_MEETING_ENDED'
    );
  });

  it('5. Deterministic concurrency: meeting terminated during token generation discards token (410); concurrent token generation succeeds cleanly', async () => {
    const m1 = await createMeetingWithHost(false);
    await service.joinMeeting(m1.meetingCode, users[1].id);

    // Concurrent token generation for same & different admitted users
    const concurrentTokens = await Promise.all([
      service.issueLiveKitToken(m1.meetingCode, users[0].id),
      service.issueLiveKitToken(m1.meetingCode, users[0].id),
      service.issueLiveKitToken(m1.meetingCode, users[1].id),
    ]);
    assert.strictEqual(concurrentTokens.length, 3);
    assert.ok(concurrentTokens.every((t) => t.roomName === getLiveKitRoomName(m1.id)));

    // Pause token issuance right before signing while Host terminates the meeting
    const barrier = createBarrier();
    const pausedSvc = new MeetingService(
      realtimeHub,
      { beforeLiveKitTokenIssue: barrier.pause },
      configuredLiveKit
    );

    const tokenPromise = pausedSvc.issueLiveKitToken(m1.meetingCode, users[1].id);
    await barrier.arrived;

    await service.endMeeting(m1.meetingCode, users[0].id);
    barrier.release();

    await assert.rejects(
      () => tokenPromise,
      (err: any) => err.statusCode === 410 && err.code === 'LIVEKIT_MEETING_ENDED'
    );
  });

  it('6. Missing server LiveKit config returns 503 LIVEKIT_NOT_CONFIGURED on HTTP route without leaking secrets', async () => {
    const m = await createMeetingWithHost(false);
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const res = await fetch(`${baseUrl}/api/v1/meetings/${m.meetingCode}/livekit-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.code, 'LIVEKIT_NOT_CONFIGURED');
    assert.ok(!JSON.stringify(body).includes('Secret'));
  });

  it('7. Signaling Admission Gateway immediately blocks removed-participant original unexpired JWT (HTTP validate + WS upgrade) without disrupting other admitted participants', async () => {
    const m = await createMeetingWithHost(false);
    await service.joinMeeting(m.meetingCode, users[1].id);

    const [hostTok, guestTok] = await Promise.all([
      service.issueLiveKitToken(m.meetingCode, users[0].id),
      service.issueLiveKitToken(m.meetingCode, users[1].id),
    ]);

    // Both original unexpired JWTs pass pre-admission authorization while ADMITTED
    const hostBefore = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`,
      undefined,
      configuredLiveKit
    );
    const guestBefore = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(hostBefore.allowed, true);
    assert.strictEqual(guestBefore.allowed, true);

    // Remove Guest via Phase 08 removal flow
    await service.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Revocation audit');

    const guestRecord = await MeetingParticipant.findOne({
      meetingId: m.id,
      userId: users[1].id,
    });
    assert.strictEqual(guestRecord?.admissionStatus, 'REMOVED');
    assert.strictEqual(guestRecord?.tokenEpoch, 2);
    assert.ok(guestRecord?.tokenRevokedBefore instanceof Date);

    // 1) Original unexpired Guest JWT is immediately blocked by gateway authorizer (403)
    const guestAfter = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(guestAfter.allowed, false);
    if (!guestAfter.allowed) {
      assert.strictEqual(guestAfter.statusCode, 403);
      assert.strictEqual(guestAfter.code, 'PARTICIPANT_REMOVED');
    }

    // 2) Raw WebSocket Upgrade handshake using exact original Guest JWT is rejected with HTTP 403
    const upgradeStatus = await new Promise<number>((resolve, reject) => {
      const parsed = new URL(baseUrl);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      });
      req.on('upgrade', (_res, sock) => {
        sock.destroy();
        resolve(101);
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(upgradeStatus, 403, 'Removed participant WS upgrade with old JWT MUST receive 403');

    // 3) Host in the same room remains completely authorized without disruption
    const hostAfterGuestRemove = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(hostAfterGuestRemove.allowed, true);

    // 4) Ending the meeting immediately blocks Host's existing unexpired JWT at the gateway (410)
    await service.endMeeting(m.meetingCode, users[0].id);
    const hostAfterEnd = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(hostAfterEnd.allowed, false);
    if (!hostAfterEnd.allowed) {
      assert.strictEqual(hostAfterEnd.statusCode, 410);
      assert.strictEqual(hostAfterEnd.code, 'LIVEKIT_MEETING_ENDED');
    }
  });

  it('8. Leave+rejoin tokenEpoch permanently invalidates pre-departure JWT, and stale in-flight token request during concurrent removal is rejected (403)', async () => {
    const m = await createMeetingWithHost(false);
    await service.joinMeeting(m.meetingCode, users[1].id);

    const epoch1Token = await service.issueLiveKitToken(m.meetingCode, users[1].id);
    await service.leaveMeeting(m.meetingCode, users[1].id);

    // Rejoin legitimately -> user is ADMITTED again, now at tokenEpoch = 2
    await service.joinMeeting(m.meetingCode, users[1].id);
    const epoch2Token = await service.issueLiveKitToken(m.meetingCode, users[1].id);

    // Pre-departure unexpired JWT (epoch 1) MUST remain permanently revoked
    const staleEpochCheck = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(epoch1Token.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(staleEpochCheck.allowed, false);
    if (!staleEpochCheck.allowed) {
      assert.strictEqual(staleEpochCheck.statusCode, 403);
      assert.strictEqual(staleEpochCheck.code, 'LIVEKIT_TOKEN_REVOKED');
    }

    // New epoch-2 JWT is allowed
    const freshEpochCheck = await authorizeLiveKitSignalHandshake(
      `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(epoch2Token.token)}`,
      undefined,
      configuredLiveKit
    );
    assert.strictEqual(freshEpochCheck.allowed, true);

    // Deterministic concurrency: pause in-flight token request while Host removes participant
    const barrier = createBarrier();
    const pausedSvc = new MeetingService(
      realtimeHub,
      { beforeLiveKitTokenIssue: barrier.pause },
      configuredLiveKit
    );
    const inflightPromise = pausedSvc.issueLiveKitToken(m.meetingCode, users[1].id);
    await barrier.arrived;

    await service.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Concurrent removal');
    barrier.release();

    await assert.rejects(
      () => inflightPromise,
      (err: any) => err.statusCode === 403 && err.code === 'PARTICIPANT_REMOVED'
    );
  });
});
