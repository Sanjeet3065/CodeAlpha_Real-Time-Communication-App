import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { User, type IUser } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import {
  MeetingParticipant,
  generateAdmissionSessionId,
} from '../models/MeetingParticipant.model.js';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import {
  SecurityAuditEntry,
  ensureSecurityAuditReady,
} from '../models/SecurityAuditEntry.model.js';
import {
  securityAudit,
  sanitizePayload,
} from '../utils/securityAudit.js';
import {
  LiveKitEvictionWorker,
} from '../workers/livekitEvictionWorker.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  parseLiveKitParticipantUserId,
  parseLiveKitParticipantSessionId,
} from '../services/livekit.service.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { MeetingService } from '../services/meeting.service.js';
import { generateAccessToken } from '../utils/tokens.js';

describe('Sprint 06F — Audit-Driven Reliability & Security Remediation Suite', () => {
  let appServer: any;
  let appBaseUrl = '';
  let meetingService: MeetingService;
  let evictionWorker: LiveKitEvictionWorker;
  let coordinator: LiveKitRevocationCoordinator;
  let gateway: LiveKitSignalGateway;

  let testUserHost: IUser;
  let testUserGuest: IUser;
  let testUserAdmin: IUser;

  const sfuPresenceMap = new Map<string, boolean>();
  let removedParticipantsFromSFU: string[] = [];

  const mockAdapter = {
    listRooms: async () => [],
    createRoom: async (opts: any) => ({ name: opts.name, sid: `mock_sid_${opts.name}` }),
    deleteRoom: async () => {},
    getParticipant: async (roomName: string, identity: string) => {
      const isPresent = sfuPresenceMap.get(identity);
      if (isPresent) {
        return { identity, state: 'ACTIVE', sid: `p_sid_${identity}` };
      }
      return null;
    },
    removeParticipant: async (roomName: string, identity: string) => {
      removedParticipantsFromSFU.push(identity);
      sfuPresenceMap.set(identity, false);
      return {};
    },
  };

  const mockLiveKit = new LiveKitService({
    config: {
      url: 'ws://127.0.0.1:7880',
      apiKey: 'test-key',
      apiSecret: 'test-secret-at-least-32-chars-long-xyz',
      tokenTtlSeconds: 600,
    },
    roomClientFactory: () => mockAdapter,
  });

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      const mongoUri =
        process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test_sprint06f';
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    }
    await ensureSecurityAuditReady();

    evictionWorker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 20_000,
      heartbeatIntervalMs: 5_000,
      requireTransactions: false,
    });

    const hub = new MeetingRealtimeHub();
    coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
    });
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
  // WORKSTREAM A: F-06E-01 SINGLE-FLIGHT LEASE HEARTBEAT PROTECTION
  // =========================================================================
  describe('Workstream A — F-06E-01 Single-Flight Lease Heartbeat Protection', () => {
    it('1. Single-flight guard prevents overlapping renewLease calls when DB latency > heartbeat interval', async () => {
      let concurrentRenewCalls = 0;
      let maxConcurrentObserved = 0;
      let totalRenewalsInitiated = 0;

      const workerWithGuardedHeartbeat = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 500,       // 500ms lease
        heartbeatIntervalMs: 30,     // fast 30ms interval
        requireTransactions: false,
        hooks: {
          beforeLeaseRenew: async () => {
            concurrentRenewCalls++;
            totalRenewalsInitiated++;
            if (concurrentRenewCalls > maxConcurrentObserved) {
              maxConcurrentObserved = concurrentRenewCalls;
            }
            // Injected DB latency (100ms) is over 3x the heartbeat interval (30ms)
            await new Promise((resolve) => setTimeout(resolve, 100));
          },
          afterLeaseRenew: async () => {
            concurrentRenewCalls--;
          },
        },
      });

      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Single Flight Test Meeting',
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

      // Operation runs for 350ms with a 100ms renew hook and 30ms heartbeat
      const outcome = await workerWithGuardedHeartbeat.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          await new Promise((resolve) => setTimeout(resolve, 350));
        },
      });

      assert.strictEqual(outcome.status, 'COMPLETED');
      // Crucial assertion: concurrency must NEVER exceed 1!
      assert.strictEqual(
        maxConcurrentObserved,
        1,
        `Expected max concurrent renewals to be 1, but observed ${maxConcurrentObserved}`
      );
      assert.ok(totalRenewalsInitiated >= 2, `Expected at least 2 renewals, got ${totalRenewalsInitiated}`);

      await workerWithGuardedHeartbeat.stop();
    });

    it('2. Worker stop() awaits outstanding in-flight heartbeat promise without unhandled rejections', async () => {
      let renewalFinished = false;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 1000,
        heartbeatIntervalMs: 50,
        requireTransactions: false,
        hooks: {
          beforeLeaseRenew: async () => {
            // Delay renewal by 150ms
            await new Promise((resolve) => setTimeout(resolve, 150));
            renewalFinished = true;
          },
        },
      });

      const { meeting } = await meetingService.createMeeting(testUserHost._id.toString(), {
        title: 'Stop Await Meeting',
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

      // Launch processing asynchronously
      const processPromise = worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
        },
      });

      // Wait 80ms so heartbeat triggers its beforeLeaseRenew hook
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Trigger worker.stop() while lease renewal is actively pending in background
      await worker.stop();

      // Assert that worker.stop() waited for the outstanding renewal promise to settle
      assert.strictEqual(renewalFinished, true, 'worker.stop() must await in-flight heartbeat promise');

      await processPromise;
    });
  });

  // =========================================================================
  // WORKSTREAM B: F-06E-02 DURABLE SECURITY AUDIT PERSISTENCE & TRANSACTION SAFETY
  // =========================================================================
  describe('Workstream B — F-06E-02 Durable Security Audit Persistence & Fail-Closed Behavior', () => {
    it('3. Operator retry commits job state and SecurityAuditEntry durably in MongoDB', async () => {
      const jobId = crypto.randomBytes(32).toString('hex');
      const now = new Date();

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: new mongoose.Types.ObjectId(),
        meetingCode: 'cly-op-ret',
        userId: testUserGuest._id,
        identity: `usr_${testUserGuest._id}_123456789abc`,
        sessionId: '123456789abc',
        epoch: 1,
        status: 'FAILED',
        attempts: 3,
        maxAttempts: 5,
        nextRunAt: now,
      });

      const outcome = await evictionWorker.operatorRetryJob(
        jobId,
        testUserAdmin._id.toString()
      );

      assert.strictEqual(outcome.success, true);

      // Verify LiveKitEvictionJob reset
      const updatedJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(updatedJob?.status, 'PENDING');
      assert.strictEqual(updatedJob?.attempts, 0);

      // Verify SecurityAuditEntry persisted durably in MongoDB
      const auditDoc = await SecurityAuditEntry.findOne({
        jobId,
        eventType: 'EVICTION_OPERATOR_RETRY',
      });
      assert.ok(auditDoc, 'SecurityAuditEntry must be durably stored in MongoDB');
      assert.strictEqual(auditDoc.operatorId, testUserAdmin._id.toString());
      assert.strictEqual(auditDoc.outcome, 'SUCCESS');
      assert.strictEqual(auditDoc.severity, 'WARN');
    });

    it('4. Operator retry rolls back job state if audit persistence fails (fail-closed integrity)', async () => {
      const jobId = crypto.randomBytes(32).toString('hex');
      const now = new Date();

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: new mongoose.Types.ObjectId(),
        meetingCode: 'cly-fail-audit',
        userId: testUserGuest._id,
        identity: `usr_${testUserGuest._id}_123456789abc`,
        sessionId: '123456789abc',
        epoch: 1,
        status: 'FAILED',
        attempts: 3,
        maxAttempts: 5,
        nextRunAt: now,
        lastError: 'Initial network error',
      });

      // Monkeypatch SecurityAuditEntry.prototype.save to simulate write failure
      const originalSave = SecurityAuditEntry.prototype.save;
      SecurityAuditEntry.prototype.save = async function () {
        throw new Error('Simulated MongoDB WriteConcernError on audit log');
      };

      try {
        await assert.rejects(
          async () => {
            await evictionWorker.operatorRetryJob(jobId, testUserAdmin._id.toString());
          },
          (err: any) => {
            assert.ok(err.message.includes('Simulated MongoDB WriteConcernError'));
            return true;
          }
        );

        // Crucial: The job must NOT remain in PENDING status! It must have rolled back to FAILED!
        const rolledBackJob = await LiveKitEvictionJob.findOne({ jobId });
        assert.strictEqual(
          rolledBackJob?.status,
          'FAILED',
          'Job status must be rolled back to FAILED on audit persistence failure'
        );
        assert.strictEqual(rolledBackJob?.attempts, 3);
        assert.strictEqual(rolledBackJob?.lastError, 'Initial network error');

        // And zero audit documents should exist
        const auditDocs = await SecurityAuditEntry.find({ jobId });
        assert.strictEqual(auditDocs.length, 0);
      } finally {
        SecurityAuditEntry.prototype.save = originalSave;
      }
    });

    it('5. Admin REST API returns HTTP 500 when audit persistence fails, never misleading HTTP 200', async () => {
      const adminToken = generateAccessToken({
        sub: testUserAdmin._id.toString(),
        email: testUserAdmin.email,
        firstName: testUserAdmin.firstName,
        lastName: testUserAdmin.lastName,
        role: 'admin',
      });

      const jobId = crypto.randomBytes(32).toString('hex');
      await LiveKitEvictionJob.create({
        jobId,
        meetingId: new mongoose.Types.ObjectId(),
        meetingCode: 'cly-api-err',
        userId: testUserGuest._id,
        identity: `usr_${testUserGuest._id}_123456789abc`,
        sessionId: '123456789abc',
        epoch: 1,
        status: 'ESCALATED',
        attempts: 5,
        maxAttempts: 5,
        nextRunAt: new Date(),
      });

      const originalSave = SecurityAuditEntry.prototype.save;
      SecurityAuditEntry.prototype.save = async function () {
        throw new Error('Simulated disk full during admin API audit log');
      };

      try {
        const res = await fetch(`${appBaseUrl}/api/v1/admin/eviction-jobs/${jobId}/retry`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });

        // Must NOT return 200!
        assert.strictEqual(res.status, 500);

        // Job must remain ESCALATED
        const job = await LiveKitEvictionJob.findOne({ jobId });
        assert.strictEqual(job?.status, 'ESCALATED');
      } finally {
        SecurityAuditEntry.prototype.save = originalSave;
      }
    });

    it('6. Escalation commits job status ESCALATED and persists CRITICAL audit event', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(
        new mongoose.Types.ObjectId(),
        testUserGuest._id,
        1,
        sessionId
      );

      const job = await LiveKitEvictionJob.create({
        jobId,
        meetingId: new mongoose.Types.ObjectId(),
        meetingCode: 'cly-escl-test',
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PROCESSING',
        attempts: 4, // Next attempt = 5 (maxAttempts)
        maxAttempts: 5,
        nextRunAt: new Date(),
        leaseToken: crypto.randomUUID(),
      });

      // Mark escalated
      const updated = await (evictionWorker as any).markJobEscalated(
        job,
        job.leaseToken,
        5,
        'LiveKit SFU 503 Service Unavailable',
        new Date()
      );

      assert.strictEqual(updated, true);

      const escalatedJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(escalatedJob?.status, 'ESCALATED');
      assert.strictEqual(escalatedJob?.attempts, 5);

      const auditEvent = await SecurityAuditEntry.findOne({
        jobId,
        eventType: 'EVICTION_JOB_ESCALATED',
      });
      assert.ok(auditEvent);
      assert.strictEqual(auditEvent.severity, 'CRITICAL');
      assert.strictEqual(auditEvent.outcome, 'ESCALATED');
    });
  });

  // =========================================================================
  // WORKSTREAM C: F-06E-03 SESSION IDENTIFIER PARSING & COMPATIBILITY
  // =========================================================================
  describe('Workstream C — F-06E-03 Session Identifier Specification & Compatibility', () => {
    it('7. generateAdmissionSessionId produces exact 12-char lowercase hex strings', () => {
      for (let i = 0; i < 50; i++) {
        const id = generateAdmissionSessionId();
        assert.strictEqual(typeof id, 'string');
        assert.strictEqual(id.length, 12, 'Must be exactly 12 characters long');
        assert.ok(/^[0-9a-f]{12}$/.test(id), 'Must consist only of lowercase hex characters');
      }
    });

    it('8. Backend identity parser correctly extracts user ID and session ID from both 12-hex and legacy formats', () => {
      const userId = '65f0a1b2c3d4e5f6a7b8c9e2';
      const session12 = 'a1b2c3d4e5f6';
      const session16 = 'a1b2c3d4e5f67890';

      // 12-hex format
      const id12 = `usr_${userId}_${session12}`;
      assert.strictEqual(parseLiveKitParticipantUserId(id12), userId);
      assert.strictEqual(parseLiveKitParticipantSessionId(id12), session12);

      // 16-hex format (forward compatibility)
      const id16 = `usr_${userId}_${session16}`;
      assert.strictEqual(parseLiveKitParticipantUserId(id16), userId);
      assert.strictEqual(parseLiveKitParticipantSessionId(id16), session16);

      // Legacy format (no session suffix)
      const idLegacy = `usr_${userId}`;
      assert.strictEqual(parseLiveKitParticipantUserId(idLegacy), userId);
      assert.strictEqual(parseLiveKitParticipantSessionId(idLegacy), null);
    });
  });

  // =========================================================================
  // WORKSTREAM D: F-06E-04 SAFE JOB ID REDACTION EXEMPTION
  // =========================================================================
  describe('Workstream D — F-06E-04 Safe Job ID Redaction Exemption', () => {
    it('9. Preserves valid 64-hex jobId inside nested details while redacting secrets and arbitrary 64-hex hashes', () => {
      const validJobId = '3bc896e84d018f28fa51d8a59f8ab73202eff16390e80c88637e1323e602ecc8';
      const arbitraryHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';

      const payload = {
        jobId: validJobId, // root jobId
        details: {
          jobId: validJobId,             // nested details.jobId -> MUST BE PRESERVED
          tokenHash: arbitraryHash,      // arbitrary 64-hex hash under another key -> MUST BE REDACTED
          randomSecretKey: arbitraryHash,// arbitrary 64-hex hash under generic key -> MUST BE REDACTED
          password: 'superSecretPassword', // sensitive key -> MUST BE REDACTED
          jwt: validJwt,                 // sensitive key & format -> MUST BE REDACTED
          nested: {
            deepJobId: validJobId,       // non-jobId key -> MUST BE REDACTED
            jobId: validJobId,           // nested jobId -> MUST BE PRESERVED
          },
          list: [
            { jobId: validJobId },       // jobId in array -> MUST BE PRESERVED
            { otherSecret: arbitraryHash }, // other in array -> MUST BE REDACTED
          ],
        },
      };

      const sanitized = sanitizePayload(payload);

      // 1. Nested details.jobId is preserved!
      assert.strictEqual(sanitized.details.jobId, validJobId);
      assert.strictEqual(sanitized.details.nested.jobId, validJobId);
      assert.strictEqual(sanitized.details.list[0].jobId, validJobId);

      // 2. Arbitrary 64-hex hashes under other keys remain REDACTED
      assert.strictEqual(sanitized.details.tokenHash, '[REDACTED]');
      assert.strictEqual(sanitized.details.randomSecretKey, '[REDACTED]');
      assert.strictEqual(sanitized.details.nested.deepJobId, '[REDACTED]');
      assert.strictEqual(sanitized.details.list[1].otherSecret, '[REDACTED]');

      // 3. Secrets and passwords remain REDACTED
      assert.strictEqual(sanitized.details.password, '[REDACTED]');
      assert.strictEqual(sanitized.details.jwt, '[REDACTED]');
    });

    it('10. If a JWT token is passed as jobId, it is strictly redacted to [REDACTED]', () => {
      const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';
      const maliciousPayload = {
        details: {
          jobId: validJwt, // Attempt to bypass JWT redaction via jobId key
        },
      };

      const sanitized = sanitizePayload(maliciousPayload);
      assert.strictEqual(sanitized.details.jobId, '[REDACTED]');
    });
  });
});
