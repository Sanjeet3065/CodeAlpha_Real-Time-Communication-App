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
import {
  LiveKitRevocationCoordinator,
  type DistributedRevocationPayload,
} from '../realtime/livekitRevocationCoordinator.js';
import {
  claimSignalingAdmissionFence,
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
  type LiveKitSignalGatewayHooks,
} from '../realtime/livekitSignalGateway.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIconnectlyFenceKey01';
const TEST_API_SECRET = 'SuperSecurePostSyncFencingAuditSecretKey2026987654321';

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
      server.closeAllConnections?.();
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

describe('Phase 09 Post-Sync Atomic 101 Fencing & Distributed Delivery Audit Suite', () => {
  let upstream: Awaited<ReturnType<typeof startMockUpstreamLiveKit>>;
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const hubA = new MeetingRealtimeHub();
  const hubB = new MeetingRealtimeHub();

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async () => ({}),
    deleteRoom: async () => ({}),
  };

  let configuredLiveKit: LiveKitService;

  before(async () => {
    const mongoUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test').replace(
      /\/[^/?]+(\?|$)/,
      '/connectly_test_postfence$1'
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
      const email = `lk_fence_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `FenceUser${i}`,
        lastName: 'Linearizable',
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

  async function spawnNode(
    hub: MeetingRealtimeHub,
    hooks: LiveKitSignalGatewayHooks = {},
    coordOpts: { pollIntervalMs?: number; initialCursorSeq?: number; maxStaleDeliveryMs?: number } = {}
  ) {
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: coordOpts.pollIntervalMs ?? 25,
      enableChangeStream: true,
      initialCursorSeq: coordOpts.initialCursorSeq,
      maxStaleDeliveryMs: coordOpts.maxStaleDeliveryMs ?? 10_000,
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
      title: 'Post-Sync Atomic Fence Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled: false },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await svc.joinMeeting(meeting.meetingCode, users[0].id);
    await svc.joinMeeting(meeting.meetingCode, users[1].id);
    await svc.joinMeeting(meeting.meetingCode, users[2].id);
    return meeting;
  }

  it('1. Removal AFTER syncNow() AND AFTER final MongoDB read (with delivery paused) loses atomic fence and NEVER emits HTTP 101', async () => {
    const barrier = createBarrier();
    let pauseGuestOnly = false;

    const instanceA = await spawnNode(hubA, {
      afterSyncBeforeAtomicFence: async () => {
        if (pauseGuestOnly) await barrier.pause();
      },
    });
    const instanceB = await spawnNode(hubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const [hostTok, guestTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      // Host stays connected throughout
      const hostConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);

      // Pause Guest AFTER postHandshakeCheck, AFTER syncNow(), AND AFTER finalReadCheck
      pauseGuestOnly = true;
      const guestPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await barrier.arrived;

      // Deliberately PAUSE Instance A's revocation notification delivery!
      instanceA.coordinator.pauseDelivery();

      // Instance B commits removal + durable revocation event
      await instanceB.svc.removeParticipant(
        m.meetingCode,
        users[0].id,
        users[1].id,
        'Post-sync pre-atomic-fence removal'
      );

      // Resume Instance A while revocation delivery is STILL paused
      barrier.release();
      const guestRes = await guestPromise;

      assert.strictEqual(
        guestRes.statusCode,
        403,
        'Atomic claimSignalingAdmissionFence MUST reject removal committed after syncNow() with 403 and NEVER emit 101'
      );
      assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST remain connected');
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 2);
      assert.strictEqual(instanceA.gateway.getPendingUpgradeCount(), 0);

      hostConn.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('2. Post-linearization sequence (after atomic fence, before socket.write(101), delivery deliberately paused then resumed) proves exact propagation guarantee', async () => {
    const barrier = createBarrier();
    let pauseGuestOnly = false;

    const instanceA = await spawnNode(hubA, {
      afterAtomicFenceBeforeSocketWrite101: async () => {
        if (pauseGuestOnly) await barrier.pause();
      },
    });
    const instanceB = await spawnNode(hubB);

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const [hostTok, guestTok, peerTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[2].id),
      ]);

      const hostConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      const peerConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(peerTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);
      assert.strictEqual(peerConn.statusCode, 101);

      // Pause Guest AFTER atomic claimSignalingAdmissionFence linearized as ADMITTED (fenceVersion = 1),
      // immediately BEFORE clientSocket.write(HTTP 101)
      pauseGuestOnly = true;
      const guestPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await barrier.arrived;

      // Deliberately hold Instance A's revocation delivery paused while Instance B commits removal AFTER admission linearized
      instanceA.coordinator.pauseDelivery();
      await instanceB.svc.removeParticipant(
        m.meetingCode,
        users[0].id,
        users[1].id,
        'Post-linearization removal with delayed delivery'
      );

      // Resume Instance A while revocation delivery is STILL paused:
      // Because admission linearized BEFORE removal and delivery is paused, 101 flushes for the pre-removal admission
      barrier.release();
      const guestRes = await guestPromise;
      assert.strictEqual(guestRes.statusCode, 101);

      // Now resume revocation delivery -> Instance A receives durable revocation event and MUST terminate Guest socket
      instanceA.coordinator.resumeDelivery();
      const synced = await instanceA.coordinator.syncNow();
      assert.strictEqual(synced, true);

      await guestRes.closedPromise;
      assert.strictEqual(guestRes.socket?.destroyed, true, 'Post-linearization socket MUST terminate upon revocation delivery');
      assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST remain connected');
      assert.strictEqual(peerConn.socket?.destroyed, false, 'Unrelated peer MUST remain connected');
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 4);

      hostConn.socket?.destroy();
      peerConn.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('3. Concurrent cross-instance admission vs removal races serialize cleanly with ZERO surviving removed sockets while Host stays connected', async () => {
    const instanceA = await spawnNode(hubA);
    const instanceB = await spawnNode(hubB);

    try {
      for (let trial = 0; trial < 5; trial += 1) {
        const m = await createMeetingWithThreeUsers(instanceA.svc);
        const [hostTok, guestTok] = await Promise.all([
          instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
          instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
        ]);

        const hostConn = await attemptWsUpgrade(
          instanceA.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
        );
        assert.strictEqual(hostConn.statusCode, 101);

        // Fire admission on Instance A and removal on Instance B concurrently
        const [wsRes] = await Promise.all([
          attemptWsUpgrade(
            instanceA.port,
            `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
          ),
          instanceB.svc.removeParticipant(
            m.meetingCode,
            users[0].id,
            users[1].id,
            `Concurrent race trial ${trial}`
          ),
        ]);

        // Synchronize revocation cursor to complete cross-instance propagation deterministically
        await instanceA.coordinator.syncNow();
        if (wsRes.closedPromise) {
          await wsRes.closedPromise;
        }

        assert.ok(
          wsRes.statusCode === 403 || wsRes.socket?.destroyed === true,
          `Trial ${trial}: removed participant must either never get 101 or have socket terminated`
        );
        assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST stay connected');
        await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 2);

        hostConn.socket?.destroy();
        await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
      }
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('4. Removal followed immediately by re-admission: old-epoch JWT rejected; delayed old revocation event does not disrupt new-epoch socket', async () => {
    const instanceA = await spawnNode(hubA, {}, { pollIntervalMs: 60_000 });
    const instanceB = await spawnNode(hubB, {}, { pollIntervalMs: 60_000 });

    try {
      const m = await createMeetingWithThreeUsers(instanceA.svc);
      const oldEpoch1Tok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      // Pause delivery on Instance A so the removal event (revokedEpoch=2) arrives AFTER re-admission
      instanceA.coordinator.pauseDelivery();
      await instanceB.svc.removeParticipant(m.meetingCode, users[0].id, users[1].id, 'Removed before re-admit');

      // Re-admit Guest under new tokenEpoch = 3
      await MeetingParticipant.updateOne(
        { meetingId: m.id, userId: users[1].id },
        { $set: { admissionStatus: 'ADMITTED' }, $inc: { tokenEpoch: 1, signalFenceVersion: 1 } }
      );

      // Old epoch-1 JWT MUST fail atomic fence (403)
      const oldWsRes = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(oldEpoch1Tok.token)}`
      );
      assert.strictEqual(oldWsRes.statusCode, 403);

      // Fresh epoch-3 JWT connects cleanly (101)
      const newEpoch3Tok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);
      const newWsRes = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(newEpoch3Tok.token)}`
      );
      assert.strictEqual(newWsRes.statusCode, 101);

      // Now deliver the delayed old revocation event (revokedEpoch=2) -> MUST NOT kill epoch-3 socket!
      instanceA.coordinator.resumeDelivery();
      await instanceA.coordinator.syncNow();
      assert.strictEqual(
        newWsRes.socket?.destroyed,
        false,
        'Delayed revokedEpoch=2 event must not kill legitimate re-admitted epoch=3 socket'
      );

      newWsRes.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('5. Duplicate and out-of-order revocation events are deduplicated cleanly without skipping lower sequence numbers', async () => {
    const coord = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      initialCursorSeq: 10,
    });

    const received: number[] = [];
    coord.subscribe((ev) => received.push(ev.seq));

    const makeEvent = (seq: number): DistributedRevocationPayload => ({
      eventId: new mongoose.Types.ObjectId().toString(),
      seq,
      meetingId: new mongoose.Types.ObjectId().toString(),
      userId: new mongoose.Types.ObjectId().toString(),
      kind: 'PARTICIPANT_REMOVED',
      revokedEpoch: 2,
      fenceVersion: 1,
      reason: 'Out-of-order test',
      createdAt: new Date(),
    });

    // Arrive out-of-order: seq 12 before seq 11
    assert.strictEqual(coord.ingestEvent(makeEvent(12)), true);
    assert.deepStrictEqual(received, [12]);
    // Cursor MUST NOT skip over unseen seq 11!
    assert.strictEqual(coord.getLastContiguousSeq(), 10);

    // Duplicate seq 12 MUST be dropped cleanly
    assert.strictEqual(coord.ingestEvent(makeEvent(12)), false);
    assert.deepStrictEqual(received, [12]);

    // Missing seq 11 arrives -> dispatches seq 11 and advances contiguous cursor cleanly to 12
    assert.strictEqual(coord.ingestEvent(makeEvent(11)), true);
    assert.deepStrictEqual(received, [12, 11]);
    assert.strictEqual(coord.getLastContiguousSeq(), 12);

    await coord.stop();
  });

  it('6. Coordinator restart recovers missed durable cursor events; stalled delivery & unavailable atomic fence both fail closed (503)', async () => {
    // Part A: Durable cursor recovery across coordinator restart
    const nodeA1 = await spawnNode(hubA, {}, { pollIntervalMs: 60_000 });
    const nodeB = await spawnNode(hubB, {}, { pollIntervalMs: 60_000 });
    let savedCursorSeq = 0;
    let meetingId = '';
    const guestUserId = users[1].id;

    try {
      const m = await createMeetingWithThreeUsers(nodeA1.svc);
      meetingId = m.id;
      await nodeA1.coordinator.syncNow();
      savedCursorSeq = nodeA1.coordinator.getLastContiguousSeq();
      await nodeA1.close();

      // While Coordinator 1 is stopped, Instance B removes Guest -> persists durable seq = savedCursorSeq + 1
      await nodeB.svc.removeParticipant(m.meetingCode, users[0].id, guestUserId, 'Published during restart');

      // Coordinator 2 starts from saved durable cursor and replays missed event cleanly
      const recoveredEvents: DistributedRevocationPayload[] = [];
      const coord2 = new LiveKitRevocationCoordinator({
        pollIntervalMs: 60_000,
        enableChangeStream: false,
        initialCursorSeq: savedCursorSeq,
      });
      coord2.subscribe((ev) => recoveredEvents.push(ev));
      await coord2.start();
      await coord2.syncNow();

      assert.ok(
        recoveredEvents.some(
          (e) =>
            e.meetingId === meetingId &&
            e.userId === guestUserId &&
            e.kind === 'PARTICIPANT_REMOVED'
        ),
        'Restarted coordinator MUST recover durable revocation event published while offline'
      );
      assert.ok(coord2.getLastContiguousSeq() > savedCursorSeq);
      await coord2.stop();
    } finally {
      await nodeB.close();
    }

    // Part B: Stalled delivery watchdog (without DB exception) fails closed & closes active sockets
    const stalledNode = await spawnNode(hubA, {}, { pollIntervalMs: 60_000, maxStaleDeliveryMs: 5_000 });
    try {
      const m2 = await createMeetingWithThreeUsers(stalledNode.svc);
      const hostTok = await stalledNode.svc.issueLiveKitToken(m2.meetingCode, users[0].id);

      const activeConn = await attemptWsUpgrade(
        stalledNode.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(activeConn.statusCode, 101);
      assert.strictEqual(stalledNode.gateway.getActiveSocketCount(), 2);

      // Simulate delivery pipeline stalling past maxStaleDeliveryMs (no DB error thrown)
      stalledNode.coordinator.setLastSuccessfulSyncAtForTest(Date.now() - 10_000);
      assert.strictEqual(stalledNode.coordinator.isHealthy(), false);

      await activeConn.closedPromise;
      assert.strictEqual(stalledNode.gateway.getActiveSocketCount(), 0);

      const blockedRes = await attemptWsUpgrade(
        stalledNode.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(blockedRes.statusCode, 503);

      // Part C: Atomic fencing DB error fails closed (503 LIVEKIT_FENCE_UNAVAILABLE)
      const origFindOneAndUpdate = MeetingParticipant.findOneAndUpdate;
      (MeetingParticipant as any).findOneAndUpdate = () => ({
        lean: () => Promise.reject(new Error('Simulated atomic fence DB failure')),
      });
      try {
        const fenceErr = await claimSignalingAdmissionFence(m2.id, users[0].id, 1);
        assert.strictEqual(fenceErr.allowed, false);
        if (!fenceErr.allowed) {
          assert.strictEqual(fenceErr.statusCode, 503);
          assert.strictEqual(fenceErr.code, 'LIVEKIT_FENCE_UNAVAILABLE');
        }
      } finally {
        (MeetingParticipant as any).findOneAndUpdate = origFindOneAndUpdate;
      }
    } finally {
      await stalledNode.close();
    }
  });
});
