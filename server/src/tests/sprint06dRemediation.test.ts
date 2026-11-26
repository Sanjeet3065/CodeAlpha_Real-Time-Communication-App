import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import {
  SecurityAuditEntry,
  ensureSecurityAuditReady,
} from '../models/SecurityAuditEntry.model.js';
import { Meeting } from '../models/Meeting.model.js';
import {
  MeetingParticipant,
  generateAdmissionSessionId,
} from '../models/MeetingParticipant.model.js';
import { User, type IUser } from '../models/User.model.js';
import { MeetingService } from '../services/meeting.service.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';
import { LiveKitEvictionWorker } from '../workers/livekitEvictionWorker.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { generateAccessToken } from '../utils/tokens.js';
import { createApp } from '../app.js';
import { securityAudit } from '../utils/securityAudit.js';

describe('Phase 18 Sprint 06D — Reliability Remediation & Staging Hardening Suite', () => {
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
      const isPresent = sfuPresenceMap.get(identity);
      if (isPresent === false) {
        const notFoundErr = new Error('Participant not found');
        (notFoundErr as any).status = 404;
        throw notFoundErr;
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
    const rsUri = 'mongodb://127.0.0.1:27018/connectly_test_sprint06d_rs?replicaSet=rs0';
    const standaloneUri = 'mongodb://127.0.0.1:27017/connectly_test_sprint06d';

    try {
      await mongoose.connect(rsUri, { serverSelectionTimeoutMS: 2000 });
    } catch {
      await mongoose.connect(standaloneUri, { serverSelectionTimeoutMS: 2000 });
    }

    await ensureSecurityAuditReady();

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
      heartbeatIntervalMs: 5_000,
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
    if (appServer) {
      appServer.closeAllConnections?.();
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
    }
    await evictionWorker.stop();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    removedParticipantsFromSFU = [];
    sfuPresenceMap.clear();
    sfuEvictErrorToThrow = null;
    sfuPresenceErrorToThrow = null;
    securityAudit.clear();

    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});
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
  // WORKSTREAM A: WORKER LEASE HEARTBEAT & LONG-RUNNING OPERATIONS
  // =========================================================================
  describe('Workstream A — Worker Lease Renewal Heartbeat', () => {
    it('1. Periodically renews lease during long-running operation exceeding base lease duration', async () => {
      let renewalsCount = 0;
      const workerWithFastHeartbeat = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 200,      // short 200ms lease
        heartbeatIntervalMs: 50,    // 50ms heartbeat
        hooks: {
          afterLeaseRenew: (_jobId, renewed) => {
            if (renewed) renewalsCount++;
          },
        },
      });

      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Heartbeat Meeting',
      });
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());

      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(meeting.id, testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: meeting.id,
        userId: testUserGuest._id,
        displayName: 'Guest User',
        email: testUserGuest.email,
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'OFFLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
        requestedAt: new Date(),
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: meeting.id,
        meetingCode: meeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRunAt: new Date(),
      });

      sfuPresenceMap.set(identity, true);

      // Simulate a slow SFU call lasting 300ms (longer than the 200ms lease!)
      const outcome = await workerWithFastHeartbeat.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
        },
      });

      assert.strictEqual(outcome.status, 'COMPLETED');
      assert.ok(renewalsCount >= 3, `Expected at least 3 lease renewals, got ${renewalsCount}`);

      const finalJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(finalJob?.status, 'COMPLETED');
      assert.strictEqual(finalJob?.leaseOwner, null);
      assert.strictEqual(finalJob?.leaseToken, null);

      await workerWithFastHeartbeat.stop();
    });

    it('2. Lease renewal failure aborts further authoritative state mutations when lease is stolen', async () => {
      let renewedOnce = false;
      let resolveRenewalFailed!: () => void;
      const renewalFailedPromise = new Promise<void>((resolve) => {
        resolveRenewalFailed = resolve;
      });

      const workerWithFastHeartbeat = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 2_000,
        leaseSafetyMarginMs: 100,
        heartbeatIntervalMs: 40,
        hooks: {
          afterLeaseRenew: async (jId, renewed) => {
            if (renewed && !renewedOnce) {
              renewedOnce = true;
              // Simulate another worker stealing the job by changing the leaseToken in MongoDB
              await LiveKitEvictionJob.updateOne(
                { jobId: jId },
                { $set: { leaseToken: crypto.randomUUID(), leaseOwner: 'rogue_worker' } }
              );
              return;
            }
            if (!renewed && renewedOnce) {
              resolveRenewalFailed();
            }
          },
        },
      });

      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Heartbeat Steal Meeting',
      });
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());

      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(meeting.id, testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: meeting.id,
        userId: testUserGuest._id,
        displayName: 'Guest User',
        email: testUserGuest.email,
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'OFFLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
        requestedAt: new Date(),
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: meeting.id,
        meetingCode: meeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRunAt: new Date(),
      });

      sfuPresenceMap.set(identity, true);

      // Wait deterministically for heartbeat #1 to succeed + steal and heartbeat #2 to fail
      const outcome = await workerWithFastHeartbeat.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              renewalFailedPromise,
              new Promise<void>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error('Timed out waiting for stolen lease renewal failure')),
                  3_000
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        },
      });

      // The stale worker must detect that its lease was lost and return LEASE_LOST without calling SFU eviction
      assert.strictEqual(outcome.status, 'LEASE_LOST');
      assert.strictEqual(removedParticipantsFromSFU.length, 0);

      // The job status must NOT have been set to COMPLETED by the stale worker
      const finalJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(finalJob?.leaseOwner, 'rogue_worker');
      assert.strictEqual(finalJob?.status, 'PROCESSING');

      await workerWithFastHeartbeat.stop();
    });

    it('3. Worker stop() cleans up active heartbeat timers cleanly without timer leaks', async () => {
      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 5000,
        heartbeatIntervalMs: 50,
      });

      await worker.start();
      assert.strictEqual((worker as any).isRunning, true);

      await worker.stop();
      assert.strictEqual((worker as any).isRunning, false);
      assert.strictEqual((worker as any).activeHeartbeatTimers.size, 0);
    });

    it('4. Concurrent duplicate eviction calls to LiveKit SFU are idempotent and safe', async () => {
      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Duplicate Eviction Meeting',
      });
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());

      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(meeting.id, testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: meeting.id,
        userId: testUserGuest._id,
        displayName: 'Guest User',
        email: testUserGuest.email,
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'OFFLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
        requestedAt: new Date(),
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: meeting.id,
        meetingCode: meeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRunAt: new Date(),
      });

      sfuPresenceMap.set(identity, true);

      // First eviction succeeds
      const res1 = await mockLiveKit.evictParticipant(meeting.id, identity);
      assert.strictEqual(res1.success, true);
      assert.strictEqual(sfuPresenceMap.get(identity), false);

      // Second duplicate eviction returns notFound=true, which is classified as success (idempotent)
      const res2 = await mockLiveKit.evictParticipant(meeting.id, identity);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.notFound, true);
    });
  });

  // =========================================================================
  // WORKSTREAM B: DURABLE SECURITY AUDIT TRAIL PERSISTENCE
  // =========================================================================
  describe('Workstream B — Durable Security Audit Trail Persistence', () => {
    it('5. securityAudit.logAsync() persists audit events durably to MongoDB', async () => {
      const jobId = crypto.randomBytes(32).toString('hex');
      const event = await securityAudit.logAsync({
        eventType: 'EVICTION_OPERATOR_RETRY',
        userId: testUserAdmin._id.toString(),
        operatorId: testUserAdmin._id.toString(),
        jobId,
        severity: 'WARN',
        outcome: 'SUCCESS',
        details: {
          jobId,
          operatorId: testUserAdmin._id.toString(),
          reason: 'Manual staging test retry',
        },
      });

      assert.ok(event.id);
      assert.strictEqual(event.eventType, 'EVICTION_OPERATOR_RETRY');

      // Verify MongoDB document exists
      const persisted = await SecurityAuditEntry.findOne({ eventId: event.id });
      assert.ok(persisted, 'Expected SecurityAuditEntry document in MongoDB');
      assert.strictEqual(persisted.jobId, jobId);
      assert.strictEqual(persisted.operatorId, testUserAdmin._id.toString());
      assert.strictEqual(persisted.severity, 'WARN');
      assert.strictEqual(persisted.outcome, 'SUCCESS');
    });

    it('6. Restart recovery: persistent audit query survives in-memory ring buffer clearing', async () => {
      const jobId = crypto.randomBytes(32).toString('hex');

      await securityAudit.logAsync({
        eventType: 'EVICTION_JOB_ESCALATED',
        userId: testUserGuest._id.toString(),
        jobId,
        severity: 'CRITICAL',
        outcome: 'ESCALATED',
        details: {
          jobId,
          attempts: 5,
          lastError: 'LiveKit 503 Service Unavailable',
        },
      });

      // Confirm event exists in in-memory buffer
      const inMemoryBefore = securityAudit.query({ eventType: 'EVICTION_JOB_ESCALATED' });
      assert.strictEqual(inMemoryBefore.length, 1);

      // SIMULATE APPLICATION RESTART: Clear in-memory ring buffer
      securityAudit.clear();
      const inMemoryAfter = securityAudit.query({ eventType: 'EVICTION_JOB_ESCALATED' });
      assert.strictEqual(inMemoryAfter.length, 0, 'In-memory buffer must be empty after restart');

      // Query durable MongoDB persistence
      const recoveredEntries = await securityAudit.queryPersistent({
        eventType: 'EVICTION_JOB_ESCALATED',
        jobId,
      });

      assert.strictEqual(recoveredEntries.length, 1, 'Event must survive process restart');
      assert.strictEqual(recoveredEntries[0].jobId, jobId);
      assert.strictEqual(recoveredEntries[0].severity, 'CRITICAL');
      assert.strictEqual(recoveredEntries[0].outcome, 'ESCALATED');
    });

    it('7. GET /api/v1/admin/audit-logs enforces RBAC and returns persistent audit logs', async () => {
      const adminToken = generateAccessToken({
        sub: testUserAdmin._id.toString(),
        email: testUserAdmin.email,
        firstName: testUserAdmin.firstName,
        lastName: testUserAdmin.lastName,
        role: 'admin',
      });
      const guestToken = generateAccessToken({
        sub: testUserGuest._id.toString(),
        email: testUserGuest.email,
        firstName: testUserGuest.firstName,
        lastName: testUserGuest.lastName,
        role: 'user',
      });

      // Populate an audit entry
      const jobId = crypto.randomBytes(32).toString('hex');
      await securityAudit.logAsync({
        eventType: 'EVICTION_OPERATOR_RETRY',
        operatorId: testUserAdmin._id.toString(),
        jobId,
        severity: 'WARN',
        outcome: 'SUCCESS',
      });

      // 1. Unauthenticated -> 401
      const resUnauth = await fetch(`${appBaseUrl}/api/v1/admin/audit-logs`);
      assert.strictEqual(resUnauth.status, 401);

      // 2. Non-admin regular user -> 403
      const resForbidden = await fetch(`${appBaseUrl}/api/v1/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${guestToken}` },
      });
      assert.strictEqual(resForbidden.status, 403);

      // 3. Admin user -> 200 with entries
      const resAdmin = await fetch(`${appBaseUrl}/api/v1/admin/audit-logs?jobId=${jobId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(resAdmin.status, 200);
      const jsonAdmin = await resAdmin.json();
      assert.strictEqual(jsonAdmin.status, 'success');
      assert.strictEqual(jsonAdmin.data.total, 1);
      assert.strictEqual(jsonAdmin.data.entries[0].jobId, jobId);
    });

    it('8. Persistence failure resilience: database error does not crash the application', async () => {
      // Temporarily monkeypatch SecurityAuditEntry.create to simulate DB write failure
      const originalCreate = SecurityAuditEntry.create;
      try {
        (SecurityAuditEntry as any).create = async () => {
          throw new Error('Simulated MongoDB disk full error');
        };

        // Synchronous log should catch and log error without throwing
        const event = securityAudit.log({
          eventType: 'AUTH_LOGIN_FAILURE',
          userId: 'test_user',
          severity: 'WARN',
        });

        assert.ok(event.id);
        assert.strictEqual(event.eventType, 'AUTH_LOGIN_FAILURE');
      } finally {
        (SecurityAuditEntry as any).create = originalCreate;
      }
    });
  });

  // =========================================================================
  // WORKSTREAM C: SESSION IDENTITY & RE-ADMISSION SAFETY
  // =========================================================================
  describe('Workstream C — Session-Scoped Identity Safety', () => {
    it('9. Old eviction job evicts ONLY old session and does NOT disconnect active re-admitted session', async () => {
      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Sprint 06D Re-admission Meeting',
      });

      // Host joins
      await meetingService.joinMeeting(meeting.meetingCode, testUserHost._id.toString());

      // 1. Session 1: Guest joins
      const join1 = await meetingService.joinMeeting(meeting.meetingCode, testUserGuest._id.toString());
      assert.strictEqual(join1.joinResult, 'ADMITTED');
      const p1 = await MeetingParticipant.findOne({
        meetingId: meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(p1 && p1.admissionSessionId);
      const session1Id = p1.admissionSessionId;
      const identitySession1 = getLiveKitParticipantIdentity(testUserGuest._id.toString(), session1Id);

      // Guest connects to LiveKit SFU with session 1 identity
      sfuPresenceMap.set(identitySession1, true);

      // 2. Remove Guest from meeting (simulating initial SFU removal API failure)
      sfuEvictErrorToThrow = new Error('Simulated LiveKit Cloud transient network timeout');
      await meetingService.removeParticipant(
        meeting.meetingCode,
        testUserHost._id.toString(),
        testUserGuest._id.toString(),
        'Violated meeting guidelines'
      );
      sfuEvictErrorToThrow = null; // restore connectivity for background worker

      // Verify Session 1 eviction job exists in PENDING / FAILED state
      const evictionJob1 = await LiveKitEvictionJob.findOne({
        meetingId: meeting.id,
        userId: testUserGuest._id,
      });
      assert.ok(evictionJob1);
      assert.strictEqual(evictionJob1.sessionId, session1Id);
      assert.strictEqual(evictionJob1.identity, identitySession1);

      // 3. Guest is re-admitted (Session 2): reset to WAITING then admit cleanly
      await MeetingParticipant.updateOne(
        { meetingId: meeting.id, userId: testUserGuest._id },
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
      const session2Id = p2.admissionSessionId!;
      assert.notStrictEqual(session2Id, session1Id, 'Session 2 must have a distinct session ID');
      const identitySession2 = getLiveKitParticipantIdentity(testUserGuest._id.toString(), session2Id);

      // Guest connects to LiveKit SFU under Session 2 identity
      sfuPresenceMap.set(identitySession2, true);

      // 4. Background worker now processes Session 1's eviction job
      const workerOutcome = await evictionWorker.processJobById(evictionJob1.jobId);
      assert.strictEqual(workerOutcome.status, 'COMPLETED');

      // 5. CRITICAL VERIFICATION:
      // Session 1 must be evicted from the SFU
      assert.strictEqual(sfuPresenceMap.get(identitySession1), false);
      assert.ok(removedParticipantsFromSFU.includes(identitySession1));

      // Session 2 must REMAIN CONNECTED on the SFU!
      assert.strictEqual(sfuPresenceMap.get(identitySession2), true);
      assert.strictEqual(removedParticipantsFromSFU.includes(identitySession2), false);
    });
  });
});
