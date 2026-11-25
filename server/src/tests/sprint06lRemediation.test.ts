import assert from 'node:assert';
import crypto from 'node:crypto';
import { describe, it, before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import {
  sanitizePayload,
  securityAudit,
} from '../utils/securityAudit.js';
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
  SecurityAuditEntry,
  ensureSecurityAuditReady,
} from '../models/SecurityAuditEntry.model.js';
import {
  LiveKitService,
  getLiveKitParticipantIdentity,
  type LiveKitRoomClientAdapter,
} from '../services/livekit.service.js';

const VALID_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const VALID_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('Sprint 06L — Targeted Sanitizer Exact-Key & Lease-Safe Deferral Remediation Suite', () => {
  let testHostUser: any;
  let testGuestUser: any;
  let testMeeting: any;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect('mongodb://127.0.0.1:27017/connectly_test_sprint06l', {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
    }
    await ensureSecurityAuditReady();

    await User.deleteMany({ email: /@test-sprint06l\.io$/ });
    await Meeting.deleteMany({ title: /Sprint 06L/ });
    await MeetingParticipant.deleteMany({});
    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});

    testHostUser = await User.create({
      firstName: 'Host',
      lastName: 'User 06L',
      email: 'host@test-sprint06l.io',
      passwordHash: 'argon2id$mockedhash',
      role: 'user',
    });

    testGuestUser = await User.create({
      firstName: 'Guest',
      lastName: 'User 06L',
      email: 'guest@test-sprint06l.io',
      passwordHash: 'argon2id$mockedhash',
      role: 'user',
    });

    testMeeting = await Meeting.create({
      title: 'Sprint 06L Test Meeting',
      meetingCode: 'cly-s6l-tst',
      hostId: testHostUser._id,
      originalHostId: testHostUser._id,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86400000),
      settings: {
        waitingRoomEnabled: true,
        allowChat: true,
        allowScreenShare: true,
      },
    });
  });

  after(async () => {
    await User.deleteMany({ email: /@test-sprint06l\.io$/ });
    await Meeting.deleteMany({ title: /Sprint 06L/ });
    await MeetingParticipant.deleteMany({});
    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});
    await mongoose.disconnect();
  });

  // =========================================================================
  // WORKSTREAM A: F-06K-01 STRICT EXACT jobId KEY MATCHING
  // =========================================================================
  describe('Workstream A — Strict Exact jobId Key Matching (F-06K-01)', () => {
    it('1. Exact permitted key variants preserve valid 64-hex hashes (jobId, jobid, JOBID, JobId)', () => {
      const payload = {
        jobId: VALID_SHA256,
        jobid: VALID_SHA256,
        JOBID: VALID_SHA256,
        JobId: VALID_SHA256,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.jobId, VALID_SHA256);
      assert.strictEqual(sanitized.jobid, VALID_SHA256);
      assert.strictEqual(sanitized.JOBID, VALID_SHA256);
      assert.strictEqual(sanitized.JobId, VALID_SHA256);
    });

    it('2. Hyphenated, underscored, and dotted variants redact (job-id, job_id, job.id)', () => {
      const payload = {
        'job-id': VALID_SHA256,
        job_id: VALID_SHA256,
        'job.id': VALID_SHA256,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized['job-id'], '[REDACTED]', 'job-id must be redacted');
      assert.strictEqual(sanitized.job_id, '[REDACTED]', 'job_id must be redacted');
      assert.strictEqual(sanitized['job.id'], '[REDACTED]', 'job.id must be redacted');
    });

    it('3. Prefix and suffix variants redact (myJobId, jobIdHash, thisJobId, jobId123)', () => {
      const payload = {
        myJobId: VALID_SHA256,
        jobIdHash: VALID_SHA256,
        thisJobId: VALID_SHA256,
        jobId123: VALID_SHA256,
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.myJobId, '[REDACTED]');
      assert.strictEqual(sanitized.jobIdHash, '[REDACTED]');
      assert.strictEqual(sanitized.thisJobId, '[REDACTED]');
      assert.strictEqual(sanitized.jobId123, '[REDACTED]');
    });

    it('4. Sensitive compound keys redact regardless of casing, delimiters, and jobId inclusion', () => {
      const payload = {
        clientSecretJobId: VALID_SHA256,
        api_key: 'sensitive-api-key',
        db_password: 'super-secret-db-pass',
        user_password: 'plain-user-password',
        secret_key: 'sk_live_1234567890',
        refreshToken: 'rt_live_refresh_token_string',
        access_token: 'at_live_access_token_string',
        privateKey: '-----BEGIN PRIVATE KEY-----',
        jwtToken: VALID_JWT,
        authorizationHeader: 'Bearer my-bearer-token',
        sessionCookie: 'connect.sid=1234567890',
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.clientSecretJobId, '[REDACTED]');
      assert.strictEqual(sanitized.api_key, '[REDACTED]');
      assert.strictEqual(sanitized.db_password, '[REDACTED]');
      assert.strictEqual(sanitized.user_password, '[REDACTED]');
      assert.strictEqual(sanitized.secret_key, '[REDACTED]');
      assert.strictEqual(sanitized.refreshToken, '[REDACTED]');
      assert.strictEqual(sanitized.access_token, '[REDACTED]');
      assert.strictEqual(sanitized.privateKey, '[REDACTED]');
      assert.strictEqual(sanitized.jwtToken, '[REDACTED]');
      assert.strictEqual(sanitized.authorizationHeader, '[REDACTED]');
      assert.strictEqual(sanitized.sessionCookie, '[REDACTED]');
    });

    it('5. Sensitive parent objects shield child values (including nested jobId)', () => {
      const payload = {
        clientSecret: {
          jobId: VALID_SHA256,
          childData: 'must-never-leak',
        },
        apiKey: {
          jobId: VALID_SHA256,
          token: 'inner-token',
        },
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.clientSecret, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
    });

    it('6. Nested arrays and objects remain sanitized', () => {
      const payload = {
        outer: {
          innerList: [
            { 'job-id': VALID_SHA256, legitimateJobId: { jobId: VALID_SHA256 } },
            { user_password: 'pwd', name: 'Bob' },
          ],
        },
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.outer.innerList[0]['job-id'], '[REDACTED]');
      assert.strictEqual(sanitized.outer.innerList[0].legitimateJobId.jobId, VALID_SHA256);
      assert.strictEqual(sanitized.outer.innerList[1].user_password, '[REDACTED]');
      assert.strictEqual(sanitized.outer.innerList[1].name, 'Bob');
    });

    it('7. JWT-like and sensitive values redact even under exact jobId', () => {
      const payload = {
        caseA: { jobId: VALID_JWT },
        caseB: { jobId: 'Bearer secret-bearer-token' },
        caseC: { jobId: 'sk_live_1234567890abcdef' },
        caseD: { jobId: 'not-a-hex-sha256-string-too-short' },
      };

      const sanitized = sanitizePayload(payload);

      assert.strictEqual(sanitized.caseA.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseB.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseC.jobId, '[REDACTED]');
      assert.strictEqual(sanitized.caseD.jobId, '[REDACTED]');
    });

    it('8. Both sync and async logging paths sanitize before stdout emission and MongoDB persistence', async () => {
      const rawDetails = {
        jobId: VALID_SHA256,
        'job-id': VALID_SHA256,
        job_id: VALID_SHA256,
        clientSecret: 'secret-to-redact',
        api_key: 'key-to-redact',
        normalTag: 'safe-metadata',
      };

      // 1. Sync log
      const syncEvent = securityAudit.log({
        eventType: 'EVICTION_OPERATOR_RETRY',
        details: rawDetails,
        jobId: VALID_SHA256,
      });

      assert.strictEqual(syncEvent.details?.jobId, VALID_SHA256);
      assert.strictEqual(syncEvent.details?.['job-id'], '[REDACTED]');
      assert.strictEqual(syncEvent.details?.job_id, '[REDACTED]');
      assert.strictEqual(syncEvent.details?.clientSecret, '[REDACTED]');
      assert.strictEqual(syncEvent.details?.api_key, '[REDACTED]');
      assert.strictEqual(syncEvent.details?.normalTag, 'safe-metadata');

      // 2. Async log with DB persistence
      const asyncEvent = await securityAudit.logAsync({
        eventType: 'EVICTION_OPERATOR_RETRY',
        details: rawDetails,
        jobId: VALID_SHA256,
      });

      const dbDoc = await SecurityAuditEntry.findOne({ eventId: asyncEvent.id });
      assert.ok(dbDoc, 'SecurityAuditEntry must exist in MongoDB');
      assert.strictEqual(dbDoc.details?.jobId, VALID_SHA256);
      assert.strictEqual(dbDoc.details?.['job-id'], '[REDACTED]');
      assert.strictEqual(dbDoc.details?.job_id, '[REDACTED]');
      assert.strictEqual(dbDoc.details?.clientSecret, '[REDACTED]');
      assert.strictEqual(dbDoc.details?.api_key, '[REDACTED]');
      assert.strictEqual(dbDoc.details?.normalTag, 'safe-metadata');
    });
  });

  // =========================================================================
  // WORKSTREAM B: F-06K-02 SAFE LEASE-MARGIN DEFERRAL
  // =========================================================================
  describe('Workstream B — Safe Lease-Margin Deferral (F-06K-02)', () => {
    let mockLiveKit: LiveKitService;
    let sfuGetCallsCount: number;
    let sfuEvictCallsCount: number;

    beforeEach(async () => {
      sfuGetCallsCount = 0;
      sfuEvictCallsCount = 0;
      await MeetingParticipant.deleteMany({});
      await LiveKitEvictionJob.deleteMany({});

      mockLiveKit = {
        isConfigured: () => true,
        getParticipant: async () => {
          sfuGetCallsCount++;
          return { identity: 'usr_present' };
        },
        evictParticipant: async () => {
          sfuEvictCallsCount++;
          return { success: true };
        },
      } as unknown as LiveKitService;
    });

    it('1. Pre-presence check inside the safety margin dispatches no SFU request and defers safely', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L1',
        email: 'guestl1@test.io',
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
        userId: testGuestUser._id,
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

      // Warp time to T=9,500ms before presence check (only 500ms remaining <= 1000ms margin)
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 9_500;
        },
      });
      await worker.stop();

      // Verified: Status is DEFERRED, no SFU call was dispatched
      assert.strictEqual(outcome.status, 'DEFERRED');
      assert.strictEqual(sfuGetCallsCount, 0);
      assert.strictEqual(sfuEvictCallsCount, 0);

      // Verified: Document transitioned to PENDING with attempts unchanged
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.status, 'PENDING');
      assert.strictEqual(jobInDb?.attempts, 0, 'Attempts must remain unchanged on deferral');
      assert.strictEqual(jobInDb?.leaseOwner, null, 'Lease must be released');
      assert.strictEqual(jobInDb?.leaseToken, null);
      assert.strictEqual(jobInDb?.leaseExpiresAt, null);
      assert.ok(jobInDb?.nextRunAt && jobInDb.nextRunAt.getTime() > virtualNow, 'nextRunAt must be in future');
    });

    it('2. Pre-eviction check inside the safety margin dispatches no eviction request and defers safely', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L2',
        email: 'guestl2@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 1, // Pre-existing attempt count
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      // Mock LiveKit that warps time inside getParticipant so that pre-eviction check triggers safety margin
      const warpingLiveKit = {
        isConfigured: () => true,
        getParticipant: async () => {
          sfuGetCallsCount++;
          virtualNow += 9_500; // Warp time past safety margin threshold
          return { identity: 'usr_present' };
        },
        evictParticipant: async () => {
          sfuEvictCallsCount++;
          return { success: true };
        },
      } as unknown as LiveKitService;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: warpingLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      const outcome = await worker.processJobById(jobId);
      await worker.stop();

      // Verified: getParticipant ran, but evictParticipant was NOT dispatched
      assert.strictEqual(sfuGetCallsCount, 1);
      assert.strictEqual(sfuEvictCallsCount, 0, 'No eviction call should be dispatched within safety margin');
      assert.strictEqual(outcome.status, 'DEFERRED');

      // Verified: attempts remained 1 (NOT incremented to 2) and status in DB is PENDING (NOT FAILED or ESCALATED)
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.status, 'PENDING');
      assert.strictEqual(jobInDb?.attempts, 1, 'Attempts must not be consumed on pre-eviction deferral');
      assert.strictEqual(jobInDb?.leaseOwner, null);
    });

    it('3. Both deferral paths leave attempts unchanged and do not escalate', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L3',
        email: 'guestl3@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      // Job is at attempts: 2 with maxAttempts: 3 (one more failure would escalate)
      await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 2,
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

      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 9_200; // 800ms remaining <= 1000ms margin
        },
      });
      await worker.stop();

      assert.strictEqual(outcome.status, 'DEFERRED');
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.status, 'PENDING');
      assert.strictEqual(jobInDb?.attempts, 2, 'Must NOT increment attempts to 3');
      assert.notStrictEqual(jobInDb?.status, 'ESCALATED', 'Must NOT escalate on deferral');
    });

    it('4. A validly owned deferred job becomes safely reclaimable without waiting for original lease expiry', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L4',
        email: 'guestl4@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      const worker1 = new LiveKitEvictionWorker({
        workerId: 'worker-1',
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 20_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      // Worker 1 hits safety margin (T=19,500ms on 20,000ms lease)
      await worker1.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 19_500;
        },
      });
      await worker1.stop();

      // In DB, lease fields are cleared immediately
      const deferredJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(deferredJob?.status, 'PENDING');
      assert.strictEqual(deferredJob?.leaseOwner, null);
      assert.strictEqual(deferredJob?.leaseExpiresAt, null);

      // Advance clock past deferral delay (1,000ms)
      virtualNow += 1_500;

      // Worker 2 can immediately claim the deferred job
      const worker2 = new LiveKitEvictionWorker({
        workerId: 'worker-2',
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 20_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      const outcome2 = await worker2.processJobById(jobId);
      await worker2.stop();

      assert.strictEqual(outcome2.status, 'COMPLETED');
      const finalJob = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(finalJob?.status, 'COMPLETED');
    });

    it('5. Deferral does not create an immediate repeated processing loop in processDueJobs', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L5',
        email: 'guestl5@test.io',
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
        userId: testGuestUser._id,
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
        hooks: {
          beforeLiveKitCall: async () => {
            virtualNow += 9_500;
          },
        },
      });

      // Sweep 1: Job is claimed, hits margin, and deferred with nextRunAt in future
      const summary1 = await worker.processDueJobs();
      assert.strictEqual(summary1.scanned, 1);
      assert.strictEqual(summary1.deferred, 1);

      // Sweep 2 immediately at virtualNow: Job is NOT due (nextRunAt > virtualNow) -> 0 scanned
      const summary2 = await worker.processDueJobs();
      assert.strictEqual(summary2.scanned, 0, 'Deferred job must not hot-loop in immediate subsequent sweep');

      await worker.stop();
    });

    it('6. A stale lease token cannot defer or release the job after theft', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L6',
        email: 'guestl6@test.io',
        role: 'participant',
        admissionStatus: 'REMOVED',
        presenceStatus: 'ONLINE',
        admissionSessionId: sessionId,
        tokenEpoch: 1,
      });

      const initialToken = crypto.randomUUID();
      const jobDoc = await LiveKitEvictionJob.create({
        jobId,
        meetingId: testMeeting._id,
        meetingCode: testMeeting.meetingCode,
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PROCESSING',
        leaseOwner: 'worker-stale',
        leaseToken: initialToken,
        leaseExpiresAt: new Date(Date.now() + 5_000),
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      const worker = new LiveKitEvictionWorker({
        workerId: 'worker-stale',
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        requireTransactions: false,
      });

      // Simulates Worker B stealing the job with a new token
      const stolenToken = crypto.randomUUID();
      await LiveKitEvictionJob.updateOne(
        { _id: jobDoc._id },
        { $set: { leaseOwner: 'worker-usurper', leaseToken: stolenToken } }
      );

      // Stale worker tries to defer with old token
      const deferSuccess = await worker.deferJobUnderSafetyMargin(
        jobDoc._id,
        initialToken,
        new Date(),
        'Stale attempt to defer'
      );

      assert.strictEqual(deferSuccess, false, 'Stale worker update must return false (0 matched)');

      const currentInDb = await LiveKitEvictionJob.findById(jobDoc._id);
      assert.strictEqual(currentInDb?.status, 'PROCESSING');
      assert.strictEqual(currentInDb?.leaseOwner, 'worker-usurper');
      assert.strictEqual(currentInDb?.leaseToken, stolenToken);

      await worker.stop();
    });

    it('7. Heartbeat success before the check extends the deadline and permits request', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L7',
        email: 'guestl7@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      let heartbeatFired = false;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 50,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
        hooks: {
          afterLeaseRenew: async (_id, renewed) => {
            if (renewed) heartbeatFired = true;
          },
        },
      });

      // At T=8,000ms, heartbeat fires and successfully renews lease for another 10,000ms
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 8_000;
          await new Promise((r) => setTimeout(r, 80)); // Allow heartbeat to tick
        },
      });
      await worker.stop();

      assert.strictEqual(heartbeatFired, true, 'Heartbeat must have successfully renewed lease');
      assert.strictEqual(outcome.status, 'COMPLETED', 'SFU operation permitted because lease was extended');
      assert.ok(sfuGetCallsCount >= 1);
    });

    it('8. Heartbeat failure does not extend confirmed deadline and aborts SFU call inside margin', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L8',
        email: 'guestl8@test.io',
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
        userId: testGuestUser._id,
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
        heartbeatIntervalMs: 50,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
        hooks: {
          beforeLeaseRenew: async () => {
            throw new Error('Simulated transient MongoDB network failure on heartbeat');
          },
        },
      });

      // Advance to T=4,500ms (500ms remaining <= 1000ms margin) with failed heartbeat
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 4_500;
          await new Promise((r) => setTimeout(r, 60));
        },
      });
      await worker.stop();

      assert.strictEqual(sfuGetCallsCount, 0, 'Must NOT dispatch SFU call');
      assert.strictEqual(outcome.status, 'DEFERRED');
    });

    it('9. Actual lease expiry remains a separate non-authoritative LEASE_LOST outcome', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L9',
        email: 'guestl9@test.io',
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
        userId: testGuestUser._id,
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

      // Warp past confirmed lease deadline (T=6,000ms > 5,000ms)
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 6_000;
        },
      });
      await worker.stop();

      // Confirmed lease deadline passed -> LEASE_LOST (NOT DEFERRED)
      assert.strictEqual(outcome.status, 'LEASE_LOST');
      assert.strictEqual(sfuGetCallsCount, 0);
    });

    it('10. A genuine dispatched SFU failure still consumes attempts and follows existing retry backoff', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L10',
        email: 'guestl10@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      const failingLiveKit = {
        isConfigured: () => true,
        getParticipant: async () => ({ identity: 'usr_present' }),
        evictParticipant: async () => {
          sfuEvictCallsCount++;
          return { success: false, error: 'LiveKit 503 Service Unavailable' };
        },
      } as unknown as LiveKitService;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: failingLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
      });

      const outcome = await worker.processJobById(jobId);
      await worker.stop();

      // Genuine SFU call was dispatched and failed
      assert.strictEqual(sfuEvictCallsCount, 1);
      assert.strictEqual(outcome.status, 'FAILED');
      assert.strictEqual(outcome.attempts, 1);

      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.status, 'FAILED');
      assert.strictEqual(jobInDb?.attempts, 1, 'Genuine failure must increment attempts');
    });

    it('11. A genuine failure reaches the established escalation threshold on maxAttempts', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L11',
        email: 'guestl11@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 2,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      const failingLiveKit = {
        isConfigured: () => true,
        getParticipant: async () => ({ identity: 'usr_present' }),
        evictParticipant: async () => ({ success: false, error: 'Fatal SFU 500 Internal Error' }),
      } as unknown as LiveKitService;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: failingLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
      });

      const outcome = await worker.processJobById(jobId);
      await worker.stop();

      assert.strictEqual(outcome.status, 'ESCALATED');
      assert.strictEqual(outcome.attempts, 3);

      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.status, 'ESCALATED');
      assert.strictEqual(jobInDb?.attempts, 3);
    });

    it('12. No rejected safety-margin path can mark the job COMPLETED', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L12',
        email: 'guestl12@test.io',
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
        userId: testGuestUser._id,
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
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 4_500;
        },
      });
      await worker.stop();

      assert.notStrictEqual(outcome.status, 'COMPLETED');
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.notStrictEqual(jobInDb?.status, 'COMPLETED');
      assert.strictEqual(jobInDb?.status, 'PENDING');
    });

    it('13. Heartbeat cleanup occurs on deferral path and settles in-flight promises', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L13',
        email: 'guestl13@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
        epoch: 1,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextRunAt: new Date(),
      });

      let virtualNow = Date.now();
      let heartbeatTicks = 0;

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        leaseDurationMs: 10_000,
        heartbeatIntervalMs: 50,
        leaseSafetyMarginMs: 1_000,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
        hooks: {
          afterLeaseRenew: async () => {
            heartbeatTicks++;
          },
        },
      });

      // Warp time to trigger deferral
      const outcome = await worker.processJobById(jobId, {
        beforeLiveKitCall: async () => {
          virtualNow += 9_500;
        },
      });

      assert.strictEqual(outcome.status, 'DEFERRED');

      // Wait a moment: heartbeat timer MUST be cleared by finally block, so heartbeatTicks must not increment
      const ticksAtExit = heartbeatTicks;
      await new Promise((r) => setTimeout(r, 120));
      assert.strictEqual(heartbeatTicks, ticksAtExit, 'Heartbeat timer must not continue firing after deferral');

      await worker.stop();
    });

    it('14. Worker A cannot overwrite Worker B state after lease theft', async () => {
      const sessionId = generateAdmissionSessionId();
      const identity = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionId);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionId);

      await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest L14',
        email: 'guestl14@test.io',
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
        userId: testGuestUser._id,
        identity,
        sessionId,
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
        livekit: mockLiveKit,
        leaseDurationMs: 5_000,
        heartbeatIntervalMs: 0,
        leaseSafetyMarginMs: 500,
        requireTransactions: false,
        nowFn: () => new Date(virtualNow),
      });

      const outcome = await workerA.processJobById(jobId, {
        afterLiveKitCallBeforeStateUpdate: async () => {
          // Worker B steals the job in MongoDB
          virtualNow += 6_000;
          await LiveKitEvictionJob.updateOne(
            { jobId },
            {
              $set: {
                leaseOwner: 'worker-B',
                leaseToken: crypto.randomUUID(),
                leaseExpiresAt: new Date(virtualNow + 20_000),
                status: 'PROCESSING',
              },
            }
          );
        },
      });
      await workerA.stop();

      assert.strictEqual(outcome.status, 'LEASE_LOST');
      const jobInDb = await LiveKitEvictionJob.findOne({ jobId });
      assert.strictEqual(jobInDb?.leaseOwner, 'worker-B');
      assert.strictEqual(jobInDb?.status, 'PROCESSING');
    });

    it('15. Controlled in-flight race: delayed sessionA removal leaves re-admitted sessionB connected on SFU', async () => {
      const sfuConnectedParticipants = new Map<string, { identity: string; connected: boolean }>();

      let pauseEvictionDeferred: (() => void) | null = null;
      const pauseEvictionPromise = new Promise<void>((resolve) => {
        pauseEvictionDeferred = resolve;
      });

      let evictionCallReachedAdapter = false;

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
          await pauseEvictionPromise;
          const p = sfuConnectedParticipants.get(identity);
          if (p) p.connected = false;
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

      const sessionA = generateAdmissionSessionId();
      const identityA = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionA);
      const jobId = generateEvictionJobId(testMeeting._id.toString(), testGuestUser._id, 1, sessionA);

      sfuConnectedParticipants.set(identityA, { identity: identityA, connected: true });

      const participantDoc = await MeetingParticipant.create({
        meetingId: testMeeting._id,
        userId: testGuestUser._id,
        displayName: 'Guest Concurrent 06L',
        email: 'guestconcurrent06l@test.io',
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
        userId: testGuestUser._id,
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

      const executionPromise = workerA.processJobById(jobId);

      while (!evictionCallReachedAdapter) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Expire Worker A's lease and steal the job for Worker B
      virtualNow += 5_000;
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

      // Re-admit user under sessionB
      const sessionB = generateAdmissionSessionId();
      const identityB = getLiveKitParticipantIdentity(testGuestUser._id.toString(), sessionB);

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

      // Release Worker A's stalled eviction
      assert.ok(pauseEvictionDeferred);
      pauseEvictionDeferred!();

      const outcomeA = await executionPromise;
      await workerA.stop();

      // Session A was evicted, session B remains connected on SFU
      assert.strictEqual(sfuConnectedParticipants.get(identityA)?.connected, false);
      assert.strictEqual(sfuConnectedParticipants.get(identityB)?.connected, true);
      assert.strictEqual(outcomeA.status, 'LEASE_LOST');
    });
  });
});
