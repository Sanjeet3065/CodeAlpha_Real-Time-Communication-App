import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import mongoose from 'mongoose';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import {
  MeetingRealtimeEvent,
  REQUIRED_MEETING_OUTBOX_INDEX_NAMES,
  ensureMeetingRealtimeOutboxReady,
} from '../models/MeetingRealtimeEvent.model.js';
import {
  LiveKitRevocationEvent,
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  resetRevocationTopologyCache,
} from '../models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeHub, type MeetingRealtimeHubHooks } from '../realtime/meetingSocket.js';
import {
  resolveSocketIoAdapterConfig,
  attachSharedSocketIoAdapter,
} from '../realtime/socketAdapter.js';
import {
  MeetingRealtimeOutboxDispatcher,
  createSimulatedOutboxCrash,
} from '../realtime/meetingOutboxDispatcher.js';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
} from '../realtime/livekitRevocationCoordinator.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitService } from '../services/livekit.service.js';
import { MeetingService, type MeetingServiceHooks } from '../services/meeting.service.js';
import { generateAccessToken } from '../utils/tokens.js';
import { env } from '../config/env.js';

function createBarrier() {
  let arrivedResolve!: () => void;
  let releaseResolve!: () => void;
  const arrived = new Promise<void>((r) => {
    arrivedResolve = r;
  });
  const releaseGate = new Promise<void>((r) => {
    releaseResolve = r;
  });
  return {
    arrived,
    pause: async () => {
      arrivedResolve();
      await releaseGate;
    },
    release: () => {
      releaseResolve();
    },
  };
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  label = 'condition'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function connectRealClient(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket.IO client connect timeout'));
    }, 5_000);
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

function subscribeClient(
  socket: ClientSocket,
  meetingCode: string
): Promise<{ ok: boolean; code?: string; message?: string; status?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('meeting:subscribe ack timeout')), 5_000);
    socket.emit(
      'meeting:subscribe',
      { meetingCode },
      (ack: { ok: boolean; code?: string; message?: string; status?: string }) => {
        clearTimeout(timer);
        resolve(ack);
      }
    );
  });
}

function respBulk(buf: Buffer | string): Buffer {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return Buffer.concat([Buffer.from(`$${b.length}\r\n`, 'utf8'), b, Buffer.from('\r\n', 'utf8')]);
}

function respArray(items: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(`*${items.length}\r\n`, 'utf8'), ...items]);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Minimal binary-safe RESP2 Redis Pub/Sub TCP broker strictly for deterministic local tests
 * exercising the REAL unmodified `ioredis` client and REAL `@socket.io/redis-adapter`
 * (including `PUBLISH`, `SUBSCRIBE`, `PSUBSCRIBE`, `PUBSUB NUMSUB`, `PING`, `INFO`, `CLIENT`).
 */
