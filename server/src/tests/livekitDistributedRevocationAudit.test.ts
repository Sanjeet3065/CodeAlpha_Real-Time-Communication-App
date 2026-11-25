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
import {
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  LiveKitRevocationEvent,
} from '../models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
  type DistributedRevocationPayload,
} from '../realtime/livekitRevocationCoordinator.js';
import {
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
  type LiveKitSignalGatewayHooks,
} from '../realtime/livekitSignalGateway.js';
import { MeetingService, type PublishRevocationFn } from '../services/meeting.service.js';
import {
  LiveKitService,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';

const TEST_API_KEY = 'APIconnectlyDistAudit01';
const TEST_API_SECRET = 'SuperSecureDistributedRevocationAuditSecretKey2026987654321';

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

describe('Phase 09 Final Distributed Revocation Correction & Regression Audit Suite (10 Scenarios)', () => {
  let upstream: Awaited<ReturnType<typeof startMockUpstreamLiveKit>>;
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const createdInstanceIds: string[] = [];
  const hubA = new MeetingRealtimeHub();
  const hubB = new MeetingRealtimeHub();
  let removedSfuCalls: Array<{ room: string; identity: string }> = [];
  let deletedRoomCalls: string[] = [];

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async (room, identity) => {
      removedSfuCalls.push({ room, identity });
      return {};
    },
    deleteRoom: async (room) => {
      deletedRoomCalls.push(room);
      return {};
    },
  };

  let configuredLiveKit: LiveKitService;

  before(async () => {
    const mongoUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test').replace(
      /\/[^/?]+(\?|$)/,
      '/connectly_test_distaudit$1'
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
      const email = `lk_distaudit_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `DistAudit${i}`,
        lastName: 'Verifier',
        email,
        passwordHash,
      });
      users.push({ id: user._id.toString(), email });
    }
  });

  after(async () => {
    await upstream.close();
    if (createdInstanceIds.length > 0) {
      await LiveKitRevocationCursor.deleteMany({ _id: { $in: createdInstanceIds } });
    }
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
    opts: {
      hooks?: LiveKitSignalGatewayHooks;
      pollIntervalMs?: number;
      gapFailClosedGraceMs?: number;
      initialCursorSeq?: number;
      instanceId?: string;
      publishRevocation?: PublishRevocationFn;
      activeSocketRevalidationIntervalMs?: number;
    } = {}
  ) {
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: opts.pollIntervalMs ?? 60_000,
      enableChangeStream: false,
      gapFailClosedGraceMs: opts.gapFailClosedGraceMs ?? 5_000,
      initialCursorSeq: opts.initialCursorSeq,
      instanceId: opts.instanceId,
      maxStaleDeliveryMs: 60_000,
    });
    await coordinator.start();
    const gateway = new LiveKitSignalGateway(
      configuredLiveKit,
      opts.hooks ?? {},
      coordinator,
      { activeSocketRevalidationIntervalMs: opts.activeSocketRevalidationIntervalMs ?? 0 }
    );
    const app = createApp({ signalGateway: gateway });
    const server = http.createServer(app);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Node bind failed');
    const svc = new MeetingService(
      hub,
      {},
      configuredLiveKit,
      gateway,
      opts.publishRevocation ?? publishLiveKitRevocation,
      coordinator
    );

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

  async function createMeetingWithUsers(svc: MeetingService, waitingRoomEnabled = false) {
    const { meeting } = await svc.createMeeting(users[0].id, {
      title: 'Distributed Revocation Audit Room',
      maxParticipants: 10,
      settings: { waitingRoomEnabled },
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
    await svc.joinMeeting(meeting.meetingCode, users[0].id);
    if (!waitingRoomEnabled) {
      await svc.joinMeeting(meeting.meetingCode, users[1].id);
      await svc.joinMeeting(meeting.meetingCode, users[2].id);
    }
    return meeting;
  }

  it('1. Process failure after sequence allocation before event insertion NEVER skips missing seq and transitions coordinator fail-closed (503 + socket teardown)', async () => {
    const node = await spawnNode(hubA, { gapFailClosedGraceMs: 1_000 });
    let crashedSeq = 0;
    try {
      const m = await createMeetingWithUsers(node.svc);
      const hostTok = await node.svc.issueLiveKitToken(m.meetingCode, users[0].id);
      const hostConn = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);
      assert.strictEqual(node.gateway.getActiveSocketCount(), 2);

      const baseSeq = node.coordinator.getLastContiguousSeq();

      // Simulate process failure strictly AFTER sequence allocation (seq = N) and BEFORE event insertion
      await assert.rejects(
        () =>
          publishLiveKitRevocation({
            meetingId: m.id,
            userId: users[1].id,
            kind: 'PARTICIPANT_REMOVED',
            revokedEpoch: 2,
            beforeEventInsertForTest: async () => {
              const c = await LiveKitRevocationCounter.findById('livekit_revocation_global_seq').lean();
              crashedSeq = c?.seq ?? 0;
              throw new Error('Simulated process crash after sequence allocation');
            },
          }),
        (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_REVOCATION_PUBLISH_FAILED'
      );
      assert.ok(crashedSeq > baseSeq, 'Allocated sequence must exceed initial cursor');

      // Another process publishes seq > crashedSeq
      const nextEvent = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[2].id,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 2,
      });
      assert.ok(nextEvent.seq > crashedSeq);

      // Initial sweep delivers nextEvent immediately while holding cursor strictly BEFORE crashedSeq
      const firstSyncOk = await node.coordinator.syncNow();
      assert.strictEqual(firstSyncOk, true);
      assert.ok(node.coordinator.getLastContiguousSeq() < crashedSeq);
      assert.ok(node.coordinator.getPendingGapSeqs().includes(crashedSeq));

      // Deterministically age the missing gap beyond gapFailClosedGraceMs -> MUST fail closed, NEVER skip!
      node.coordinator.ageGapFirstSeenForTest(crashedSeq, Date.now() - 10_000);
      const failedSyncOk = await node.coordinator.syncNow();
      assert.strictEqual(failedSyncOk, false, 'Unreconciled gap MUST fail closed');
      assert.strictEqual(node.coordinator.isHealthy(), false);
      assert.ok(
        node.coordinator.getLastContiguousSeq() < crashedSeq,
        'lastContiguousSeq MUST NOT silently skip past missing sequence'
      );

      // Active sockets MUST be terminated and new upgrades rejected with 503
      await hostConn.closedPromise;
      assert.strictEqual(node.gateway.getActiveSocketCount(), 0);
      const blocked = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(blocked.statusCode, 503);
    } finally {
      // Fill the synthetic crashed seq for this test's meeting so parallel test files sharing connectly_test stay isolated
      if (crashedSeq > 0) {
        await LiveKitRevocationEvent.updateOne(
          { seq: crashedSeq },
          {
            $setOnInsert: {
              seq: crashedSeq,
              meetingId: createdMeetingIds[createdMeetingIds.length - 1],
              userId: new mongoose.Types.ObjectId(users[1].id),
              kind: 'PARTICIPANT_LEFT',
              revokedEpoch: 1,
              reason: 'Test cleanup filler',
              createdAt: new Date(),
            },
          },
          { upsert: true }
        ).catch(() => {});
      }
      await node.close();
    }
  });

  it('2. Delayed event insertion BEYOND previous gap grace period is NEVER silently discarded and recovers cleanly upon arrival', async () => {
    const node = await spawnNode(hubA, { gapFailClosedGraceMs: 500 });
    const receivedForMeeting: number[] = [];

    try {
      const m = await createMeetingWithUsers(node.svc);
      node.coordinator.subscribe((ev) => {
        if (ev.meetingId === m.id) receivedForMeeting.push(ev.seq);
      });
      const baseSeq = node.coordinator.getLastContiguousSeq();
      let delayedSeq = 0;
      const barrier = createBarrier();

      // Publisher 1 allocates seq = N, then pauses deterministically BEFORE inserting event N
      const delayedPublishPromise = publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[1].id,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 2,
        reason: 'Delayed event past grace period',
        beforeEventInsertForTest: async () => {
          const c = await LiveKitRevocationCounter.findById('livekit_revocation_global_seq').lean();
          delayedSeq = c?.seq ?? 0;
          await barrier.pause();
        },
      });
      await barrier.arrived;
      assert.ok(delayedSeq > baseSeq);

      // Publisher 2 inserts seq > N while seq = N is still paused
      const eventNPlus1 = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[2].id,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 2,
      });
      assert.ok(eventNPlus1.seq > delayedSeq);

      // Sweep observes N+1, tracks missing N, and then ages N past gapFailClosedGraceMs -> fail-closed
      await node.coordinator.syncNow();
      assert.deepStrictEqual(receivedForMeeting, [eventNPlus1.seq]);
      assert.ok(node.coordinator.getPendingGapSeqs().includes(delayedSeq));
      node.coordinator.ageGapFirstSeenForTest(delayedSeq, Date.now() - 10_000);
      assert.strictEqual(await node.coordinator.syncNow(), false);
      assert.strictEqual(node.coordinator.isHealthy(), false);
      assert.ok(node.coordinator.getLastContiguousSeq() < delayedSeq);

      // Now release delayed Publisher 1 -> inserts event N AFTER grace period expired
      barrier.release();
      const committedDelayed = await delayedPublishPromise;
      assert.strictEqual(committedDelayed.seq, delayedSeq);

      // Next sync MUST deliver delayed event N (NEVER silently discarded!), advance cursor past N+1, and recover HEALTHY!
      const recovered = await node.coordinator.syncNow();
      assert.strictEqual(recovered, true);
      assert.strictEqual(node.coordinator.isHealthy(), true);
      assert.deepStrictEqual(receivedForMeeting, [eventNPlus1.seq, delayedSeq]);
      assert.ok(node.coordinator.getLastContiguousSeq() >= eventNPlus1.seq);
      assert.ok(!node.coordinator.getPendingGapSeqs().includes(delayedSeq));
    } finally {
      await node.close();
    }
  });

  it('3. Concurrent event creation from multiple application instances produces strictly unique contiguous sequences with zero lost events', async () => {
    const nodeA = await spawnNode(hubA);
    const nodeB = await spawnNode(hubB);
    const receivedA: number[] = [];
    const receivedB: number[] = [];

    try {
      const m = await createMeetingWithUsers(nodeA.svc);
      nodeA.coordinator.subscribe((ev) => {
        if (ev.meetingId === m.id) receivedA.push(ev.seq);
      });
      nodeB.coordinator.subscribe((ev) => {
        if (ev.meetingId === m.id) receivedB.push(ev.seq);
      });
      const baseSeq = Math.min(
        nodeA.coordinator.getLastContiguousSeq(),
        nodeB.coordinator.getLastContiguousSeq()
      );

      const COUNT = 12;
      const published = await Promise.all(
        Array.from({ length: COUNT }, (_, idx) =>
          publishLiveKitRevocation({
            meetingId: m.id,
            userId: users[idx % 2 === 0 ? 1 : 2].id,
            kind: idx % 2 === 0 ? 'PARTICIPANT_REMOVED' : 'PARTICIPANT_LEFT',
            revokedEpoch: idx + 2,
            reason: `Concurrent instance publish #${idx}`,
          })
        )
      );

      const sortedPublishedSeqs = published.map((p) => p.seq).sort((a, b) => a - b);
      assert.strictEqual(
        new Set(sortedPublishedSeqs).size,
        COUNT,
        'All 12 concurrent publishes MUST receive strictly unique sequences'
      );
      assert.ok(sortedPublishedSeqs[0] > baseSeq);

      assert.strictEqual(await nodeA.coordinator.syncNow(), true);
      assert.strictEqual(await nodeB.coordinator.syncNow(), true);
      assert.deepStrictEqual(receivedA, sortedPublishedSeqs);
      assert.deepStrictEqual(receivedB, sortedPublishedSeqs);
      assert.ok(nodeA.coordinator.getLastContiguousSeq() >= sortedPublishedSeqs[COUNT - 1]);
      assert.ok(nodeB.coordinator.getLastContiguousSeq() >= sortedPublishedSeqs[COUNT - 1]);
    } finally {
      await nodeA.close();
      await nodeB.close();
    }
  });

  it('4. Duplicate and out-of-order event delivery deduplicates strictly (including <= lastContiguousSeq) without skipping lower sequences', async () => {
    const coord = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      initialCursorSeq: 100,
    });
    const delivered: number[] = [];
    coord.subscribe((ev) => delivered.push(ev.seq));

    const mk = (seq: number): DistributedRevocationPayload => ({
      eventId: new mongoose.Types.ObjectId().toString(),
      seq,
      meetingId: new mongoose.Types.ObjectId().toString(),
      userId: new mongoose.Types.ObjectId().toString(),
      kind: 'PARTICIPANT_REMOVED',
      revokedEpoch: 2,
      fenceVersion: 1,
      reason: 'Out-of-order & duplicate test',
      createdAt: new Date(),
    });

    // Out-of-order arrivals: 103, 105, 102
    assert.strictEqual(coord.ingestEvent(mk(103)), true);
    assert.strictEqual(coord.ingestEvent(mk(105)), true);
    assert.strictEqual(coord.ingestEvent(mk(102)), true);
    assert.strictEqual(coord.getLastContiguousSeq(), 100);

    // Duplicates (already dispatched higher seq + historical <= cursor) MUST be dropped
    assert.strictEqual(coord.ingestEvent(mk(103)), false);
    assert.strictEqual(coord.ingestEvent(mk(100)), false);
    assert.strictEqual(coord.ingestEvent(mk(99)), false);

    // Deliver 101 -> advances cursor contiguously through 101, 102, 103 (stops before missing 104)
    assert.strictEqual(coord.ingestEvent(mk(101)), true);
    assert.strictEqual(coord.getLastContiguousSeq(), 103);

    // Duplicate 102 after cursor moved past 103 MUST still be dropped
    assert.strictEqual(coord.ingestEvent(mk(102)), false);

    // Deliver 104 -> advances cursor contiguously to 105
    assert.strictEqual(coord.ingestEvent(mk(104)), true);
    assert.strictEqual(coord.getLastContiguousSeq(), 105);
    assert.deepStrictEqual(delivered, [103, 105, 102, 101, 104]);

    await coord.stop();
  });

  it('5. Coordinator restart recovers durable persisted cursor from MongoDB LiveKitRevocationCursor and detects TTL retention wipeout fail-closed', async () => {
    const instanceId = `audit_inst_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    createdInstanceIds.push(instanceId);

    const node1 = await spawnNode(hubA, { instanceId });
    const nodeB = await spawnNode(hubB);

    try {
      const m = await createMeetingWithUsers(node1.svc);
      const startSeq = node1.coordinator.getLastContiguousSeq();

      // Publish 1 event while Coordinator 1 is online -> cursor advances & persists to MongoDB
      const ev1 = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[1].id,
        kind: 'PARTICIPANT_LEFT',
        revokedEpoch: 2,
      });
      await node1.coordinator.syncNow();
      const savedSeqBeforeStop = node1.coordinator.getLastContiguousSeq();
      assert.ok(savedSeqBeforeStop >= ev1.seq);
      await node1.close();

      // Verify durable checkpoint exists in MongoDB
      const persisted = await LiveKitRevocationCursor.findById(instanceId).lean();
      assert.ok(persisted);
      assert.strictEqual(persisted.lastContiguousSeq, savedSeqBeforeStop);

      // While Coordinator 1 is offline, Instance B publishes 2 durable events
      const ev2 = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[1].id,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 3,
      });
      const ev3 = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[2].id,
        kind: 'PARTICIPANT_LEFT',
        revokedEpoch: 2,
      });

      // Coordinator 2 starts with SAME instanceId and NO initialCursorSeq -> auto-recovers persisted cursor!
      const recoveredSeqs: number[] = [];
      const coord2 = new LiveKitRevocationCoordinator({
        instanceId,
        pollIntervalMs: 60_000,
        enableChangeStream: false,
        gapFailClosedGraceMs: 500,
      });
      coord2.subscribe((ev) => {
        if (ev.meetingId === m.id) recoveredSeqs.push(ev.seq);
      });
      await coord2.start();
      assert.strictEqual(coord2.getLastContiguousSeq(), savedSeqBeforeStop);
      assert.strictEqual(await coord2.syncNow(), true);
      assert.deepStrictEqual(recoveredSeqs, [ev2.seq, ev3.seq]);
      assert.ok(coord2.getLastContiguousSeq() >= ev3.seq);
      await coord2.stop();

      // Part B: TTL retention wipeout detection (all trailing events expired while coordinator offline)
      const ttlEvent = await publishLiveKitRevocation({
        meetingId: m.id,
        userId: users[1].id,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 4,
      });
      // Simulate MongoDB TTL deleting the undelivered event before Coordinator 3 wakes up
      await LiveKitRevocationEvent.deleteOne({ seq: ttlEvent.seq });

      const coord3 = new LiveKitRevocationCoordinator({
        instanceId,
        pollIntervalMs: 60_000,
        enableChangeStream: false,
        gapFailClosedGraceMs: 500,
      });
      try {
        await coord3.start();
        await coord3.syncNow();
        assert.ok(coord3.getPendingGapSeqs().includes(ttlEvent.seq));
        coord3.ageGapFirstSeenForTest(ttlEvent.seq, Date.now() - 10_000);
        assert.strictEqual(await coord3.syncNow(), false, 'TTL-expired undelivered event MUST fail closed');
        assert.strictEqual(coord3.isHealthy(), false);
        assert.ok(startSeq >= 0);
      } finally {
        await coord3.stop();
        // Restore deleted event so parallel suites sharing connectly_test do not see a synthetic gap
        await LiveKitRevocationEvent.updateOne(
          { seq: ttlEvent.seq },
          {
            $setOnInsert: {
              seq: ttlEvent.seq,
              meetingId: new mongoose.Types.ObjectId(m.id),
              userId: new mongoose.Types.ObjectId(users[1].id),
              kind: 'PARTICIPANT_REMOVED',
              revokedEpoch: 4,
              reason: 'Test cleanup restore',
              createdAt: new Date(),
            },
          },
          { upsert: true }
        ).catch(() => {});
      }
    } finally {
      await nodeB.close();
    }
  });

  it('6. Database transaction policy & transaction failure fail closed (NEVER silently fall back to non-atomic writes)', async () => {
    const meetingId = new mongoose.Types.ObjectId().toString();

    // A) In production (or transactionPolicy: 'required') on standalone MongoDB -> MUST fail closed
    await assert.rejects(
      () =>
        publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 2,
          nodeEnvOverride: 'production',
        }),
      (err: any) =>
        err.statusCode === 503 && err.code === 'LIVEKIT_REVOCATION_TRANSACTION_REQUIRED'
    );

    // Zero events persisted non-atomically for this meeting
    const leakedCount = await LiveKitRevocationEvent.countDocuments({
      meetingId: new mongoose.Types.ObjectId(meetingId),
    });
    assert.strictEqual(leakedCount, 0);

    // B) Production coordinator with requireTransactions=true on standalone MUST fail closed immediately
    const prodCoord = new LiveKitRevocationCoordinator({
      requireTransactions: true,
      pollIntervalMs: 60_000,
      enableChangeStream: true,
    });
    await prodCoord.start();
    assert.strictEqual(prodCoord.isHealthy(), false);
    assert.strictEqual(await prodCoord.syncNow(), false);
    await prodCoord.stop();
  });

  it('7. Revocation event publish failure STILL disconnects local socket, calls SFU eviction, marks coordinator unhealthy, and remote gateway revalidation evicts removed socket', async () => {
    removedSfuCalls = [];
    const failingPublish: PublishRevocationFn = async () => {
      throw new Error('Simulated durable revocation event write outage');
    };

    const instanceA = await spawnNode(hubA, { activeSocketRevalidationIntervalMs: 0 });
    const instanceB = await spawnNode(hubB, { publishRevocation: failingPublish });

    try {
      const m = await createMeetingWithUsers(instanceA.svc);
      const [hostTok, guestTok] = await Promise.all([
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[0].id),
        instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id),
      ]);

      // Host & Guest connected on Instance A; Guest ALSO connected on Instance B
      const hostConnA = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      const guestConnA = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      const guestConnB = await attemptWsUpgrade(
        instanceB.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      assert.strictEqual(hostConnA.statusCode, 101);
      assert.strictEqual(guestConnA.statusCode, 101);
      assert.strictEqual(guestConnB.statusCode, 101);

      // Instance B removes Guest while durable publish fails -> MUST throw 503 (never silent!),
      // MUST STILL evict from SFU, MUST STILL close local Guest socket, and MUST fail-closed coordinator B
      await assert.rejects(
        () =>
          instanceB.svc.removeParticipant(
            m.meetingCode,
            users[0].id,
            users[1].id,
            'Removal during publish outage'
          ),
        (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_REVOCATION_PUBLISH_FAILED'
      );

      await guestConnB.closedPromise;
      assert.strictEqual(guestConnB.socket?.destroyed, true, 'Local socket on Instance B MUST be closed');
      assert.strictEqual(instanceB.coordinator.isHealthy(), false, 'Coordinator B MUST transition fail-closed');
      assert.ok(
        removedSfuCalls.some((c) => c.identity.includes(users[1].id)),
        'SFU removeParticipant MUST execute even when durable event publish fails'
      );

      // Even without a published event (and with mocked SFU), Instance A defense-in-depth
      // active socket revalidation MUST terminate Guest's socket while preserving Host!
      const swept = await instanceA.gateway.revalidateActiveSockets();
      assert.ok(swept >= 2, 'Active socket revalidation MUST close removed participant socket pair');
      await guestConnA.closedPromise;
      assert.strictEqual(guestConnA.socket?.destroyed, true);
      assert.strictEqual(hostConnA.socket?.destroyed, false, 'Host MUST remain connected');
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 2);

      hostConnA.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('8. Removal racing with admission deterministically enforces both linearization orders with zero surviving removed sockets', async () => {
    // Subtest A: Removal linearizes BEFORE atomic fence (delivery paused) -> NEVER emits 101
    const barrierPreFence = createBarrier();
    let pauseTarget = false;
    const nodeA1 = await spawnNode(hubA, {
      hooks: {
        afterSyncBeforeAtomicFence: async () => {
          if (pauseTarget) await barrierPreFence.pause();
        },
      },
    });
    const nodeB = await spawnNode(hubB);

    try {
      const m1 = await createMeetingWithUsers(nodeA1.svc);
      const [hostTok, guestTok] = await Promise.all([
        nodeA1.svc.issueLiveKitToken(m1.meetingCode, users[0].id),
        nodeA1.svc.issueLiveKitToken(m1.meetingCode, users[1].id),
      ]);

      const hostConn = await attemptWsUpgrade(
        nodeA1.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);

      pauseTarget = true;
      const guestPromise = attemptWsUpgrade(
        nodeA1.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await barrierPreFence.arrived;

      nodeA1.coordinator.pauseDelivery();
      await nodeB.svc.removeParticipant(m1.meetingCode, users[0].id, users[1].id, 'Wins fence race');
      barrierPreFence.release();

      const guestRes = await guestPromise;
      assert.strictEqual(guestRes.statusCode, 403);
      assert.strictEqual(hostConn.socket?.destroyed, false);
      hostConn.socket?.destroy();
      await waitForCondition(() => nodeA1.gateway.getActiveSocketCount() === 0);
    } finally {
      await nodeA1.close();
    }

    // Subtest B: Admission linearizes BEFORE removal -> post-removal durable revocation terminates socket
    const barrierPostFence = createBarrier();
    let pauseTargetB = false;
    const nodeA2 = await spawnNode(hubA, {
      hooks: {
        afterAtomicFenceBeforeSocketWrite101: async () => {
          if (pauseTargetB) await barrierPostFence.pause();
        },
      },
    });
    try {
      const m2 = await createMeetingWithUsers(nodeA2.svc);
      const [hostTok, guestTok] = await Promise.all([
        nodeA2.svc.issueLiveKitToken(m2.meetingCode, users[0].id),
        nodeA2.svc.issueLiveKitToken(m2.meetingCode, users[1].id),
      ]);
      const hostConn = await attemptWsUpgrade(
        nodeA2.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(hostConn.statusCode, 101);

      pauseTargetB = true;
      const guestPromise = attemptWsUpgrade(
        nodeA2.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
      );
      await barrierPostFence.arrived;

      nodeA2.coordinator.pauseDelivery();
      await nodeB.svc.removeParticipant(m2.meetingCode, users[0].id, users[1].id, 'Post-fence removal');
      barrierPostFence.release();

      const guestRes = await guestPromise;
      assert.strictEqual(guestRes.statusCode, 101);

      nodeA2.coordinator.resumeDelivery();
      assert.strictEqual(await nodeA2.coordinator.syncNow(), true);
      await guestRes.closedPromise;
      assert.strictEqual(guestRes.socket?.destroyed, true);
      assert.strictEqual(hostConn.socket?.destroyed, false);

      hostConn.socket?.destroy();
      await waitForCondition(() => nodeA2.gateway.getActiveSocketCount() === 0);
    } finally {
      await nodeA2.close();
      await nodeB.close();
    }
  });

  it('9. Re-admission via real leaveMeeting + joinMeeting AND admitParticipant advances tokenEpoch so delayed old-epoch revocation NEVER kills newer session', async () => {
    const instanceA = await spawnNode(hubA);
    const instanceB = await spawnNode(hubB);

    try {
      // Part A: Direct leaveMeeting + joinMeeting re-admission
      const m = await createMeetingWithUsers(instanceA.svc, false);
      const oldTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);

      // Pause delivery on Instance A while Guest leaves on Instance B (publishes revokedEpoch = 2)
      instanceA.coordinator.pauseDelivery();
      await instanceB.svc.leaveMeeting(m.meetingCode, users[1].id);

      // Guest legitimately rejoins -> tokenEpoch advances to 3!
      await instanceB.svc.joinMeeting(m.meetingCode, users[1].id);
      const refreshedDoc = await MeetingParticipant.findOne({ meetingId: m.id, userId: users[1].id }).lean();
      assert.ok(refreshedDoc && refreshedDoc.tokenEpoch >= 3, 'Re-admission MUST strictly advance tokenEpoch');

      // Old epoch-1 token MUST be rejected with 403
      const oldWs = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(oldTok.token)}`
      );
      assert.strictEqual(oldWs.statusCode, 403);

      // New epoch-3 token connects cleanly
      const newTok = await instanceA.svc.issueLiveKitToken(m.meetingCode, users[1].id);
      const newWs = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(newTok.token)}`
      );
      assert.strictEqual(newWs.statusCode, 101);

      // Now deliver delayed old-epoch revocation event -> MUST NOT disrupt epoch-3 socket!
      instanceA.coordinator.resumeDelivery();
      assert.strictEqual(await instanceA.coordinator.syncNow(), true);
      assert.strictEqual(newWs.socket?.destroyed, false);

      newWs.socket?.destroy();
      await waitForCondition(() => instanceA.gateway.getActiveSocketCount() === 0);

      // Part B: Waiting-room admitParticipant advances tokenEpoch & signalFenceVersion
      const mWait = await createMeetingWithUsers(instanceA.svc, true);
      await instanceB.svc.joinMeeting(mWait.meetingCode, users[1].id);
      const beforeAdmit = await MeetingParticipant.findOne({ meetingId: mWait.id, userId: users[1].id }).lean();
      await instanceA.svc.admitParticipant(mWait.meetingCode, users[0].id, users[1].id);
      const afterAdmit = await MeetingParticipant.findOne({ meetingId: mWait.id, userId: users[1].id }).lean();
      assert.ok(beforeAdmit && afterAdmit);
      assert.strictEqual(afterAdmit.tokenEpoch, beforeAdmit.tokenEpoch + 1);
      assert.strictEqual(afterAdmit.signalFenceVersion, beforeAdmit.signalFenceVersion + 1);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });

  it('10. Meeting termination AND meeting expiration racing with signaling admission NEVER leave an admission authorized (410 + active socket eviction)', async () => {
    deletedRoomCalls = [];
    const barrierEndRace = createBarrier();
    let pauseGuestForEnd = false;

    const instanceA = await spawnNode(hubA, {
      hooks: {
        afterParticipantFenceBeforeMeetingRecheck: async () => {
          if (pauseGuestForEnd) await barrierEndRace.pause();
        },
      },
    });
    const instanceB = await spawnNode(hubB);

    try {
      // Part A: endMeeting commits right AFTER MeetingParticipant fence succeeded, BEFORE post-fence Meeting re-check
      const m1 = await createMeetingWithUsers(instanceA.svc);
      const guestTok1 = await instanceA.svc.issueLiveKitToken(m1.meetingCode, users[1].id);

      pauseGuestForEnd = true;
      const guestPromise = attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok1.token)}`
      );
      await barrierEndRace.arrived;

      // Instance B ends the meeting while Instance A is paused inside claimSignalingAdmissionFence
      instanceA.coordinator.pauseDelivery();
      await instanceB.svc.endMeeting(m1.meetingCode, users[0].id);

      // Verify endMeeting also advanced tokenEpoch & signalFenceVersion on admitted participants
      const endedParticipant = await MeetingParticipant.findOne({
        meetingId: m1.id,
        userId: users[1].id,
      }).lean();
      assert.ok(endedParticipant && endedParticipant.tokenEpoch >= 2);
      assert.ok(endedParticipant && endedParticipant.signalFenceVersion >= 2);

      barrierEndRace.release();
      const guestRes = await guestPromise;
      assert.strictEqual(
        guestRes.statusCode,
        410,
        'Post-fence Meeting check MUST reject meeting termination with 410 and NEVER emit 101'
      );
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 0);
      instanceA.coordinator.resumeDelivery();
      await instanceA.coordinator.syncNow();

      // Part B: Meeting expiration terminates existing active sockets across instances & blocks new upgrades
      pauseGuestForEnd = false;
      const m2 = await createMeetingWithUsers(instanceA.svc);
      const guestTok2 = await instanceA.svc.issueLiveKitToken(m2.meetingCode, users[1].id);
      const activeConn = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok2.token)}`
      );
      assert.strictEqual(activeConn.statusCode, 101);
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 2);

      // Expire the meeting in MongoDB and trigger findMeetingAndEnforceExpiration on Instance B
      await Meeting.updateOne(
        { _id: m2.id },
        { $set: { expiresAt: new Date(Date.now() - 10_000) } }
      );
      await assert.rejects(
        () => instanceB.svc.issueLiveKitToken(m2.meetingCode, users[1].id),
        (err: any) => err.statusCode === 410 && err.code === 'MEETING_EXPIRED'
      );

      // Instance B published durable MEETING_ENDED revocation + called deleteRoom; Instance A evicts socket!
      assert.ok(deletedRoomCalls.some((r) => r.includes(m2.id)));
      assert.strictEqual(await instanceA.coordinator.syncNow(), true);
      await activeConn.closedPromise;
      assert.strictEqual(activeConn.socket?.destroyed, true);
      assert.strictEqual(instanceA.gateway.getActiveSocketCount(), 0);

      const postExpireWs = await attemptWsUpgrade(
        instanceA.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok2.token)}`
      );
      assert.strictEqual(postExpireWs.statusCode, 410);
    } finally {
      await instanceA.close();
      await instanceB.close();
    }
  });
});
