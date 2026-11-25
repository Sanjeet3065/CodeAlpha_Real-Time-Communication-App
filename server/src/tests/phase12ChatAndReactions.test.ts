import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { io as ClientSocket } from 'socket.io-client';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { chatService } from '../services/chat.service.js';
import { meetingService } from '../services/meeting.service.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';

describe('Phase 12 Real-Time Chat & Reactions Test Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let hostUser: any;
  let guestUser: any;
  let waitingUser: any;
  let outsiderUser: any;
  let hostToken: string;
  let guestToken: string;
  let meetingCode: string;
  let meetingId: string;
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];

  before(async () => {
    try {
      const mongoUri =
        process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test_phase12_chat';
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri);
      }

      const passwordHash = await hashPassword('Phase12ChatPass!2026');
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      hostUser = await User.create({
        email: `p12_host_${suffix}@example.com`,
        passwordHash,
        firstName: 'Aarav',
        lastName: 'Host',
        avatarUrl: 'https://example.com/host.png',
        isEmailVerified: true,
      });
      hostToken = generateAccessToken({
        sub: hostUser._id.toString(),
        email: hostUser.email,
        firstName: hostUser.firstName,
        lastName: hostUser.lastName,
      });

      guestUser = await User.create({
        email: `p12_guest_${suffix}@example.com`,
        passwordHash,
        firstName: 'Maya',
        lastName: 'Guest',
        avatarUrl: 'https://example.com/guest.png',
        isEmailVerified: true,
      });
      guestToken = generateAccessToken({
        sub: guestUser._id.toString(),
        email: guestUser.email,
        firstName: guestUser.firstName,
        lastName: guestUser.lastName,
      });

      waitingUser = await User.create({
        email: `p12_waiting_${suffix}@example.com`,
        passwordHash,
        firstName: 'Vikram',
        lastName: 'Waiting',
        isEmailVerified: true,
      });
      generateAccessToken({
        sub: waitingUser._id.toString(),
        email: waitingUser.email,
        firstName: waitingUser.firstName,
        lastName: waitingUser.lastName,
      });

      outsiderUser = await User.create({
        email: `p12_outsider_${suffix}@example.com`,
        passwordHash,
        firstName: 'Pooja',
        lastName: 'Outsider',
        isEmailVerified: true,
      });

      // Create a test meeting
      const meetRes = await meetingService.createMeeting(hostUser._id.toString(), {
        title: 'Phase 12 Real-Time Chat & Reactions Meeting',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      meetingCode = meetRes.meeting.meetingCode;
      meetingId = meetRes.meeting.id;
      createdMeetingIds.push(new mongoose.Types.ObjectId(meetRes.meeting.id));

      // Host joins as participant
      await meetingService.joinMeeting(meetingCode, hostUser._id.toString(), {
        displayName: 'Aarav Host',
      });

      // Guest joins and is admitted
      await meetingService.joinMeeting(meetingCode, guestUser._id.toString(), {
        displayName: 'Maya Guest',
      });
      await meetingService.admitParticipant(meetingCode, hostUser._id.toString(), guestUser._id.toString());

      // Waiting user joins and remains waiting
      await meetingService.joinMeeting(meetingCode, waitingUser._id.toString(), {
        displayName: 'Vikram Waiting',
      });

      // Start in-memory HTTP server and attach Socket.IO hub
      server = http.createServer();
      meetingRealtime.attach(server);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          serverPort = addr.port;
          resolve();
        });
      });
    } catch (err) {
      console.error('CRITICAL BEFORE HOOK ERROR:', err);
      throw err;
    }
  });

  after(async () => {
    meetingRealtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (createdMeetingIds.length > 0) {
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await ChatMessage.deleteMany({ meetingId: { $in: createdMeetingIds } });
    }
    await User.deleteMany({
      _id: { $in: [hostUser._id, guestUser._id, waitingUser._id, outsiderUser._id] },
    });
    await mongoose.disconnect();
  });

  beforeEach(() => {
    chatService.clearRateLimits();
  });

  it('1. Admitted participant successfully sends a chat message, persists to DB, and broadcasts event', async () => {
    let broadcastPayload: any = null;

    const clientSocket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: guestToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on('connect', resolve);
    });

    // Subscribe to meeting
    await new Promise<void>((resolve, reject) => {
      clientSocket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
        if (!res?.ok) {
          console.error('TEST 1 SUBSCRIBE ERROR:', res);
          reject(new Error(`Test 1 subscribe failed: ${JSON.stringify(res)}`));
          return;
        }
        resolve();
      });
    });

    const broadcastPromise = new Promise<any>((resolve) => {
      clientSocket.on('chat:message-received', (msg) => {
        resolve(msg);
      });
    });

    // Send chat message via service
    const content = 'Hello everyone! Welcome to Phase 12 real-time chat.';
    const clientMessageId = `cm_${Date.now()}_1`;
    const msg = await chatService.sendMessage(meetingCode, hostUser._id.toString(), {
      content,
      clientMessageId,
    });

    assert.ok(msg.id);
    assert.strictEqual(msg.content, content);
    assert.strictEqual(msg.senderId, hostUser._id.toString());
    assert.strictEqual(msg.senderName, 'Aarav Host');
    assert.strictEqual(msg.senderRole, 'host');
    assert.strictEqual(msg.clientMessageId, clientMessageId);

    // Verify DB persistence
    const saved = await ChatMessage.findById(msg.id);
    assert.ok(saved);
    assert.strictEqual(saved.content, content);

    // Verify remote subscriber received real-time broadcast
    broadcastPayload = await broadcastPromise;
    assert.strictEqual(broadcastPayload.id, msg.id);
    assert.strictEqual(broadcastPayload.content, content);
    assert.strictEqual(broadcastPayload.senderName, 'Aarav Host');

    clientSocket.disconnect();
  });

  it('2. Idempotency: re-sending the same clientMessageId returns existing record without creating duplicates', async () => {
    const clientMessageId = `idempotent_${Date.now()}`;
    const first = await chatService.sendMessage(meetingCode, guestUser._id.toString(), {
      content: 'Idempotency test message',
      clientMessageId,
    });

    const second = await chatService.sendMessage(meetingCode, guestUser._id.toString(), {
      content: 'Different content with same clientMessageId',
      clientMessageId,
    });

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(second.content, 'Idempotency test message');

    const count = await ChatMessage.countDocuments({
      meetingId: new mongoose.Types.ObjectId(meetingId),
      clientMessageId,
    });
    assert.strictEqual(count, 1, 'Only one DB document should exist for given clientMessageId');
  });

  it('3. Validation: rejects empty messages and messages exceeding 1000 characters', async () => {
    await assert.rejects(
      () =>
        chatService.sendMessage(meetingCode, hostUser._id.toString(), {
          content: '   ',
        }),
      (err: any) => err?.statusCode === 400 && err?.code === 'EMPTY_MESSAGE'
    );

    const oversized = 'a'.repeat(1001);
    await assert.rejects(
      () =>
        chatService.sendMessage(meetingCode, hostUser._id.toString(), {
          content: oversized,
        }),
      (err: any) => err?.statusCode === 400 && err?.code === 'MESSAGE_TOO_LONG'
    );
  });

  it('4. Authorization: WAITING participant cannot send chat messages', async () => {
    await assert.rejects(
      () =>
        chatService.sendMessage(meetingCode, waitingUser._id.toString(), {
          content: 'I am waiting in lobby, can I chat?',
        }),
      (err: any) => err?.statusCode === 403 && err?.code === 'CHAT_ACCESS_DENIED'
    );
  });

  it('5. Authorization: Non-participant (outsider) cannot send or read chat messages', async () => {
    await assert.rejects(
      () =>
        chatService.sendMessage(meetingCode, outsiderUser._id.toString(), {
          content: 'I am not even in this meeting',
        }),
      (err: any) => err?.statusCode === 403 && err?.code === 'CHAT_ACCESS_DENIED'
    );

    await assert.rejects(
      () =>
        chatService.getChatHistory(meetingCode, outsiderUser._id.toString(), {
          limit: 10,
        }),
      (err: any) => err?.statusCode === 403 && err?.code === 'CHAT_ACCESS_DENIED'
    );
  });

  it('6. Meeting Lifecycle: cannot send message to an ENDED meeting', async () => {
    // Create and end a temporary meeting
    const m = await meetingService.createMeeting(hostUser._id.toString(), {
      title: 'Ended Meeting Test',
      maxParticipants: 4,
    });
    createdMeetingIds.push(new mongoose.Types.ObjectId(m.meeting.id));
    await meetingService.endMeeting(m.meeting.meetingCode, hostUser._id.toString());

    await assert.rejects(
      () =>
        chatService.sendMessage(m.meeting.meetingCode, hostUser._id.toString(), {
          content: 'Trying to chat in ended meeting',
        }),
      (err: any) => err?.statusCode === 410 && err?.code === 'MEETING_ENDED'
    );
  });

  it('7. Rate Limiting: rapidly sending >10 messages within 5 seconds triggers HTTP 429', async () => {
    // Send 10 messages successfully
    for (let i = 0; i < 10; i += 1) {
      await chatService.sendMessage(meetingCode, guestUser._id.toString(), {
        content: `Rapid message #${i + 1}`,
      });
    }

    // 11th message should be rejected with 429 RATE_LIMIT_EXCEEDED
    await assert.rejects(
      () =>
        chatService.sendMessage(meetingCode, guestUser._id.toString(), {
          content: 'Excess message triggering rate limit',
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );
  });

  it('8. Chat History: returns messages in chronological order with pagination', async () => {
    // Add distinct sequential messages
    for (let i = 1; i <= 5; i += 1) {
      await chatService.sendMessage(meetingCode, hostUser._id.toString(), {
        content: `History sequence message ${i}`,
      });
    }

    const history = await chatService.getChatHistory(meetingCode, guestUser._id.toString(), {
      limit: 3,
    });

    assert.strictEqual(history.messages.length, 3);
    assert.strictEqual(history.hasMore, true);
    // Chronological order: older before newer
    const t0 = new Date(history.messages[0].createdAt).getTime();
    const t1 = new Date(history.messages[1].createdAt).getTime();
    assert.ok(t0 <= t1, 'Chat history must be ordered chronologically ascending');
  });

  it('9. Real-Time Reactions: admitted participant sends emoji reaction and it broadcasts cleanly', async () => {
    const clientSocket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: guestToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => clientSocket.on('connect', resolve));
    await new Promise<void>((resolve, reject) => {
      clientSocket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
        if (!res?.ok) {
          reject(new Error(`Test 9 subscribe failed: ${JSON.stringify(res)}`));
          return;
        }
        resolve();
      });
    });

    const reactionPromise = new Promise<any>((resolve) => {
      clientSocket.on('reaction:received', (rx) => resolve(rx));
    });

    const reaction = await chatService.sendReaction(meetingCode, hostUser._id.toString(), {
      emoji: '🔥',
      clientReactionId: 'rx-test-9-sample',
    });

    assert.ok(reaction.id);
    assert.strictEqual(reaction.emoji, '🔥');
    assert.strictEqual(reaction.senderName, 'Aarav Host');

    const received = await reactionPromise;
    assert.strictEqual(received.emoji, '🔥');
    assert.strictEqual(received.senderId, hostUser._id.toString());

    clientSocket.disconnect();
  });

  it('10. Reactions: invalid emoji rejected and reaction spam rate limit enforced', async () => {
    await assert.rejects(
      () =>
        chatService.sendReaction(meetingCode, hostUser._id.toString(), {
          emoji: 'not_an_emoji',
          clientReactionId: 'rx-test-invalid',
        }),
      (err: any) => err?.statusCode === 400 && err?.code === 'INVALID_EMOJI'
    );

    // Send 5 reactions
    for (let i = 0; i < 5; i += 1) {
      await chatService.sendReaction(meetingCode, guestUser._id.toString(), {
        emoji: '👍',
        clientReactionId: `rx-test-10-${i}`,
      });
    }

    // 6th reaction within 3s window triggers 429
    await assert.rejects(
      () =>
        chatService.sendReaction(meetingCode, guestUser._id.toString(), {
          emoji: '👍',
          clientReactionId: 'rx-test-10-6th',
        }),
      (err: any) => err?.statusCode === 429 && err?.code === 'RATE_LIMIT_EXCEEDED'
    );
  });

  it('11. Socket.IO chat:send and reaction:send round-trip through socket acknowledgments', async () => {
    try {
      const socket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        auth: { token: hostToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => socket.on('connect', resolve));
      await new Promise<void>((resolve, reject) => {
        socket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
          if (!res?.ok) {
            console.error('TEST 11 SUBSCRIBE ERROR:', res);
            reject(new Error(`Test 11 subscribe failed: ${JSON.stringify(res)}`));
            return;
          }
          resolve();
        });
      });

      // Send chat via socket event
      const chatAck = await new Promise<any>((resolve) => {
        socket.emit(
          'chat:send',
          {
            meetingCode,
            content: 'Socket roundtrip chat message',
            clientMessageId: `sock_${Date.now()}`,
          },
          resolve
        );
      });

      assert.strictEqual(chatAck.ok, true);
      assert.strictEqual(chatAck.message?.content, 'Socket roundtrip chat message');

      // Send reaction via socket event
      const rxAck = await new Promise<any>((resolve) => {
        socket.emit(
          'reaction:send',
          { meetingCode, emoji: '🎉', clientReactionId: `rx_sock_${Date.now()}` },
          resolve
        );
      });

      assert.strictEqual(rxAck.ok, true);
      assert.strictEqual(rxAck.reaction?.emoji, '🎉');

      socket.disconnect();
    } finally {
      // test cleanup
    }
  });
});
