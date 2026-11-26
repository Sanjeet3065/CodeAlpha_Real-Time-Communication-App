/**
 * CONNECTLY — Phase 14 Collaborative Whiteboard Integration & Reliability Test Suite
 * Covers Mongoose models, service operations (add, update, delete, undo, redo, clear),
 * role-based permissions (admitted vs waiting vs outsider, host/co-host clear),
 * distributed rate limits, idempotency, per-user undo/redo isolation,
 * real-time Socket.IO event broadcasts, and LiveKit data-channel invariant.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { io as ClientSocket } from 'socket.io-client';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { resetRevocationTopologyCache } from '../models/LiveKitRevocationEvent.model.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { chatRedisService } from '../services/chatRedis.service.js';
import { whiteboardService } from '../services/whiteboard.service.js';
import { meetingService } from '../services/meeting.service.js';
import { LiveKitService } from '../services/livekit.service.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';
import { ForbiddenError, TooManyRequestsError } from '../utils/errors.js';

describe('Phase 14 Collaborative Whiteboard Test Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let hostUser: any;
  let guestUser: any;
  let coHostUser: any;
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
        process.env.MONGODB_URI_RS || 'mongodb://127.0.0.1:27018/connectly_test_phase14_whiteboard?directConnection=true';
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(mongoUri);
      resetRevocationTopologyCache();

      const passwordHash = await hashPassword('Phase14WhiteboardPass!2026');
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      hostUser = await User.create({
        email: `p14_host_${suffix}@example.com`,
        passwordHash,
        firstName: 'Elena',
        lastName: 'Host',
        isEmailVerified: true,
      });
      hostToken = generateAccessToken({
        sub: hostUser._id.toString(),
        email: hostUser.email,
        firstName: hostUser.firstName,
        lastName: hostUser.lastName,
      });

      guestUser = await User.create({
        email: `p14_guest_${suffix}@example.com`,
        passwordHash,
        firstName: 'Marcus',
        lastName: 'Guest',
        isEmailVerified: true,
      });
      guestToken = generateAccessToken({
        sub: guestUser._id.toString(),
        email: guestUser.email,
        firstName: guestUser.firstName,
        lastName: guestUser.lastName,
      });

      coHostUser = await User.create({
        email: `p14_cohost_${suffix}@example.com`,
        passwordHash,
        firstName: 'Sophia',
        lastName: 'CoHost',
        isEmailVerified: true,
      });
      generateAccessToken({
        sub: coHostUser._id.toString(),
        email: coHostUser.email,
        firstName: coHostUser.firstName,
        lastName: coHostUser.lastName,
      });

      waitingUser = await User.create({
        email: `p14_waiting_${suffix}@example.com`,
        passwordHash,
        firstName: 'Devon',
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
        email: `p14_outsider_${suffix}@example.com`,
        passwordHash,
        firstName: 'Kavita',
        lastName: 'Outsider',
        isEmailVerified: true,
      });

      // Create test meeting
      const meetRes = await meetingService.createMeeting(hostUser._id.toString(), {
        title: 'Phase 14 Collaborative Whiteboard Meeting',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      meetingCode = meetRes.meeting.meetingCode;
      meetingId = meetRes.meeting.id;
      createdMeetingIds.push(new mongoose.Types.ObjectId(meetRes.meeting.id));

      // Host joins as participant
      await meetingService.joinMeeting(meetingCode, hostUser._id.toString(), {
        displayName: 'Elena Host',
      });

      // Guest joins and is admitted
      await meetingService.joinMeeting(meetingCode, guestUser._id.toString(), {
        displayName: 'Marcus Guest',
      });
      await meetingService.admitParticipant(meetingCode, hostUser._id.toString(), guestUser._id.toString());

      // Co-host joins, is admitted, and promoted to co-host
      await meetingService.joinMeeting(meetingCode, coHostUser._id.toString(), {
        displayName: 'Sophia CoHost',
      });
      await meetingService.admitParticipant(meetingCode, hostUser._id.toString(), coHostUser._id.toString());
      await meetingService.updateParticipantRole(
        meetingCode,
        hostUser._id.toString(),
        coHostUser._id.toString(),
        { role: 'co-host' }
      );

      // Waiting user joins and remains waiting
      await meetingService.joinMeeting(meetingCode, waitingUser._id.toString(), {
        displayName: 'Devon Waiting',
      });

      // Start test HTTP server with attached Socket.IO hub
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
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await chatRedisService.close();

    if (createdMeetingIds.length > 0) {
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await Whiteboard.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await WhiteboardOperation.deleteMany({ meetingId: { $in: createdMeetingIds } });
    }
    await User.deleteMany({
      _id: { $in: [hostUser._id, guestUser._id, coHostUser._id, waitingUser._id, outsiderUser._id] },
    });
    await mongoose.disconnect();
  });

  beforeEach(() => {
    whiteboardService.clearRateLimits();
  });

  it('1. Initial whiteboard state fetch creates board v1 and returns empty active elements', async () => {
    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    assert.ok(state);
    assert.strictEqual(state.version, 1);
    assert.strictEqual(Array.isArray(state.elements), true);
    assert.strictEqual(state.elements.length, 0);

    const doc = await Whiteboard.findOne({ meetingId: new mongoose.Types.ObjectId(meetingId) });
    assert.ok(doc);
    assert.strictEqual(doc.version, 1);
  });

  it('2. Waiting room user is forbidden from accessing whiteboard state', async () => {
    await assert.rejects(
      async () => {
        await whiteboardService.getWhiteboardState(meetingCode, waitingUser._id.toString());
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /Waiting room participants/i);
        return true;
      }
    );
  });

  it('3. Outsider (not joined to meeting) is forbidden from accessing whiteboard state', async () => {
    await assert.rejects(
      async () => {
        await whiteboardService.getWhiteboardState(meetingCode, outsiderUser._id.toString());
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /not a participant/i);
        return true;
      }
    );
  });

  it('4. Admitted participant can add pen strokes with bounded coordinates', async () => {
    const opId = `op_pen_${Date.now()}`;
    const elementId = `el_pen_${Date.now()}`;

    const res = await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: opId,
        type: 'add',
        elementId,
        element: {
          id: elementId,
          type: 'pen',
          points: [
            { x: 10, y: 15 },
            { x: 25, y: 30 },
            { x: 50, y: 45 },
          ],
          x: 10,
          y: 15,
          strokeColor: '#168B83',
          strokeWidth: 4,
          opacity: 1,
          zIndex: 1,
        },
      },
    ]);

    assert.ok(res.success);
    assert.strictEqual(res.version, 2);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    assert.strictEqual(state.version, 2);
    assert.strictEqual(state.elements.length, 1);
    assert.strictEqual(state.elements[0].id, elementId);
    assert.strictEqual(state.elements[0].type, 'pen');
    assert.strictEqual(state.elements[0].points?.length, 3);
    assert.strictEqual(state.elements[0].createdBy, guestUser._id.toString());
  });

  it('5. Admitted participant can add geometric shapes (rect, circle, line, arrow)', async () => {
    const rectId = `el_rect_${Date.now()}`;
    const circleId = `el_circle_${Date.now()}`;
    const lineId = `el_line_${Date.now()}`;
    const arrowId = `el_arrow_${Date.now()}`;

    const res = await whiteboardService.applyOperations(meetingCode, hostUser._id.toString(), [
      {
        operationId: `op_r_${Date.now()}`,
        type: 'add',
        elementId: rectId,
        element: {
          id: rectId,
          type: 'rect',
          x: 100,
          y: 100,
          width: 200,
          height: 150,
          strokeColor: '#EF4444',
          fillColor: '#FFFFFF',
          strokeWidth: 2,
          zIndex: 2,
        },
      },
      {
        operationId: `op_c_${Date.now()}`,
        type: 'add',
        elementId: circleId,
        element: {
          id: circleId,
          type: 'circle',
          x: 350,
          y: 100,
          width: 120,
          height: 120,
          strokeColor: '#3B82F6',
          strokeWidth: 3,
          zIndex: 3,
        },
      },
      {
        operationId: `op_l_${Date.now()}`,
        type: 'add',
        elementId: lineId,
        element: {
          id: lineId,
          type: 'line',
          x: 50,
          y: 300,
          x2: 250,
          y2: 300,
          strokeColor: '#10B981',
          strokeWidth: 4,
          zIndex: 4,
        },
      },
      {
        operationId: `op_a_${Date.now()}`,
        type: 'add',
        elementId: arrowId,
        element: {
          id: arrowId,
          type: 'arrow',
          x: 100,
          y: 400,
          x2: 300,
          y2: 450,
          strokeColor: '#F59E0B',
          strokeWidth: 3,
          zIndex: 5,
        },
      },
    ]);

    assert.ok(res.success);

    const state = await whiteboardService.getWhiteboardState(meetingCode, guestUser._id.toString());
    const ids = state.elements.map((e) => e.id);
    assert.ok(ids.includes(rectId));
    assert.ok(ids.includes(circleId));
    assert.ok(ids.includes(lineId));
    assert.ok(ids.includes(arrowId));
  });

  it('6. Admitted participant can add and edit text elements with font bounds', async () => {
    const textId = `el_text_${Date.now()}`;

    // Add text element
    await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: `op_text_add_${Date.now()}`,
        type: 'add',
        elementId: textId,
        element: {
          id: textId,
          type: 'text',
          text: 'Sprint Planning Notes',
          fontSize: 24,
          x: 200,
          y: 200,
          strokeColor: '#FFFFFF',
          strokeWidth: 1,
          zIndex: 6,
        },
      },
    ]);

    // Update text content
    await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: `op_text_upd_${Date.now()}`,
        type: 'update',
        elementId: textId,
        element: {
          text: 'Sprint Planning Notes (Updated by Marcus)',
          x: 220,
          y: 210,
        },
      },
    ]);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    const textEl = state.elements.find((e) => e.id === textId);
    assert.ok(textEl);
    assert.strictEqual(textEl.text, 'Sprint Planning Notes (Updated by Marcus)');
    assert.strictEqual(textEl.x, 220);
    assert.strictEqual(textEl.y, 210);
  });

  it('7. Eraser deletes element (marks deleted and excludes from active state)', async () => {
    const tempId = `el_temp_${Date.now()}`;

    // Add element
    await whiteboardService.applyOperations(meetingCode, hostUser._id.toString(), [
      {
        operationId: `op_add_temp_${Date.now()}`,
        type: 'add',
        elementId: tempId,
        element: {
          id: tempId,
          type: 'line',
          x: 0,
          y: 0,
          x2: 100,
          y2: 100,
          strokeColor: '#FFFFFF',
          strokeWidth: 2,
          zIndex: 7,
        },
      },
    ]);

    // Erase element
    await whiteboardService.applyOperations(meetingCode, hostUser._id.toString(), [
      {
        operationId: `op_del_temp_${Date.now()}`,
        type: 'delete',
        elementId: tempId,
      },
    ]);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    const found = state.elements.find((e) => e.id === tempId);
    assert.strictEqual(found, undefined);
  });

  it('8. Operation idempotency: re-submitting same operationId does not alter state or increment version', async () => {
    const idempotentOpId = `op_idempotent_${Date.now()}`;
    const elementId = `el_idem_${Date.now()}`;

    const res1 = await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: idempotentOpId,
        type: 'add',
        elementId,
        element: {
          id: elementId,
          type: 'circle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          strokeColor: '#3B82F6',
          strokeWidth: 2,
          zIndex: 8,
        },
      },
    ]);

    const versionAfterFirst = res1.version;

    // Resend identical operation
    const res2 = await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: idempotentOpId,
        type: 'add',
        elementId,
        element: {
          id: elementId,
          type: 'circle',
          x: 50,
          y: 50,
          width: 80,
          height: 80,
          strokeColor: '#3B82F6',
          strokeWidth: 2,
          zIndex: 8,
        },
      },
    ]);

    assert.strictEqual(res2.version, versionAfterFirst);
  });

  it('9. Per-User Undo Isolation: User A undo does not undo User B operations', async () => {
    const userAElId = `el_userA_${Date.now()}`;
    const userBElId = `el_userB_${Date.now()}`;

    // Host (User A) adds element
    await whiteboardService.applyOperations(meetingCode, hostUser._id.toString(), [
      {
        operationId: `op_userA_${Date.now()}`,
        type: 'add',
        elementId: userAElId,
        element: {
          id: userAElId,
          type: 'rect',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          strokeColor: '#FFFFFF',
          strokeWidth: 2,
          zIndex: 10,
        },
      },
    ]);

    // Guest (User B) adds element
    await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
      {
        operationId: `op_userB_${Date.now()}`,
        type: 'add',
        elementId: userBElId,
        element: {
          id: userBElId,
          type: 'circle',
          x: 200,
          y: 200,
          width: 60,
          height: 60,
          strokeColor: '#EF4444',
          strokeWidth: 2,
          zIndex: 11,
        },
      },
    ]);

    // Guest (User B) performs undo
    const undoRes = await whiteboardService.undoOperation(meetingCode, guestUser._id.toString());
    assert.strictEqual(undoRes.success, true);
    assert.strictEqual(undoRes.elementId, userBElId);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    const hasA = state.elements.some((e) => e.id === userAElId);
    const hasB = state.elements.some((e) => e.id === userBElId);

    assert.strictEqual(hasA, true, 'User A element MUST remain active');
    assert.strictEqual(hasB, false, 'User B element MUST be undone');
  });

  it('10. Per-User Redo: User restores their undone element', async () => {
    // Guest calls redo for the element undone in previous test
    const redoRes = await whiteboardService.redoOperation(meetingCode, guestUser._id.toString());
    assert.strictEqual(redoRes.success, true);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    const hasB = state.elements.some((e) => e.id === redoRes.elementId);
    assert.strictEqual(hasB, true, 'User B element MUST be restored on redo');
  });

  it('11. Regular participant cannot clear the whiteboard (403 Forbidden)', async () => {
    await assert.rejects(
      async () => {
        await whiteboardService.clearWhiteboard(meetingCode, guestUser._id.toString());
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /host or co-host/i);
        return true;
      }
    );
  });

  it('12. Co-host can clear the whiteboard, soft-deleting all active elements', async () => {
    const clearRes = await whiteboardService.clearWhiteboard(meetingCode, coHostUser._id.toString());
    assert.strictEqual(clearRes.success, true);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    assert.strictEqual(state.elements.length, 0, 'All active elements must be cleared');
    assert.strictEqual(state.version, clearRes.version);
  });

  it('13. Host can clear the whiteboard', async () => {
    // Host adds a new element
    const newElId = `el_new_${Date.now()}`;
    await whiteboardService.applyOperations(meetingCode, hostUser._id.toString(), [
      {
        operationId: `op_host_el_${Date.now()}`,
        type: 'add',
        elementId: newElId,
        element: {
          id: newElId,
          type: 'line',
          x: 0,
          y: 0,
          x2: 50,
          y2: 50,
          strokeColor: '#FFFFFF',
          strokeWidth: 2,
          zIndex: 1,
        },
      },
    ]);

    // Host clears board
    const clearRes = await whiteboardService.clearWhiteboard(meetingCode, hostUser._id.toString());
    assert.strictEqual(clearRes.success, true);

    const state = await whiteboardService.getWhiteboardState(meetingCode, hostUser._id.toString());
    assert.strictEqual(state.elements.length, 0);
  });

  it('14. Distributed Rate Limiting & Batch Bounds: operations exceeding limit are rejected', async () => {
    // 1. Batch size exceeding max 50 operations is rejected by schema
    const oversizedBatch = Array.from({ length: 55 }, (_, i) => ({
      operationId: `op_over_${Date.now()}_${i}`,
      type: 'add' as const,
      elementId: `el_over_${Date.now()}_${i}`,
      element: {
        id: `el_over_${Date.now()}_${i}`,
        type: 'pen' as const,
        x: i,
        y: i,
        strokeColor: '#168B83',
        strokeWidth: 2,
        zIndex: i,
      },
    }));

    await assert.rejects(
      async () => {
        await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), oversizedBatch);
      },
      (err: any) => {
        assert.ok(err.name === 'ZodError' || err.statusCode === 400);
        return true;
      }
    );

    // 2. Rapid operations exceeding 120 calls per 10s window are rejected with TooManyRequestsError
    let rateLimited = false;
    for (let i = 0; i < 125; i++) {
      try {
        await whiteboardService.applyOperations(meetingCode, guestUser._id.toString(), [
          {
            operationId: `op_rl_${Date.now()}_${i}`,
            type: 'add',
            elementId: `el_rl_${Date.now()}_${i}`,
            element: {
              id: `el_rl_${Date.now()}_${i}`,
              type: 'pen',
              points: [{ x: 1, y: 1 }],
              x: 1,
              y: 1,
              strokeColor: '#168B83',
              strokeWidth: 2,
              zIndex: 1,
            },
          },
        ]);
      } catch (err: any) {
        if (err instanceof TooManyRequestsError) {
          rateLimited = true;
          break;
        }
      }
    }
    assert.strictEqual(rateLimited, true, 'Operations exceeding rate limit must throw TooManyRequestsError');
  });

  it('15. Real-Time Socket.IO collaboration: whiteboard:draw event broadcasts to admitted participants', async () => {
    const socketA = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    const socketB = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: guestToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => socketA.on('connect', res)),
      new Promise<void>((res) => socketB.on('connect', res)),
    ]);

    // Subscribe both to meeting
    await new Promise<void>((res) => {
      socketA.emit('meeting:subscribe', { meetingCode }, () => res());
    });
    await new Promise<void>((res) => {
      socketB.emit('meeting:subscribe', { meetingCode }, () => res());
    });

    const drawElId = `el_socket_${Date.now()}`;
    const receivedPromise = new Promise<any>((resolve) => {
      socketB.on('whiteboard:operation', (payload: any) => {
        resolve(payload);
      });
    });

    // Socket A emits whiteboard:draw
    await new Promise<void>((resolve, reject) => {
      socketA.emit(
        'whiteboard:draw',
        {
          meetingCode,
          operations: [
            {
              operationId: `op_sock_${Date.now()}`,
              type: 'add',
              elementId: drawElId,
              element: {
                id: drawElId,
                type: 'rect',
                x: 80,
                y: 80,
                width: 100,
                height: 100,
                strokeColor: '#7CE5DB',
                strokeWidth: 2,
                zIndex: 1,
              },
            },
          ],
        },
        (ack: any) => {
          if (ack?.ok) resolve();
          else reject(new Error(ack?.error || 'Draw ack failed'));
        }
      );
    });

    const broadcast = await receivedPromise;
    assert.ok(broadcast);
    assert.strictEqual(broadcast.operations?.length, 1);
    assert.strictEqual(broadcast.operations[0].elementId, drawElId);

    socketA.disconnect();
    socketB.disconnect();
  });

  it('16. Real-Time Ephemeral Cursors: whiteboard:cursor broadcasts to peers excluding sender', async () => {
    const socketA = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    const socketB = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: guestToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => socketA.on('connect', res)),
      new Promise<void>((res) => socketB.on('connect', res)),
    ]);

    await new Promise<void>((res) => {
      socketA.emit('meeting:subscribe', { meetingCode }, () => res());
    });
    await new Promise<void>((res) => {
      socketB.emit('meeting:subscribe', { meetingCode }, () => res());
    });

    let senderReceivedSelfCursor = false;
    socketA.on('whiteboard:cursor', () => {
      senderReceivedSelfCursor = true;
    });

    const cursorPromise = new Promise<any>((resolve) => {
      socketB.on('whiteboard:cursor', (cursor: any) => {
        resolve(cursor);
      });
    });

    // Sender emits cursor
    socketA.emit('whiteboard:cursor', {
      meetingCode,
      x: 320,
      y: 240,
      tool: 'pen',
      color: '#168B83',
    });

    const receivedCursor = await cursorPromise;
    assert.ok(receivedCursor);
    assert.strictEqual(receivedCursor.userId, hostUser._id.toString());
    assert.strictEqual(receivedCursor.x, 320);
    assert.strictEqual(receivedCursor.y, 240);
    assert.strictEqual(senderReceivedSelfCursor, false, 'Sender MUST NOT receive their own cursor broadcast');

    socketA.disconnect();
    socketB.disconnect();
  });

  it('17. LiveKit Invariant: canPublishData is strictly FALSE across all participant roles', async () => {
    const testLiveKit = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: 'test-api-key-32-chars-long-minimum-!',
        apiSecret: 'test-api-secret-32-chars-long-minimum!',
        tokenTtlSeconds: 600,
      },
      nodeEnv: 'development',
      roomClientFactory: () => ({
        createRoom: async () => ({}),
        removeParticipant: async () => ({}),
        deleteRoom: async () => ({}),
      }),
    });

    // Verify Host token grant
    const hostGrant = await testLiveKit.generateParticipantToken({
      meetingId,
      userId: hostUser._id.toString(),
      displayName: 'Elena Host',
      role: 'host',
      maxParticipants: 10,
      provisionRoom: false,
    });
    assert.ok(hostGrant.token);

    // Verify Guest token grant
    const guestGrant = await testLiveKit.generateParticipantToken({
      meetingId,
      userId: guestUser._id.toString(),
      displayName: 'Marcus Guest',
      role: 'participant',
      maxParticipants: 10,
      provisionRoom: false,
    });
    assert.ok(guestGrant.token);

    // Inspect decoded claims or token grants
    const parseTokenClaims = (jwt: string) => {
      const parts = jwt.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    };

    const hostClaims = parseTokenClaims(hostGrant.token);
    const guestClaims = parseTokenClaims(guestGrant.token);

    assert.strictEqual(
      hostClaims.video?.canPublishData,
      false,
      'Host token MUST enforce canPublishData: false'
    );
    assert.strictEqual(
      guestClaims.video?.canPublishData,
      false,
      'Participant token MUST enforce canPublishData: false'
    );
  });
});
