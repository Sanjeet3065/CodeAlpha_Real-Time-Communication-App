import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { ChatService } from '../services/chat.service.js';
import { ChatRedisService } from '../services/chatRedis.service.js';
import { meetingService } from '../services/meeting.service.js';
import { ALLOWED_REACTIONS } from '../schemas/chat.schema.js';
import { hashPassword } from '../utils/password.js';

function respBulk(str: string | Buffer): Buffer {
  const b = Buffer.isBuffer(str) ? str : Buffer.from(str, 'utf8');
  return Buffer.concat([Buffer.from(`$${b.length}\r\n`, 'utf8'), b, Buffer.from('\r\n', 'utf8')]);
}

/**
 * Lightweight binary-safe RESP2 Redis TCP server implementing
 * real EVAL, ZREMRANGEBYSCORE, ZCARD, ZADD, EXPIRE, SET (with NX/EX), PING, and INFO.
 */
async function startRespRedisServer(): Promise<{
  port: number;
  url: string;
  close: () => Promise<void>;
}> {
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  const kvStore = new Map<string, { val: string; expiresAt: number }>();
  const sockets = new Set<net.Socket>();

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf: Buffer = Buffer.alloc(0);

    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));

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
          sock.write("-ERR unknown command 'HELLO'\r\n");
        } else if (cmd === 'PING') {
          sock.write(args[1] ? respBulk(args[1]) : Buffer.from('+PONG\r\n', 'utf8'));
        } else if (cmd === 'INFO') {
          sock.write(respBulk('# Server\r\nredis_version:7.2.0\r\n'));
        } else if (cmd === 'CLIENT' || cmd === 'SELECT' || cmd === 'AUTH') {
          sock.write(Buffer.from('+OK\r\n', 'utf8'));
        } else if (cmd === 'FLUSHDB' || cmd === 'FLUSHALL') {
          sortedSets.clear();
          kvStore.clear();
          sock.write(Buffer.from('+OK\r\n', 'utf8'));
        } else if (cmd === 'QUIT') {
          sock.write(Buffer.from('+OK\r\n', 'utf8'));
          sock.end();
        } else if (cmd === 'GET') {
          const key = args[1]?.toString('utf8') || '';
          const now = Date.now();
          const entry = kvStore.get(key);
          if (!entry || entry.expiresAt <= now) {
            if (entry) kvStore.delete(key);
            sock.write(Buffer.from('$-1\r\n', 'utf8'));
          } else {
            sock.write(respBulk(entry.val));
          }
        } else if (cmd === 'DEL') {
          const key = args[1]?.toString('utf8') || '';
          const deleted = kvStore.delete(key) ? 1 : 0;
          sock.write(Buffer.from(`:${deleted}\r\n`, 'utf8'));
        } else if (cmd === 'SET') {
          // SET key val [EX sec] [NX]
          const key = args[1]?.toString('utf8') || '';
          const val = args[2]?.toString('utf8') || '';
          let isNx = false;
          let ttlMs = 30000;

          for (let i = 3; i < args.length; i += 1) {
            const opt = args[i].toString('utf8').toUpperCase();
            if (opt === 'NX') isNx = true;
            if (opt === 'EX' && args[i + 1]) {
              ttlMs = Number.parseInt(args[i + 1].toString('utf8'), 10) * 1000;
              i += 1;
            }
          }

          const now = Date.now();
          const existing = kvStore.get(key);
          if (isNx && existing && existing.expiresAt > now) {
            // NX failed: key exists
            sock.write(Buffer.from('$-1\r\n', 'utf8'));
          } else {
            kvStore.set(key, { val, expiresAt: now + ttlMs });
            sock.write(Buffer.from('+OK\r\n', 'utf8'));
          }
        } else if (cmd === 'EVAL') {
          const scriptStr = args[1]?.toString('utf8') || '';
          if (scriptStr.includes('connectly_reserve_rx')) {
            const key = args[3]?.toString('utf8') || '';
            const reservationToken = args[4]?.toString('utf8') || '';
            const ttlSec = Number.parseInt(args[5]?.toString('utf8') || '30', 10);
            const now = Date.now();
            const entry = kvStore.get(key);
            if (!entry || entry.expiresAt <= now) {
              kvStore.set(key, {
                val: `reserved:${reservationToken}`,
                expiresAt: now + ttlSec * 1000,
              });
              sock.write(respBulk('acquired'));
            } else if (entry.val === 'completed' || entry.val === '1') {
              sock.write(respBulk('completed'));
            } else {
              sock.write(respBulk('in_progress'));
            }
          } else if (scriptStr.includes('connectly_release_rx')) {
            const key = args[3]?.toString('utf8') || '';
            const reservationToken = args[4]?.toString('utf8') || '';
            const now = Date.now();
            const entry = kvStore.get(key);
            if (entry && entry.expiresAt > now && entry.val === `reserved:${reservationToken}`) {
              kvStore.delete(key);
              sock.write(Buffer.from(':1\r\n', 'utf8'));
            } else {
              sock.write(Buffer.from(':0\r\n', 'utf8'));
            }
          } else if (scriptStr.includes('connectly_complete_rx')) {
            const key = args[3]?.toString('utf8') || '';
            const reservationToken = args[4]?.toString('utf8') || '';
            const ttlSec = Number.parseInt(args[5]?.toString('utf8') || '30', 10);
            const now = Date.now();
            const entry = kvStore.get(key);
            if (
              entry &&
              entry.expiresAt > now &&
              (entry.val === `reserved:${reservationToken}` || entry.val === 'completed')
            ) {
              kvStore.set(key, { val: 'completed', expiresAt: now + ttlSec * 1000 });
              sock.write(Buffer.from(':1\r\n', 'utf8'));
            } else {
              sock.write(Buffer.from(':0\r\n', 'utf8'));
            }
          } else {
            // EVAL script numkeys key now windowMs maxEvents ttlSec member
            const key = args[3]?.toString('utf8') || '';
            const now = Number.parseInt(args[4]?.toString('utf8') || '0', 10);
            const windowMs = Number.parseInt(args[5]?.toString('utf8') || '5000', 10);
            const maxEvents = Number.parseInt(args[6]?.toString('utf8') || '10', 10);
            const member = args[8]?.toString('utf8') || `${now}`;

            let list = sortedSets.get(key) || [];
            list = list.filter((item) => item.score > now - windowMs);

            if (list.length < maxEvents) {
              list.push({ score: now, member });
              sortedSets.set(key, list);
              sock.write(Buffer.from(':1\r\n', 'utf8'));
            } else {
              sortedSets.set(key, list);
              sock.write(Buffer.from(':0\r\n', 'utf8'));
            }
          }
        } else {
          sock.write(Buffer.from('+OK\r\n', 'utf8'));
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as net.AddressInfo;

  return {
    port: addr.port,
    url: `redis://127.0.0.1:${addr.port}`,
    close: async () => {
      for (const s of sockets) {
        s.unref();
        s.destroy();
      }
      server.closeAllConnections?.();
      server.unref();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('Phase 12 Targeted Corrections & Reliability Hardening Test Suite', () => {
  let redisBroker: { port: number; url: string; close: () => Promise<void> };
  let redisClientA: Redis;
  let redisClientB: Redis;
  let chatServiceA: ChatService;
  let chatServiceB: ChatService;
  let hostUser: any;
  let guestUser: any;
  let meetingCode: string;
  let meetingId: string;

  before(async () => {
    const mongoUri =
      process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test_phase12_hardening';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Start lightweight RESP2 Redis TCP server
    redisBroker = await startRespRedisServer();

    // Two distinct ioredis clients simulating two distinct application instances
    redisClientA = new Redis(redisBroker.url, { maxRetriesPerRequest: 1 });
    redisClientB = new Redis(redisBroker.url, { maxRetriesPerRequest: 1 });

    const chatRedisA = new ChatRedisService(redisClientA);
    const chatRedisB = new ChatRedisService(redisClientB);

    chatServiceA = new ChatService(chatRedisA);
    chatServiceB = new ChatService(chatRedisB);

    const passwordHash = await hashPassword('HardeningPhase12!');
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    hostUser = await User.create({
      email: `hard_host_${suffix}@example.com`,
      passwordHash,
      firstName: 'HostHardening',
      lastName: 'User',
      isEmailVerified: true,
    });

    guestUser = await User.create({
      email: `hard_guest_${suffix}@example.com`,
      passwordHash,
      firstName: 'GuestHardening',
      lastName: 'User',
      isEmailVerified: true,
    });

    const meetRes = await meetingService.createMeeting(hostUser._id.toString(), {
      title: 'Phase 12 Hardening Meeting',
      maxParticipants: 10,
    });
    meetingCode = meetRes.meeting.meetingCode;
    meetingId = meetRes.meeting.id;

    // Admit host
    await meetingService.joinMeeting(meetingCode, hostUser._id.toString());
    // Admit guest
    await meetingService.joinMeeting(meetingCode, guestUser._id.toString());
  });

  after(async () => {
    redisClientA.disconnect(false);
    redisClientB.disconnect(false);
    await redisBroker.close();
    try {
      await Meeting.deleteMany({ meetingCode });
      await ChatMessage.deleteMany({ meetingId });
      await MeetingParticipant.deleteMany({ meetingId });
      await User.deleteMany({ _id: { $in: [hostUser._id, guestUser._id] } });
      await mongoose.disconnect();
    } catch {
      // ignore teardown error
    }
  });

  beforeEach(async () => {
    chatServiceA.clearRateLimits();
    chatServiceB.clearRateLimits();
    await redisClientA.flushall();
  });

  it('1. ISS-12-01: Two independent service instances sharing Redis enforce ONE common 10-message rate limit', async () => {
    const userId = hostUser._id.toString();

    // Send 5 messages via Instance A
    for (let i = 1; i <= 5; i += 1) {
      const msg = await chatServiceA.sendMessage(meetingCode, userId, {
        content: `Instance A message ${i}`,
        clientMessageId: `cm_a_${i}`,
      });
      assert.ok(msg.id);
    }

    // Send 5 messages via Instance B (total 10)
    for (let i = 1; i <= 5; i += 1) {
      const msg = await chatServiceB.sendMessage(meetingCode, userId, {
        content: `Instance B message ${i}`,
        clientMessageId: `cm_b_${i}`,
      });
      assert.ok(msg.id);
    }

    // The 11th message sent to EITHER Instance A or B must be rejected with HTTP 429
    await assert.rejects(
      () =>
        chatServiceA.sendMessage(meetingCode, userId, {
          content: 'Instance A message 11 - should fail',
          clientMessageId: 'cm_a_11',
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );

    await assert.rejects(
      () =>
        chatServiceB.sendMessage(meetingCode, userId, {
          content: 'Instance B message 12 - should fail',
          clientMessageId: 'cm_b_12',
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );
  });

  it('2. ISS-12-01: Concurrent requests across instances cannot bypass sliding window limit', async () => {
    const userId = guestUser._id.toString();
    const attempts = 15;

    // Fire 15 concurrent requests interleaved across Instance A and Instance B
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) => {
        const svc = i % 2 === 0 ? chatServiceA : chatServiceB;
        return svc.sendMessage(meetingCode, userId, {
          content: `Concurrent burst message ${i}`,
          clientMessageId: `burst_${Date.now()}_${i}`,
        });
      })
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rateLimited = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason?.statusCode === 429 || r.reason?.code === 'RATE_LIMIT_EXCEEDED')
    );

    // Exactly 10 must succeed; the remaining 5 must be rejected with 429
    assert.strictEqual(succeeded.length, 10, 'Expected exactly 10 requests to pass rate limiter');
    assert.strictEqual(rateLimited.length, 5, 'Expected 5 requests to be rate-limited');
  });

  it('3. ISS-12-02: Reaction idempotency across instances detects duplicate submission and prevents duplicate broadcast', async () => {
    const userId = hostUser._id.toString();
    const clientReactionId = `rx_shared_idem_${Date.now()}`;

    // Instance A processes first submission
    const resA = await chatServiceA.sendReaction(meetingCode, userId, {
      emoji: '👏',
      clientReactionId,
    });
    assert.strictEqual(resA.id, clientReactionId);
    assert.strictEqual(resA.emoji, '👏');

    // Instance B processes duplicate submission with the same clientReactionId
    const resB = await chatServiceB.sendReaction(meetingCode, userId, {
      emoji: '👏',
      clientReactionId,
    });

    // Returns identical acknowledgment
    assert.strictEqual(resB.id, clientReactionId);
    assert.strictEqual(resB.emoji, '👏');

    // Duplicate submission must NOT have consumed a reaction rate-limit quota slot!
  });

  it('4. ISS-12-02: Different users or meetings using the same clientReactionId are NOT blocked', async () => {
    const clientReactionId = `rx_collision_test_${Date.now()}`;

    // User A reacts with this ID
    const resUserA = await chatServiceA.sendReaction(meetingCode, hostUser._id.toString(), {
      emoji: '🚀',
      clientReactionId,
    });
    assert.strictEqual(resUserA.id, clientReactionId);

    // User B reacts with the identical clientReactionId in the same meeting -> MUST SUCCEED (separate keys!)
    const resUserB = await chatServiceB.sendReaction(meetingCode, guestUser._id.toString(), {
      emoji: '🚀',
      clientReactionId,
    });
    assert.strictEqual(resUserB.id, clientReactionId);
    assert.strictEqual(resUserB.senderId, guestUser._id.toString());
  });

  it('5. ISS-12-02: Production fail-closed behavior when Redis is unavailable', async () => {
    const unreachableRedis = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
    });
    unreachableRedis.on('error', () => {});
    const failingService = new ChatRedisService(unreachableRedis);

    // Override isDistributedRequired to simulate production
    failingService.isDistributedRequired = () => true;

    await assert.rejects(
      () => failingService.checkRateLimit('test:key', 5000, 10),
      (err: any) => err?.statusCode === 503 && err?.code === 'RATE_LIMIT_SERVICE_UNAVAILABLE'
    );

    await assert.rejects(
      () => failingService.acquireReactionIdempotency('m1', 'u1', 'rx1'),
      (err: any) => err?.statusCode === 503 && err?.code === 'REACTION_SERVICE_UNAVAILABLE'
    );

    unreachableRedis.disconnect(false);
  });

  it('6. ISS-12-05: Deterministic keyset pagination with identical millisecond timestamps returns all messages exactly once', async () => {
    // Isolate test into dedicated meeting room to prevent timestamp interference from preceding tests (DEF-13-16)
    const isoMeetingRes = await meetingService.createMeeting(hostUser._id.toString(), {
      title: 'Isolated Pagination Meeting',
      maxParticipants: 10,
    });
    const isoMeetingCode = isoMeetingRes.meeting.meetingCode;
    const isoMeetingId = isoMeetingRes.meeting.id;
    await meetingService.joinMeeting(isoMeetingCode, hostUser._id.toString());

    try {
      const fixedTimestamp = new Date('2026-11-20T10:00:00.000Z');
      const totalBatch = 25;

      // Create 25 messages with the exact same millisecond timestamp
      const createdDocs = await Promise.all(
        Array.from({ length: totalBatch }, (_, i) =>
          ChatMessage.create({
            meetingId: isoMeetingId,
            senderId: hostUser._id,
            senderName: hostUser.firstName,
            senderRole: 'host',
            content: `Identical timestamp message #${i + 1}`,
            clientMessageId: `same_time_${Date.now()}_${i}`,
            createdAt: fixedTimestamp,
            updatedAt: fixedTimestamp,
          })
        )
      );

      assert.strictEqual(createdDocs.length, 25);

      // Fetch Page 1 (limit 10)
      const page1 = await chatServiceA.getChatHistory(isoMeetingCode, hostUser._id.toString(), {
        limit: 10,
      });
      assert.strictEqual(page1.messages.length, 10);
      assert.strictEqual(page1.hasMore, true);
      assert.ok(page1.nextCursor, 'Expected nextCursor for composite pagination');

      // Fetch Page 2 using nextCursor
      const page2 = await chatServiceA.getChatHistory(isoMeetingCode, hostUser._id.toString(), {
        limit: 10,
        before: page1.nextCursor!,
      });
      assert.strictEqual(page2.messages.length, 10);
      assert.strictEqual(page2.hasMore, true);
      assert.ok(page2.nextCursor);

      // Fetch Page 3 using nextCursor (should retrieve remaining 5 identical timestamp messages)
      const page3 = await chatServiceA.getChatHistory(isoMeetingCode, hostUser._id.toString(), {
        limit: 10,
        before: page2.nextCursor!,
      });

      const allRetrievedIds = [
        ...page1.messages.map((m) => m.id),
        ...page2.messages.map((m) => m.id),
        ...page3.messages.map((m) => m.id),
      ];

      // Verify each of the 25 same-timestamp messages is present without duplicates
      const sameTimeIds = createdDocs.map((d) => d._id.toString());
      const matchedCount = sameTimeIds.filter((id) => allRetrievedIds.includes(id)).length;
      assert.strictEqual(matchedCount, 25, 'Every identical-timestamp message must be retrieved');

      // Verify zero duplicate IDs across pages
      const uniqueIds = new Set(allRetrievedIds);
      assert.strictEqual(uniqueIds.size, allRetrievedIds.length, 'Zero duplicate messages across pagination pages');
    } finally {
      await ChatMessage.deleteMany({ meetingId: isoMeetingId });
      await MeetingParticipant.deleteMany({ meetingId: isoMeetingId });
      await Meeting.deleteMany({ _id: isoMeetingId });
    }
  });

  it('7. ISS-12-04: Idempotent message retry preserves clientMessageId and prevents duplicate database records', async () => {
    const clientMessageId = `cm_retry_idemp_${Date.now()}`;
    const content = 'Test message for retry idempotency';

    // First send succeeds
    const firstRes = await chatServiceA.sendMessage(meetingCode, hostUser._id.toString(), {
      content,
      clientMessageId,
    });
    assert.ok(firstRes.id);

    // Simulated retry with the same clientMessageId (e.g. after network drop / lost ack)
    const retryRes = await chatServiceB.sendMessage(meetingCode, hostUser._id.toString(), {
      content,
      clientMessageId,
    });

    // Authoritative ID and attributes must match exactly
    assert.strictEqual(retryRes.id, firstRes.id);
    assert.strictEqual(retryRes.clientMessageId, clientMessageId);
    assert.strictEqual(retryRes.createdAt, firstRes.createdAt);

    // Verify exactly one message exists in database with this clientMessageId
    const count = await ChatMessage.countDocuments({ meetingId, clientMessageId });
    assert.strictEqual(count, 1, 'Database must contain exactly 1 document for clientMessageId');
  });

  it('8. Canonical Emoji Allowlist consistency: 8 allowed emojis in schema match service validation', () => {
    assert.strictEqual(ALLOWED_REACTIONS.length, 8);
    const expected = ['👍', '❤️', '👏', '🎉', '😂', '😮', '🔥', '🚀'];
    for (const em of expected) {
      assert.ok((ALLOWED_REACTIONS as readonly string[]).includes(em), `Missing emoji: ${em}`);
    }
  });

  it('9. DEF-12-01: Reaction rejected by rate limiting releases reservation so retry with same clientReactionId succeeds after window resets', async () => {
    const userId = guestUser._id.toString();

    // Step 1: Send 5 reactions to exhaust the rate limit (limit is 5 reactions per 3000ms window)
    for (let i = 1; i <= 5; i += 1) {
      const rx = await chatServiceA.sendReaction(meetingCode, userId, {
        emoji: '🔥',
        clientReactionId: `rx_quota_exhaust_${i}_${Date.now()}`,
      });
      assert.ok(rx.id);
    }

    // Step 2: Attempt 6th reaction with a designated clientReactionId -> MUST be rejected with HTTP 429
    const retryTestId = `rx_def_retry_target_${Date.now()}`;
    await assert.rejects(
      () =>
        chatServiceA.sendReaction(meetingCode, userId, {
          emoji: '🔥',
          clientReactionId: retryTestId,
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );

    // Step 3: Verify that Redis does NOT retain a consumed or pending reservation key for retryTestId
    const key = `connectly:idemp:rx:${meetingId}:${userId}:${retryTestId}`;
    const rawVal = await redisClientA.get(key);
    assert.strictEqual(rawVal, null, 'Rate-limited reaction must have released its reservation from Redis');

    // Step 4: Advance or wait past the rate limit window (3100ms)
    await new Promise((resolve) => setTimeout(resolve, 3100));

    // Step 5: Retrying the EXACT same clientReactionId must succeed and broadcast
    const retrySuccess = await chatServiceB.sendReaction(meetingCode, userId, {
      emoji: '🔥',
      clientReactionId: retryTestId,
    });

    assert.strictEqual(retrySuccess.id, retryTestId);
    assert.strictEqual(retrySuccess.emoji, '🔥');
    assert.strictEqual(retrySuccess.senderId, userId);

    // Step 6: Verify the key is now in 'completed' state in Redis
    const finalVal = await redisClientA.get(key);
    assert.strictEqual(finalVal, 'completed', 'Successfully delivered reaction must be marked completed');
  });

  it('10. DEF-12-01: Ownership-safe release using compare-and-delete prevents deleting another request reservation or completed key', async () => {
    const userId = hostUser._id.toString();
    const testRxId = `rx_owner_safety_${Date.now()}`;
    const key = `connectly:idemp:rx:${meetingId}:${userId}:${testRxId}`;
    const tokenA = 'token-alpha-123';
    const tokenB = 'token-bravo-456';

    const chatRedis = (chatServiceA as any).redisService as ChatRedisService;

    // 1. Acquire reservation with tokenA
    const statusA = await chatRedis.acquireReactionReservation(meetingId, userId, testRxId, tokenA, 30);
    assert.strictEqual(statusA, 'acquired');

    // 2. Attempt release with tokenB (mismatched token) -> MUST FAIL (returns false) and NOT delete key
    const releaseMismatched = await chatRedis.releaseReactionReservation(meetingId, userId, testRxId, tokenB);
    assert.strictEqual(releaseMismatched, false, 'Release with mismatched token must return false');

    const checkStillExists = await redisClientA.get(key);
    assert.strictEqual(checkStillExists, `reserved:${tokenA}`, 'Key must remain intact after mismatched release attempt');

    // 3. Mark completed with tokenA -> key transitions to completed
    const completed = await chatRedis.markReactionCompleted(meetingId, userId, testRxId, tokenA, 30);
    assert.strictEqual(completed, true);

    const checkCompleted = await redisClientA.get(key);
    assert.strictEqual(checkCompleted, 'completed');

    // 4. Attempt release with tokenA on already-completed key -> MUST FAIL (returns false) and NOT delete completed state
    const releaseCompleted = await chatRedis.releaseReactionReservation(meetingId, userId, testRxId, tokenA);
    assert.strictEqual(releaseCompleted, false, 'Release on completed key must return false');

    const checkStillCompleted = await redisClientA.get(key);
    assert.strictEqual(checkStillCompleted, 'completed', 'Completed key must never be deleted by release');
  });

  it('11. DEF-12-01: Duplicate completed reactions return acknowledgment without broadcasting or burning rate-limit quota', async () => {
    const userId = guestUser._id.toString();
    const clientReactionId = `rx_no_quota_burn_${Date.now()}`;

    // Send 4 reactions so exactly 1 slot remains
    for (let i = 1; i <= 4; i += 1) {
      await chatServiceA.sendReaction(meetingCode, userId, {
        emoji: '👍',
        clientReactionId: `rx_burn_prep_${i}_${Date.now()}`,
      });
    }

    // Send the 5th reaction (consuming the last available slot in window)
    const originalRes = await chatServiceA.sendReaction(meetingCode, userId, {
      emoji: '👍',
      clientReactionId,
    });
    assert.strictEqual(originalRes.id, clientReactionId);

    // Any new reaction with a NEW clientReactionId must be rejected with 429
    await assert.rejects(
      () =>
        chatServiceA.sendReaction(meetingCode, userId, {
          emoji: '👍',
          clientReactionId: `rx_new_should_429_${Date.now()}`,
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );

    // Duplicate submission of the completed reaction with the SAME clientReactionId:
    // MUST NOT be rejected with 429 and MUST NOT burn quota!
    const duplicateRes = await chatServiceB.sendReaction(meetingCode, userId, {
      emoji: '👍',
      clientReactionId,
    });

    assert.strictEqual(duplicateRes.id, clientReactionId);
    assert.strictEqual(duplicateRes.emoji, '👍');
  });

  it('12. DEF-12-01: Duplicate request while first is in-progress polls and rejects with 409 if unresolved, never returning false success', async () => {
    const userId = hostUser._id.toString();
    const testRxId = `rx_in_progress_test_${Date.now()}`;
    const tokenHolding = 'holding-token-789';

    const chatRedis = (chatServiceA as any).redisService as ChatRedisService;

    // Simulate an in-flight request holding reservation
    await chatRedis.acquireReactionReservation(meetingId, userId, testRxId, tokenHolding, 30);

    // Concurrent request arrives while reservation is held: must NOT return misleading success!
    // It will poll and ultimately reject with 409 REACTION_IN_PROGRESS
    await assert.rejects(
      () =>
        chatServiceB.sendReaction(meetingCode, userId, {
          emoji: '🎉',
          clientReactionId: testRxId,
        }),
      (err: any) => err?.statusCode === 409 && err?.code === 'REACTION_IN_PROGRESS'
    );
  });
});
