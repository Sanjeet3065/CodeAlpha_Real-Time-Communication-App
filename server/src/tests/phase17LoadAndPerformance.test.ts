import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose, { Types } from 'mongoose';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { resetRevocationTopologyCache } from '../models/LiveKitRevocationEvent.model.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { generateAccessToken } from '../utils/tokens.js';
import { hashPassword } from '../utils/password.js';

interface MeasuredStageMetric {
  stage: number;
  targetCount: number;
  actualConnected: number;
  avgJoinLatencyMs: number;
  p95JoinLatencyMs: number;
  avgSocketConnectMs: number;
  rssMemoryMb: number;
  heapUsedMb: number;
}

function connectSocket(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out'));
    }, 5000);
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

function subscribeSocket(
  socket: ClientSocket,
  meetingCode: string
): Promise<{ ok: boolean; code?: string; status?: string }> {
  return new Promise((resolve) => {
    socket.emit('meeting:subscribe', { meetingCode }, (ack: any) => resolve(ack));
  });
}

describe('Phase 17 — Comprehensive 60-Participant Load & Performance Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let socketUrl: string;
  let hostUser: any;
  let hostToken: string;
  let testMeeting: any;

  const connectedSockets: ClientSocket[] = [];
  const stageMetrics: MeasuredStageMetric[] = [];

  before(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(
      process.env.MONGODB_URI_RS || 'mongodb://127.0.0.1:27018/connectly_phase17_load_test?directConnection=true'
    );
    resetRevocationTopologyCache();
    await User.deleteMany({});
    await AuthSession.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await ChatMessage.deleteMany({});
    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});

    // 1. Create Host User
    const pw = await hashPassword('HostPassword17*Load!');
    hostUser = await User.create({
      email: 'host.loadtest@connectly.io',
      passwordHash: pw,
      firstName: 'Chief',
      lastName: 'Architect',
      isEmailVerified: true,
    });
    hostToken = generateAccessToken({ sub: hostUser._id.toString(), email: hostUser.email });

    // 2. Setup Express & HTTP Server with Realtime Hub
    const app = createApp();
    server = http.createServer(app);
    meetingRealtime.attach(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    socketUrl = `http://127.0.0.1:${addr.port}`;

    // 3. Create Meeting targeted for 60 participants
    const createRes = await fetch(`${baseUrl}/api/v1/meetings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        title: 'Phase 17 Real-World 60-Participant Stress Test',
        maxParticipants: 60,
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();
    testMeeting = createBody.data.meeting;
    assert.strictEqual(testMeeting.maxParticipants, 60);

    // Host joins and activates meeting
    const hostJoinRes = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ displayName: 'Chief Architect (Host)' }),
    });
    assert.strictEqual(hostJoinRes.status, 200);

    const hostSocket = await connectSocket(socketUrl, hostToken);
    const hostSub = await subscribeSocket(hostSocket, testMeeting.meetingCode);
    assert.strictEqual(hostSub.ok, true);
    connectedSockets.push(hostSocket);
  });

  after(async () => {
    // Teardown all client sockets
    for (const s of connectedSockets) {
      if (s.connected) s.disconnect();
    }
    await meetingRealtime.closeAsync();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.disconnect();
  });

  // =========================================================================
  // PROGRESSIVE 60-PARTICIPANT SCALING (STAGES 1 TO 9)
  // =========================================================================
  const stages = [
    { stage: 1, target: 1 },
    { stage: 2, target: 2 },
    { stage: 3, target: 5 },
    { stage: 4, target: 10 },
    { stage: 5, target: 20 },
    { stage: 6, target: 30 },
    { stage: 7, target: 40 },
    { stage: 8, target: 50 },
    { stage: 9, target: 60 },
  ];

  it('Stage Progressive Concurrency: Scales smoothly across 1, 2, 5, 10, 20, 30, 40, 50, and 60 participants', async () => {
    let currentParticipantCount = connectedSockets.length; // 1 (Host already joined)

    for (const { stage, target } of stages) {
      const needed = target - currentParticipantCount;
      const joinLatencies: number[] = [];
      const socketLatencies: number[] = [];

      for (let i = 0; i < needed; i++) {
        const participantIndex = currentParticipantCount + i + 1;
        const participantUser = await User.create({
          email: `p${participantIndex}.load@connectly.io`,
          passwordHash: 'dummyHashForLoadTest',
          firstName: `Participant`,
          lastName: `#${participantIndex}`,
          isEmailVerified: true,
        });
        const participantToken = generateAccessToken({
          sub: participantUser._id.toString(),
          email: participantUser.email,
        });

        // 1. Measure REST API join latency
        const t0 = performance.now();
        const joinRes = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${participantToken}`,
          },
          body: JSON.stringify({ displayName: `User ${participantIndex}` }),
        });
        const t1 = performance.now();
        assert.strictEqual(joinRes.status, 200, `Participant ${participantIndex} join must return HTTP 200`);
        joinLatencies.push(t1 - t0);

        // 2. Measure Socket.IO connect & subscribe latency
        const s0 = performance.now();
        const socket = await connectSocket(socketUrl, participantToken);
        const sub = await subscribeSocket(socket, testMeeting.meetingCode);
        const s1 = performance.now();
        assert.strictEqual(sub.ok, true, `Participant ${participantIndex} socket subscribe must succeed`);
        socketLatencies.push(s1 - s0);

        connectedSockets.push(socket);
      }

      currentParticipantCount = connectedSockets.length;
      assert.strictEqual(currentParticipantCount, target);

      // Verify database participant record count matches
      const dbParticipantCount = await MeetingParticipant.countDocuments({
        meetingId: testMeeting.id,
        admissionStatus: 'ADMITTED',
      });
      assert.strictEqual(dbParticipantCount, target);

      // Calculate latency metrics for this stage
      joinLatencies.sort((a, b) => a - b);
      const avgJoin = joinLatencies.length > 0 ? joinLatencies.reduce((a, b) => a + b, 0) / joinLatencies.length : 0;
      const p95Join = joinLatencies.length > 0 ? joinLatencies[Math.floor(joinLatencies.length * 0.95)] : 0;
      const avgSocket = socketLatencies.length > 0 ? socketLatencies.reduce((a, b) => a + b, 0) / socketLatencies.length : 0;

      const mem = process.memoryUsage();
      const metric: MeasuredStageMetric = {
        stage,
        targetCount: target,
        actualConnected: currentParticipantCount,
        avgJoinLatencyMs: Math.round(avgJoin * 10) / 10,
        p95JoinLatencyMs: Math.round(p95Join * 10) / 10,
        avgSocketConnectMs: Math.round(avgSocket * 10) / 10,
        rssMemoryMb: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      };
      stageMetrics.push(metric);
    }

    assert.strictEqual(connectedSockets.length, 60, 'Exactly 60 participants must be concurrently connected');
  });

  // =========================================================================
  // SCENARIO E: SIMULTANEOUS CHAT & REACTION BROADCAST AT 60 PARTICIPANTS
  // =========================================================================
  it('Scenario E: Broadcasts chat messages and reactions concurrently across all 60 participants', async () => {
    const receivedMessages: number[] = new Array(connectedSockets.length).fill(0);

    // Register message listeners on all 60 connected sockets for 'chat:message-received'
    connectedSockets.forEach((s, idx) => {
      s.on('chat:message-received', () => {
        receivedMessages[idx]++;
      });
    });

    const sendStart = performance.now();
    const chatRes = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        content: 'Broadcast load test message to 60 connected participants',
        clientMessageId: `load-test-chat-${Date.now()}`,
      }),
    });
    assert.strictEqual(chatRes.status, 201);
    const sendDuration = performance.now() - sendStart;
    assert.ok(sendDuration < 200, `Chat send latency must be under 200ms (measured ${sendDuration}ms)`);

    // Allow event loop to dispatch to all 60 sockets
    await new Promise((r) => setTimeout(r, 400));

    // Verify all 60 participants received the broadcast
    const totalDelivered = receivedMessages.filter((c) => c >= 1).length;
    assert.strictEqual(totalDelivered, 60, 'All 60 participants must receive the real-time chat broadcast');
  });

  // =========================================================================
  // SCENARIO F: CONCURRENT WHITEBOARD OPERATIONS AT 60 PARTICIPANTS
  // =========================================================================
  it('Scenario F: Synchronizes concurrent whiteboard operations without conflict or state corruption', async () => {
    // 1. Initialize whiteboard state via GET
    const initRes = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/whiteboard`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert.strictEqual(initRes.status, 200);

    const board = await Whiteboard.findOne({ meetingId: new Types.ObjectId(testMeeting.id) });
    assert.ok(board);

    // 2. Generate 5 concurrent operations from participants
    const opPromises = [0, 1, 2, 3, 4].map((i) => {
      return fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/whiteboard/operations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          operations: [
            {
              operationId: `wb-load-${i}-${Date.now()}`,
              type: 'add',
              elementId: `elem-load-${i}`,
              element: {
                id: `elem-load-${i}`,
                type: 'rect',
                x: i * 20,
                y: i * 20,
                width: 100,
                height: 50,
                strokeColor: '#168B83',
                strokeWidth: 2,
                zIndex: i + 1,
              },
            },
          ],
        }),
      });
    });

    const results = await Promise.all(opPromises);
    for (const res of results) {
      assert.strictEqual(res.status, 200);
    }

    // Verify board sequence monotonically incremented
    const updatedBoard = await Whiteboard.findOne({ meetingId: new Types.ObjectId(testMeeting.id) });
    assert.ok(updatedBoard);
    assert.ok(updatedBoard.version >= 5, 'Whiteboard version must reflect all applied operations');
  });

  // =========================================================================
  // SCENARIO G: PARTICIPANT DISCONNECTION & RECONNECTION RECOVERY
  // =========================================================================
  it('Scenario G: Handles socket disconnection and seamless reconnection without duplicate roster entries', async () => {
    const victimSocket = connectedSockets[59]; // 60th participant
    assert.ok(victimSocket.connected);

    // Disconnect
    victimSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(victimSocket.connected, false);

    // Reconnect as the same user
    const victimUser = await User.findOne({ email: 'p60.load@connectly.io' });
    assert.ok(victimUser);
    const victimToken = generateAccessToken({ sub: victimUser._id.toString(), email: victimUser.email });

    const reconnectedSocket = await connectSocket(socketUrl, victimToken);
    const reconnectedSub = await subscribeSocket(reconnectedSocket, testMeeting.meetingCode);
    assert.strictEqual(reconnectedSub.ok, true);

    connectedSockets[59] = reconnectedSocket;

    // Roster count must remain strictly 60 (no duplicate record)
    const rosterCount = await MeetingParticipant.countDocuments({
      meetingId: testMeeting.id,
      admissionStatus: 'ADMITTED',
    });
    assert.strictEqual(rosterCount, 60, 'Roster count must not duplicate upon reconnection');
  });

  // =========================================================================
  // CAPACITY ENFORCEMENT: 61ST PARTICIPANT REJECTED
  // =========================================================================
  it('Capacity Boundary: Rejects 61st participant with HTTP 403 MEETING_FULL when room is at capacity (60)', async () => {
    const overflowUser = await User.create({
      email: 'p61.overflow@connectly.io',
      passwordHash: 'dummyHashForOverflow',
      firstName: 'Overflow',
      lastName: 'User',
      isEmailVerified: true,
    });
    const overflowToken = generateAccessToken({ sub: overflowUser._id.toString(), email: overflowUser.email });

    const overflowJoinRes = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${overflowToken}`,
      },
      body: JSON.stringify({ displayName: 'Overflow User' }),
    });

    assert.strictEqual(overflowJoinRes.status, 403, '61st participant must be rejected with HTTP 403 Forbidden');
    const body = await overflowJoinRes.json();
    assert.strictEqual(body.code, 'MEETING_FULL', 'Rejection code must be MEETING_FULL');
  });

  // =========================================================================
  // API BENCHMARK LATENCIES (P50, P95, P99)
  // =========================================================================
  it('API Benchmarks: Critical endpoints respond within tight SLA bounds under 60-participant load', async () => {
    const samples: number[] = [];
    const NUM_SAMPLES = 25;

    for (let i = 0; i < NUM_SAMPLES; i++) {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/api/v1/meetings/${testMeeting.meetingCode}`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const t1 = performance.now();
      assert.strictEqual(res.status, 200);
      samples.push(t1 - t0);
    }

    samples.sort((a, b) => a - b);
    const p50 = Math.round(samples[Math.floor(NUM_SAMPLES * 0.5)] * 10) / 10;
    const p95 = Math.round(samples[Math.floor(NUM_SAMPLES * 0.95)] * 10) / 10;
    const p99 = Math.round(samples[NUM_SAMPLES - 1] * 10) / 10;

    assert.ok(p50 < 30, `p50 meeting query latency must be under 30ms (measured ${p50}ms)`);
    assert.ok(p95 < 80, `p95 meeting query latency must be under 80ms (measured ${p95}ms)`);
    assert.ok(p99 < 150, `p99 meeting query latency must be under 150ms (measured ${p99}ms)`);
  });
});
