import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose, { Types } from 'mongoose';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import {
  setReplicaSetTransactionsSupportedForTesting,
  resetRevocationTopologyCache,
} from '../models/LiveKitRevocationEvent.model.js';
import { Meeting } from '../models/Meeting.model.js';
import {
  MeetingParticipant,
} from '../models/MeetingParticipant.model.js';
import { User, type IUser } from '../models/User.model.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  parseLiveKitParticipantUserId,
  parseLiveKitParticipantSessionId,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { LiveKitEvictionWorker } from '../workers/livekitEvictionWorker.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { generateAccessToken } from '../utils/tokens.js';
import { createApp } from '../app.js';
import { securityAudit } from '../utils/securityAudit.js';

describe('Phase 18 Sprint 06B — Critical Security Blocker Remediation Suite', () => {
  let testUserHost: IUser;
  let testUserGuest: IUser;
  let testUserAdmin: IUser;
  let meetingService: MeetingService;
  let mockLiveKit: LiveKitService;
  let evictionWorker: LiveKitEvictionWorker;
  let coordinator: LiveKitRevocationCoordinator;
  let gateway: LiveKitSignalGateway;
  let removedParticipantsFromSFU: string[] = [];
  const sfuPresenceMap = new Map<string, boolean>();
  let sfuEvictErrorToThrow: Error | null = null;
  let sfuPresenceErrorToThrow: Error | null = null;
  let appServer: http.Server;
  let appBaseUrl = '';

  const mockAdapter: LiveKitRoomClientAdapter = {
    createRoom: async () => ({}),
    removeParticipant: async (_room, identity) => {
      if (sfuEvictErrorToThrow) {
        throw sfuEvictErrorToThrow;
      }
      removedParticipantsFromSFU.push(identity);
      sfuPresenceMap.set(identity, false);
      return {};
    },
    deleteRoom: async () => ({}),
    getParticipant: async (_room, identity) => {
      if (sfuPresenceErrorToThrow) {
        throw sfuPresenceErrorToThrow;
      }
      const isPresent = sfuPresenceMap.get(identity);
      if (isPresent === false) {
        const notFoundErr = new Error('Participant not found');
        (notFoundErr as any).status = 404;
        throw notFoundErr;
      }
      return { identity, joinedAt: Date.now() };
    },
  };

  before(async () => {
    const rsUri = 'mongodb://127.0.0.1:27018/connectly_test_sprint06b_rs?replicaSet=rs0';
    const standaloneUri = 'mongodb://127.0.0.1:27017/connectly_test_sprint06b';

    try {
      await mongoose.connect(rsUri, { serverSelectionTimeoutMS: 2000 });
    } catch {
      await mongoose.connect(standaloneUri, { serverSelectionTimeoutMS: 2000 });
    }

    mockLiveKit = new LiveKitService({
      config: {
        url: 'ws://127.0.0.1:7880',
        apiKey: 'test-key',
        apiSecret: 'test-secret-at-least-32-chars-long-xyz',
        tokenTtlSeconds: 600,
      },
      roomClientFactory: () => mockAdapter,
    });

    evictionWorker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 20_000,
    });

    const hub = new MeetingRealtimeHub();
    coordinator = new LiveKitRevocationCoordinator({ pollIntervalMs: 60_000, enableChangeStream: false });
    gateway = new LiveKitSignalGateway(mockLiveKit, {}, coordinator);

    meetingService = new MeetingService(
      hub,
      { requireTransactions: false },
      mockLiveKit,
      gateway,
      undefined,
      coordinator,
      { evictionWorker }
    );

    // Setup Express App for Admin RBAC testing
    const app = createApp({ signalGateway: gateway });
    await new Promise<void>((resolve) => {
      appServer = app.listen(0, '127.0.0.1', () => {
        const addr = appServer.address();
        if (addr && typeof addr === 'object') {
          appBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    gateway?.close();
    await coordinator?.stop();
    await evictionWorker?.stop();
    if (appServer) {
      appServer.closeAllConnections?.();
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
    }
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    removedParticipantsFromSFU = [];
    sfuPresenceMap.clear();
    sfuEvictErrorToThrow = null;
    sfuPresenceErrorToThrow = null;

    await LiveKitEvictionJob.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await User.deleteMany({});

    testUserHost = await User.create({
      firstName: 'Host',
      lastName: 'User',
      email: `host_${Date.now()}_${Math.random()}@example.com`,
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      role: 'user',
      isEmailVerified: true,
    });

    testUserGuest = await User.create({
      firstName: 'Guest',
      lastName: 'User',
      email: `guest_${Date.now()}_${Math.random()}@example.com`,
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      role: 'user',
      isEmailVerified: true,
    });

    testUserAdmin = await User.create({
      firstName: 'Admin',
      lastName: 'Operator',
      email: `admin_${Date.now()}_${Math.random()}@example.com`,
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      role: 'admin',
      isEmailVerified: true,
    });
  });

  // =========================================================================
  // WORKSTREAM A: SESSION-SCOPED LIVEKIT IDENTITY & OLD-SESSION EVICTION
  // =========================================================================
  describe('Workstream A — Session-Scoped LiveKit Identity', () => {
    it('generates session-scoped identity when sessionId is provided', () => {
      const uId = new Types.ObjectId().toString();
      const sId = 'a1b2c3d4e5f6';
      const identity = getLiveKitParticipantIdentity(uId, sId);

      assert.strictEqual(identity, `usr_${uId}_${sId}`);
      assert.strictEqual(parseLiveKitParticipantUserId(identity), uId);
      assert.strictEqual(parseLiveKitParticipantSessionId(identity), sId);
    });

    it('generates legacy identity when sessionId is omitted or empty', () => {
      const uId = new Types.ObjectId().toString();
      const identity = getLiveKitParticipantIdentity(uId);

      assert.strictEqual(identity, `usr_${uId}`);
      assert.strictEqual(parseLiveKitParticipantUserId(identity), uId);
      assert.strictEqual(parseLiveKitParticipantSessionId(identity), null);
    });

    it('issues LiveKit token embedding session-scoped identity', async () => {
      const meetingResult = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Session Scoped Test',
      });
      const meetingCode = meetingResult.meeting.meetingCode;

      // Join meeting as guest
      const joinResult = await meetingService.joinMeeting(meetingCode, testUserGuest._id.toString());
      assert.strictEqual(joinResult.participant.admissionStatus, 'ADMITTED');

      const participantDoc = await MeetingParticipant.findOne({
        meetingId: meetingResult.meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(participantDoc);
      assert.ok(participantDoc.admissionSessionId, 'admissionSessionId must be generated');

      // Issue LiveKit token
      const tokenBundle = await meetingService.issueLiveKitToken(
        meetingCode,
        testUserGuest._id.toString()
      );

      assert.strictEqual(
        tokenBundle.participantIdentity,
        `usr_${testUserGuest._id.toString()}_${participantDoc.admissionSessionId}`
      );
    });

    it('re-admission disambiguation: old eviction job evicts ONLY old session and does NOT touch new session', async () => {
      // 1. Create meeting and host joins
      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Re-Admission Disambiguation Test',
      });
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());

      // 2. Guest joins under Session 1
      await meetingService.joinMeeting(meeting.meetingCode, testUserGuest._id.toString());
      const p1 = await MeetingParticipant.findOne({
        meetingId: meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(p1 && p1.admissionSessionId);
      const session1Id = p1.admissionSessionId;
      const session1Identity = `usr_${testUserGuest._id.toString()}_${session1Id}`;

      // Simulate session 1 active on LiveKit SFU
      sfuPresenceMap.set(session1Identity, true);

      // 3. Host removes participant, but SFU eviction fails transiently
      sfuEvictErrorToThrow = new Error('LiveKit 503 SFU Unavailable');
      await meetingService.removeParticipant(
        meeting.meetingCode,
        testUserHost._id.toString(),
        testUserGuest._id.toString(),
        'First removal'
      );
      sfuEvictErrorToThrow = null; // Clear failure for worker retry

      // Verify eviction job was queued targeting session 1
      const evictionJob1 = await LiveKitEvictionJob.findOne({
        meetingId: meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(evictionJob1);
      assert.strictEqual(evictionJob1.identity, session1Identity);
      assert.strictEqual(evictionJob1.sessionId, session1Id);

      // 4. Host re-admits participant under Session 2
      // Host resets participant into WAITING room, then admits them cleanly
      await MeetingParticipant.updateOne(
        { _id: p1._id },
        { $set: { admissionStatus: 'WAITING', removalReason: null } }
      );
      await meetingService.admitParticipant(
        meeting.meetingCode,
        testUserHost._id.toString(),
        testUserGuest._id.toString()
      );
      const p2 = await MeetingParticipant.findOne({
        meetingId: meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(p2);
      assert.strictEqual(p2.admissionStatus, 'ADMITTED');
      assert.notStrictEqual(p2.admissionSessionId, session1Id, 'Session 2 must have distinct sessionId');
      const session2Id = p2.admissionSessionId!;
      const session2Identity = `usr_${testUserGuest._id.toString()}_${session2Id}`;

      // Mark session 2 active on LiveKit SFU
      sfuPresenceMap.set(session2Identity, true);

      // 5. Worker processes the old eviction job for Session 1
      const outcome = await evictionWorker.processJobById(evictionJob1.jobId);
      assert.strictEqual(outcome.status, 'COMPLETED');

      // 6. VERIFY: Only Session 1 was evicted! Session 2 was NEVER touched!
      assert.ok(
        removedParticipantsFromSFU.includes(session1Identity),
        'Old session 1 must be evicted'
      );
      assert.ok(
        !removedParticipantsFromSFU.includes(session2Identity),
        'New session 2 must NOT be evicted'
      );
      assert.strictEqual(sfuPresenceMap.get(session1Identity), false);
      assert.strictEqual(sfuPresenceMap.get(session2Identity), true);
    });
  });

  // =========================================================================
  // WORKSTREAM B: FAIL-CLOSED STANDALONE MONGODB
  // =========================================================================
  describe('Workstream B — Fail-Closed Standalone Behavior', () => {
    it('throws TRANSACTION_REQUIRED and leaves state untouched if requireTransactions is true on standalone', async () => {
      // Create meeting service with requireTransactions: true
      const strictService = new MeetingService(
        new MeetingRealtimeHub(),
        {},
        mockLiveKit,
        new LiveKitSignalGateway(mockLiveKit, {}, new LiveKitRevocationCoordinator({ pollIntervalMs: 60_000, enableChangeStream: false })),
        undefined,
        new LiveKitRevocationCoordinator({ pollIntervalMs: 60_000, enableChangeStream: false }),
        { requireTransactions: true, evictionWorker }
      );

      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Fail-Closed Test',
      });
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());
      await meetingService.joinMeeting(meeting.meetingCode, testUserGuest._id.toString());

      // Explicitly simulate standalone environment
      setReplicaSetTransactionsSupportedForTesting(false);
      try {
        let threw = false;
        try {
          await strictService.removeParticipant(
            meeting.meetingCode,
            testUserHost._id.toString(),
            testUserGuest._id.toString()
          );
        } catch (err: any) {
          threw = true;
          assert.strictEqual(err.code, 'TRANSACTION_REQUIRED');
        }
        assert.ok(threw, 'Must throw TRANSACTION_REQUIRED error on standalone');

        // Verify participant was NOT removed in DB
        const participantAfter = await MeetingParticipant.findOne({
          meetingId: meeting.id,
          userId: testUserGuest._id,
        });
        assert.ok(participantAfter);
        assert.strictEqual(participantAfter.admissionStatus, 'ADMITTED');
      } finally {
        resetRevocationTopologyCache();
      }
    });
  });

  // =========================================================================
  // WORKSTREAM C: ADMIN EVICTION MANAGEMENT & RBAC
  // =========================================================================
  describe('Workstream C — Admin Eviction Management & RBAC', () => {
    it('GET /api/v1/admin/eviction-jobs/escalated: 401 unauthenticated, 403 non-admin, 200 admin', async () => {
      // 1. Unauthenticated request
      const unauthRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/escalated`);
      assert.strictEqual(unauthRes.status, 401);

      // 2. Non-admin request
      const userToken = generateAccessToken({
        sub: testUserGuest._id.toString(),
        email: testUserGuest.email,
        firstName: testUserGuest.firstName,
        lastName: testUserGuest.lastName,
        role: 'user',
      });
      const forbiddenRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/escalated`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(forbiddenRes.status, 403);

      // 3. Admin request
      const adminToken = generateAccessToken({
        sub: testUserAdmin._id.toString(),
        email: testUserAdmin.email,
        firstName: testUserAdmin.firstName,
        lastName: testUserAdmin.lastName,
        role: 'admin',
      });
      const adminRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/escalated`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(adminRes.status, 200);
      const body = await adminRes.json();
      assert.strictEqual(body.status, 'success');
      assert.ok(Array.isArray(body.data.jobs));
    });

    it('POST /api/v1/admin/eviction-jobs/:jobId/retry: validates, resets ESCALATED job, and records audit event', async () => {
      const adminToken = generateAccessToken({
        sub: testUserAdmin._id.toString(),
        email: testUserAdmin.email,
        firstName: testUserAdmin.firstName,
        lastName: testUserAdmin.lastName,
        role: 'admin',
      });

      // 1. Invalid jobId format -> 400
      const badIdRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/not-a-valid-hex/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(badIdRes.status, 400);

      // 2. Non-existent jobId -> 404
      const randomHex = 'a'.repeat(64);
      const notFoundRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/${randomHex}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(notFoundRes.status, 404);

      // 3. Create an ESCALATED job in DB
      const mId = new Types.ObjectId();
      const uId = new Types.ObjectId();
      const jobId = generateEvictionJobId(mId, uId, 1, 'sess123');

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: mId,
        meetingCode: 'xyz-123-abc',
        userId: uId,
        identity: `usr_${uId.toString()}_sess123`,
        sessionId: 'sess123',
        epoch: 1,
        status: 'ESCALATED',
        attempts: 5,
        maxAttempts: 5,
        nextRunAt: new Date(Date.now() - 1000),
        lastError: 'LiveKit 503 SFU Unavailable',
        escalatedAt: new Date(),
      });

      // 4. Retry via Admin API -> 200
      const retryRes = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(retryRes.status, 200);
      const retryBody = await retryRes.json();
      assert.strictEqual(retryBody.status, 'success');

      // 5. Verify DB state is now PENDING with 0 attempts
      const updatedJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.ok(updatedJob);
      assert.strictEqual(updatedJob.status, 'PENDING');
      assert.strictEqual(updatedJob.attempts, 0);
      assert.strictEqual(updatedJob.escalatedAt, null);

      // 6. Verify audit event
      const recentAudit = securityAudit.query({ eventType: 'EVICTION_OPERATOR_RETRY' });
      assert.ok(recentAudit.length > 0, 'EVICTION_OPERATOR_RETRY audit event must be logged');
      assert.strictEqual(recentAudit[recentAudit.length - 1].userId, testUserAdmin._id.toString());
    });
  });

  // =========================================================================
  // WORKSTREAM D: ADAPTIVE POLLING & WAKEUP
  // =========================================================================
  describe('Workstream D — Adaptive Worker Polling', () => {
    it('backs off on empty sweep and resets to minPollIntervalMs on wakeUp()', async () => {
      const adaptiveWorker = new LiveKitEvictionWorker({
        pollIntervalMs: 1000,
        minPollIntervalMs: 500,
        maxPollIntervalMs: 4000,
        livekit: mockLiveKit,
      });

      assert.strictEqual(adaptiveWorker.getCurrentPollIntervalMs(), 1000);

      // Start worker
      await adaptiveWorker.start();

      // Trigger empty sweep
      const emptySummary = await adaptiveWorker.processDueJobs();
      assert.strictEqual(emptySummary.scanned, 0);

      // Wake up worker
      adaptiveWorker.wakeUp();
      assert.strictEqual(adaptiveWorker.getCurrentPollIntervalMs(), 500);

      await adaptiveWorker.stop();
    });
  });

  // =========================================================================
  // WORKSTREAM E: WORKER LEASE FENCING & CONCURRENCY HARDENING
  // =========================================================================
  describe('Workstream E — Worker Lease Fencing', () => {
    it('returns LEASE_LOST if lease was stolen or expired during LiveKit call', async () => {
      const mId = new Types.ObjectId();
      const uId = new Types.ObjectId();
      const jobId = generateEvictionJobId(mId, uId, 1, 'fence123');

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: mId,
        meetingCode: 'fence-test',
        userId: uId,
        identity: `usr_${uId.toString()}_fence123`,
        sessionId: 'fence123',
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRunAt: new Date(Date.now() - 1000),
      });

      await MeetingParticipant.create({
        meetingId: mId,
        userId: uId,
        displayName: 'Test User',
        email: 'test@example.com',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'OFFLINE',
        tokenEpoch: 1,
        signalFenceVersion: 1,
      });

      // Hook: simulate another worker stealing the lease before LiveKit call completes
      const outcome = await evictionWorker.processJobById(jobId, {
        beforeLiveKitCall: async (job) => {
          await LiveKitEvictionJob.updateOne(
            { _id: job._id },
            { $set: { leaseToken: 'stolen_token_by_worker_2' } }
          );
        },
      });

      assert.strictEqual(outcome.status, 'LEASE_LOST');

      // Verify the stolen lease token was NOT overwritten
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.ok(jobInDb);
      assert.strictEqual(jobInDb.leaseToken, 'stolen_token_by_worker_2');
    });
  });
});
