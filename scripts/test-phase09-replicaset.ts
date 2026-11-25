import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import mongoose from 'mongoose';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { generateAccessToken } from '../server/src/utils/tokens.js';

import { createApp } from '../server/src/app.js';
import { User } from '../server/src/models/User.model.js';
import { Meeting } from '../server/src/models/Meeting.model.js';
import { MeetingParticipant } from '../server/src/models/MeetingParticipant.model.js';
import {
  MeetingRealtimeEvent,
  MEETING_OUTBOX_TERMINAL_TTL_SECONDS,
  ensureMeetingRealtimeOutboxReady,
} from '../server/src/models/MeetingRealtimeEvent.model.js';
import {
  MeetingRealtimeOutboxDispatcher,
  createSimulatedOutboxCrash,
} from '../server/src/realtime/meetingOutboxDispatcher.js';
import {
  isReplicaSetTransactionsSupported,
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  LiveKitRevocationEvent,
  resetRevocationTopologyCache,
} from '../server/src/models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeHub } from '../server/src/realtime/meetingSocket.js';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
} from '../server/src/realtime/livekitRevocationCoordinator.js';
import {
  LiveKitSignalGateway,
  LIVEKIT_SIGNAL_GATEWAY_PATH,
} from '../server/src/realtime/livekitSignalGateway.js';
import { MeetingService, type PublishRevocationFn } from '../server/src/services/meeting.service.js';
import {
  LiveKitService,
  type LiveKitRoomClientAdapter,
} from '../server/src/services/livekit.service.js';
import { hashPassword } from '../server/src/utils/password.js';

const MONGOD_PATH =
  process.env.MONGOD_BIN || 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';
const RS_PORT = 27018;
const RS_NAME = 'connectlyRsAudit';
const TEST_API_KEY = 'APIconnectlyRsAudit01';
const TEST_API_SECRET = 'SuperSecureReplicaSetChangeStreamAuditSecretKey2026987654321';

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

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  label = 'condition'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(await predicate(), `Timed out waiting for: ${label}`);
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

async function startEphemeralReplicaSet(): Promise<{
  uri: string;
  stop: () => Promise<void>;
}> {
  if (!fs.existsSync(MONGOD_PATH)) {
    throw new Error(`mongod binary not found at ${MONGOD_PATH}`);
  }

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'connectly-rs-audit-'));
  const proc: ChildProcess = spawn(
    MONGOD_PATH,
    [
      '--replSet',
      RS_NAME,
      '--port',
      String(RS_PORT),
      '--bind_ip',
      '127.0.0.1',
      '--dbpath',
      dbPath,
      '--oplogSize',
      '64',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let startupOutput = '';
  proc.stdout?.on('data', (chunk) => {
    startupOutput += chunk.toString();
  });
  proc.stderr?.on('data', (chunk) => {
    startupOutput += chunk.toString();
  });

  const directUri = `mongodb://127.0.0.1:${RS_PORT}/connectly_rs_audit?directConnection=true`;
  const rsUri = `mongodb://127.0.0.1:${RS_PORT}/connectly_rs_audit?replicaSet=${RS_NAME}&directConnection=true`;

  // Wait until mongod accepts direct connection
  let connected = false;
  const connectDeadline = Date.now() + 15_000;
  while (Date.now() < connectDeadline) {
    try {
      await mongoose.connect(directUri, { serverSelectionTimeoutMS: 1000 });
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!connected) {
    proc.kill();
    throw new Error(`Failed to connect to ephemeral mongod on port ${RS_PORT}:\n${startupOutput.slice(-800)}`);
  }

  // Initiate single-node replica set
  const admin = mongoose.connection.db!.admin();
  try {
    await admin.command({
      replSetInitiate: {
        _id: RS_NAME,
        members: [{ _id: 0, host: `127.0.0.1:${RS_PORT}` }],
      },
    });
  } catch (err: any) {
    if (!String(err?.message || '').includes('already initialized')) {
      throw err;
    }
  }

  // Wait until this node is elected PRIMARY
  await waitForCondition(
    async () => {
      const hello = await admin.command({ hello: 1 });
      return Boolean(hello?.isWritablePrimary && hello?.setName === RS_NAME);
    },
    15_000,
    'Replica Set PRIMARY election'
  );

  await mongoose.disconnect();
  await mongoose.connect(rsUri);
  resetRevocationTopologyCache();

  return {
    uri: rsUri,
    stop: async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 4000);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      try {
        fs.rmSync(dbPath, { recursive: true, force: true });
      } catch {
        // ignore Windows handle release delay
      }
    },
  };
}

