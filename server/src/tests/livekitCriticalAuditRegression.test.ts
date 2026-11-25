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
  LiveKitRevocationCursor,
  LiveKitRevocationEvent,
} from '../models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeEvent } from '../models/MeetingRealtimeEvent.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
} from '../realtime/livekitRevocationCoordinator.js';
import {
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

const TEST_API_KEY = 'APIconnectlyCritAudit01';
const TEST_API_SECRET = 'SuperSecureCriticalSourceAuditSecretKey20269876543210';

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

async function startMockUpstreamLiveKit(options?: { rejectWithStatus?: number }) {
  const sockets = new Set<Duplex>();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  server.on('upgrade', (req, socket) => {
    if (options?.rejectWithStatus) {
      socket.end(
        `HTTP/1.1 ${options.rejectWithStatus} Bad Gateway\r\nContent-Length: 16\r\nConnection: close\r\n\r\nUpstream failure`
      );
      return;
    }
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
    getOpenUpstreamCount: () => sockets.size,
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

describe('Phase 09 Critical Source Audit Correction & Regression Suite (Tasks 1–7)', () => {
  let upstream: Awaited<ReturnType<typeof startMockUpstreamLiveKit>>;
  const users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  const createdInstanceIds: string[] = [];

  let sfuRemoveCalls: Array<{ room: string; identity: string }> = [];
  let sfuRemoveMode: 'ok' | 'throw' = 'ok';

  const makeLiveKitService = (port: number) =>
    new LiveKitService({
      config: {
        url: `ws://127.0.0.1:${port}`,
        apiKey: TEST_API_KEY,
        apiSecret: TEST_API_SECRET,
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: (): LiveKitRoomClientAdapter => ({
        createRoom: async () => ({}),
        removeParticipant: async (room, identity) => {
          sfuRemoveCalls.push({ room, identity });
          if (sfuRemoveMode === 'throw') {
            throw new Error('Simulated LiveKit SFU removeParticipant failure');
          }
          return {};
        },
        deleteRoom: async () => ({}),
      }),
    });

  let configuredLiveKit: LiveKitService;

  before(async () => {
    const mongoUri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test').replace(
      /\/[^/?]+(\?|$)/,
      '/connectly_test_critaudit$1'
    );
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    await LiveKitRevocationEvent.deleteMany({});
    await mongoose.connection.collection('livekitrevocationcounters').deleteMany({});

    upstream = await startMockUpstreamLiveKit();
    configuredLiveKit = makeLiveKitService(upstream.port);

    const passwordHash = await hashPassword('StrongPass!2026');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    for (let i = 0; i < 4; i += 1) {
      const email = `lk_crit_${i}_${suffix}@example.com`;
      const user = await User.create({
        firstName: `CritUser${i}`,
        lastName: 'Audit',
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
      await MeetingRealtimeEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
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

  async function spawnNode(opts: {
    hooks?: LiveKitSignalGatewayHooks;
    serviceHooks?: ConstructorParameters<typeof MeetingService>[1];
    hub?: MeetingRealtimeHub;
    livekitSvc?: LiveKitService;
    maxRevalidationFailures?: number;
    requireTransactions?: boolean;
  } = {}) {
    const hub = opts.hub ?? new MeetingRealtimeHub();
    const lk = opts.livekitSvc ?? configuredLiveKit;
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      maxStaleDeliveryMs: 60_000,
    });
    await coordinator.start();
    const gateway = new LiveKitSignalGateway(lk, opts.hooks ?? {}, coordinator, {
      activeSocketRevalidationIntervalMs: 0,
      maxRevalidationFailures: opts.maxRevalidationFailures ?? 1,
    });
    const app = createApp({ signalGateway: gateway });
    const server = http.createServer(app);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Node bind failed');
    const svc = new MeetingService(
      hub,
      opts.serviceHooks ?? {},
      lk,
      gateway,
      publishLiveKitRevocation,
      coordinator,
      { requireTransactions: opts.requireTransactions ?? false }
    );

    return {
      hub,
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

  it('1. Checkpoint crash safety: crash after event insert before processing AND crash after processing before checkpoint both replay safely on restart with zero skips', async () => {
    const instanceId = `crit_ckpt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    createdInstanceIds.push(instanceId);
    const meetingId = new mongoose.Types.ObjectId().toString();

    // Baseline coordinator establishes durable checkpoint seq0
    const baseCoord = new LiveKitRevocationCoordinator({
      instanceId,
      pollIntervalMs: 60_000,
      enableChangeStream: false,
    });
    await baseCoord.start();
    const seq0 = baseCoord.getLastContiguousSeq();
    await baseCoord.stop();

    // Scenario A: Event inserted, Coordinator 1 crashes at beforeEventProcess (BEFORE processing & BEFORE checkpoint)
    const evA = await publishLiveKitRevocation({
      meetingId,
      userId: users[1].id,
      kind: 'PARTICIPANT_REMOVED',
      revokedEpoch: 2,
    });

    const processedA: number[] = [];
    const coordCrashBeforeProcess = new LiveKitRevocationCoordinator({
      instanceId,
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      hooks: {
        beforeEventProcess: async (ev) => {
          if (ev.seq === evA.seq) {
            throw new Error('Simulated crash after event insert before processing');
          }
        },
      },
    });
    coordCrashBeforeProcess.subscribe((ev) => {
      if (ev.meetingId === meetingId) processedA.push(ev.seq);
    });
    await coordCrashBeforeProcess.start();
    await coordCrashBeforeProcess.syncNow();
    await coordCrashBeforeProcess.stop({ skipCheckpointFlush: true });

    // Durable checkpoint MUST NOT have advanced past seq0!
    const cpAfterCrashA = await LiveKitRevocationCursor.findById(instanceId).lean();
    assert.strictEqual(cpAfterCrashA?.lastContiguousSeq, seq0);
    assert.deepStrictEqual(processedA, []);

    // Scenario B: Coordinator 2 processes evA cleanly, then crashes at beforeCheckpointPersist (AFTER processing, BEFORE checkpoint)
    const processedB: number[] = [];
    const coordCrashBeforeCkpt = new LiveKitRevocationCoordinator({
      instanceId,
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      hooks: {
        beforeCheckpointPersist: async () => {
          throw new Error('Simulated crash after event processing before checkpoint');
        },
      },
    });
    coordCrashBeforeCkpt.subscribe((ev) => {
      if (ev.meetingId === meetingId) processedB.push(ev.seq);
    });
    await coordCrashBeforeCkpt.start();
    await coordCrashBeforeCkpt.syncNow();
    await coordCrashBeforeCkpt.stop({ skipCheckpointFlush: true });

    assert.deepStrictEqual(processedB, [evA.seq], 'Event was processed in memory before crash');
    const cpAfterCrashB = await LiveKitRevocationCursor.findById(instanceId).lean();
    assert.strictEqual(
      cpAfterCrashB?.lastContiguousSeq,
      seq0,
      'Durable checkpoint MUST remain at seq0 because checkpoint persist crashed'
    );

    // Scenario C: Coordinator 3 restarts from durable checkpoint -> replays evA cleanly and advances checkpoint!
    const recovered: number[] = [];
    const coordRecovered = new LiveKitRevocationCoordinator({
      instanceId,
      pollIntervalMs: 60_000,
      enableChangeStream: false,
    });
    coordRecovered.subscribe((ev) => {
      if (ev.meetingId === meetingId) recovered.push(ev.seq);
    });
    await coordRecovered.start();
    assert.strictEqual(await coordRecovered.syncNow(), true);
    assert.deepStrictEqual(recovered, [evA.seq], 'Restart MUST replay uncheckpointed event with zero skips');
    await coordRecovered.stop();

    const cpFinal = await LiveKitRevocationCursor.findById(instanceId).lean();
    assert.ok(cpFinal && cpFinal.lastContiguousSeq >= evA.seq);
  });

  it('2. Gateway fail-closed active socket revalidation on MongoDB outage (NEVER silently keeps sockets authorized)', async () => {
    const node = await spawnNode({ maxRevalidationFailures: 1 });
    try {
      const { meeting } = await node.svc.createMeeting(users[0].id, {
        title: 'Revalidation Fail-Closed Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: false },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await node.svc.joinMeeting(meeting.meetingCode, users[0].id);

      const hostTok = await node.svc.issueLiveKitToken(meeting.meetingCode, users[0].id);
      const conn = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(conn.statusCode, 101);
      assert.strictEqual(node.gateway.getActiveSocketCount(), 2);

      // Simulate MongoDB outage during revalidateActiveSockets()
      const origFind = Meeting.find;
      (Meeting as any).find = () => ({
        select: () => ({
          lean: () => Promise.reject(new Error('Simulated MongoDB outage during active revalidation')),
        }),
      });
      try {
        const closed = await node.gateway.revalidateActiveSockets();
        assert.ok(closed >= 2, 'Fail-closed revalidation MUST terminate active sockets on DB outage');
      } finally {
        (Meeting as any).find = origFind;
      }

      await conn.closedPromise;
      assert.strictEqual(conn.socket?.destroyed, true);
      assert.strictEqual(node.gateway.getActiveSocketCount(), 0);
      assert.strictEqual(node.gateway.getPendingUpgradeCount(), 0);
    } finally {
      await node.close();
    }
  });

  it('3. Failed handshakes (invalid token, transient DB error, fence failure, proxy error, finalize throw) NEVER call livekit.removeParticipant() and clean up both sockets', async () => {
    sfuRemoveCalls = [];
    sfuRemoveMode = 'ok';

    // Part A: Invalid token, fence DB error, sync failure, and finalize exception
    let throwInHook = false;
    const node = await spawnNode({
      hooks: {
        beforeWrite101: async () => {
          if (throwInHook) throw new Error('Simulated unexpected finalize error');
        },
      },
    });
    try {
      const { meeting } = await node.svc.createMeeting(users[0].id, {
        title: 'No Destructive SFU Side Effects Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: false },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
      const hostTok = await node.svc.issueLiveKitToken(meeting.meetingCode, users[0].id);

      // 1) Invalid token
      const badTokRes = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=not.a.valid.jwt`
      );
      assert.strictEqual(badTokRes.statusCode, 401);

      // 2) Atomic fence DB outage (503 LIVEKIT_FENCE_UNAVAILABLE)
      const origFindOneAndUpdate = MeetingParticipant.findOneAndUpdate;
      (MeetingParticipant as any).findOneAndUpdate = () => ({
        lean: () => Promise.reject(new Error('Transient DB error at atomic fence')),
      });
      try {
        const fenceErrRes = await attemptWsUpgrade(
          node.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
        );
        assert.strictEqual(fenceErrRes.statusCode, 503);
      } finally {
        (MeetingParticipant as any).findOneAndUpdate = origFindOneAndUpdate;
      }

      // 3) Unexpected finalizeUpgrade exception AFTER socket tracking -> must untrack active & pending cleanly (500)
      throwInHook = true;
      const hookErrRes = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      throwInHook = false;
      assert.strictEqual(hookErrRes.statusCode, 500);

      // 4) Coordinator unhealthy during upgrade (503)
      node.coordinator.markUnavailable('Simulated outage');
      const coordErrRes = await attemptWsUpgrade(
        node.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(coordErrRes.statusCode, 503);

      // ZERO calls to livekit.removeParticipant() across ALL handshake failure paths!
      assert.strictEqual(
        sfuRemoveCalls.length,
        0,
        'Handshake failures MUST NOT accidentally kick valid participants from LiveKit SFU'
      );
      await waitForCondition(
        () =>
          node.gateway.getActiveSocketCount() === 0 &&
          node.gateway.getPendingUpgradeCount() === 0
      );
    } finally {
      await node.close();
    }

    // Part B: Upstream proxy non-101 HTTP rejection & unreachable upstream error
    const rejectingUpstream = await startMockUpstreamLiveKit({ rejectWithStatus: 502 });
    const proxyNode = await spawnNode({ livekitSvc: makeLiveKitService(rejectingUpstream.port) });
    try {
      const { meeting } = await proxyNode.svc.createMeeting(users[0].id, {
        title: 'Proxy Error Cleanup Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: false },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await proxyNode.svc.joinMeeting(meeting.meetingCode, users[0].id);
      const hostTok = await proxyNode.svc.issueLiveKitToken(meeting.meetingCode, users[0].id);

      const rejRes = await attemptWsUpgrade(
        proxyNode.port,
        `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
      );
      assert.strictEqual(rejRes.statusCode, 502);
      assert.strictEqual(proxyNode.gateway.getPendingUpgradeCount(), 0);
      assert.strictEqual(proxyNode.gateway.getActiveSocketCount(), 0);
      assert.strictEqual(sfuRemoveCalls.length, 0);
    } finally {
      await proxyNode.close();
      await rejectingUpstream.close();
    }
  });

  it('4. Waiting-room admission: reservation rollback on concurrent cancel AND stale actor authorization (demoted co-host / disabled setting) blocked cleanly', async () => {
    // Subtest A: Reservation rollback when waiting user cancels mid-admission
    const cancelBarrier = createBarrier();
    const nodeA = await spawnNode({
      serviceHooks: { beforeAdmitParticipantWrite: cancelBarrier.pause },
    });
    const nodeB = await spawnNode();

    try {
      const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
        title: 'Admission Rollback & Stale Actor Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true, allowCoHostAdmit: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

      const admitPromise = nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
      await cancelBarrier.arrived;

      // User 1 cancels their waiting request while admission is paused after capacity reservation
      await nodeB.svc.leaveMeeting(meeting.meetingCode, users[1].id);
      cancelBarrier.release();

      await assert.rejects(
        () => admitPromise,
        (err: any) => err.statusCode === 409 && err.code === 'WAITING_REQUEST_NOT_PENDING'
      );

      // activeParticipantCount MUST be rolled back cleanly to 1 (Host only — zero leaked capacity!)
      const mAfterCancel = await Meeting.findById(meeting.id).lean();
      assert.strictEqual(mAfterCancel?.activeParticipantCount, 1);

      // Subtest B: Stale co-host authorization (co-host demoted mid-admission) MUST be rejected with 403 and zero leaked count
      const demoteBarrier = createBarrier();
      const staleNode = await spawnNode({
        serviceHooks: { beforeAdmitParticipantWrite: demoteBarrier.pause },
      });
      try {
        // Admit user[1] as co-host, then user[2] enters waiting room
        await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
        await nodeB.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
        await nodeB.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, {
          role: 'co-host',
        });
        await nodeB.svc.joinMeeting(meeting.meetingCode, users[2].id); // WAITING

        // Co-host begins admitting user[2], pauses after reserve
        const staleAdmitPromise = staleNode.svc.admitParticipant(
          meeting.meetingCode,
          users[1].id,
          users[2].id
        );
        await demoteBarrier.arrived;

        // Host demotes co-host back to participant!
        await nodeB.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, {
          role: 'participant',
        });
        demoteBarrier.release();

        await assert.rejects(
          () => staleAdmitPromise,
          (err: any) => err.statusCode === 403 && err.code === 'FORBIDDEN'
        );

        const mAfterStale = await Meeting.findById(meeting.id).lean();
        const u2Doc = await MeetingParticipant.findOne({
          meetingId: meeting.id,
          userId: users[2].id,
        }).lean();
        assert.strictEqual(mAfterStale?.activeParticipantCount, 2, 'No leaked capacity on stale actor reject');
        assert.strictEqual(u2Doc?.admissionStatus, 'WAITING', 'Target must remain WAITING');
      } finally {
        await staleNode.close();
      }

      // Subtest C: Production transaction enforcement (requireTransactions=true on standalone MUST fail closed)
      const prodNode = await spawnNode({ requireTransactions: true });
      try {
        await assert.rejects(
          () => prodNode.svc.admitParticipant(meeting.meetingCode, users[0].id, users[2].id),
          (err: any) => err.statusCode === 503 && err.code === 'TRANSACTION_REQUIRED'
        );
      } finally {
        await prodNode.close();
      }
    } finally {
      await nodeA.close();
      await nodeB.close();
    }
  });

  it('5. Admission vs meeting termination race at ALL 4 boundaries (beforeAdmitReserve, beforeAdmitParticipantWrite, beforeAdmitOutboxClaim, beforeAdmitEmit) NEVER emits stale admission-approved or participant-joined', async () => {
    const boundaries: Array<
      'beforeAdmitReserve' | 'beforeAdmitParticipantWrite' | 'beforeAdmitOutboxClaim' | 'beforeAdmitEmit'
    > = [
      'beforeAdmitReserve',
      'beforeAdmitParticipantWrite',
      'beforeAdmitOutboxClaim',
      'beforeAdmitEmit',
    ];

    for (const boundary of boundaries) {
      const barrier = createBarrier();
      const emittedEvents: string[] = [];

      const hubA = new MeetingRealtimeHub();
      const origApprove = hubA.emitAdmissionApproved.bind(hubA);
      const origJoined = hubA.emitParticipantJoined.bind(hubA);
      const origEnded = hubA.emitMeetingEnded.bind(hubA);
      hubA.emitAdmissionApproved = async (...args) => {
        emittedEvents.push('admission-approved');
        return origApprove(...args);
      };
      hubA.emitParticipantJoined = (...args) => {
        emittedEvents.push('participant-joined');
        return origJoined(...args);
      };
      hubA.emitMeetingEnded = async (...args) => {
        emittedEvents.push('meeting-ended');
        return origEnded(...args);
      };

      const nodeA = await spawnNode({
        hub: hubA,
        serviceHooks: { [boundary]: barrier.pause },
      });
      const nodeB = await spawnNode();

      try {
        const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
          title: `Admit vs End (${boundary})`,
          maxParticipants: 10,
          settings: { waitingRoomEnabled: true },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

        emittedEvents.length = 0;

        // Instance A starts admitting user[1] and pauses at the exact boundary
        const admitPromise = nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
        await barrier.arrived;

        // Instance B terminates the meeting!
        await nodeB.svc.endMeeting(meeting.meetingCode, users[0].id);
        barrier.release();

        await assert.rejects(
          () => admitPromise,
          (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
        );

        assert.ok(
          !emittedEvents.includes('admission-approved'),
          `Boundary ${boundary}: MUST NEVER emit stale admission-approved after termination`
        );
        assert.ok(
          !emittedEvents.includes('participant-joined'),
          `Boundary ${boundary}: MUST NEVER emit stale participant-joined after termination`
        );

        const u1Doc = await MeetingParticipant.findOne({
          meetingId: meeting.id,
          userId: users[1].id,
        }).lean();
        assert.notStrictEqual(
          u1Doc?.admissionStatus,
          'ADMITTED',
          `Boundary ${boundary}: participant must not remain ADMITTED after ended meeting`
        );
      } finally {
        await nodeA.close();
        await nodeB.close();
      }
    }
  });

  it('6. Host leave deterministic succession (co-host before participant) AND host leave vs concurrent join never erroneously terminates active peer', async () => {
    // Part A: Deterministic succession chooses earliest-joined co-host over earlier-joined regular participant
    const nodeA = await spawnNode();
    const nodeB = await spawnNode();

    try {
      const { meeting: m1 } = await nodeA.svc.createMeeting(users[0].id, {
        title: 'Deterministic Host Succession Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: false },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(m1.id));
      await nodeA.svc.joinMeeting(m1.meetingCode, users[0].id);
      await nodeA.svc.joinMeeting(m1.meetingCode, users[1].id); // regular participant joined earlier
      await nodeA.svc.joinMeeting(m1.meetingCode, users[2].id); // joined second, promoted to co-host
      await nodeA.svc.updateParticipantRole(m1.meetingCode, users[0].id, users[2].id, {
        role: 'co-host',
      });

      const leaveRes = await nodeB.svc.leaveMeeting(m1.meetingCode, users[0].id);
      assert.strictEqual(leaveRes.meetingEnded, false);
      assert.strictEqual(leaveRes.newHostId, users[2].id, 'Earliest admitted co-host MUST inherit host role');

      const m1Doc = await Meeting.findById(m1.id).lean();
      assert.strictEqual(m1Doc?.hostId.toString(), users[2].id);
      assert.strictEqual(m1Doc?.activeParticipantCount, 2);

      // Part B: Host leaves paused at beforeLeaveMeetingUpdate while user[1] joins concurrently ->
      // meeting MUST NOT end erroneously and host ownership MUST transfer to user[1]!
      const leaveBarrier = createBarrier();
      const pausedLeaveNode = await spawnNode({
        serviceHooks: { beforeLeaveMeetingUpdate: leaveBarrier.pause },
      });
      try {
        const { meeting: m2 } = await nodeA.svc.createMeeting(users[0].id, {
          title: 'Host Leave vs Concurrent Join Room',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(m2.id));
        await nodeA.svc.joinMeeting(m2.meetingCode, users[0].id);

        const hostLeavePromise = pausedLeaveNode.svc.leaveMeeting(m2.meetingCode, users[0].id);
        await leaveBarrier.arrived;

        // Concurrent user[1] joins while Host's leave is mid-flight
        await nodeB.svc.joinMeeting(m2.meetingCode, users[1].id);
        leaveBarrier.release();

        const raceLeaveRes = await hostLeavePromise;
        assert.strictEqual(raceLeaveRes.meetingEnded, false, 'Meeting must NOT end when concurrent join succeeded');
        assert.strictEqual(raceLeaveRes.newHostId, users[1].id, 'Concurrent joiner must receive host ownership');

        const m2Doc = await Meeting.findById(m2.id).lean();
        assert.strictEqual(m2Doc?.status, 'ACTIVE');
        assert.strictEqual(m2Doc?.hostId.toString(), users[1].id);
        assert.strictEqual(m2Doc?.activeParticipantCount, 1);
      } finally {
        await pausedLeaveNode.close();
      }
    } finally {
      await nodeA.close();
      await nodeB.close();
    }
  });

  it('7. Removal cleanup reliability: realtime failure AND/OR LiveKit SFU failure NEVER block local signaling socket teardown and NEVER mask failed external cleanup', async () => {
    const scenarios: Array<{ name: string; failRealtime: boolean; failLiveKit: boolean }> = [
      { name: 'realtime throws, SFU succeeds', failRealtime: true, failLiveKit: false },
      { name: 'realtime succeeds, SFU throws', failRealtime: false, failLiveKit: true },
      { name: 'BOTH realtime and SFU fail', failRealtime: true, failLiveKit: true },
    ];

    for (const sc of scenarios) {
      sfuRemoveCalls = [];
      sfuRemoveMode = sc.failLiveKit ? 'throw' : 'ok';

      const hub = new MeetingRealtimeHub();
      let realtimeInvoked = false;
      if (sc.failRealtime) {
        hub.emitParticipantRemoved = async () => {
          realtimeInvoked = true;
          throw new Error('Simulated Socket.IO emitParticipantRemoved outage');
        };
      } else {
        const orig = hub.emitParticipantRemoved.bind(hub);
        hub.emitParticipantRemoved = async (...args) => {
          realtimeInvoked = true;
          return orig(...args);
        };
      }

      const node = await spawnNode({ hub });
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: `Removal Cleanup (${sc.name})`,
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id);

        const [hostTok, guestTok] = await Promise.all([
          node.svc.issueLiveKitToken(meeting.meetingCode, users[0].id),
          node.svc.issueLiveKitToken(meeting.meetingCode, users[1].id),
        ]);

        const hostConn = await attemptWsUpgrade(
          node.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
        );
        const guestConn = await attemptWsUpgrade(
          node.port,
          `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
        );
        assert.strictEqual(hostConn.statusCode, 101);
        assert.strictEqual(guestConn.statusCode, 101);

        const removeRes = await node.svc.removeParticipant(
          meeting.meetingCode,
          users[0].id,
          users[1].id,
          `Cleanup test: ${sc.name}`
        );

        // 1) Local Guest socket MUST ALWAYS be disconnected while Host stays connected!
        await guestConn.closedPromise;
        assert.strictEqual(guestConn.socket?.destroyed, true, `${sc.name}: Guest socket MUST close`);
        assert.strictEqual(hostConn.socket?.destroyed, false, `${sc.name}: Host socket MUST remain open`);
        assert.strictEqual(removeRes.cleanup.localSocketsDisconnected, true);

        // 2) Independent cleanup steps MUST all have been attempted regardless of sibling failures!
        assert.strictEqual(realtimeInvoked, true, `${sc.name}: realtime step must be attempted`);
        assert.ok(
          sfuRemoveCalls.some((c) => c.identity.includes(users[1].id)),
          `${sc.name}: LiveKit SFU eviction must be attempted even if realtime threw`
        );

        // 3) External cleanup failures MUST be honestly reported (NEVER reported as success!)
        assert.strictEqual(removeRes.cleanup.realtimeEmitted, !sc.failRealtime);
        assert.strictEqual(removeRes.cleanup.livekitEvicted, !sc.failLiveKit);
        const expectedFailureCount = (sc.failRealtime ? 1 : 0) + (sc.failLiveKit ? 1 : 0);
        assert.strictEqual(removeRes.cleanup.failures.length, expectedFailureCount);

        // 4) Durable cross-instance revocation event MUST exist in MongoDB
        const revEvent = await LiveKitRevocationEvent.findOne({
          meetingId: meeting.id,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
        }).lean();
        assert.ok(revEvent, `${sc.name}: durable revocation event must remain authoritative`);

        hostConn.socket?.destroy();
        await waitForCondition(() => node.gateway.getActiveSocketCount() === 0);
      } finally {
        sfuRemoveMode = 'ok';
        await node.close();
      }
    }
  });
});
