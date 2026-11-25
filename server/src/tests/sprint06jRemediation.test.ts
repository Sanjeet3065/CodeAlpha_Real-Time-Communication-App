import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  sanitizePayload,
  isSensitiveKey,
  securityAudit,
} from '../utils/securityAudit.js';
import {
  SecurityAuditEntry,
  ensureSecurityAuditReady,
} from '../models/SecurityAuditEntry.model.js';
import {
  LiveKitEvictionWorker,
} from '../workers/livekitEvictionWorker.js';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import {
  MeetingParticipant,
  generateAdmissionSessionId,
} from '../models/MeetingParticipant.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { User } from '../models/User.model.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';

const TEST_DB_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/connectly_test_sprint06j';

describe('Sprint 06J — Targeted Security Sanitizer Hardening & Lease-Expiry Safety Remediation Suite', () => {
  let testUserHost: any;
  let testUserGuest: any;
  let testMeeting: any;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_DB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
    }
    await ensureSecurityAuditReady();

    await User.deleteMany({ email: /@test-sprint06j\.io$/ });
    await Meeting.deleteMany({ title: /Sprint 06J/ });
    await MeetingParticipant.deleteMany({});
    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});

    testUserHost = await User.create({
      firstName: 'Host',
      lastName: 'User',
      email: 'host@test-sprint06j.io',
      passwordHash: 'argon2id$mockedhash',
    });

    testUserGuest = await User.create({
      firstName: 'Guest',
      lastName: 'User',
      email: 'guest@test-sprint06j.io',
      passwordHash: 'argon2id$mockedhash',
    });

    testMeeting = await Meeting.create({
      title: 'Sprint 06J Test Meeting',
      meetingCode: 'cly-s6j-tst',
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      expiresAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
    });
  });

  after(async () => {
    await User.deleteMany({ email: /@test-sprint06j\.io$/ });
    await Meeting.deleteMany({ title: /Sprint 06J/ });
    await MeetingParticipant.deleteMany({});
    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});
    await mongoose.disconnect();
  });

  // =========================================================================
  // WORKSTREAM A: F-06I-01 COMPOUND SECRET-KEY REDACTION
  // =========================================================================
  describe('Workstream A — Compound Secret-Key Redaction (F-06I-01)', () => {
    const VALID_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const VALID_JWT =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    it('1. Recognizes all compound sensitive key examples regardless of casing and delimiters', () => {
      const examples = [
        'clientSecret',
        'api_secret',
        'apiKey',
        'db_password',
        'user_password',
        'secret_key',
        'refreshToken',
        'access_token',
        'privateKey',
        'jwtToken',
        'authorizationHeader',
        'sessionCookie',
      ];

      for (const key of examples) {
        assert.strictEqual(
          isSensitiveKey(key),
          true,
          `Expected isSensitiveKey("${key}") to be true`
        );
      }
    });

    it('2. Normalizes key variations (camelCase, snake_case, kebab-case, UPPERCASE)', () => {
      const variations = [
        'CLIENT_SECRET',
        'client-secret',
        'ClientSecret',
        'API_SECRET',
        'api-secret',
        'API_KEY',
        'api-key',
        'DB_PASSWORD',
        'db-password',
        'USER_PASSWORD',
        'user-password',
        'SECRET_KEY',
        'secret-key',
        'REFRESH_TOKEN',
        'refresh-token',
        'ACCESS_TOKEN',
        'access-token',
        'PRIVATE_KEY',
        'private-key',
        'JWT_TOKEN',
        'jwt-token',
        'AUTHORIZATION_HEADER',
        'authorization-header',
        'SESSION_COOKIE',
        'session-cookie',
      ];

      for (const v of variations) {
        assert.strictEqual(
          isSensitiveKey(v),
          true,
          `Expected isSensitiveKey("${v}") to be true`
        );
      }
    });

    it('3. Redacts compound sensitive keys in payload while preserving safe non-credential keys', () => {
      const payload = {
        clientSecret: 'secret-val-1',
        api_secret: 'secret-val-2',
        apiKey: 'key-val-3',
        db_password: 'pwd-val-4',
        user_password: 'pwd-val-5',
        secret_key: 'key-val-6',
        refreshToken: 'token-val-7',
        access_token: 'token-val-8',
        privateKey: 'key-val-9',
        jwtToken: 'jwt-val-10',
        authorizationHeader: 'Bearer auth-11',
        sessionCookie: 'sess-12',
        safeMetadata: 'visible-metadata',
        userId: 'usr_1234567890abcdef12345678',
        role: 'participant',
        attempts: 3,
        active: true,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.clientSecret, '[REDACTED]');
      assert.strictEqual(sanitized.api_secret, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.db_password, '[REDACTED]');
      assert.strictEqual(sanitized.user_password, '[REDACTED]');
      assert.strictEqual(sanitized.secret_key, '[REDACTED]');
      assert.strictEqual(sanitized.refreshToken, '[REDACTED]');
      assert.strictEqual(sanitized.access_token, '[REDACTED]');
      assert.strictEqual(sanitized.privateKey, '[REDACTED]');
      assert.strictEqual(sanitized.jwtToken, '[REDACTED]');
      assert.strictEqual(sanitized.authorizationHeader, '[REDACTED]');
      assert.strictEqual(sanitized.sessionCookie, '[REDACTED]');

      // Safe fields preserved
      assert.strictEqual(sanitized.safeMetadata, 'visible-metadata');
      assert.strictEqual(sanitized.userId, 'usr_1234567890abcdef12345678');
      assert.strictEqual(sanitized.role, 'participant');
      assert.strictEqual(sanitized.attempts, 3);
      assert.strictEqual(sanitized.active, true);
    });

    it('4. Deeply redacts sensitive keys inside nested objects and nested arrays', () => {
      const payload = {
        level1: {
          level2: {
            clientSecret: 'deep-secret',
            normalData: 'kept-at-level2',
          },
          arrayData: [
            { user_password: 'arr-pwd', name: 'Alice' },
            { api_key: 'arr-key', name: 'Bob' },
          ],
        },
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.level1.level2.clientSecret, '[REDACTED]');
      assert.strictEqual(sanitized.level1.level2.normalData, 'kept-at-level2');
      assert.strictEqual(sanitized.level1.arrayData[0].user_password, '[REDACTED]');
      assert.strictEqual(sanitized.level1.arrayData[0].name, 'Alice');
      assert.strictEqual(sanitized.level1.arrayData[1].api_key, '[REDACTED]');
      assert.strictEqual(sanitized.level1.arrayData[1].name, 'Bob');
    });

    it('5. Never allows sensitive parent objects to expose child values (including nested jobId)', () => {
      const payload = {
        clientSecret: {
          jobId: VALID_SHA256,
          childSecret: 'plain-secret',
        },
        apiKey: {
          jobId: VALID_SHA256,
          tokenData: 'raw-token',
        },
        sessionCookie: {
          jobId: VALID_SHA256,
        },
      };

      const sanitized = sanitizePayload(payload);

      // Sensitive parent object is redacted directly; child content is never exposed
      assert.strictEqual(sanitized.clientSecret, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.sessionCookie, '[REDACTED]');
    });

    it('6. Preserves valid 64-hex jobId only when key is strictly exact jobId (case-insensitive)', () => {
      const payload = {
        jobId: VALID_SHA256,
        jobid: VALID_SHA256,
        JOBID: VALID_SHA256,
        JobId: VALID_SHA256,
        'job-id': VALID_SHA256,
        job_id: VALID_SHA256,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.jobId, VALID_SHA256);
      assert.strictEqual(sanitized.jobid, VALID_SHA256);
      assert.strictEqual(sanitized.JOBID, VALID_SHA256);
      assert.strictEqual(sanitized.JobId, VALID_SHA256);
      // Sprint 06L (F-06K-01): Delimited variants must NOT preserve 64-hex hash
      assert.strictEqual(sanitized['job-id'], '[REDACTED]');
      assert.strictEqual(sanitized.job_id, '[REDACTED]');
    });

    it('7. Redacts invalid or secret-like values passed under jobId', () => {
      const payload = {
        caseA: { jobId: 'short-123' },
        caseB: { jobId: VALID_SHA256 + 'extra' },
        caseC: { jobId: 'z3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
        caseD: { jobId: VALID_JWT },
        caseE: { jobId: 'sk_live_1234567890abcdef' },
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.caseA.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseB.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseC.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseD.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseE.jobId, '[REDACTED]');
    });

    it('8. Redacts 64-hex values under arbitrary unrelated non-jobId keys', () => {
      const payload = {
        randomHash: VALID_SHA256,
        checksum: VALID_SHA256,
        metadataHash: VALID_SHA256,
        signature: VALID_SHA256,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.randomHash, '[REDACTED]');
      assert.strictEqual(sanitized.checksum, '[REDACTED]');
      assert.strictEqual(sanitized.metadataHash, '[REDACTED]');
      assert.strictEqual(sanitized.signature, '[REDACTED]');
    });

    it('9. Sanitizes details before persisting to MongoDB via securityAudit.logAsync', async () => {
      const rawDetails = {
        clientSecret: 'unwanted-secret-string',
        api_key: 'unwanted-api-key',
        db_password: 'super-secret-password',
        jobId: VALID_SHA256,
        status: 'ESCALATED',
      };

      const event = await securityAudit.logAsync({
        eventType: 'EVICTION_OPERATOR_RETRY',
        details: rawDetails,
        jobId: VALID_SHA256,
      });

      // In-memory event details are sanitized
      assert.strictEqual(event.details?.clientSecret, '[REDACTED]');
      assert.strictEqual(event.details?.api_key, '[REDACTED]');
      assert.strictEqual(event.details?.db_password, '[REDACTED]');
      assert.strictEqual(event.details?.jobId, VALID_SHA256);
      assert.strictEqual(event.details?.status, 'ESCALATED');

      // Database entry is verified sanitized
      const dbEntry = await SecurityAuditEntry.findOne({ eventId: event.id });
      assert.ok(dbEntry, 'Database entry must exist');
      assert.strictEqual(dbEntry.details?.clientSecret, '[REDACTED]');
      assert.strictEqual(dbEntry.details?.api_key, '[REDACTED]');
      assert.strictEqual(dbEntry.details?.db_password, '[REDACTED]');
      assert.strictEqual(dbEntry.details?.jobId, VALID_SHA256);
      assert.strictEqual(dbEntry.details?.status, 'ESCALATED');
    });
  });

  // =========================================================================
  // WORKSTREAM B: F-06I-02 LEASE EXPIRY SAFETY MARGIN
  // =========================================================================
  describe('Workstream B — Lease Expiry Safety Margin (F-06I-02)', () => {
    let mockLiveKit: LiveKitService;
    let sfuCallsCount: number;

    beforeEach(async () => {
      sfuCallsCount = 0;
      await MeetingParticipant.deleteMany({});
      await LiveKitEvictionJob.deleteMany({});
      mockLiveKit = {
        isConfigured: () => true,
        getParticipant: async () => {
          sfuCallsCount++;
          return { identity: 'usr_test' };
        },
        evictParticipant: async () => {
          sfuCallsCount++;
          return { success: true };
        },
      } as unknown as LiveKitService;
    });

    it('1. Lease with sufficient remaining time (> margin) allows external SFU request', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest B1',
        email: 'guestb1@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      const virtualNow = Date.now();
      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // At T=0, remaining lease is 10,000ms >> 1,000ms safety margin -> SFU call permitted
      const outcome = await worker.processJobById(jobId);
      await worker.stop();

      assert.strictEqual(outcome.status, 'COMPLETED');
      assert.ok(sfuCallsCount >= 1, 'SFU call should have been executed');
    });

    it('2. Lease inside safety margin rejects new external SFU request and returns LEASE_LOST', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest B2',
        email: 'guestb2@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // Warp time to T=9,500ms (only 500ms remaining, within 1,000ms margin)
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 9_500;
        },
      });
      await worker.stop();

      assert.strictEqual(outcome.status, 'DEFERRED');
      assert.strictEqual(sfuCallsCount, 0, 'No SFU call should be initiated when within safety margin');
    });

    it('3. Lease already expired rejects new SFU request', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest B3',
        email: 'guestb3@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 5_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 500,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // Warp past lease deadline (T=6,000ms > 5,000ms)
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 6_000;
        },
      });
      await worker.stop();

      assert.strictEqual(outcome.status, 'LEASE_LOST');
      assert.strictEqual(sfuCallsCount, 0, 'No SFU call should be initiated after lease expiration');
    });

    it('4. Transient heartbeat failure with sufficient remaining lease time allows recovery on subsequent tick', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest B4',
        email: 'guestb4@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      const virtualNow = Date.now();
      let heartbeatCount = 0;
      let renewalFailedOnce = false;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 20_000,
        heartbeatIntervalMs: 50,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
        hooks: {
          beforeLeaseRenew: async () => {
            heartbeatCount++;
            if (heartbeatCount === 1) {
              renewalFailedOnce = true;
              throw new Error('Simulated transient MongoDB connection reset');
            }
          },
        },
      });

      // Let worker run with transient failure on heartbeat 1, then recovery on heartbeat 2
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          await new Promise((r) => setTimeout(r, 150));
        },
      });
      await worker.stop();

      assert.strictEqual(outcome.status, 'COMPLETED');
      assert.strictEqual(renewalFailedOnce, true, 'Heartbeat 1 should have experienced transient failure');
      assert.ok(heartbeatCount >= 2, 'Subsequent heartbeat should have executed');
    });

    it('5. Stale worker cannot mark job completed after lease expiry or theft', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest B5',
        email: 'guestb5@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 5_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 500,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // Steal the job and expire worker's local deadline before state persistence
      const outcome = await worker.processJobById(jobId, {
        afterLiveKitCallBeforeStateUpdate: async () => {
          virtualNow += 6_000;
          await LiveKitEvictionJob.updateOne(
            { jobId },
            {
              $set: {
                leaseOwner: 'worker-usurper-beta',
                leaseToken: crypto.randomUUID(),
                leaseExpiresAt: new Date(virtualNow + 30_000),
              },
            }
          );
        },
      });
      await worker.stop();

      assert.strictEqual(outcome.status, 'LEASE_LOST');
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.leaseOwner, 'worker-usurper-beta');
      assert.strictEqual(jobInDb?.status, 'PROCESSING');
    });
  });

  // =========================================================================
  // WORKSTREAM C: REAL IN-FLIGHT EVICTION / RE-ADMISSION RACE TEST
  // =========================================================================
  describe('Workstream C — Real In-Flight Eviction / Re-Admission Race Test', () => {
    it('Executes end-to-end race: paused old eviction (sessionA) does NOT disconnect re-admitted user (sessionB)', async () => {
      await MeetingParticipant.deleteMany({});
      await LiveKitEvictionJob.deleteMany({});

      // 1. Establish simulated SFU participant registry
      const sfuConnectedParticipants = new Map<string, { identity: string; connected: boolean }>();

      let pauseEvictionDeferred: (() => void) | null = null;
      const pauseEvictionPromise = new Promise<void>((resolve) => {
        pauseEvictionDeferred = resolve;
      });

      let evictionCallReachedAdapter = false;
      let evictionCompletedInAdapter = false;

      // Controlled LiveKit adapter inspecting actual identity arguments
      const controlledClientAdapter: LiveKitRoomClientAdapter = {
        createRoom: async () => ({}),
        deleteRoom: async () => ({}),
        getParticipant: async (_room: string, identity: string) => {
          const p = sfuConnectedParticipants.get(identity);
          if (!p || !p.connected) return null;
          return { identity: p.identity };
        },
        removeParticipant: async (_room: string, identity: string) => {
          evictionCallReachedAdapter = true;
          // Pause execution on sessionA to simulate network stall
          await pauseEvictionPromise;
          const p = sfuConnectedParticipants.get(identity);
          if (p) {
            p.connected = false;
          }
          evictionCompletedInAdapter = true;
          return {};
        },
      };

      const controlledLiveKit = new LiveKitService({
        config: {
          url: 'ws://127.0.0.1:7880',
          apiKey: 'test-key',
          apiSecret: 'test-secret-at-least-32-chars-long-xyz',
          tokenTtlSeconds: 600,
        },
        roomClientFactory: () => controlledClientAdapter,
      });

      // 1. Create old admission identity sessionA
      const sessionA = generateAdmissionSessionId();
      const identityA = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionA);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testUserGuest._id, 1, sessionA);

      // Connect sessionA on SFU
      sfuConnectedParticipants.set(identityA, { identity: identityA, connected: true });

      const participantDoc = await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testUserGuest._id,
        displayName: 'Guest Concurrent',
        email: 'guestconcurrent@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionA,
        tokenEpoch: 1,
      });

      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testUserGuest._id,
        identity: identityA,
        sessionId: sessionA,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      const workerA = new LiveKitEvictionWorker({
        workerId: 'worker-A',
        pollIntervalMs: 0,
        livekit: controlledLiveKit,
        leaseDurationMs: 3_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 200,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // 2. Start worker execution for sessionA
      const executionPromise = workerA.processJobById(jobId);

      // Wait until the eviction request reaches the controlled adapter
      while (!evictionCallReachedAdapter) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // 4. While Worker A is paused in-flight, expire/steal Worker A's lease
      virtualNow += 5_000; // Past 3,000ms lease
      const stolenToken = crypto.randomUUID();
      await LiveKitEvictionJob.updateOne(
        { jobId },
        {
          $set: {
            leaseOwner: 'worker-B',
            leaseToken: stolenToken,
            leaseExpiresAt: new Date(virtualNow + 20_000),
          },
        }
      );

      // 5. Re-admit the same user under sessionB
      const sessionB = generateAdmissionSessionId();
      const identityB = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionB);

      // 6. Confirm sessionB is a distinct LiveKit identity
      assert.notStrictEqual(sessionA, sessionB);
      assert.notStrictEqual(identityA, identityB);
      assert.strictEqual(identityA.includes(sessionA), true);
      assert.strictEqual(identityB.includes(sessionB), true);

      // Connect sessionB to the SFU
      sfuConnectedParticipants.set(identityB, { identity: identityB, connected: true });
      await MeetingParticipant.updateOne(
        { _id: participantDoc._id },
        {
          $set: {
            admissionStatus: 'ADMITTED',
            admissionSessionId: sessionB,
            tokenEpoch: 2,
          },
        }
      );

      // 7. Release the pending sessionA eviction request
      assert.ok(pauseEvictionDeferred);
      pauseEvictionDeferred!();

      // Wait for Worker A's execution to resolve
      const outcomeA = await executionPromise;
      await workerA.stop();

      // 8. Verify simulated SFU removed sessionA
      assert.strictEqual(evictionCompletedInAdapter, true);
      assert.strictEqual(sfuConnectedParticipants.get(identityA)?.connected, false);

      // 9. Verify sessionB remains connected on SFU
      assert.strictEqual(
        sfuConnectedParticipants.get(identityB)?.connected,
        true,
        'sessionB must remain active and connected on the SFU'
      );

      // 10. Verify stale Worker A cannot persist authoritative completion
      assert.strictEqual(outcomeA.status, 'LEASE_LOST');
      const jobAfterWorkerA = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobAfterWorkerA?.status, 'PROCESSING');
      assert.strictEqual(jobAfterWorkerA?.leaseOwner, 'worker-B');

      // 11. Newer job owner (Worker B) safely reconciles the result
      const workerB = new LiveKitEvictionWorker({
        workerId: 'worker-B',
        pollIntervalMs: 0,
        livekit: controlledLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // Worker B marks completion under its valid leaseToken
      const updated = await workerB.markJobCompleted(jobAfterWorkerA!._id, stolenToken);
      assert.strictEqual(updated, true);

      const jobFinal = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobFinal?.status, 'COMPLETED');
      assert.strictEqual(sfuConnectedParticipants.get(identityB)?.connected, true);

      await workerB.stop();
    });
  });
});
