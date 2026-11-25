import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { LiveKitRevocationEvent } from '../models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
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
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIconnectlyCrossInstKey01';
const TEST_API_SECRET = 'SuperSecureCrossInstanceRevocationSecretKey2026987654321';

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
      socket.on('error', () => {});
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

async function startMockUpstreamLiveKit() {
  const sockets = new Set<Duplex>();
  const server = http.createServer((_req, res) => {
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
    port: addr.port,
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

async function waitForCondition(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(predicate(), 'Condition was not satisfied within timeout');
}

describe('Phase 09 Cross-Instance Distributed Revocation & 101 Handshake Fencing Suite', () => {
  let upstream: Awaited<ReturnType<typeof startMockUpstreamLiveKit>>;
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const realtimeHubA = new MeetingRealtimeHub();
  const realtimeHubB = new MeetingRealtimeHub();

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async () => ({}),
    deleteRoom: async () => ({}),
  };

  let configuredLiveKit: LiveKitService;

  before(async () => {
    const mongoUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test').replace(
      /\/[^/?]+(\?|$)/,
      '/connectly_test_crossrev$1'
    );
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    await LiveKitRevocationEvent.deleteMany({});
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
      const email = `lk_xinst_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `XInstUser${i}`,
        lastName: 'Distributed',
        email,
        passwordHash,
      });
      users.push({ id: user._id.toString(), email });
    }
  });

  after(async () => {
    await upstream.close();
    if (createdMeetingIds.length > 0) {
      await LiveKitRevocationEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
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

  async function spawnClusterNode(
    hub: MeetingRealtimeHub,
    hooks: LiveKitSignalGatewayHooks = {},
    pollIntervalMs = 25
  ) {
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs,
      enableChangeStream: true,
    });
    await coordinator.start();
    const gateway = new LiveKitSignalGateway(configuredLiveKit, hooks, coordinator);
    const app = createApp({ signalGateway: gateway });
    const server = http.createServer(app);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Node bind failed');
    const svc = new MeetingService(hub, {}, configuredLiveKit, gateway);

    return {
      coordinator,
      gateway,
      svc,
      port: addr.port,
      close: async () => {
        gateway.close();
        await coordinator.stop();
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async function createMeetingWithThreeUsers(svc: MeetingService) {
    const { meeting } = await svc.createMeeting(users[0].id, {
      title: 'Cross-Instance Revocation Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled: false },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await svc.joinMeeting(meeting.meetingCode, users[0].id);
    await svc.joinMeeting(meeting.meetingCode, users[1].id);
    await svc.joinMeeting(meeting.meetingCode, users[2].id);
    return meeting;
  }

  it('1. Final 101 race: cross-instance removal AFTER post-handshake MongoDB revalidation but BEFORE HTTP 101 write blocks 101 cleanly', async () => {
    const before101Barrier = createBarrier();
    const instanceA = await spawnClusterNode(realtimeHubA, {
      beforeWrite101: before101Barrier.pause,
    });
    const instanceB = await spawnClusterNode(realtimeHubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const guestTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      // Instance A validates JWT, completes upstream handshake, registers sockets,
      // passes post-handshake MongoDB revalidation, and pauses right BEFORE writing HTTP 101.
      const wsPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await before101Barrier.arrived;

      // Independent API Instance B removes Guest & commits MongoDB + durable revocation event
      await instanceB.svc.removeParticipant(
        m.meetingCode,
        users[0].id,
        users[1].id,
        'Cross-instance pre-101 removal'
      );

      // Release Instance A to attempt final pre-101 fence & HTTP 101 write
      before101Barrier.release();

      const res = await wsPromise;
      assert.strictEqual(
        res.statusCode,
        403,
        'Removed participant MUST receive 403 and NEVER HTTP 101 when removed before 101 write'
      );
      await waitForCondition(
        () =>
          instanceA.gateway.getActiveSocketCount() === 0 &&
          instanceA.gateway.getPendingUpgradeCount() === 0
      );
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('2. Cross-instance removal IMMEDIATELY AFTER HTTP 101 terminates newly established socket via distributed revocation coordinator', async () => {
    const after101Barrier = createBarrier();
    const instanceA = await spawnClusterNode(realtimeHubA, {
      afterWrite101: after101Barrier.pause,
    });
    const instanceB = await spawnClusterNode(realtimeHubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const guestTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      const wsPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await after101Barrier.arrived;

      // Independent API Instance B removes Guest right after Instance A wrote HTTP 101
      await instanceB.svc.removeParticipant(
        m.meetingCode,
        users[0].id,
        users[1].id,
        'Cross-instance post-101 removal'
      );
      after101Barrier.release();

      const res = await wsPromise;
      if (res.closedPromise) {
        await res.closedPromise;
      }
      assert.ok(
        !res.socket || res.socket.destroyed,
        'Guest socket established just before cross-instance removal MUST be terminated'
      );
      await waitForCondition(
        () =>
          instanceA.gateway.getActiveSocketCount() === 0 &&
          instanceA.gateway.getPendingUpgradeCount() === 0
      );
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('3. Cross-instance removal of already-established socket on Instance A by API Instance B terminates ONLY removed participant; Host & unrelated peer stay connected', async () => {
    const instanceA = await spawnClusterNode(realtimeHubA);
    const instanceB = await spawnClusterNode(realtimeHubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const [hostTok, guestTok, peerTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[2].id),
      ]);

      // All 3 participants establish active proxied WebSockets on Gateway Instance A
      const [hostConn, guestConn, peerConn] = await Promise.all([
        attemptWsUpgrade(
          instanceA.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
        ),
        attemptWsUpgrade(
          instanceA.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
        ),
        attemptWsUpgrade(
          instanceA.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(peerTok.token)}`
        ),
      ]);

      assert.strictEqual(hostConn.statusCode, 101);
      assert.strictEqual(guestConn.statusCode, 101);
      assert.strictEqual(peerConn.statusCode, 101);
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 6);
      assert.strictEqual(instanceB.gateway.getActiveSocketCount(), 0);

      // API Instance B (which owns ZERO sockets!) removes Guest
      await instanceB.svc.removeParticipant(
        m.meetingCode,
        users[0].id,
        users[1].id,
        'Cross-instance active eviction'
      );

      // Instance A MUST automatically terminate Guest's already-established socket via distributed revocation
      await guestConn.closedPromise;
      assert.strictEqual(guestConn.socket?.destroyed, true);

      // Host and unrelated admitted peer (users[2]) MUST remain connected uninterrupted!
      assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST remain connected');
      assert.strictEqual(peerConn.socket?.destroyed, false, 'Unrelated admitted peer MUST remain connected');
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 4);

      hostConn.socket?.destroy();
      peerConn.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('4. Simultaneous cross-instance removal + multiple old-JWT reconnect attempts block all reconnects and evict active socket while Host remains connected', async () => {
    const RECONNECT_COUNT = 4;
    const burstBarrier = createCountdownBarrier(RECONNECT_COUNT);
    let pauseBurst = false;

    const instanceA = await spawnClusterNode(realtimeHubA, {
      beforeWrite101: async () => {
        if (pauseBurst) await burstBarrier.pause();
      },
    });
    const instanceB = await spawnClusterNode(realtimeHubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const [hostTok, guestTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      const hostConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      const guestActive = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);
      assert.strictEqual(guestActive.statusCode, 101);

      // Guest launches 4 simultaneous reconnect attempts using the same old JWT
      pauseBurst = true;
      const burstPromises = Array.from({ length: RECONNECT_COUNT }, () =>
        attemptWsUpgrade(
          instanceA.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
        )
      );
      await burstBarrier.allArrived;

      // Concurrently, Instance B removes Guest
      await instanceB.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Cross-instance burst');
      burstBarrier.release();

      const burstResults = await Promise.all(burstPromises);
      for (const r of burstResults) {
        assert.notStrictEqual(r.statusCode, 101, 'Every simultaneous reconnect attempt MUST be blocked');
      }

      await guestActive.closedPromise;
      assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST remain uninterrupted');
      await waitForCondition(
        () =>
          instanceA.gateway.getActiveSocketCount() === 2 &&
          instanceA.gateway.getPendingUpgradeCount() === 0
      );

      hostConn.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('5. Re-admission after removal keeps old-epoch JWTs permanently invalid while new-epoch JWT succeeds', async () => {
    const instanceA = await spawnClusterNode(realtimeHubA);
    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const oldEpoch1Tok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      // Remove Guest -> tokenEpoch increments to 2 & tokenRevokedBefore set
      await instanceA.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Removed then re-admitted');

      // Simulate administrative / host re-admission in MongoDB under new epoch (preserving monotonic epoch >= 2)
      await MeetingParticipant.updateOne(
        { meetingId: m.id, userId: users[1].id },
        { $set: { admissionStatus: 'ADMITTED' }, $inc: { tokenEpoch: 1 } }
      );

      // Old epoch-1 JWT MUST remain permanently rejected on BOTH HTTP validate AND WS upgrade
      const oldValidateRes = await fetch(
        `http://127.0.0.1:${instanceA.port}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate?access_token=${encodeURIComponent(oldEpoch1Tok.token)}`
      );
      assert.strictEqual(oldValidateRes.status, 403);

      const oldWsRes = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(oldEpoch1Tok.token)}`
      );
      assert.strictEqual(oldWsRes.statusCode, 403);

      // Fresh epoch-3 JWT minted after re-admission succeeds cleanly
      const newEpochTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);
      const newWsRes = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(newEpochTok.token)}`
      );
      assert.strictEqual(newWsRes.statusCode, 101);
      newWsRes.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
    }
  });

  it('6. Revocation coordinator unavailable/disconnected AND MongoDB unavailable both enforce strict fail-closed policy (503 + active socket termination)', async () => {
    // Use a long poll interval so coordinator outage stays deterministic throughout assertions
    const instanceA = await spawnClusterNode(realtimeHubA, {}, 60_000);
    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const hostTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id);

      const activeConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(activeConn.statusCode, 101);
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 2);

      // Simulate real consecutive MongoDB revocation-cursor sync failures -> coordinator transitions to UNHEALTHY
      const origEventFind = LiveKitRevocationEvent.find;
      (LiveKitRevocationEvent as any).find = () => ({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.reject(new Error('Simulated revocation store disconnect')),
          }),
        }),
      });
      try {
        await instanceA.coordinator.syncNow();
        await instanceA.coordinator.syncNow();
      } finally {
        (LiveKitRevocationEvent as any).find = origEventFind;
      }
      assert.strictEqual(instanceA.coordinator.isHealthy(), false);

      // 1) Active proxied sockets fail closed immediately
      await activeConn.closedPromise;
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 0);

      // 2) New WS upgrade fails closed with 503
      const blockedWs = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(blockedWs.statusCode, 503);

      // 3) HTTP /validate fails closed with 503
      const blockedHttp = await fetch(
        `http://127.0.0.1:${instanceA.port}${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1/validate?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(blockedHttp.status, 503);

      // 4) MongoDB outage during direct authorization & revalidation fails closed (503)
      const origFindById = Meeting.findById;
      (Meeting as any).findById = () => ({
        select: () => Promise.reject(new Error('Simulated MongoDB outage')),
      });
      try {
        const authErr = await authorizeLiveKitSignalHandshake(
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`,
          undefined,
          configuredLiveKit
        );
        assert.strictEqual(authErr.allowed, false);
        if (!authErr.allowed) {
          assert.strictEqual(authErr.statusCode, 503);
          assert.strictEqual(authErr.code, 'LIVEKIT_AUTH_UNAVAILABLE');
        }

        const revalErr = await revalidateParticipantAccess(m.id, users[0].id, 1);
        assert.strictEqual(revalErr.allowed, false);
        if (!revalErr.allowed) {
          assert.strictEqual(revalErr.statusCode, 503);
          assert.strictEqual(revalErr.code, 'LIVEKIT_AUTH_UNAVAILABLE');
        }
      } finally {
        (Meeting as any).findById = origFindById;
      }
    } finally {
      await instanceA.close();
    }
  });

  it('7. Gateway shutdown while BOTH pending handshakes AND established sockets are active closes all cleanly with zero leaks', async () => {
    const pendingBarrier = createBarrier();
    let pauseGuest = false;

    const instanceA = await spawnClusterNode(realtimeHubA, {
      duringUpstreamHandshake: async () => {
        if (pauseGuest) await pendingBarrier.pause();
      },
    });

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const [hostTok, guestTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      // Host has an active established socket
      const hostConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);

      // Guest has a pending handshake in-flight
      pauseGuest = true;
      const guestPendingPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await pendingBarrier.arrived;

      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 2);
      assert.strictEqual(instanceA.gateway.getPendingUpgradeCount(), 1);

      // Trigger graceful shutdown while both are active
      const closed = instanceA.gateway.close();
      assert.ok(closed >= 3);
      pendingBarrier.release();

      const guestPendingRes = await guestPendingPromise;
      assert.notStrictEqual(guestPendingRes.statusCode, 101);
      await hostConn.closedPromise;

      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 0);
      assert.strictEqual(instanceA.gateway.getPendingUpgradeCount(), 0);

      // Subsequent upgrade rejected cleanly with 503
      const postShutdown = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(postShutdown.statusCode, 503);
    } finally {
      await instanceA.close();
    }
  });
});