async function startRespPubSubBroker(): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const channelSubs = new Map<string, Set<net.Socket>>();
  const patternSubs = new Map<string, Set<net.Socket>>();
  const sockets = new Set<net.Socket>();

  const countSubsForSocket = (sock: net.Socket): number => {
    let n = 0;
    for (const set of channelSubs.values()) if (set.has(sock)) n += 1;
    for (const set of patternSubs.values()) if (set.has(sock)) n += 1;
    return n;
  };

  const cleanupSocket = (sock: net.Socket) => {
    sockets.delete(sock);
    for (const [k, set] of channelSubs.entries()) {
      set.delete(sock);
      if (set.size === 0) channelSubs.delete(k);
    }
    for (const [k, set] of patternSubs.entries()) {
      set.delete(sock);
      if (set.size === 0) patternSubs.delete(k);
    }
  };

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf: Buffer = Buffer.alloc(0);

    sock.on('close', () => cleanupSocket(sock));
    sock.on('error', () => cleanupSocket(sock));

    const parseCommands = (): Buffer[][] => {
      const cmds: Buffer[][] = [];
      let offset = 0;
      while (offset < buf.length) {
        if (buf[offset] !== 0x2a /* '*' */) {
          const lineEnd = buf.indexOf('\r\n', offset);
          if (lineEnd === -1) break;
          const parts = buf.subarray(offset, lineEnd).toString('utf8').trim().split(/\s+/);
          if (parts[0]) cmds.push(parts.map((p) => Buffer.from(p, 'utf8')));
          offset = lineEnd + 2;
          continue;
        }
        const headerEnd = buf.indexOf('\r\n', offset);
        if (headerEnd === -1) break;
        const count = Number.parseInt(buf.subarray(offset + 1, headerEnd).toString('utf8'), 10);
        if (Number.isNaN(count) || count < 0) break;

        let cursor = headerEnd + 2;
        const args: Buffer[] = [];
        let complete = true;
        for (let i = 0; i < count; i += 1) {
          if (cursor >= buf.length || buf[cursor] !== 0x24 /* '$' */) {
            complete = false;
            break;
          }
          const lenEnd = buf.indexOf('\r\n', cursor);
          if (lenEnd === -1) {
            complete = false;
            break;
          }
          const byteLen = Number.parseInt(buf.subarray(cursor + 1, lenEnd).toString('utf8'), 10);
          const dataStart = lenEnd + 2;
          const dataEnd = dataStart + byteLen;
          if (dataEnd + 2 > buf.length) {
            complete = false;
            break;
          }
          args.push(Buffer.from(buf.subarray(dataStart, dataEnd)));
          cursor = dataEnd + 2;
        }
        if (!complete) break;
        cmds.push(args);
        offset = cursor;
      }
      buf = buf.subarray(offset);
      return cmds;
    };

    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (const args of parseCommands()) {
        const cmd = args[0]?.toString('utf8').toUpperCase();
        if (cmd === 'HELLO') {
          // Reject RESP3 negotiation so ioredis v6 cleanly uses standard RESP2 pub/sub framing
          sock.write("-ERR unknown command 'HELLO'\r\n");
        } else if (cmd === 'PING') {
          if (args[1]) sock.write(respBulk(args[1]));
          else sock.write('+PONG\r\n');
        } else if (cmd === 'INFO') {
          sock.write(respBulk('# Server\r\nredis_version:7.2.0\r\n'));
        } else if (cmd === 'CLIENT' || cmd === 'SELECT' || cmd === 'AUTH') {
          sock.write('+OK\r\n');
        } else if (cmd === 'QUIT') {
          sock.write('+OK\r\n');
          sock.end();
        } else if (cmd === 'SUBSCRIBE') {
          for (const chBuf of args.slice(1)) {
            const ch = chBuf.toString('utf8');
            const set = channelSubs.get(ch) ?? new Set<net.Socket>();
            set.add(sock);
            channelSubs.set(ch, set);
            sock.write(
              respArray([
                respBulk('subscribe'),
                respBulk(chBuf),
                Buffer.from(`:${countSubsForSocket(sock)}\r\n`, 'utf8'),
              ])
            );
          }
        } else if (cmd === 'UNSUBSCRIBE') {
          const targets = args.slice(1).map((b) => b.toString('utf8'));
          for (const ch of targets) {
            channelSubs.get(ch)?.delete(sock);
            sock.write(
              respArray([
                respBulk('unsubscribe'),
                respBulk(ch),
                Buffer.from(`:${countSubsForSocket(sock)}\r\n`, 'utf8'),
              ])
            );
          }
        } else if (cmd === 'PSUBSCRIBE') {
          for (const patBuf of args.slice(1)) {
            const pat = patBuf.toString('utf8');
            const set = patternSubs.get(pat) ?? new Set<net.Socket>();
            set.add(sock);
            patternSubs.set(pat, set);
            sock.write(
              respArray([
                respBulk('psubscribe'),
                respBulk(patBuf),
                Buffer.from(`:${countSubsForSocket(sock)}\r\n`, 'utf8'),
              ])
            );
          }
        } else if (cmd === 'PUNSUBSCRIBE') {
          const targets = args.slice(1).map((b) => b.toString('utf8'));
          for (const pat of targets) {
            patternSubs.get(pat)?.delete(sock);
            sock.write(
              respArray([
                respBulk('punsubscribe'),
                respBulk(pat),
                Buffer.from(`:${countSubsForSocket(sock)}\r\n`, 'utf8'),
              ])
            );
          }
        } else if (cmd === 'PUBLISH') {
          const chBuf = args[1] ?? Buffer.alloc(0);
          const ch = chBuf.toString('utf8');
          const payload = args[2] ?? Buffer.alloc(0);
          let delivered = 0;

          const exact = channelSubs.get(ch);
          if (exact) {
            const frame = respArray([respBulk('message'), respBulk(chBuf), respBulk(payload)]);
            for (const subSock of exact) {
              if (!subSock.destroyed) {
                subSock.write(frame);
                delivered += 1;
              }
            }
          }
          for (const [pat, set] of patternSubs.entries()) {
            if (globToRegex(pat).test(ch)) {
              const frame = respArray([
                respBulk('pmessage'),
                respBulk(pat),
                respBulk(chBuf),
                respBulk(payload),
              ]);
              for (const subSock of set) {
                if (!subSock.destroyed) {
                  subSock.write(frame);
                  delivered += 1;
                }
              }
            }
          }
          sock.write(`:${delivered}\r\n`);
        } else if (cmd === 'PUBSUB') {
          const subCmd = args[1]?.toString('utf8').toUpperCase();
          if (subCmd === 'NUMSUB') {
            const items: Buffer[] = [];
            for (const chBuf of args.slice(2)) {
              const ch = chBuf.toString('utf8');
              const cnt = channelSubs.get(ch)?.size ?? 0;
              items.push(respBulk(chBuf), Buffer.from(`:${cnt}\r\n`, 'utf8'));
            }
            sock.write(respArray(items));
          } else {
            sock.write('*0\r\n');
          }
        } else {
          sock.write('+OK\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to start RESP pub/sub broker');

  return {
    port: addr.port,
    url: `redis://127.0.0.1:${addr.port}`,
    close: async () => {
      for (const s of sockets) s.destroy();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('Phase 09 Final Source Audit — Real Socket.IO Cross-Instance, Subscribe Races, Durable Joins & Outbox Init', () => {
  const TEST_DB_URI = env.MONGODB_URI.replace(
    /\/[^/?]+(\?|$)/,
    '/connectly_test_sio_cross$1'
  );

  let users: Array<{ id: string; email: string; token: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  let configuredLiveKit: LiveKitService;
  let respBroker: { port: number; url: string; close: () => Promise<void> };

  before(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    resetRevocationTopologyCache();
    await mongoose.connect(TEST_DB_URI);
    await ensureMeetingRealtimeOutboxReady();
    respBroker = await startRespPubSubBroker();

    configuredLiveKit = new LiveKitService({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'test_sio_cross_api_key_123456',
      apiSecret: 'test_sio_cross_api_secret_abcdefghijklmnopqrstuvwxyz',
      tokenTtlSeconds: 600,
    });
    configuredLiveKit.ensureRoomExists = async () => {};
    configuredLiveKit.removeParticipant = async () => true;
    configuredLiveKit.deleteRoom = async () => {};

    const ts = Date.now();
    users = [];
    for (let i = 0; i < 4; i += 1) {
      const email = `sio_cross_${ts}_${i}@connectly.dev`;
      const doc = await User.create({
        firstName: `Real${i}`,
        lastName: 'Client',
        email,
        passwordHash: 'argon2id-test-hash-placeholder',
        isActive: true,
      });
      const token = generateAccessToken({
        sub: doc._id.toString(),
        email,
        firstName: doc.firstName,
        lastName: doc.lastName,
      });
      users.push({ id: doc._id.toString(), email, token });
    }
  });

  afterEach(async () => {
    if (createdMeetingIds.length > 0) {
      await MeetingRealtimeEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await LiveKitRevocationEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
      createdMeetingIds.length = 0;
    }
  });

  after(async () => {
    await respBroker.close();
    await User.deleteMany({ email: { $in: users.map((u) => u.email) } });
    await LiveKitRevocationCursor.deleteMany({});
    await LiveKitRevocationCounter.deleteMany({});
    await mongoose.disconnect();
  });

  async function spawnRealSocketInstance(opts: {
    adapterMode?: 'memory' | 'redis';
    hubHooks?: MeetingRealtimeHubHooks;
    serviceHooks?: MeetingServiceHooks;
    nowFn?: () => Date;
    leaseDurationMs?: number;
    instanceId?: string;
  } = {}) {
    const hub = new MeetingRealtimeHub(opts.hubHooks);
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    hub.attach(server);
    if (opts.adapterMode === 'redis') {
      await hub.attachSharedAdapter({
        nodeEnv: 'test',
        adapterSetting: 'redis',
        multiInstanceSetting: 'true',
        redisUrl: respBroker.url,
        redisPrefix: 'connectly:test:socketio',
      });
    }
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind test HTTP server');

    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      maxStaleDeliveryMs: 60_000,
    });
    await coordinator.start();
    const gateway = new LiveKitSignalGateway(configuredLiveKit, {}, coordinator, {
      activeSocketRevalidationIntervalMs: 0,
    });
    const dispatcher = new MeetingRealtimeOutboxDispatcher({
      instanceId: opts.instanceId ?? `real_sio_${addr.port}`,
      pollIntervalMs: 0,
      leaseDurationMs: opts.leaseDurationMs ?? 5_000,
      nowFn: opts.nowFn,
      realtime: hub,
    });
    const svc = new MeetingService(
      hub,
      opts.serviceHooks ?? {},
      configuredLiveKit,
      gateway,
      publishLiveKitRevocation,
      coordinator,
      { requireTransactions: false, outboxDispatcher: dispatcher }
    );

    return {
      port: addr.port,
      hub,
      dispatcher,
      svc,
      close: async () => {
        await dispatcher.stop();
        gateway.close();
        await coordinator.stop();
        await hub.closeAsync();
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it('1. Multi-instance Socket.IO adapter fails closed in production/multi-instance mode and when Redis is unreachable', async () => {
    // Production with auto and no REDIS_URL -> MUST fail closed
    assert.throws(
      () =>
        resolveSocketIoAdapterConfig({
          nodeEnv: 'production',
          adapterSetting: 'auto',
          multiInstanceSetting: 'auto',
          redisUrl: '',
        }),
      /Multi-instance\/production Socket\.IO requires a shared adapter/
    );

    // Explicit multi-instance with memory -> MUST fail closed
    assert.throws(
      () =>
        resolveSocketIoAdapterConfig({
          nodeEnv: 'development',
          adapterSetting: 'memory',
          multiInstanceSetting: 'true',
          redisUrl: '',
        }),
      /In-memory Socket\.IO adapter is prohibited/
    );

    // Explicit redis without REDIS_URL -> MUST fail closed
    assert.throws(
      () =>
        resolveSocketIoAdapterConfig({
          nodeEnv: 'development',
          adapterSetting: 'redis',
          multiInstanceSetting: 'false',
          redisUrl: '',
        }),
      /requires REDIS_URL/
    );

    // Valid redis config resolves cleanly
    const redisResolved = resolveSocketIoAdapterConfig({
      nodeEnv: 'production',
      adapterSetting: 'auto',
      multiInstanceSetting: 'auto',
      redisUrl: 'rediss://redis.internal.connectly.app:6379',
    });
    assert.strictEqual(redisResolved.mode, 'redis');
    assert.strictEqual(redisResolved.multiInstanceRequired, true);

    // Unreachable Redis server MUST fail closed on attachSharedSocketIoAdapter (NEVER silent memory fallback)
    const tempServer = http.createServer();
    const tempHub = new MeetingRealtimeHub();
    const io = tempHub.attach(tempServer);
    try {
      await assert.rejects(
        () =>
          attachSharedSocketIoAdapter(io, {
            nodeEnv: 'production',
            adapterSetting: 'redis',
            multiInstanceSetting: 'true',
            redisUrl: 'redis://127.0.0.1:1',
          }),
        /Failed to initialize Redis Socket\.IO adapter \(fail-closed\)/
      );

      // SOCKET_IO_ADAPTER=mongo on standalone MongoDB MUST fail closed (Change Streams require Replica Set)
      await assert.rejects(
        () =>
          attachSharedSocketIoAdapter(io, {
            nodeEnv: 'production',
            adapterSetting: 'mongo',
            multiInstanceSetting: 'true',
          }),
        /requires a MongoDB Replica Set/
      );
    } finally {
      await tempHub.closeAsync();
      tempServer.close();
    }
  });

  it('2. Real Socket.IO meeting:subscribe authorization races (removal, termination, rejection, co-host demotion, and stale presence overwrite)', async () => {
    // 2a: Concurrent REMOVAL while subscribing -> post-join revalidation undoes channels & blocks broadcasts
    {
      const barrier = createBarrier();
      const node = await spawnRealSocketInstance({
        hubHooks: {
          afterSubscribeJoinBeforeRevalidate: async ({ userId }) => {
            if (userId === users[1].id) await barrier.pause();
          },
        },
      });
      let guestSocket: ClientSocket | null = null;
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: 'Subscribe Race Remove',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id);

        guestSocket = await connectRealClient(node.port, users[1].token);
        const receivedAfterRemove: string[] = [];
        guestSocket.on('meeting:settings-updated', () => receivedAfterRemove.push('settings'));

        const subPromise = subscribeClient(guestSocket, meeting.meetingCode);
        await barrier.arrived;

        // Host removes Guest BEFORE post-join revalidation runs
        await node.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Race remove');
        barrier.release();

        const ack = await subPromise;
        assert.strictEqual(ack.ok, false);
        assert.strictEqual(ack.code, 'FORBIDDEN');

        // Verify Guest was removed from admitted channel: broadcast MUST NOT arrive
        node.hub.emitSettingsUpdated(meeting.id, 'After Remove', { waitingRoomEnabled: false });
        await new Promise((r) => setTimeout(r, 120));
        assert.deepStrictEqual(receivedAfterRemove, []);
      } finally {
        guestSocket?.disconnect();
        await node.close();
      }
    }

    // 2b: Concurrent MEETING TERMINATION while subscribing -> post-join revalidation undoes channels
    {
      const barrier = createBarrier();
      const node = await spawnRealSocketInstance({
        hubHooks: {
          afterSubscribeJoinBeforeRevalidate: async ({ userId }) => {
            if (userId === users[1].id) await barrier.pause();
          },
        },
      });
      let guestSocket: ClientSocket | null = null;
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: 'Subscribe Race End',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id);

        guestSocket = await connectRealClient(node.port, users[1].token);
        const subPromise = subscribeClient(guestSocket, meeting.meetingCode);
        await barrier.arrived;

        await node.svc.endMeeting(meeting.meetingCode, users[0].id);
        barrier.release();

        const ack = await subPromise;
        assert.strictEqual(ack.ok, false);
        assert.strictEqual(ack.code, 'MEETING_ENDED');
      } finally {
        guestSocket?.disconnect();
        await node.close();
      }
    }

    // 2c: Concurrent WAITING REJECTION while subscribing -> post-join revalidation undoes waitingChannel
    {
      const barrier = createBarrier();
      const node = await spawnRealSocketInstance({
        hubHooks: {
          afterSubscribeJoinBeforeRevalidate: async ({ userId }) => {
            if (userId === users[1].id) await barrier.pause();
          },
        },
      });
      let waitSocket: ClientSocket | null = null;
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: 'Subscribe Race Reject',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: true },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

        waitSocket = await connectRealClient(node.port, users[1].token);
        const subPromise = subscribeClient(waitSocket, meeting.meetingCode);
        await barrier.arrived;

        await node.svc.rejectParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Rejected during sub');
        barrier.release();

        const ack = await subPromise;
        assert.strictEqual(ack.ok, false);
        assert.strictEqual(ack.code, 'FORBIDDEN');
      } finally {
        waitSocket?.disconnect();
        await node.close();
      }
    }

    // 2d: Concurrent CO-HOST DEMOTION while subscribing -> post-join revalidation leaves hostsChannel
    {
      const barrier = createBarrier();
      const node = await spawnRealSocketInstance({
        hubHooks: {
          afterSubscribeJoinBeforeRevalidate: async ({ userId }) => {
            if (userId === users[1].id) await barrier.pause();
          },
        },
      });
      let cohostSocket: ClientSocket | null = null;
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: 'Subscribe Race Demote',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id);
        await node.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, {
          role: 'co-host',
        });

        cohostSocket = await connectRealClient(node.port, users[1].token);
        const waitingRoomLeaks: unknown[] = [];
        cohostSocket.on('meeting:waiting-room-updated', (p) => waitingRoomLeaks.push(p));

        const subPromise = subscribeClient(cohostSocket, meeting.meetingCode);
        await barrier.arrived;

        // Demote co-host back to participant before post-join revalidation
        await node.svc.updateParticipantRole(meeting.meetingCode, users[0].id, users[1].id, {
          role: 'participant',
        });
        barrier.release();

        const ack = await subPromise;
        assert.strictEqual(ack.ok, true);

        // Waiting-room PII broadcast MUST NOT reach demoted user!
        node.hub.emitWaitingRoomUpdated(meeting.id, [{ userId: 'secret_waiting_user' }]);
        await new Promise((r) => setTimeout(r, 120));
        assert.strictEqual(waitingRoomLeaks.length, 0);
      } finally {
        cohostSocket?.disconnect();
        await node.close();
      }
    }

    // 2e: Stale presence update MUST NOT overwrite newer removed/left state (tokenEpoch & signalFenceVersion guarded)
    {
      const barrier = createBarrier();
      const node = await spawnRealSocketInstance({
        hubHooks: {
          beforePresenceUpdate: async ({ userId }) => {
            if (userId === users[1].id) await barrier.pause();
          },
        },
      });
      let guestSocket: ClientSocket | null = null;
      try {
        const { meeting } = await node.svc.createMeeting(users[0].id, {
          title: 'Subscribe Stale Presence Guard',
          maxParticipants: 10,
          settings: { waitingRoomEnabled: false },
        });
        createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
        await node.svc.joinMeeting(meeting.meetingCode, users[0].id);
        await node.svc.joinMeeting(meeting.meetingCode, users[1].id);
        await MeetingParticipant.updateOne(
          { meetingId: meeting.id, userId: users[1].id },
          { $set: { presenceStatus: 'OFFLINE' } }
        );

        guestSocket = await connectRealClient(node.port, users[1].token);
        const subPromise = subscribeClient(guestSocket, meeting.meetingCode);
        await barrier.arrived;

        // Remove guest right before stale presence update executes
        await node.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Removed before presence');
        barrier.release();
        await subPromise;

        const pDoc = await MeetingParticipant.findOne({
          meetingId: meeting.id,
          userId: users[1].id,
        }).lean();
        assert.strictEqual(pDoc?.admissionStatus, 'REMOVED');
        assert.strictEqual(
          pDoc?.presenceStatus,
          'OFFLINE',
          'Stale subscribe presence write MUST NOT overwrite REMOVED/OFFLINE state'
        );
      } finally {
        guestSocket?.disconnect();
        await node.close();
      }
    }
  });

  it('3. REAL TWO-instance Socket.IO (@socket.io/redis-adapter + ioredis): cross-instance waiting room, admission, fetchSockets(), removal eviction, and meeting end', async () => {
    const instA = await spawnRealSocketInstance({ adapterMode: 'redis', instanceId: 'sio-A' });
    const instB = await spawnRealSocketInstance({ adapterMode: 'redis', instanceId: 'sio-B' });
    let hostSockA: ClientSocket | null = null;
    let peerSockB: ClientSocket | null = null;
    let guestSockB: ClientSocket | null = null;

    try {
      assert.strictEqual(instA.hub.getAdapterMode(), 'redis');
      assert.strictEqual(instB.hub.getAdapterMode(), 'redis');

      const { meeting } = await instA.svc.createMeeting(users[0].id, {
        title: 'Two-Instance Real Socket.IO Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await instA.svc.joinMeeting(meeting.meetingCode, users[0].id); // Host admitted
      // Pre-admit Peer (users[2]) so Peer connects to Instance B as admitted
      await instA.svc.joinMeeting(meeting.meetingCode, users[2].id); // WAITING
      await instA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[2].id);

      // Connect Host to Instance A, Peer to Instance B
      hostSockA = await connectRealClient(instA.port, users[0].token);
      peerSockB = await connectRealClient(instB.port, users[2].token);
      assert.strictEqual((await subscribeClient(hostSockA, meeting.meetingCode)).ok, true);
      assert.strictEqual((await subscribeClient(peerSockB, meeting.meetingCode)).ok, true);

      const hostWaitingUpdates: any[] = [];
      const peerJoinedEvents: any[] = [];
      const peerSettingsEvents: any[] = [];
      const peerEndedEvents: any[] = [];
      const guestApprovedEvents: any[] = [];
      const guestRemovedEvents: any[] = [];
      const guestSettingsEvents: any[] = [];

      hostSockA.on('meeting:waiting-room-updated', (p) => hostWaitingUpdates.push(p));
      peerSockB.on('meeting:participant-joined', (p) => peerJoinedEvents.push(p));
      peerSockB.on('meeting:settings-updated', (p) => peerSettingsEvents.push(p));
      peerSockB.on('meeting:ended', (p) => peerEndedEvents.push(p));

      // Waiting Guest (users[1]) joins via Instance B -> Host on Instance A MUST receive waiting-room-updated!
      await instB.svc.joinMeeting(meeting.meetingCode, users[1].id);
      guestSockB = await connectRealClient(instB.port, users[1].token);
      guestSockB.on('meeting:admission-approved', (p) => guestApprovedEvents.push(p));
      guestSockB.on('meeting:participant-removed', (p) => guestRemovedEvents.push(p));
      guestSockB.on('meeting:settings-updated', (p) => guestSettingsEvents.push(p));
      const waitSub = await subscribeClient(guestSockB, meeting.meetingCode);
      assert.strictEqual(waitSub.ok, true);
      assert.strictEqual(waitSub.status, 'WAITING');

      await waitForCondition(
        () => hostWaitingUpdates.some((w) => w.count === 1),
        4_000,
        'Host on Instance A receives cross-instance waiting-room-updated from Instance B'
      );

      // Host admits Guest on Instance A -> Guest on Instance B receives admission-approved AND Peer on Instance B receives participant-joined!
      await instA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);

      await waitForCondition(
        () => guestApprovedEvents.length === 1 && peerJoinedEvents.length === 1,
        4_000,
        'Cross-instance admission-approved & participant-joined on Instance B'
      );
      assert.ok(guestApprovedEvents[0].eventId, 'admission-approved MUST include stable eventId');
      assert.strictEqual(
        guestApprovedEvents[0].eventId,
        peerJoinedEvents[0].eventId,
        'admission-approved & participant-joined share stable outbox eventId'
      );

      // Cross-instance fetchSockets() from Instance A MUST see sockets on BOTH Instance A and Instance B!
      await waitForCondition(
        async () => {
          const allAdmitted = await instA.hub
            .getIo()!
            .in(instA.hub.admittedChannel(meeting.id))
            .fetchSockets();
          return allAdmitted.length === 3;
        },
        4_000,
        'Cross-instance fetchSockets() returns all 3 admitted sockets across Instance A & B'
      );

      // Host removes Guest on Instance A -> Guest on Instance B receives participant-removed AND is evicted from rooms on Instance B!
      await instA.svc.removeParticipant(meeting.meetingCode, users[0].id, users[1].id, 'Cross-instance eviction');

      await waitForCondition(
        () => guestRemovedEvents.length === 1,
        4_000,
        'Guest on Instance B receives participant-removed from Instance A'
      );

      // Broadcast settings update from Instance A -> Peer on Instance B MUST receive it, evicted Guest on Instance B MUST NOT!
      instA.hub.emitSettingsUpdated(meeting.id, 'Post-Eviction Title', { waitingRoomEnabled: true });
      await waitForCondition(
        () => peerSettingsEvents.length === 1,
        4_000,
        'Peer on Instance B receives settings update'
      );
      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(
        guestSettingsEvents.length,
        0,
        'Evicted Guest on Instance B MUST NOT receive broadcasts after cross-instance eviction'
      );

      // Host ends meeting on Instance A -> Peer on Instance B receives meeting:ended AND Instance B marks meeting ended!
      await instA.svc.endMeeting(meeting.meetingCode, users[0].id);
      await waitForCondition(
        () => peerEndedEvents.length === 1 && instB.hub.isMeetingMarkedEnded(meeting.id),
        4_000,
        'Peer on Instance B receives meeting:ended & Instance B syncs endedMeetingIds'
      );
    } finally {
      hostSockA?.disconnect();
      peerSockB?.disconnect();
      guestSockB?.disconnect();
      await instA.close();
      await instB.close();
    }
  });

  it('4. REAL Socket.IO client outbox recovery (crash before emit, crash after emit + duplicate eventId idempotency, and termination during CLAIMED lease)', async () => {
    let nowMs = Date.now();
    const sharedNow = () => new Date(nowMs);

    // Part A: Crash before emit -> Instance B recovers after lease expiry -> real Socket.IO client receives event
    const instA = await spawnRealSocketInstance({
      adapterMode: 'redis',
      instanceId: 'sio-crash-A',
      nowFn: sharedNow,
      leaseDurationMs: 4_000,
      serviceHooks: {
        beforeAdmitEmit: async () => {
          throw createSimulatedOutboxCrash('Simulated crash before real Socket.IO emit');
        },
      },
    });
    const instB = await spawnRealSocketInstance({
      adapterMode: 'redis',
      instanceId: 'sio-recover-B',
      nowFn: sharedNow,
      leaseDurationMs: 4_000,
    });

    let guestSock: ClientSocket | null = null;
    let hostSock: ClientSocket | null = null;
    try {
      const { meeting } = await instA.svc.createMeeting(users[0].id, {
        title: 'Real Socket Outbox Crash Recovery',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await instA.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await instB.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

      hostSock = await connectRealClient(instA.port, users[0].token);
      guestSock = await connectRealClient(instB.port, users[1].token);
      assert.strictEqual((await subscribeClient(hostSock, meeting.meetingCode)).ok, true);
      assert.strictEqual((await subscribeClient(guestSock, meeting.meetingCode)).ok, true);

      const guestApproved: any[] = [];
      const hostJoined: any[] = [];
      guestSock.on('meeting:admission-approved', (p) => guestApproved.push(p));
      hostSock.on('meeting:participant-joined', (p) => hostJoined.push(p));

      await assert.rejects(
        () => instA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
        /crash before real Socket\.IO emit/
      );
      assert.strictEqual(guestApproved.length, 0);

      // Advance clock past lease expiry -> Instance B recovers and emits over REAL Socket.IO adapter!
      nowMs += 5_000;
      const sweepA = await instB.dispatcher.processDueEvents();
      assert.strictEqual(sweepA.dispatched, 1);

      await waitForCondition(
        () => guestApproved.length === 1 && hostJoined.length === 1,
        4_000,
        'Real Socket.IO clients receive recovered admission-approved & participant-joined'
      );

      // Part B: Crash AFTER real Socket.IO emit before DISPATCHED -> lease takeover redelivers SAME eventId -> idempotent consumer applies strictly once!
      const crashAfterEmitInst = await spawnRealSocketInstance({
        adapterMode: 'redis',
        instanceId: 'sio-crash-after-emit',
        nowFn: sharedNow,
        leaseDurationMs: 4_000,
        serviceHooks: {
          afterAdmitEmitBeforeMarkDispatched: async () => {
            throw createSimulatedOutboxCrash('Simulated crash AFTER real Socket.IO emit');
          },
        },
      });
      try {
        await instB.svc.joinMeeting(meeting.meetingCode, users[2].id); // WAITING
        const seenJoinIds = new Set<string>();
        const wireJoinPayloads: any[] = [];
        let logicalJoinCount = 0;

        hostSock.on('meeting:participant-joined', (p) => {
          if (p.participant?.userId !== users[2].id) return;
          wireJoinPayloads.push(p);
          if (!p.eventId || !seenJoinIds.has(p.eventId)) {
            if (p.eventId) seenJoinIds.add(p.eventId);
            logicalJoinCount += 1;
          }
        });

        await assert.rejects(
          () => crashAfterEmitInst.svc.admitParticipant(meeting.meetingCode, users[0].id, users[2].id),
          /crash AFTER real Socket\.IO emit/
        );
        await waitForCondition(() => wireJoinPayloads.length === 1, 4_000, 'First real wire delivery');

        // Lease expires -> Instance B takes over & redelivers over real Socket.IO with IDENTICAL eventId
        nowMs += 5_000;
        const sweepB = await instB.dispatcher.processDueEvents();
        assert.strictEqual(sweepB.dispatched, 1);

        await waitForCondition(() => wireJoinPayloads.length === 2, 4_000, 'Second real wire redelivery');
        assert.strictEqual(
          wireJoinPayloads[0].eventId,
          wireJoinPayloads[1].eventId,
          'Real Socket.IO redelivery MUST carry identical stable eventId'
        );
        assert.strictEqual(
          logicalJoinCount,
          1,
          'Frontend idempotent eventId consumer applies participant-joined strictly once'
        );
      } finally {
        await crashAfterEmitInst.close();
      }

      // Part C: Termination during active CLAIMED lease -> real waiting client receives meeting:ended, ZERO admission-approved
      const claimBarrier = createBarrier();
      const leasedInst = await spawnRealSocketInstance({
        adapterMode: 'redis',
        instanceId: 'sio-leased-term',
        nowFn: sharedNow,
        leaseDurationMs: 10_000,
        serviceHooks: {
          afterAdmitOutboxClaim: claimBarrier.pause,
        },
      });
      let waiting3Sock: ClientSocket | null = null;
      try {
        await instB.svc.joinMeeting(meeting.meetingCode, users[3].id); // WAITING
        waiting3Sock = await connectRealClient(instB.port, users[3].token);
        assert.strictEqual((await subscribeClient(waiting3Sock, meeting.meetingCode)).ok, true);

        const w3Approved: any[] = [];
        const w3Ended: any[] = [];
        waiting3Sock.on('meeting:admission-approved', (p) => w3Approved.push(p));
        waiting3Sock.on('meeting:ended', (p) => w3Ended.push(p));

        const admitP = leasedInst.svc.admitParticipant(meeting.meetingCode, users[0].id, users[3].id);
        await claimBarrier.arrived;

        await instB.svc.endMeeting(meeting.meetingCode, users[0].id);
        claimBarrier.release();

        await assert.rejects(
          () => admitP,
          (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
        );
        await waitForCondition(() => w3Ended.length === 1, 4_000, 'Waiting user receives meeting:ended');
        await new Promise((r) => setTimeout(r, 150));
        assert.strictEqual(
          w3Approved.length,
          0,
          'Waiting user MUST NEVER receive admission-approved after termination suppressed active lease'
        );
      } finally {
        waiting3Sock?.disconnect();
        await leasedInst.close();
      }
    } finally {
      guestSock?.disconnect();
      hostSock?.disconnect();
      await instA.close();
      await instB.close();
    }
  });

  it('5. Durable joinMeeting() PARTICIPANT_JOINED outbox: crash before emit recovers to real Socket.IO client & ALREADY_ADMITTED creates zero duplicates', async () => {
    let nowMs = Date.now();
    const sharedNow = () => new Date(nowMs);

    const instA = await spawnRealSocketInstance({
      adapterMode: 'redis',
      instanceId: 'sio-join-crash-A',
      nowFn: sharedNow,
      leaseDurationMs: 4_000,
      serviceHooks: {
        beforeJoinEmit: async () => {
          throw createSimulatedOutboxCrash('Simulated crash during joinMeeting before Socket.IO emit');
        },
      },
    });
    const instB = await spawnRealSocketInstance({
      adapterMode: 'redis',
      instanceId: 'sio-join-recover-B',
      nowFn: sharedNow,
      leaseDurationMs: 4_000,
    });

    let hostSock: ClientSocket | null = null;
    try {
      const { meeting } = await instB.svc.createMeeting(users[0].id, {
        title: 'Durable Join Outbox Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: false },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await instB.svc.joinMeeting(meeting.meetingCode, users[0].id);

      hostSock = await connectRealClient(instB.port, users[0].token);
      assert.strictEqual((await subscribeClient(hostSock, meeting.meetingCode)).ok, true);

      const hostJoinedEvents: any[] = [];
      hostSock.on('meeting:participant-joined', (p) => hostJoinedEvents.push(p));

      // Guest direct-joins on Instance A, which commits admission + PENDING PARTICIPANT_JOINED outbox,
      // claims it, then crashes right before emit!
      await assert.rejects(
        () => instA.svc.joinMeeting(meeting.meetingCode, users[1].id),
        /crash during joinMeeting before Socket\.IO emit/
      );
      assert.strictEqual(hostJoinedEvents.length, 0);

      const joinOutboxDocsBefore = await MeetingRealtimeEvent.find({
        meetingId: meeting.id,
        targetUserId: users[1].id,
        type: 'PARTICIPANT_JOINED',
      }).lean();
      assert.strictEqual(joinOutboxDocsBefore.length, 1);
      assert.strictEqual(joinOutboxDocsBefore[0].status, 'CLAIMED');
      assert.strictEqual(joinOutboxDocsBefore[0].terminalAt, null);

      // Lease expires -> Instance B recovers and emits meeting:participant-joined with stable eventId!
      nowMs += 5_000;
      const sweep = await instB.dispatcher.processDueEvents();
      assert.strictEqual(sweep.dispatched, 1);

      await waitForCondition(
        () => hostJoinedEvents.length === 1,
        4_000,
        'Real Host client receives recovered PARTICIPANT_JOINED event'
      );
      assert.strictEqual(hostJoinedEvents[0].eventId, joinOutboxDocsBefore[0].eventId);
      assert.strictEqual(hostJoinedEvents[0].participant.userId, users[1].id);

      // Idempotent second joinMeeting() for ALREADY_ADMITTED Guest MUST NOT create duplicate logical join event!
      const secondJoin = await instB.svc.joinMeeting(meeting.meetingCode, users[1].id);
      assert.strictEqual(secondJoin.joinResult, 'ALREADY_ADMITTED');

      const joinOutboxDocsAfter = await MeetingRealtimeEvent.find({
        meetingId: meeting.id,
        targetUserId: users[1].id,
        type: 'PARTICIPANT_JOINED',
      }).lean();
      assert.strictEqual(
        joinOutboxDocsAfter.length,
        1,
        'ALREADY_ADMITTED rejoin MUST NOT create duplicate PARTICIPANT_JOINED outbox records'
      );
    } finally {
      hostSock?.disconnect();
      await instA.close();
      await instB.close();
    }
  });

  it('6. Outbox startup initialization fails closed when index creation fails or essential indexes are missing', async () => {
    // Baseline verification succeeds and all 5 required indexes exist
    await ensureMeetingRealtimeOutboxReady();
    const idxs = await MeetingRealtimeEvent.collection.indexes();
    const names = new Set(idxs.map((i) => i.name));
    for (const reqName of REQUIRED_MEETING_OUTBOX_INDEX_NAMES) {
      assert.ok(names.has(reqName), `Expected required index ${reqName} to exist`);
    }

    // Inject createIndexes failure -> MUST throw (NEVER swallow!)
    const origCreateIndexes = MeetingRealtimeEvent.createIndexes.bind(MeetingRealtimeEvent);
    (MeetingRealtimeEvent as any).createIndexes = async () => {
      throw new Error('Simulated MongoDB index creation failure');
    };
    try {
      await assert.rejects(
        () => ensureMeetingRealtimeOutboxReady(),
        /Simulated MongoDB index creation failure/
      );
    } finally {
      (MeetingRealtimeEvent as any).createIndexes = origCreateIndexes;
    }

    // Inject missing required index verification -> MUST throw (fail closed!)
    const origIndexes = MeetingRealtimeEvent.collection.indexes.bind(
      MeetingRealtimeEvent.collection
    );
    let callCount = 0;
    (MeetingRealtimeEvent.collection as any).indexes = async () => {
      callCount += 1;
      const real = await origIndexes();
      if (callCount >= 2) {
        return real.filter((i) => i.name !== 'terminalAt_ttl_24h');
      }
      return real;
    };
    try {
      await assert.rejects(
        () => ensureMeetingRealtimeOutboxReady(),
        /Required MeetingRealtimeEvent index 'terminalAt_ttl_24h' is missing/
      );
    } finally {
      (MeetingRealtimeEvent.collection as any).indexes = origIndexes;
    }
  });
});
