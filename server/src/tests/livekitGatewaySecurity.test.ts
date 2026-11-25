import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';
import mongoose from 'mongoose';
import { AccessToken } from 'livekit-server-sdk';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  authorizeLiveKitSignalHandshake,
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
  revalidateParticipantAccess,
  type LiveKitSignalGatewayHooks,
} from '../realtime/livekitSignalGateway.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  getLiveKitRoomName,
  validateLiveKitConfig,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIconnectlyGwAuditKey01';
const TEST_API_SECRET = 'SuperSecureGatewayAuditSecretKeyForPhase09RaceTests987654321';

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

function createCountdownBarrier(expectedCount: number) {
  let arrivedCount = 0;
  let markAllArrived!: () => void;
  let releaseAll!: () => void;
  const allArrived = new Promise<void>((r) => {
    markAllArrived = r;
  });
  const gate = new Promise<void>((r) => {
    releaseAll = r;
  });
  return {
    allArrived,
    release: () => releaseAll(),
    pause: async () => {
      arrivedCount += 1;
      if (arrivedCount >= expectedCount) {
        markAllArrived();
      }
      await gate;
    },
  };
}

interface WsAttemptResult {
  statusCode: number;
  socket?: Duplex;
  closedPromise?: Promise<void>;
}

function attemptWsUpgrade(port: number, reqPath: string): Promise<WsAttemptResult> {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    let settled = false;
    const finish = (result: WsAttemptResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('upgrade', (res, socket) => {
      socket.on('error', () => {
        // ignore reset during removal teardown
      });
      const closedPromise = new Promise<void>((r) => {
        if (socket.destroyed) r();
        else socket.once('close', () => r());
      });
      finish({ statusCode: res.statusCode || 101, socket, closedPromise });
    });

    req.on('response', (res) => {
      res.resume();
      finish({ statusCode: res.statusCode || 0 });
    });

    req.on('error', () => {
      finish({ statusCode: 0 });
    });

    req.end();
  });
}

/**
 * Starts a deterministic local mock upstream LiveKit HTTP/WS server that accepts
 * WebSocket upgrades on /rtc and /rtc/v1 (simulating self-hosted LiveKit v1.13.11
 * which accepts unexpired JWTs without checking revocation).
 */