async function run(): Promise<void> {
  console.log('[ReplicaSetAudit] Starting ephemeral MongoDB 8.3 single-node Replica Set...');
  const rs = await startEphemeralReplicaSet();
  const upstream = await startMockUpstreamLiveKit();

  const stubAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async () => ({}),
    deleteRoom: async () => ({}),
  };

  const configuredLiveKit = new LiveKitService({
    config: {
      url: `ws://127.0.0.1:${upstream.port}`,
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      tokenTtlSeconds: 600,
    },
    nodeEnv: 'development',
    roomClientFactory: () => stubAdapter,
  });

  const hubA = new MeetingRealtimeHub();
  const hubB = new MeetingRealtimeHub();
  const users: Array<{ id: string; email: string }> = [];

  try {
    // Verify replica-set transaction detection
    const txSupported = await isReplicaSetTransactionsSupported(true);
    assert.strictEqual(txSupported, true, 'Ephemeral MongoDB Replica Set MUST report transaction support');

    // Create collections before multi-document transactions run
    await Promise.all([
      User.createCollection().catch(() => {}),
      Meeting.createCollection().catch(() => {}),
      MeetingParticipant.createCollection().catch(() => {}),
      LiveKitRevocationCounter.createCollection().catch(() => {}),
      LiveKitRevocationEvent.createCollection().catch(() => {}),
      LiveKitRevocationCursor.createCollection().catch(() => {}),
      MeetingRealtimeEvent.createCollection().catch(() => {}),
    ]);
    await Promise.all([
      MeetingParticipant.init().catch(() => {}),
      LiveKitRevocationEvent.init().catch(() => {}),
      MeetingRealtimeEvent.init().catch(() => {}),
    ]);

    const passwordHash = await hashPassword('StrongPass!2026');
    for (let i = 0; i < 3; i += 1) {
      const user = await User.create({
        firstName: `RsUser${i}`,
        lastName: 'ReplicaSet',
        email: `rs_user_${i}_${Date.now()}@example.com`,
        passwordHash,
      });
      users.push({ id: user._id.toString(), email: user.email });
    }

    async function spawnRsNode(
      hub: MeetingRealtimeHub,
      opts: {
        instanceId?: string;
        pollIntervalMs?: number;
        changeStreamReconnectDelayMs?: number;
        publishRevocation?: PublishRevocationFn;
      } = {}
    ) {
      const coordinator = new LiveKitRevocationCoordinator({
        pollIntervalMs: opts.pollIntervalMs ?? 60_000, // Long poll interval proves Change Stream push!
        enableChangeStream: true,
        requireTransactions: true,
        instanceId: opts.instanceId,
        changeStreamReconnectDelayMs: opts.changeStreamReconnectDelayMs ?? 150,
        maxStaleDeliveryMs: 60_000,
      });
      await coordinator.start();
      const gateway = new LiveKitSignalGateway(configuredLiveKit, {}, coordinator, {
        activeSocketRevalidationIntervalMs: 0,
      });
      const app = createApp({ signalGateway: gateway });
      const server = http.createServer(app);
      gateway.attach(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('RS Node bind failed');
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

    let passed = 0;
    const TOTAL_RS_CHECKS = 16;
    const runCheck = async (name: string, fn: () => Promise<void>) => {
      const t0 = Date.now();
      await fn();
      passed += 1;
      console.log(`  PASS [${passed}/${TOTAL_RS_CHECKS}] ${name} (${Date.now() - t0}ms)`);
    };

    // RS-1: Real MongoDB ACID transaction rollback on crash after sequence allocation
    await runCheck(
      'RS-1: ACID transaction failure after sequence allocation rolls back counter & event atomically (ZERO leaked sequence gap)',
      async () => {
        const meetingId = new mongoose.Types.ObjectId().toString();
        const first = await publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 2,
          transactionPolicy: 'required',
        });
        assert.strictEqual(first.seq, 1);

        // Simulate crash strictly AFTER allocateNextRevocationSeq(session) and BEFORE event insert
        await assert.rejects(
          () =>
            publishLiveKitRevocation({
              meetingId,
              userId: users[1].id,
              kind: 'PARTICIPANT_REMOVED',
              revokedEpoch: 3,
              transactionPolicy: 'required',
              beforeEventInsertForTest: async () => {
                throw new Error('Simulated process crash mid-transaction');
              },
            }),
          (err: any) => err.statusCode === 503 && err.code === 'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
        );

        // Counter MUST still be 1 (rolled back atomically!) and NO orphan seq 2 exists
        const counterAfterAbort = await LiveKitRevocationCounter.findById(
          'livekit_revocation_global_seq'
        ).lean();
        assert.strictEqual(counterAfterAbort?.seq, 1, 'Aborted transaction MUST roll back counter seq');

        // Next successful publish gets exact seq = 2 (zero gap!)
        const second = await publishLiveKitRevocation({
          meetingId,
          userId: users[2].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 2,
          transactionPolicy: 'required',
        });
        assert.strictEqual(second.seq, 2);
      }
    );

    // RS-2: Real MongoDB WiredTiger counter-lock serialization under delayed insert + concurrent multi-instance publishers
    await runCheck(
      'RS-2: Delayed transactional insert + 8 concurrent multi-instance publishers serialize strictly without gaps or out-of-order commits',
      async () => {
        const meetingId = new mongoose.Types.ObjectId().toString();
        const counterBefore = await LiveKitRevocationCounter.findById(
          'livekit_revocation_global_seq'
        ).lean();
        const baseSeq = counterBefore?.seq ?? 0;

        const barrier = createBarrier();
        const commitOrder: number[] = [];

        // Publisher 1 allocates seq inside ACID tx and pauses before event insert
        const p1 = publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 2,
          transactionPolicy: 'required',
          beforeEventInsertForTest: barrier.pause,
        }).then((ev) => {
          commitOrder.push(ev.seq);
          return ev;
        });
        await barrier.arrived;

        // Fire 7 concurrent publishers while Publisher 1 holds the counter document lock
        const others = Array.from({ length: 7 }, (_, i) =>
          publishLiveKitRevocation({
            meetingId,
            userId: users[i % 2 === 0 ? 1 : 2].id,
            kind: 'PARTICIPANT_LEFT',
            revokedEpoch: i + 2,
            transactionPolicy: 'required',
          }).then((ev) => {
            commitOrder.push(ev.seq);
            return ev;
          })
        );

        // Give concurrent transactions a moment to contend on the counter lock, then release P1
        await new Promise((r) => setTimeout(r, 80));
        barrier.release();

        const results = await Promise.all([p1, ...others]);
        const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
        const expected = Array.from({ length: 8 }, (_, i) => baseSeq + 1 + i);
        assert.deepStrictEqual(seqs, expected, 'All 8 transactional publishes MUST yield contiguous sequences');
        assert.strictEqual(
          commitOrder[0],
          baseSeq + 1,
          'First holder of counter lock MUST commit baseSeq+1 before waiters can commit'
        );
      }
    );

    // RS-3: Atomic MeetingService.removeParticipant transaction rollback on publish failure
    await runCheck(
      'RS-3: Atomic removeParticipant transaction rolls back MeetingParticipant & Meeting cleanly if revocation publish fails',
      async () => {
        const failingPublish: PublishRevocationFn = async () => {
          throw new Error('Injected revocation publish failure inside ACID removal transaction');
        };
        const node = await spawnRsNode(hubA, { publishRevocation: failingPublish });
        try {
          const { meeting } = await node.svc.createMeeting(users[0].id, {
            title: 'RS Rollback Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: false },
          });
          await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await node.svc.joinMeeting(meeting.meetingCode, users[1].id);

          await assert.rejects(
            () => node.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Should rollback'),
            (err: any) =>
              err.statusCode === 503 && err.code === 'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
          );

          // Participant MUST still be ADMITTED and activeParticipantCount MUST still be 2 (full atomic rollback!)
          const pDoc = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[1].id,
          }).lean();
          const mDoc = await Meeting.findById(meeting.id).lean();
          assert.strictEqual(pDoc?.admissionStatus, 'ADMITTED');
          assert.strictEqual(mDoc?.activeParticipantCount, 2);
        } finally {
          await node.close();
        }
      }
    );

    // RS-4: Real MongoDB Change Stream push delivery across two Gateway instances (60s poll disabled effectively)
    await runCheck(
      'RS-4: Real MongoDB Change Stream push delivers cross-instance removal (transportMode=change_stream) and evicts Guest while Host stays connected',
      async () => {
        const nodeA = await spawnRsNode(hubA, { pollIntervalMs: 60_000 });
        const nodeB = await spawnRsNode(hubB, { pollIntervalMs: 60_000 });
        try {
          assert.strictEqual(nodeA.coordinator.getTransportMode(), 'change_stream');
          assert.strictEqual(nodeB.coordinator.getTransportMode(), 'change_stream');

          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Change Stream Push Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: false },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[1].id);

          const [hostTok, guestTok] = await Promise.all([
            nodeA.svc.issueLiveKitToken(meeting.meetingCode, users[0].id),
            nodeA.svc.issueLiveKitToken(meeting.meetingCode, users[1].id),
          ]);

          const hostConn = await attemptWsUpgrade(
            nodeA.port,
            `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(hostTok.token)}`
          );
          const guestConn = await attemptWsUpgrade(
            nodeA.port,
            `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
          );
          assert.strictEqual(hostConn.statusCode, 101);
          assert.strictEqual(guestConn.statusCode, 101);
          assert.strictEqual(nodeA.gateway.getActiveSocketCount(), 4);

          // Instance B removes Guest -> Instance A receives push via REAL Change Stream (no syncNow called!)
          await nodeB.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Change stream push eviction');

          await guestConn.closedPromise;
          assert.strictEqual(guestConn.socket?.destroyed, true);
          assert.strictEqual(hostConn.socket?.destroyed, false, 'Host MUST remain connected');
          assert.ok(nodeA.coordinator.getLastResumeToken() !== null, 'Coordinator MUST capture Change Stream resumeToken');
          await waitForCondition(() => nodeA.gateway.getActiveSocketCount() === 2, 3000, 'active socket count = 2');

          hostConn.socket?.destroy();
          await waitForCondition(() => nodeA.gateway.getActiveSocketCount() === 0, 3000, 'active socket count = 0');
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-5: Real Change Stream disconnect, resumeAfter reconnect & durable sequence catch-up
    await runCheck(
      'RS-5: Change Stream interruption triggers durable seq catch-up, reconnects with resumeAfter, and resumes real-time delivery with zero skips/duplicates',
      async () => {
        const nodeA = await spawnRsNode(hubA, {
          pollIntervalMs: 60_000,
          changeStreamReconnectDelayMs: 150,
        });
        const receivedSeqs: number[] = [];
        nodeA.coordinator.subscribe((ev) => receivedSeqs.push(ev.seq));

        try {
          assert.strictEqual(nodeA.coordinator.getTransportMode(), 'change_stream');
          assert.strictEqual(nodeA.coordinator.getChangeStreamAttachCount(), 1);
          const meetingId = new mongoose.Types.ObjectId().toString();

          // Publish 1 event first so Change Stream captures a valid resumeToken
          const ev1 = await publishLiveKitRevocation({
            meetingId,
            userId: users[1].id,
            kind: 'PARTICIPANT_LEFT',
            revokedEpoch: 2,
            transactionPolicy: 'required',
          });
          await waitForCondition(
            () => receivedSeqs.includes(ev1.seq) && nodeA.coordinator.getLastResumeToken() !== null,
            5000,
            'initial Change Stream event & resumeToken'
          );

          // Force Change Stream disconnect!
          await nodeA.coordinator.forceDisconnectChangeStreamForTest();

          // Publish 2 events while stream is reconnecting
          const ev2 = await publishLiveKitRevocation({
            meetingId,
            userId: users[1].id,
            kind: 'PARTICIPANT_REMOVED',
            revokedEpoch: 3,
            transactionPolicy: 'required',
          });
          const ev3 = await publishLiveKitRevocation({
            meetingId,
            userId: users[2].id,
            kind: 'PARTICIPANT_LEFT',
            revokedEpoch: 2,
            transactionPolicy: 'required',
          });

          // Wait for Change Stream to re-attach via resumeAfter AND catch up ev2, ev3
          await waitForCondition(
            () =>
              nodeA.coordinator.getChangeStreamAttachCount() >= 2 &&
              nodeA.coordinator.getTransportMode() === 'change_stream' &&
              receivedSeqs.includes(ev2.seq) &&
              receivedSeqs.includes(ev3.seq),
            6000,
            'Change Stream reconnect + catch-up'
          );

          // Publish ev4 AFTER reconnect -> proves resumed live Change Stream works!
          const ev4 = await publishLiveKitRevocation({
            meetingId,
            userId: users[2].id,
            kind: 'PARTICIPANT_REMOVED',
            revokedEpoch: 3,
            transactionPolicy: 'required',
          });
          await waitForCondition(
            () => receivedSeqs.includes(ev4.seq),
            5000,
            'post-reconnect Change Stream delivery'
          );

          // Exact deduplicated set [ev1, ev2, ev3, ev4]
          const expected = [ev1.seq, ev2.seq, ev3.seq, ev4.seq];
          assert.deepStrictEqual(
            receivedSeqs.slice().sort((a, b) => a - b),
            expected,
            'Exactly one delivery per sequence across disconnect/resume'
          );
          assert.strictEqual(receivedSeqs.length, 4, 'Zero duplicate deliveries allowed');
          assert.strictEqual(nodeA.coordinator.getLastContiguousSeq(), ev4.seq);
        } finally {
          await nodeA.close();
        }
      }
    );

    // RS-6: Real Coordinator restart with persisted LiveKitRevocationCursor (lastContiguousSeq + resumeToken) on Replica Set
    await runCheck(
      'RS-6: Coordinator restart on Replica Set restores persisted lastContiguousSeq + resumeToken and recovers offline events cleanly',
      async () => {
        const instanceId = `rs_restart_inst_${Date.now()}`;
        const meetingId = new mongoose.Types.ObjectId().toString();

        const coord1 = new LiveKitRevocationCoordinator({
          instanceId,
          pollIntervalMs: 60_000,
          enableChangeStream: true,
          requireTransactions: true,
        });
        const got1: number[] = [];
        coord1.subscribe((ev) => got1.push(ev.seq));
        await coord1.start();
        assert.strictEqual(coord1.getTransportMode(), 'change_stream');

        const evOnline = await publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_LEFT',
          revokedEpoch: 2,
          transactionPolicy: 'required',
        });
        await waitForCondition(
          () => got1.includes(evOnline.seq) && coord1.getLastResumeToken() !== null,
          5000,
          'coord1 online event + resumeToken'
        );
        await coord1.stop();

        // Confirm durable checkpoint in MongoDB has both lastContiguousSeq and resumeToken
        const checkpoint = await LiveKitRevocationCursor.findById(instanceId).lean();
        assert.ok(checkpoint);
        assert.strictEqual(checkpoint.lastContiguousSeq, evOnline.seq);
        assert.ok(checkpoint.resumeToken, 'Persisted checkpoint MUST store Change Stream resumeToken');

        // Publish 2 events while coordinator is completely stopped
        const evOff1 = await publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 3,
          transactionPolicy: 'required',
        });
        const evOff2 = await publishLiveKitRevocation({
          meetingId,
          userId: users[2].id,
          kind: 'PARTICIPANT_LEFT',
          revokedEpoch: 2,
          transactionPolicy: 'required',
        });

        // Start Coordinator 2 with the SAME instanceId -> resumes from persisted resumeToken + seq!
        const coord2 = new LiveKitRevocationCoordinator({
          instanceId,
          pollIntervalMs: 60_000,
          enableChangeStream: true,
          requireTransactions: true,
        });
        const got2: number[] = [];
        coord2.subscribe((ev) => got2.push(ev.seq));
        await coord2.start();
        assert.strictEqual(coord2.getTransportMode(), 'change_stream');

        await waitForCondition(
          () => got2.includes(evOff1.seq) && got2.includes(evOff2.seq),
          6000,
          'coord2 resumeAfter offline recovery'
        );
        assert.deepStrictEqual(got2, [evOff1.seq, evOff2.seq]);
        assert.strictEqual(coord2.getLastContiguousSeq(), evOff2.seq);
        await coord2.stop();
      }
    );

    // RS-7: Real Change Stream crash-safe checkpointing (paused delivery & crash before checkpoint never skip)
    await runCheck(
      'RS-7: Change Stream crash before processing/checkpoint AND paused delivery NEVER advance resumeToken prematurely; restart replays cleanly',
      async () => {
        const instanceId = `rs_ckpt_safety_${Date.now()}`;
        const meetingId = new mongoose.Types.ObjectId().toString();

        // 1) Baseline online event establishes persisted checkpoint (ev0.seq + resumeToken0)
        const coord0 = new LiveKitRevocationCoordinator({
          instanceId,
          pollIntervalMs: 60_000,
          enableChangeStream: true,
          requireTransactions: true,
        });
        const got0: number[] = [];
        coord0.subscribe((ev) => got0.push(ev.seq));
        await coord0.start();

        const ev0 = await publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_LEFT',
          revokedEpoch: 2,
          transactionPolicy: 'required',
        });
        await waitForCondition(
          () => got0.includes(ev0.seq) && coord0.getLastResumeToken() !== null,
          5000,
          'ev0 checkpoint'
        );
        const token0 = coord0.getLastResumeToken();

        // Pause delivery -> publish ev1 -> resumeToken MUST NOT advance while paused!
        coord0.pauseDelivery();
        const ev1 = await publishLiveKitRevocation({
          meetingId,
          userId: users[1].id,
          kind: 'PARTICIPANT_REMOVED',
          revokedEpoch: 3,
          transactionPolicy: 'required',
        });
        await new Promise((r) => setTimeout(r, 150));
        assert.deepStrictEqual(coord0.getLastResumeToken(), token0, 'Paused delivery must NOT advance resumeToken');
        assert.strictEqual(coord0.getLastContiguousSeq(), ev0.seq);
        await coord0.stop();

        // 2) Restarted coordinator crashes AFTER processing ev1, BEFORE persisting checkpoint
        const gotBeforeCrash: number[] = [];
        let crashedFlag = false;
        const coordCrash = new LiveKitRevocationCoordinator({
          instanceId,
          pollIntervalMs: 60_000,
          enableChangeStream: true,
          requireTransactions: true,
          hooks: {
            afterEventProcessBeforeCheckpoint: async (ev) => {
              if (ev.seq === ev1.seq) {
                crashedFlag = true;
                throw new Error('Simulated crash after Change Stream processing before checkpoint');
              }
            },
          },
        });
        coordCrash.subscribe((ev) => gotBeforeCrash.push(ev.seq));
        await coordCrash.start();
        await waitForCondition(() => crashedFlag, 5000, 'crash after processing ev1');
        await coordCrash.stop({ skipCheckpointFlush: true });

        assert.deepStrictEqual(gotBeforeCrash, [ev1.seq]);
        const cpStillAtEv0 = await LiveKitRevocationCursor.findById(instanceId).lean();
        assert.strictEqual(cpStillAtEv0?.lastContiguousSeq, ev0.seq, 'Durable seq MUST stay at ev0 after pre-checkpoint crash');
        assert.deepStrictEqual(cpStillAtEv0?.resumeToken, token0, 'Durable resumeToken MUST stay at token0 after pre-checkpoint crash');

        // 3) Restarted coordinator replays ev1 via resumeAfter with ZERO skips!
        const gotFinal: number[] = [];
        const coordFinal = new LiveKitRevocationCoordinator({
          instanceId,
          pollIntervalMs: 60_000,
          enableChangeStream: true,
          requireTransactions: true,
        });
        coordFinal.subscribe((ev) => gotFinal.push(ev.seq));
        await coordFinal.start();
        await waitForCondition(() => gotFinal.includes(ev1.seq), 5000, 'ev1 replayed via Change Stream resumeAfter');
        assert.deepStrictEqual(gotFinal, [ev1.seq]);
        assert.strictEqual(coordFinal.getLastContiguousSeq(), ev1.seq);
        await coordFinal.stop();
      }
    );

    // RS-8: Real Replica Set atomic admitParticipant rollback + stale co-host rejection inside ACID transaction
    await runCheck(
      'RS-8: Atomic Replica Set admitParticipant rolls back capacity on cancel AND blocks demoted co-host via transactional write-conflict check',
      async () => {
        const cancelBarrier = createBarrier();
        const nodeA = await spawnRsNode(hubA);
        const pausedSvc = new MeetingService(
          hubA,
          { beforeAdmitParticipantWrite: cancelBarrier.pause },
          configuredLiveKit,
          nodeA.gateway,
          publishLiveKitRevocation,
          nodeA.coordinator,
          { requireTransactions: true }
        );
        const nodeB = await spawnRsNode(hubB);
        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Atomic Admit Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true, allowCoHostAdmit: true },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

          // A) Cancel while admission tx is paused before target write -> transaction rolls back activeParticipantCount!
          const admitP = pausedSvc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
          await cancelBarrier.arrived;
          await nodeB.svc.leaveMeeting(meeting.meetingCode, users[1].id);
          cancelBarrier.release();
          await assert.rejects(() => admitP, (err: any) => err.statusCode === 409);

          const mAfterCancel = await Meeting.findById(meeting.id).lean();
          assert.strictEqual(mAfterCancel?.activeParticipantCount, 1, 'Transactional rollback MUST leave zero leaked capacity');

          // B) Stale co-host demoted while paused at beforeAdmitReserve -> transactional actor check rejects 403!
          const demoteBarrier = createBarrier();
          const staleSvc = new MeetingService(
            hubA,
            { beforeAdmitReserve: demoteBarrier.pause },
            configuredLiveKit,
            nodeA.gateway,
            publishLiveKitRevocation,
            nodeA.coordinator,
            { requireTransactions: true }
          );
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
          await nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
          await nodeA.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, { role: 'co-host' });
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[2].id); // WAITING

          const staleP = staleSvc.admitParticipant(meeting.meetingCode, users[1].id, users[2].id);
          await demoteBarrier.arrived;
          await nodeB.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, { role: 'participant' });
          demoteBarrier.release();

          await assert.rejects(() => staleP, (err: any) => err.statusCode === 403 && err.code === 'FORBIDDEN');
          const mAfterDemote = await Meeting.findById(meeting.id).lean();
          assert.strictEqual(mAfterDemote?.activeParticipantCount, 2);
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-9: Real Replica Set transactional outbox suppresses stale admission events on cross-instance endMeeting
    await runCheck(
      'RS-9: Transactional outbox on Replica Set suppresses stale admission-approved/participant-joined when Instance B ends meeting',
      async () => {
        const outboxBarrier = createBarrier();
        const emitted: string[] = [];
        const customHub = new MeetingRealtimeHub();
        customHub.emitAdmissionApproved = async () => {
          emitted.push('admission-approved');
        };
        customHub.emitParticipantJoined = () => {
          emitted.push('participant-joined');
        };

        const nodeA = await spawnRsNode(customHub);
        const pausedAdmitSvc = new MeetingService(
          customHub,
          { beforeAdmitOutboxClaim: outboxBarrier.pause },
          configuredLiveKit,
          nodeA.gateway,
          publishLiveKitRevocation,
          nodeA.coordinator,
          { requireTransactions: true }
        );
        const nodeB = await spawnRsNode(hubB);

        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Outbox Termination Race',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
          emitted.length = 0;

          const admitP = pausedAdmitSvc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
          await outboxBarrier.arrived;

          // Instance B commits atomic endMeeting (suppresses PENDING outbox entries inside tx!)
          await nodeB.svc.endMeeting(meeting.meetingCode, users[0].id);
          outboxBarrier.release();

          await assert.rejects(() => admitP, (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED');
          assert.deepStrictEqual(emitted, [], 'ZERO stale admission/join events may emit after termination');
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-10: Real Replica Set atomic leaveMeeting (deterministic co-host succession + last-host auto-end + waiting cancellation + durable revocation)
    await runCheck(
      'RS-10: Atomic Replica Set leaveMeeting commits host succession, last-host auto-end, waiting cancellation, and durable revocation atomically',
      async () => {
        const nodeA = await spawnRsNode(hubA);
        const nodeB = await spawnRsNode(hubB);
        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Atomic Leave Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: false },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[1].id); // regular participant (earlier)
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[2].id); // promoted co-host (later)
          await nodeA.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[2].id, { role: 'co-host' });

          // Host leaves -> deterministic succession promotes co-host (users[2]) + publishes PARTICIPANT_LEFT atomically
          const res1 = await nodeA.svc.leaveMeeting(meeting.meetingCode, users[0].id);
          assert.strictEqual(res1.meetingEnded, false);
          assert.strictEqual(res1.newHostId, users[2].id);

          const leftEvent = await LiveKitRevocationEvent.findOne({
            meetingId: meeting.id,
            userId: users[0].id,
            kind: 'PARTICIPANT_LEFT',
          }).lean();
          assert.ok(leftEvent, 'PARTICIPANT_LEFT revocation event MUST commit atomically with host leave');

          // Remaining regular participant leaves, then enable waiting room & have users[0] rejoin as WAITING
          await nodeB.svc.leaveMeeting(meeting.meetingCode, users[1].id);
          await nodeA.svc.updateSettings(meeting.meetingCode, users[2].id, { waitingRoomEnabled: true });
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[0].id); // WAITING

          // Now last host (users[2]) leaves -> atomically ENDS meeting, cancels waiting user[0], publishes MEETING_ENDED!
          const res2 = await nodeA.svc.leaveMeeting(meeting.meetingCode, users[2].id);
          assert.strictEqual(res2.meetingEnded, true);
          assert.strictEqual(res2.newHostId, null);

          const [mFinal, waitingFinal, endEvent] = await Promise.all([
            Meeting.findById(meeting.id).lean(),
            MeetingParticipant.findOne({ meetingId: meeting.id, userId: users[0].id }).lean(),
            LiveKitRevocationEvent.findOne({ meetingId: meeting.id, kind: 'MEETING_ENDED' }).lean(),
          ]);
          assert.strictEqual(mFinal?.status, 'ENDED');
          assert.strictEqual(mFinal?.activeParticipantCount, 0);
          assert.strictEqual(waitingFinal?.admissionStatus, 'CANCELLED');
          assert.ok(endEvent, 'MEETING_ENDED durable revocation MUST commit atomically on last host leave');
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-11: Real Replica Set removeParticipant independent cleanup when realtime fails
    await runCheck(
      'RS-11: Replica Set removeParticipant disconnects local socket & evicts SFU independently even when realtime emission fails',
      async () => {
        const failingHub = new MeetingRealtimeHub();
        failingHub.emitParticipantRemoved = async () => {
          throw new Error('Simulated RS realtime emit failure');
        };
        const node = await spawnRsNode(failingHub);
        try {
          const { meeting } = await node.svc.createMeeting(users[0].id, {
            title: 'RS Removal Cleanup Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: false },
          });
          await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await node.svc.joinMeeting(meeting.meetingCode, users[1].id);

          const guestTok = await node.svc.issueLiveKitToken(meeting.meetingCode, users[1].id);
          const guestConn = await attemptWsUpgrade(
            node.port,
            `${LIVEKIT_SIGNAL_GATEWAY_PATH}/rtc/v1?access_token=${encodeURIComponent(guestTok.token)}`
          );
          assert.strictEqual(guestConn.statusCode, 101);

          const res = await node.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'RS cleanup test');
          await guestConn.closedPromise;
          assert.strictEqual(guestConn.socket?.destroyed, true);
          assert.strictEqual(res.cleanup.localSocketsDisconnected, true);
          assert.strictEqual(res.cleanup.realtimeEmitted, false);
          assert.strictEqual(res.cleanup.livekitEvicted, true);
          assert.strictEqual(res.cleanup.failures.length, 1);
        } finally {
          await node.close();
        }
      }
    );

    // RS-12: Real Replica Set atomic admission outbox lease crash recovery + safe terminal-only TTL index verification
    await runCheck(
      'RS-12: Replica Set outbox crash after CLAIMED recovers on Instance B after lease expiry & enforces terminal-only TTL index (no createdAt TTL)',
      async () => {
        await ensureMeetingRealtimeOutboxReady();
        const indexes = await MeetingRealtimeEvent.collection.indexes();
        const unsafeCreatedAtTtl = indexes.find(
          (idx) => idx.key && 'createdAt' in idx.key && typeof idx.expireAfterSeconds === 'number'
        );
        assert.strictEqual(unsafeCreatedAtTtl, undefined, 'No unconditional createdAt TTL index may exist');
        const safeTtl = indexes.find((idx) => idx.name === 'terminalAt_ttl_24h');
        assert.ok(safeTtl, 'terminalAt_ttl_24h partial TTL index MUST exist on Replica Set');
        assert.strictEqual(safeTtl.expireAfterSeconds, MEETING_OUTBOX_TERMINAL_TTL_SECONDS);
        assert.deepStrictEqual(safeTtl.partialFilterExpression, {
          status: { $in: ['DISPATCHED', 'SUPPRESSED'] },
        });

        let nowMs = Date.now();
        const emittedA: string[] = [];
        const emittedB: string[] = [];
        const customHubA = new MeetingRealtimeHub();
        customHubA.emitAdmissionApproved = async (_m, _u, _s, _p, eventId) => {
          emittedA.push(eventId || 'none');
        };
        const customHubB = new MeetingRealtimeHub();
        customHubB.emitAdmissionApproved = async (_m, _u, _s, _p, eventId) => {
          emittedB.push(eventId || 'none');
        };

        const dispA = new MeetingRealtimeOutboxDispatcher({
          instanceId: 'rs-inst-A',
          pollIntervalMs: 0,
          leaseDurationMs: 5_000,
          nowFn: () => new Date(nowMs),
          realtime: customHubA,
        });
        const dispB = new MeetingRealtimeOutboxDispatcher({
          instanceId: 'rs-inst-B',
          pollIntervalMs: 0,
          leaseDurationMs: 5_000,
          nowFn: () => new Date(nowMs),
          realtime: customHubB,
        });

        const nodeA = await spawnRsNode(customHubA);
        const crashAfterClaimSvc = new MeetingService(
          customHubA,
          {
            afterAdmitOutboxClaim: async () => {
              throw createSimulatedOutboxCrash('Simulated RS SIGKILL after PENDING -> CLAIMED');
            },
          },
          configuredLiveKit,
          nodeA.gateway,
          publishLiveKitRevocation,
          nodeA.coordinator,
          { requireTransactions: true, outboxDispatcher: dispA }
        );

        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Outbox Lease Recovery Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[1].id);

          await assert.rejects(
            () => crashAfterClaimSvc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
            /RS SIGKILL after PENDING -> CLAIMED/
          );

          const leasedDoc = await MeetingRealtimeEvent.findOne({
            meetingId: meeting.id,
            type: 'ADMISSION_APPROVED',
          }).lean();
          assert.strictEqual(leasedDoc?.status, 'CLAIMED');
          assert.strictEqual(leasedDoc?.leaseOwner, 'rs-inst-A');
          assert.strictEqual(leasedDoc?.terminalAt, null);
          assert.strictEqual(emittedA.length, 0);

          // Advance clock past leaseDurationMs -> Instance B reclaims and dispatches cleanly!
          nowMs += 6_000;
          const sweep = await dispB.processDueEvents();
          assert.strictEqual(sweep.dispatched, 1);
          assert.strictEqual(emittedB.length, 1);
          assert.strictEqual(emittedB[0], leasedDoc?.eventId);

          const doneDoc = await MeetingRealtimeEvent.findById(leasedDoc!._id).lean();
          assert.strictEqual(doneDoc?.status, 'DISPATCHED');
          assert.strictEqual(doneDoc?.attemptCount, 2);
          assert.ok(doneDoc?.terminalAt instanceof Date);
        } finally {
          await nodeA.close();
        }
      }
    );

    // RS-13: Real Replica Set endMeeting ACID transaction suppresses actively CLAIMED (leased) admission outbox record
    await runCheck(
      'RS-13: Replica Set endMeeting ACID transaction atomically suppresses actively CLAIMED admission lease & prevents stale emission',
      async () => {
        const leaseBarrier = createBarrier();
        const emittedA: string[] = [];
        const customHubA = new MeetingRealtimeHub();
        customHubA.emitAdmissionApproved = async () => {
          emittedA.push('admission-approved');
        };
        customHubA.emitParticipantJoined = () => {
          emittedA.push('participant-joined');
        };

        const dispA = new MeetingRealtimeOutboxDispatcher({
          instanceId: 'rs-leased-A',
          pollIntervalMs: 0,
          leaseDurationMs: 10_000,
          realtime: customHubA,
        });

        const nodeA = await spawnRsNode(customHubA);
        const leasedAdmitSvc = new MeetingService(
          customHubA,
          { afterAdmitOutboxClaim: leaseBarrier.pause },
          configuredLiveKit,
          nodeA.gateway,
          publishLiveKitRevocation,
          nodeA.coordinator,
          { requireTransactions: true, outboxDispatcher: dispA }
        );
        const nodeB = await spawnRsNode(hubB);

        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS End During Active Lease Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
          emittedA.length = 0;

          const admitP = leasedAdmitSvc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
          await leaseBarrier.arrived;

          const leasedDoc = await MeetingRealtimeEvent.findOne({
            meetingId: meeting.id,
            type: 'ADMISSION_APPROVED',
          }).lean();
          assert.strictEqual(leasedDoc?.status, 'CLAIMED');
          assert.strictEqual(leasedDoc?.leaseOwner, 'rs-leased-A');

          // Instance B commits atomic endMeeting transaction -> suppresses CLAIMED lease atomically!
          await nodeB.svc.endMeeting(meeting.meetingCode, users[0].id);

          const suppressedDoc = await MeetingRealtimeEvent.findById(leasedDoc!._id).lean();
          assert.strictEqual(suppressedDoc?.status, 'SUPPRESSED');
          assert.strictEqual(suppressedDoc?.leaseToken, null);
          assert.ok(suppressedDoc?.terminalAt instanceof Date);

          leaseBarrier.release();
          await assert.rejects(
            () => admitP,
            (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
          );
          assert.deepStrictEqual(emittedA, [], 'ZERO stale admission events may fire after RS endMeeting suppresses lease');
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-14: Real Replica Set atomic meeting expiration (ACID rollback + post-commit cleanup isolation + concurrent admission race)
    await runCheck(
      'RS-14: Replica Set atomic meeting expiration rolls back cleanly on tx failure, survives post-commit cleanup failure, and blocks concurrent admission',
      async () => {
        const nodeBase = await spawnRsNode(hubA);
        try {
          const { meeting } = await nodeBase.svc.createMeeting(users[0].id, {
            title: 'RS Atomic Expiration Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true },
          });
          await nodeBase.svc.joinMeeting(meeting.meetingCode, users[0].id);
          await nodeBase.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

          // Insert a PENDING outbox event to verify rollback vs suppression
          const pendingEv = await MeetingRealtimeEvent.create({
            meetingId: meeting.id,
            meetingVersion: 1,
            targetUserId: users[1].id,
            type: 'ADMISSION_APPROVED',
            status: 'PENDING',
            terminalAt: null,
          });

          const hostBefore = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[0].id,
          }).lean();
          const counterBefore = await LiveKitRevocationCounter.findById(
            'livekit_revocation_global_seq'
          ).lean();

          // Force meeting past expiresAt
          await Meeting.updateOne(
            { _id: meeting.id },
            { $set: { expiresAt: new Date(Date.now() - 5_000) } }
          );

          // A) Rollback test: fail inside expiration transaction right before revocation publish -> FULL ACID ROLLBACK!
          const failingExpSvc = new MeetingService(
            hubA,
            {
              beforeExpirationRevocationPublish: async () => {
                throw new Error('Injected failure inside atomic expiration transaction');
              },
            },
            configuredLiveKit,
            nodeBase.gateway,
            publishLiveKitRevocation,
            nodeBase.coordinator,
            { requireTransactions: true }
          );

          await assert.rejects(
            () => failingExpSvc.getMeetingState(meeting.meetingCode, users[0].id),
            (err: any) =>
              err.statusCode === 503 && err.code === 'MEETING_EXPIRATION_TRANSACTION_FAILED'
          );

          const mAfterRollback = await Meeting.findById(meeting.id).lean();
          const hostAfterRollback = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[0].id,
          }).lean();
          const waitAfterRollback = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[1].id,
          }).lean();
          const outboxAfterRollback = await MeetingRealtimeEvent.findById(pendingEv._id).lean();
          const counterAfterRollback = await LiveKitRevocationCounter.findById(
            'livekit_revocation_global_seq'
          ).lean();

          assert.strictEqual(mAfterRollback?.status, 'ACTIVE', 'Expiration tx rollback MUST preserve ACTIVE status');
          assert.strictEqual(hostAfterRollback?.admissionStatus, 'ADMITTED');
          assert.strictEqual(hostAfterRollback?.tokenEpoch, hostBefore?.tokenEpoch);
          assert.strictEqual(waitAfterRollback?.admissionStatus, 'WAITING');
          assert.strictEqual(outboxAfterRollback?.status, 'PENDING');
          assert.strictEqual(counterAfterRollback?.seq, counterBefore?.seq);

          // B) Success + post-commit cleanup failures (LiveKit deleteRoom & realtime emitMeetingEnded both fail) MUST NOT undo committed EXPIRED state!
          const failingCleanupHub = new MeetingRealtimeHub();
          failingCleanupHub.emitMeetingEnded = async () => {
            throw new Error('Simulated realtime failure during expiration cleanup');
          };
          const failingCleanupLk = new LiveKitService({
            url: 'ws://127.0.0.1:7880',
            apiKey: 'test_rs_exp_cleanup_key_123456',
            apiSecret: 'test_rs_exp_cleanup_secret_abcdefghijklmnopqrstuvwxyz',
            tokenTtlSeconds: 600,
          });
          failingCleanupLk.deleteRoom = async () => {
            throw new Error('Simulated LiveKit deleteRoom failure during expiration cleanup');
          };

          const cleanupFailExpSvc = new MeetingService(
            failingCleanupHub,
            {},
            failingCleanupLk,
            nodeBase.gateway,
            publishLiveKitRevocation,
            nodeBase.coordinator,
            { requireTransactions: true }
          );

          // Trigger atomic expiration via admitParticipant (concurrent expiration vs admission!) -> MUST reject 410 MEETING_EXPIRED while committing EXPIRED state!
          await assert.rejects(
            () => cleanupFailExpSvc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
            (err: any) => err.statusCode === 410 && err.code === 'MEETING_EXPIRED'
          );

          const mAfterCommit = await Meeting.findById(meeting.id).lean();
          const hostAfterCommit = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[0].id,
          }).lean();
          const waitAfterCommit = await MeetingParticipant.findOne({
            meetingId: meeting.id,
            userId: users[1].id,
          }).lean();
          const outboxAfterCommit = await MeetingRealtimeEvent.findById(pendingEv._id).lean();
          const endRevocation = await LiveKitRevocationEvent.findOne({
            meetingId: meeting.id,
            kind: 'MEETING_ENDED',
          }).lean();

          assert.strictEqual(mAfterCommit?.status, 'EXPIRED');
          assert.strictEqual(mAfterCommit?.activeParticipantCount, 0);
          assert.strictEqual(hostAfterCommit?.admissionStatus, 'LEFT');
          assert.strictEqual(hostAfterCommit?.tokenEpoch, (hostBefore?.tokenEpoch ?? 1) + 1);
          assert.strictEqual(waitAfterCommit?.admissionStatus, 'CANCELLED');
          assert.strictEqual(outboxAfterCommit?.status, 'SUPPRESSED');
          assert.ok(outboxAfterCommit?.terminalAt instanceof Date);
          assert.ok(endRevocation, 'Durable MEETING_ENDED revocation event MUST commit atomically');

          // Subsequent removeParticipant on expired meeting MUST reject 410 MEETING_EXPIRED cleanly
          await assert.rejects(
            () => nodeBase.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Too late'),
            (err: any) => err.statusCode === 410 && err.code === 'MEETING_EXPIRED'
          );
        } finally {
          await nodeBase.close();
        }
      }
    );

    // RS-15: Real Replica Set atomic joinMeeting() durable PARTICIPANT_JOINED outbox + crash recovery + zero duplicate logical joins
    await runCheck(
      'RS-15: Replica Set atomic joinMeeting commits durable PARTICIPANT_JOINED outbox, recovers after crash, and prevents duplicate logical joins',
      async () => {
        let nowMs = Date.now();
        const sharedNow = () => new Date(nowMs);
        const emittedA: string[] = [];
        const emittedB: string[] = [];

        const hubJoinA = new MeetingRealtimeHub();
        hubJoinA.emitParticipantJoined = (_m, _p, _c, eventId) => {
          emittedA.push(eventId || 'none');
        };
        const hubJoinB = new MeetingRealtimeHub();
        hubJoinB.emitParticipantJoined = (_m, _p, _c, eventId) => {
          emittedB.push(eventId || 'none');
        };

        const dispA = new MeetingRealtimeOutboxDispatcher({
          instanceId: 'rs-join-A',
          pollIntervalMs: 0,
          leaseDurationMs: 5_000,
          nowFn: sharedNow,
          realtime: hubJoinA,
        });
        const dispB = new MeetingRealtimeOutboxDispatcher({
          instanceId: 'rs-join-B',
          pollIntervalMs: 0,
          leaseDurationMs: 5_000,
          nowFn: sharedNow,
          realtime: hubJoinB,
        });

        const nodeA = await spawnRsNode(hubJoinA);
        const crashJoinSvc = new MeetingService(
          hubJoinA,
          {
            afterJoinOutboxClaim: async () => {
              throw createSimulatedOutboxCrash('Simulated RS crash after joinMeeting outbox claim');
            },
          },
          configuredLiveKit,
          nodeA.gateway,
          publishLiveKitRevocation,
          nodeA.coordinator,
          { requireTransactions: true, outboxDispatcher: dispA }
        );
        const nodeB = await spawnRsNode(hubJoinB);

        try {
          const { meeting } = await nodeB.svc.createMeeting(users[0].id, {
            title: 'RS Durable Join Outbox Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: false },
          });
          await nodeB.svc.joinMeeting(meeting.meetingCode, users[0].id);
          emittedA.length = 0;
          emittedB.length = 0;

          await assert.rejects(
            () => crashJoinSvc.joinMeeting(meeting.meetingCode, users[1].id),
            /RS crash after joinMeeting outbox claim/
          );
          assert.strictEqual(emittedA.length, 0);

          const joinDocs = await MeetingRealtimeEvent.find({
            meetingId: meeting.id,
            targetUserId: users[1].id,
            type: 'PARTICIPANT_JOINED',
          }).lean();
          assert.strictEqual(joinDocs.length, 1);
          assert.strictEqual(joinDocs[0].status, 'CLAIMED');
          assert.strictEqual(joinDocs[0].terminalAt, null);

          // Advance clock past lease expiry -> Instance B recovers and emits PARTICIPANT_JOINED!
          nowMs += 6_000;
          const sweep = await dispB.processDueEvents();
          assert.strictEqual(sweep.dispatched, 1);
          assert.strictEqual(emittedB.length, 1);
          assert.strictEqual(emittedB[0], joinDocs[0].eventId);

          // Idempotent second joinMeeting() on Replica Set MUST return ALREADY_ADMITTED with ZERO new outbox events!
          const dupJoin = await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
          assert.strictEqual(dupJoin.joinResult, 'ALREADY_ADMITTED');

          const joinDocsAfter = await MeetingRealtimeEvent.find({
            meetingId: meeting.id,
            targetUserId: users[1].id,
            type: 'PARTICIPANT_JOINED',
          }).lean();
          assert.strictEqual(joinDocsAfter.length, 1);
          assert.strictEqual(joinDocsAfter[0].status, 'DISPATCHED');
        } finally {
          await nodeA.close();
          await nodeB.close();
        }
      }
    );

    // RS-16: Real TWO-instance Socket.IO (@socket.io/mongo-adapter) on REAL MongoDB 8.3 Replica Set Change Streams
    await runCheck(
      'RS-16: Real TWO-instance Socket.IO (@socket.io/mongo-adapter) on Replica Set delivers cross-instance waiting room, admission, fetchSockets(), eviction & meeting end',
      async () => {
        const sioHubA = new MeetingRealtimeHub();
        const sioHubB = new MeetingRealtimeHub();
        const srvA = http.createServer((_req, res) => {
          res.statusCode = 200;
          res.end('ok');
        });
        const srvB = http.createServer((_req, res) => {
          res.statusCode = 200;
          res.end('ok');
        });
        sioHubA.attach(srvA);
        sioHubB.attach(srvB);
        await sioHubA.attachSharedAdapter({
          nodeEnv: 'production',
          adapterSetting: 'mongo',
          multiInstanceSetting: 'true',
          mongoCollection: 'rs_socketio_adapter_events',
        });
        await sioHubB.attachSharedAdapter({
          nodeEnv: 'production',
          adapterSetting: 'mongo',
          multiInstanceSetting: 'true',
          mongoCollection: 'rs_socketio_adapter_events',
        });
        await Promise.all([
          new Promise<void>((r) => srvA.listen(0, '127.0.0.1', () => r())),
          new Promise<void>((r) => srvB.listen(0, '127.0.0.1', () => r())),
        ]);
        const portA = (srvA.address() as any).port as number;
        const portB = (srvB.address() as any).port as number;

        const nodeA = await spawnRsNode(sioHubA);
        const nodeB = await spawnRsNode(sioHubB);

        const connectClient = (port: number, userIdx: number): Promise<ClientSocket> =>
          new Promise((resolve, reject) => {
            const token = generateAccessToken({
              sub: users[userIdx].id,
              email: users[userIdx].email,
              firstName: `RsUser${userIdx}`,
              lastName: 'Test',
            });
            const sock = createSocketClient(`http://127.0.0.1:${port}`, {
              auth: { token },
              transports: ['websocket'],
              reconnection: false,
              timeout: 5_000,
            });
            sock.once('connect', () => resolve(sock));
            sock.once('connect_error', reject);
          });

        const subClient = (sock: ClientSocket, code: string) =>
          new Promise<{ ok: boolean; status?: string }>((resolve) => {
            sock.emit('meeting:subscribe', { meetingCode: code }, resolve);
          });

        let hostSockA: ClientSocket | null = null;
        let guestSockB: ClientSocket | null = null;
        try {
          const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
            title: 'RS Two-Instance Real Mongo Adapter Room',
            maxParticipants: 10,
            settings: { waitingRoomEnabled: true },
          });
          await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);

          hostSockA = await connectClient(portA, 0);
          assert.strictEqual((await subClient(hostSockA, meeting.meetingCode)).ok, true);

          const hostWaiting: any[] = [];
          const guestApproved: any[] = [];
          const guestRemoved: any[] = [];
          const guestSettingsAfterEvict: any[] = [];
          hostSockA.on('meeting:waiting-room-updated', (p) => hostWaiting.push(p));

          // Allow @socket.io/mongo-adapter Change Streams to settle
          await new Promise((r) => setTimeout(r, 250));

          await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING via Instance B
          guestSockB = await connectClient(portB, 1);
          guestSockB.on('meeting:admission-approved', (p) => guestApproved.push(p));
          guestSockB.on('meeting:participant-removed', (p) => guestRemoved.push(p));
          guestSockB.on('meeting:settings-updated', (p) => guestSettingsAfterEvict.push(p));
          assert.strictEqual((await subClient(guestSockB, meeting.meetingCode)).ok, true);

          await waitForCondition(() => hostWaiting.some((w) => w.count === 1), 5_000, 'RS Mongo adapter waiting update');

          // Host admits Guest on Instance A -> Guest on Instance B receives admission-approved with eventId!
          await nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
          await waitForCondition(() => guestApproved.length === 1, 5_000, 'RS Mongo adapter admission-approved');
          assert.ok(guestApproved[0].eventId);

          // Cross-instance fetchSockets() sees BOTH Host (Instance A) and Guest (Instance B)
          await waitForCondition(
            async () => (await sioHubA.getIo()!.in(sioHubA.admittedChannel(meeting.id)).fetchSockets()).length === 2,
            5_000,
            'RS Mongo adapter cross-instance fetchSockets() === 2'
          );

          // Host removes Guest on Instance A -> Guest on Instance B receives participant-removed & is evicted!
          await nodeA.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'RS Mongo eviction');
          await waitForCondition(() => guestRemoved.length === 1, 5_000, 'RS Mongo adapter participant-removed');

          sioHubA.emitSettingsUpdated(meeting.id, 'After RS Eviction', { waitingRoomEnabled: true });
          await new Promise((r) => setTimeout(r, 200));
          assert.strictEqual(guestSettingsAfterEvict.length, 0);

          // Host ends meeting on Instance A -> Instance B marks ended via serverSideEmit!
          await nodeA.svc.endMeeting(meeting.meetingCode, users[0].id);
          await waitForCondition(() => sioHubB.isMeetingMarkedEnded(meeting.id), 5_000, 'RS Mongo adapter sync-ended');
        } finally {
          hostSockA?.disconnect();
          guestSockB?.disconnect();
          await nodeA.close();
          await nodeB.close();
          await sioHubA.closeAsync();
          await sioHubB.closeAsync();
          srvA.closeAllConnections?.();
          srvB.closeAllConnections?.();
          await Promise.all([
            new Promise<void>((r) => srvA.close(() => r())),
            new Promise<void>((r) => srvB.close(() => r())),
          ]);
        }
      }
    );

    console.log(`\n[ReplicaSetAudit] ALL ${passed}/${TOTAL_RS_CHECKS} REAL MONGODB 8.3 REPLICA SET TESTS PASSED!`);
  } finally {
    await upstream.close();
    await rs.stop();
    resetRevocationTopologyCache();
  }
}

run().catch((err) => {
  console.error('[ReplicaSetAudit] FAILED:', err);
  process.exit(1);
});