async function startMockUpstreamLiveKit(): Promise<{
  server: http.Server;
  port: number;
  sockets: Set<Duplex>;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Duplex>();
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/rtc/validate') || req.url?.startsWith('/rtc/v1/validate')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  server.on('upgrade', (req, socket) => {
    const acceptKey = crypto
      .createHash('sha1')
      .update(`${req.headers['sec-websocket-key'] || ''}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Mock upstream bind failed');

  return {
    server,
    port: addr.port,
    sockets,
    close: async () => {
      for (const s of Array.from(sockets)) {
        try {
          s.destroy();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(predicate(), 'Condition was not satisfied within timeout');
}

describe('Phase 09 Final Gateway Race-Condition, Bypass & Deployment Security Suite', () => {
  let upstream: Awaited<ReturnType<typeof startMockUpstreamLiveKit>>;
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const realtimeHub = new MeetingRealtimeHub();

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async () => ({}),
    deleteRoom: async () => ({}),
  };

  let configuredLiveKit: LiveKitService;

  before(async () => {
    const mongoUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test').replace(
      /\/[^/?]+(\?|$)/,
      '/connectly_test_gwsec$1'
    );
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    await mongoose.connection.collection('livekitrevocationevents').deleteMany({});
    await mongoose.connection.collection('livekitrevocationcounters').deleteMany({});

    upstream = await startMockUpstreamLiveKit();
    configuredLiveKit = new LiveKitService({
      config: {
        url: `ws://127.0.0.1:${upstream.port}`,
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () => stubAdapter,
    });

    const passwordHash = await hashPassword('StrongPass!2026');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    for (let i = 0; i < 3; i += 1) {
      const email = `lk_gw_sec_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `GwUser${i}`,
        lastName: 'RaceAudit',
        email,
        passwordHash,
      });
      users.push({ id: user._id.toString(), email });
    }
  });

  after(async () => {
    await upstream.close();
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

  async function createGatewayServer(hooks: LiveKitSignalGatewayHooks = {}) {
    const gateway = new LiveKitSignalGateway(configuredLiveKit, hooks);
    const app = createApp({ signalGateway: gateway });
    const server = http.createServer(app);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Gateway bind failed');
    const svc = new MeetingService(realtimeHub, {}, configuredLiveKit, gateway);
    return {
      gateway,
      svc,
      port: addr.port,
      close: async () => {
        gateway.close();
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async function createActiveMeetingWithTwoUsers(svc: MeetingService) {
    const { meeting } = await svc.createMeeting(users[0].id, {
      title: 'Gateway Race Audit Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled: false },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await svc.joinMeeting(meeting.meetingCode, users[0].id);
    await svc.joinMeeting(meeting.meetingCode, users[1].id);
    return meeting;
  }

  it('1. Deterministic 7-boundary handshake-vs-removal race tests + cross-instance removal leave ZERO active removed sockets', async () => {
    const boundaries: Array<keyof LiveKitSignalGatewayHooks> = [
      'beforeAuthorize',
      'afterAuthorize',
      'beforeUpstreamConnect',
      'duringUpstreamHandshake',
      'afterUpstreamHandshake',
      'duringSocketRegister',
      'afterSocketRegister',
    ];

    for (const boundary of boundaries) {
      const barrier = createBarrier();
      const envObj = await createGatewayServer({ [boundary]: barrier.pause });
      try {
        const m = await createActiveMeetingWithTwoUsers(envObj.svc);
        const guestTok = await envObj.svc.issueLiveKitToken(m.meetingCode, users[1].id);

        const wsPromise = attemptWsUpgrade(
          envObj.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
        );

        // Deterministically pause right at the exact boundary under test
        await barrier.arrived;

        // Execute authoritative Phase 08 removal (increments tokenEpoch + calls disconnectParticipantSockets)
        await envObj.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, `Race at ${boundary}`);

        // Release handshake barrier
        barrier.release();

        const wsResult = await wsPromise;

        if (boundary === 'afterSocketRegister') {
          // If 101 was already emitted right before afterSocketRegister, removal MUST have
          // immediately closed the socket pair so zero active sockets remain.
          if (wsResult.closedPromise) {
            await wsResult.closedPromise;
          }
          assert.ok(
            !wsResult.socket || wsResult.socket.destroyed,
            `[${boundary}] Removed participant socket must be destroyed`
          );
        } else {
          assert.notStrictEqual(
            wsResult.statusCode,
            101,
            `[${boundary}] Removed participant MUST NOT receive 101 Switching Protocols`
          );
        }

        await waitForCondition(
          () => envObj.gateway.getActiveSocketCount() === 0 && envObj.gateway.getPendingUpgradeCount() === 0
        );
      } finally {
        await envObj.close();
      }
    }

    // Cross-instance removal test: Instance A has upgrade in-flight duringUpstreamHandshake,
    // Instance B removes the participant in MongoDB WITHOUT calling Instance A's local disconnectParticipantSockets.
    const crossBarrier = createBarrier();
    const instanceA = await createGatewayServer({ duringUpstreamHandshake: crossBarrier.pause });
    const instanceBService = new MeetingService(
      realtimeHub,
      {},
      configuredLiveKit,
      new LiveKitSignalGateway(configuredLiveKit)
    );
    try {
      const m = await createActiveMeetingWithTwoUsers(instanceA.svc);
      const guestTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      const wsPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await crossBarrier.arrived;

      // Remove via completely separate service/gateway instance (cross-instance DB commit only)
      await instanceBService.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Cross-instance removal');
      crossBarrier.release();

      const res = await wsPromise;
      assert.strictEqual(res.statusCode, 403, 'Post-handshake MongoDB revalidation MUST reject cross-instance removal with 403');
      await waitForCondition(
        () => instanceA.gateway.getActiveSocketCount() === 0 && instanceA.gateway.getPendingUpgradeCount() === 0
      );
    } finally {
      await instanceA.close();
    }
  });

  it('2. Simultaneous 5x connection burst with same old JWT during removal blocks all 5 while Host stays connected uninterrupted', async () => {
    const CONCURRENT_ATTEMPTS = 5;
    const burstBarrier = createCountdownBarrier(CONCURRENT_ATTEMPTS);
    let pauseGuestOnly = false;

    const envObj = await createGatewayServer({
      duringUpstreamHandshake: async () => {
        if (pauseGuestOnly) {
          await burstBarrier.pause();
        }
      },
    });

    try {
      const m = await createActiveMeetingWithTwoUsers(envObj.svc);
      const [hostTok, guestTok] = await Promise.all([
        envObj.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        envObj.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      // Host connects first and remains connected throughout Guest's removal & burst
      const hostConn = await attemptWsUpgrade(
        envObj.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);
      assert.ok(hostConn.socket && !hostConn.socket.destroyed);
      assert.strictEqual(envObj.gateway.getActiveSocketCount(), 2);

      // Now fire 5 simultaneous WebSocket upgrades for Guest using the same unexpired JWT
      pauseGuestOnly = true;
      const guestPromises = Array.from({ length: CONCURRENT_ATTEMPTS }, () =>
        attemptWsUpgrade(
          envObj.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
        )
      );

      await burstBarrier.allArrived;

      // Host removes Guest while all 5 Guest handshakes are paused in-flight
      await envObj.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Burst removal');
      burstBarrier.release();

      const guestResults = await Promise.all(guestPromises);
      for (const res of guestResults) {
        assert.notStrictEqual(res.statusCode, 101, 'Every simultaneous burst attempt by removed guest MUST be blocked');
      }

      // Host MUST remain connected with exactly 2 tracked sockets (client + upstream), 0 pending
      assert.strictEqual(hostConn.socket.destroyed, false, 'Host socket MUST NOT be disrupted by Guest removal');
      await waitForCondition(
        () => envObj.gateway.getActiveSocketCount() === 2 && envObj.gateway.getPendingUpgradeCount() === 0
      );

      // Cleanly closing Host socket removes tracked sockets reliably down to 0
      hostConn.socket.destroy();
      await waitForCondition(() => envObj.gateway.getActiveSocketCount() === 0);
    } finally {
      await envObj.close();
    }
  });

  it('3. Gateway bypass audit: alternate routes rejected (404), HTTP validate enforces auth, and gateway shutdown closes all active sockets', async () => {
    const envObj = await createGatewayServer();
    try {
      const m = await createActiveMeetingWithTwoUsers(envObj.svc);
      const [hostTok, guestTok] = await Promise.all([
        envObj.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        envObj.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      // Alternate WS upgrade routes MUST NOT bypass gateway (all rejected with 404)
      for (const badPath of [
        `/rtc?access_token=${encodeURIComponent(hostTok.token)}`,
        `/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v2?access_token=${encodeURIComponent(hostTok.token)}`,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/bypass?access_token=${encodeURIComponent(hostTok.token)}`,
      ]) {
        const r = await attemptWsUpgrade(envObj.port, badPath);
        assert.strictEqual(r.statusCode, 404, `Alternate WS route ${badPath} MUST return 404`);
      }

      // HTTP /validate endpoints enforce identical MongoDB authorization
      const okValidate = await fetch(
        `http://127.0.0.1:${envObj.port}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate?access_token=${encodeURIComponent(guestTok.token)}`
      );
      assert.strictEqual(okValidate.status, 200);

      await envObj.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Validate test');
      const blockedValidate = await fetch(
        `http://127.0.0.1:${envObj.port}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate?access_token=${encodeURIComponent(guestTok.token)}`
      );
      assert.strictEqual(blockedValidate.status, 403);

      const unknownHttpRoute = await fetch(
        `http://127.0.0.1:${envObj.port}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v2/validate?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(unknownHttpRoute.status, 404);

      // Establish active Host connection, then invoke gateway.close() -> closes sockets & rejects new upgrades with 503
      const hostConn = await attemptWsUpgrade(
        envObj.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);
      assert.strictEqual(envObj.gateway.getActiveSocketCount(), 2);

      const closedCount = envObj.gateway.close();
      assert.ok(closedCount >= 2);
      await hostConn.closedPromise;
      assert.strictEqual(envObj.gateway.getActiveSocketCount(), 0);

      const afterShutdown = await attemptWsUpgrade(
        envObj.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(afterShutdown.statusCode, 503);
    } finally {
      await envObj.close();
    }
  });

  it('4. Rejects missing/malformed epoch metadata, cross-meeting/cross-participant JWTs, and fails closed on MongoDB errors', async () => {
    const envObj = await createGatewayServer();
    try {
      const m1 = await createActiveMeetingWithTwoUsers(envObj.svc);
      const { meeting: m2 } = await envObj.svc.createMeeting(users[0].id, {
        title: 'Second Isolated Meeting',
        maxParticipants: 10,
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(m2.id));
      await envObj.svc.joinMeeting(m2.meetingCode, users[0].id);

      // 1) Validly signed LiveKit JWT missing epoch metadata -> rejected (403 LIVEKIT_TOKEN_REVOKED)
      const noEpochAt = new AccessToken(TEST_API_KEY, TEST_API_SECRET, {
        identity: getLiveKitParticipantIdentity(users[0].id),
        ttl: 600,
      });
      noEpochAt.addGrant({ roomJoin: true, room: getLiveKitRoomName(m1.id) });
      const noEpochJwt = await noEpochAt.toJwt();
      const noEpochRes = await authorizeLiveKitSignalHandshake(
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(noEpochJwt)}`,
        undefined,
        configuredLiveKit
      );
      assert.strictEqual(noEpochRes.allowed, false);
      if (!noEpochRes.allowed) {
        assert.strictEqual(noEpochRes.statusCode, 403);
        assert.strictEqual(noEpochRes.code, 'LIVEKIT_TOKEN_REVOKED');
      }

      // 2) Validly signed JWT with malformed epoch (0 / string) -> rejected
      const badEpochAt = new AccessToken(TEST_API_KEY, TEST_API_SECRET, {
        identity: getLiveKitParticipantIdentity(users[0].id),
        ttl: 600,
        metadata: JSON.stringify({ role: 'host', meetingId: m1.id, epoch: 'invalid' }),
      });
      badEpochAt.addGrant({ roomJoin: true, room: getLiveKitRoomName(m1.id) });
      const badEpochRes = await authorizeLiveKitSignalHandshake(
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(await badEpochAt.toJwt())}`,
        undefined,
        configuredLiveKit
      );
      assert.strictEqual(badEpochRes.allowed, false);

      // 3) Cross-meeting metadata mismatch (room=m1, metadata.meetingId=m2) -> rejected (403)
      const crossMetaAt = new AccessToken(TEST_API_KEY, TEST_API_SECRET, {
        identity: getLiveKitParticipantIdentity(users[0].id),
        ttl: 600,
        metadata: JSON.stringify({ role: 'host', meetingId: m2.id, epoch: 1 }),
      });
      crossMetaAt.addGrant({ roomJoin: true, room: getLiveKitRoomName(m1.id) });
      const crossMetaRes = await authorizeLiveKitSignalHandshake(
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(await crossMetaAt.toJwt())}`,
        undefined,
        configuredLiveKit
      );
      assert.strictEqual(crossMetaRes.allowed, false);
      if (!crossMetaRes.allowed) {
        assert.strictEqual(crossMetaRes.statusCode, 403);
      }

      // 4) Non-admitted user (users[2]) attempting to use forged JWT for m2 -> rejected (403)
      const outsiderAt = new AccessToken(TEST_API_KEY, TEST_API_SECRET, {
        identity: getLiveKitParticipantIdentity(users[2].id),
        ttl: 600,
        metadata: JSON.stringify({ role: 'participant', meetingId: m2.id, epoch: 1 }),
      });
      outsiderAt.addGrant({ roomJoin: true, room: getLiveKitRoomName(m2.id) });
      const outsiderRes = await authorizeLiveKitSignalHandshake(
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(await outsiderAt.toJwt())}`,
        undefined,
        configuredLiveKit
      );
      assert.strictEqual(outsiderRes.allowed, false);
      if (!outsiderRes.allowed) {
        assert.strictEqual(outsiderRes.statusCode, 403);
        assert.strictEqual(outsiderRes.code, 'LIVEKIT_ACCESS_DENIED');
      }

      // 5) MongoDB failure -> MUST fail CLOSED (503 LIVEKIT_AUTH_UNAVAILABLE)
      const originalFindById = Meeting.findById;
      (Meeting as any).findById = () => ({
        select: () => Promise.reject(new Error('Simulated MongoDB outage')),
      });
      try {
        const dbErrRes = await revalidateParticipantAccess(m1.id, users[0].id, 1);
        assert.strictEqual(dbErrRes.allowed, false);
        if (!dbErrRes.allowed) {
          assert.strictEqual(dbErrRes.statusCode, 503);
          assert.strictEqual(dbErrRes.code, 'LIVEKIT_AUTH_UNAVAILABLE');
        }
      } finally {
        (Meeting as any).findById = originalFindById;
      }
    } finally {
      await envObj.close();
    }
  });

  it('5. Production transport & anti-bypass validation blocks silent self-hosted gateway disablement and insecure public URLs', async () => {
    // 1) Self-hosted production with LIVEKIT_SIGNAL_GATEWAY_ENABLED=false MUST fail closed
    const bypassCheck = validateLiveKitConfig(
      {
        url: 'wss://sfu.connectly.app',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        signalGatewayEnabled: 'false',
      },
      'production'
    );
    assert.strictEqual(bypassCheck.valid, false);

    // 2) Self-hosted production with private loopback LIVEKIT_URL + TLS LIVEKIT_PUBLIC_URL succeeds
    const prodSelfHostedOk = validateLiveKitConfig(
      {
        url: 'ws://127.0.0.1:7880',
        publicUrl: 'wss://api.connectly.app/livekit-signal',
        signalGatewayEnabled: 'auto',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
      },
      'production'
    );
    assert.strictEqual(prodSelfHostedOk.valid, true);

    // 3) Insecure ws:// LIVEKIT_PUBLIC_URL rejected in production
    const badPublicUrl = validateLiveKitConfig(
      {
        url: 'ws://127.0.0.1:7880',
        publicUrl: 'ws://api.connectly.app/livekit-signal',
        signalGatewayEnabled: 'auto',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
      },
      'production'
    );
    assert.strictEqual(badPublicUrl.valid, false);

    // 4) Managed LiveKit Cloud allows direct mode (signalGatewayEnabled: 'false' or 'auto')
    const prodCloudOk = validateLiveKitConfig(
      {
        url: 'wss://prod-app.livekit.cloud',
        signalGatewayEnabled: 'false',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
      },
      'production'
    );
    assert.strictEqual(prodCloudOk.valid, true);

    // 5) Production self-hosted token issuance without LIVEKIT_PUBLIC_URL or wss:// gatewayUrl MUST fail closed (503)
    const prodSelfHostedSvc = new LiveKitService({
      config: {
        url: 'wss://sfu-internal.connectly.app',
        signalGatewayEnabled: 'auto',
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'production',
      roomClientFactory: () => stubAdapter,
    });

    await assert.rejects(
      () =>
        prodSelfHostedSvc.generateParticipantToken({
          meetingId: '65f0a1b2c3d4e5f6a7b8c9d0',
          userId: '65f0a1b2c3d4e5f6a7b8c9e2',
          displayName: 'Prod Host',
          role: 'host',
          maxParticipants: 10,
        }),
      (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_NOT_CONFIGURED'
    );

    // And with insecure ws:// gatewayUrl in production -> ALSO fails closed (503)
    await assert.rejects(
      () =>
        prodSelfHostedSvc.generateParticipantToken({
          meetingId: '65f0a1b2c3d4e5f6a7b8c9d0',
          userId: '65f0a1b2c3d4e5f6a7b8c9e2',
          displayName: 'Prod Host',
          role: 'host',
          maxParticipants: 10,
          gatewayUrl: 'ws://api.connectly.app/livekit-signal',
        }),
      (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_NOT_CONFIGURED'
    );

    // With valid wss:// gatewayUrl -> succeeds and returns strictly the wss:// gateway URL
    const prodOkBundle = await prodSelfHostedSvc.generateParticipantToken({
      meetingId: '65f0a1b2c3d4e5f6a7b8c9d0',
      userId: '65f0a1b2c3d4e5f6a7b8c9e2',
      displayName: 'Prod Host',
      role: 'host',
      maxParticipants: 10,
      gatewayUrl: 'wss://api.connectly.app/livekit-signal',
    });
    assert.strictEqual(prodOkBundle.livekitUrl, 'wss://api.connectly.app/livekit-signal');
  });
});
