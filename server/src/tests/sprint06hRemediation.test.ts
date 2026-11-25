import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { envSchema } from '../config/env.js';
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
import { ServiceUnavailableError } from '../utils/errors.js';
import { parseLiveKitUserId as clientParseLiveKitUserId } from '../../../client/src/utils/mediaDevices.js';

describe('Sprint 06H — Targeted Reliability, Security & Production-Transaction Remediation Suite', () => {
  let evictionWorker: LiveKitEvictionWorker;
  let testUserHost: IUser;
  let testUserGuest: IUser;

  const sfuPresenceMap = new Map<string, boolean>();
  let sfuEvictionCalls: string[] = [];
  let sfuInspectionCalls: string[] = [];

  const mockAdapter = {
    listRooms: async () => [],
    createRoom: async (opts: any) => ({ name: opts.name, sid: `mock_sid_${opts.name}` }),
    deleteRoom: async () => {},
    getParticipant: async (roomName: string, identity: string) => {
      sfuInspectionCalls.push(identity);
      const isPresent = sfuPresenceMap.get(identity);
      if (isPresent) {
        return { identity, state: 'ACTIVE', sid: `p_sid_${identity}` };
      }
      return null;
    },
    removeParticipant: async (roomName: string, identity: string) => {
      sfuEvictionCalls.push(identity);
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
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    const mongoUri = 'mongodb://127.0.0.1:27017/connectly_test_sprint06h';
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    await ensureSecurityAuditReady();

    evictionWorker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 20_000,
      heartbeatIntervalMs: 5_000,
      requireTransactions: false,
    });
  });

  after(async () => {
    await evictionWorker.stop();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    sfuPresenceMap.clear();
    sfuEvictionCalls = [];
    sfuInspectionCalls = [];
    securityAudit.clear();

    await LiveKitEvictionJob.deleteMany({});
    await SecurityAuditEntry.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await User.deleteMany({});

    testUserHost = await User.create({
      firstName: 'Host',
      lastName: 'User',
      email: `host_${Date.now()}@test.local`,
      passwordHash: 'dummyhash',
      role: 'user',
    });

    testUserGuest = await User.create({
      firstName: 'Guest',
      lastName: 'User',
      email: `guest_${Date.now()}@test.local`,
      passwordHash: 'dummyhash',
      role: 'user',
    });
  });

  // =========================================================================
  // WORKSTREAM A — LEASE OWNERSHIP AFTER HEARTBEAT FAILURE (F-06G-01)
  // =========================================================================

  it('1. [F-06G-01] Transient DB failure during heartbeat does not forfeit lease if confirmed deadline is intact; subsequent recovery succeeds', async () => {
    const meeting = await Meeting.create({
      title: 'Sprint 06H Test Room 1',
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      meetingCode: 'cly-h01-rm1',
      expiresAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
    });

    const sessionId = generateAdmissionSessionId();
    const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
    sfuPresenceMap.set(identity, true);

    await MeetingParticipant.create({
      meetingId: meeting._id,
      userId: testUserGuest._id,
      displayName: 'Guest User',
      email: testUserGuest.email,
      role: 'participant',
      admissionStatus: 'REMOVED',
      presenceStatus: 'ONLINE',
      admissionSessionId: sessionId,
      requestedAt: new Date(),
    });

    const jobId = generateEvictionJobId(meeting._id.toString(), testUserGuest._id.toString(), 1, sessionId);
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserGuest._id,
      epoch: 1,
      sessionId,
      identity,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    let simulatedFailures = 1;
    let renewAttempts = 0;

    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 20_000,
      heartbeatIntervalMs: 30,
      requireTransactions: false,
    });

    const result = await worker.processJobById(jobId, {
      beforeLeaseRenew: async () => {
        renewAttempts++;
        if (simulatedFailures > 0) {
          simulatedFailures--;
          throw new Error('Simulated transient MongoDB network partition');
        }
      },
      beforeLiveKitCall: async () => {
        // Wait long enough for heartbeat intervals to fire
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    });

    await worker.stop();

    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(sfuEvictionCalls.length, 1);
    assert.strictEqual(sfuEvictionCalls[0], identity);
    assert.ok(renewAttempts >= 1, 'Heartbeat attempt was made');

    const finalJob = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(finalJob?.status, 'COMPLETED');
    assert.strictEqual(finalJob?.leaseOwner, null);
  });

  it('2. [F-06G-01] Continuous DB failure beyond confirmed deadline causes worker to flag leaseLost and abort', async () => {
    const meeting = await Meeting.create({
      title: 'Sprint 06H Test Room 2',
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      meetingCode: 'cly-h02-rm2',
      expiresAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
    });

    const sessionId = generateAdmissionSessionId();
    const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
    sfuPresenceMap.set(identity, true);

    await MeetingParticipant.create({
      meetingId: meeting._id,
      userId: testUserGuest._id,
      displayName: 'Guest User',
      email: testUserGuest.email,
      role: 'participant',
      admissionStatus: 'REMOVED',
      presenceStatus: 'ONLINE',
      admissionSessionId: sessionId,
      requestedAt: new Date(),
    });

    const jobId = generateEvictionJobId(meeting._id.toString(), testUserGuest._id.toString(), 1, sessionId);
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserGuest._id,
      epoch: 1,
      sessionId,
      identity,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    // Configure a very short lease duration (100ms) with simulated time warp
    let virtualNow = Date.now();
    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 100,
      heartbeatIntervalMs: 20,
      requireTransactions: false,
      nowFn: () => new Date(virtualNow),
    });

    const result = await worker.processJobById(jobId, {
      beforeLiveKitCall: async () => {
        // Warp time beyond confirmed lease deadline
        virtualNow += 500;
      },
    });

    await worker.stop();

    assert.strictEqual(result.status, 'LEASE_LOST');
    // Ensure LiveKit eviction was NOT executed after deadline expired
    assert.strictEqual(sfuEvictionCalls.length, 0);
  });

  it('3. [F-06G-01] Refuses to make external SFU calls if lease deadline expired before call', async () => {
    const meeting = await Meeting.create({
      title: 'Sprint 06H Test Room 3',
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      meetingCode: 'cly-h03-rm3',
      expiresAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
    });

    const sessionId = generateAdmissionSessionId();
    const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
    sfuPresenceMap.set(identity, true);

    await MeetingParticipant.create({
      meetingId: meeting._id,
      userId: testUserGuest._id,
      displayName: 'Guest User',
      email: testUserGuest.email,
      role: 'participant',
      admissionStatus: 'REMOVED',
      presenceStatus: 'ONLINE',
      admissionSessionId: sessionId,
      requestedAt: new Date(),
    });

    const jobId = generateEvictionJobId(meeting._id.toString(), testUserGuest._id.toString(), 1, sessionId);
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserGuest._id,
      epoch: 1,
      sessionId,
      identity,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    let virtualNow = Date.now();
    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 200,
      heartbeatIntervalMs: 0,
      requireTransactions: false,
      nowFn: () => new Date(virtualNow),
    });

    const result = await worker.processJobById(jobId, {
      afterAcquireBeforeExecution: async () => {
        // Warp time past 200ms lease duration
        virtualNow += 300;
      },
    });

    await worker.stop();

    assert.strictEqual(result.status, 'LEASE_LOST');
    assert.strictEqual(sfuInspectionCalls.length, 0);
    assert.strictEqual(sfuEvictionCalls.length, 0);
  });

  it('4. [F-06G-01] Lease stolen during LiveKit call prevents state modification and returns LEASE_LOST', async () => {
    const meeting = await Meeting.create({
      title: 'Sprint 06H Test Room 4',
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      meetingCode: 'cly-h04-rm4',
      expiresAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
    });

    const sessionId = generateAdmissionSessionId();
    const identity = getLiveKitParticipantIdentity(testUserGuest._id.toString(), sessionId);
    sfuPresenceMap.set(identity, true);

    await MeetingParticipant.create({
      meetingId: meeting._id,
      userId: testUserGuest._id,
      displayName: 'Guest User',
      email: testUserGuest.email,
      role: 'participant',
      admissionStatus: 'REMOVED',
      presenceStatus: 'ONLINE',
      admissionSessionId: sessionId,
      requestedAt: new Date(),
    });

    const jobId = generateEvictionJobId(meeting._id.toString(), testUserGuest._id.toString(), 1, sessionId);
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserGuest._id,
      epoch: 1,
      sessionId,
      identity,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    let virtualNow = Date.now();
    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 0,
      requireTransactions: false,
      nowFn: () => new Date(virtualNow),
    });

    const result = await worker.processJobById(jobId, {
      beforeLiveKitCall: async () => {
        // Another worker claims the job with a different leaseToken and advances leaseExpiresAt
        await LiveKitEvictionJob.updateOne(
          { jobId },
          {
            $set: {
              leaseOwner: 'worker-usurper-999',
              leaseToken: crypto.randomUUID(),
              leaseExpiresAt: new Date(virtualNow + 30_000),
            },
          }
        );
      },
      afterLiveKitCallBeforeStateUpdate: async () => {
        // Warp time to ensure original local deadline passed
        virtualNow += 2_000;
      },
    });

    await worker.stop();

    assert.strictEqual(result.status, 'LEASE_LOST');
    // Ensure the original job's leaseOwner is still the usurper, NOT completed by first worker
    const jobAfter = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(jobAfter?.leaseOwner, 'worker-usurper-999');
    assert.strictEqual(jobAfter?.status, 'PROCESSING');
  });

  it('5. [F-06G-01] Graceful shutdown settles heartbeats, active job executions, and sweeps cleanly', async () => {
    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      leaseDurationMs: 10_000,
      heartbeatIntervalMs: 50,
      requireTransactions: false,
    });

    let inProgress = false;

    const dummyJobId = generateEvictionJobId('m1', 'u1', 1, 's1');
    await LiveKitEvictionJob.create({
      jobId: dummyJobId,
      meetingId: new Types.ObjectId(),
      meetingCode: 'cly-h05-rm5',
      userId: new Types.ObjectId(),
      epoch: 1,
      sessionId: 's1',
      identity: 'usr_000000000000000000000001_s1',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    const jobPromise = worker.processJobById(dummyJobId, {
      afterAcquireBeforeExecution: async () => {
        inProgress = true;
        // Keep execution active briefly so external stop can overlap
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
    });

    // Wait until job is in flight
    while (!inProgress) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Trigger stop from outside the execution context
    const stopPromise = worker.stop();
    const [outcome] = await Promise.all([jobPromise, stopPromise]);

    assert.strictEqual(inProgress, true);
    assert.ok(['COMPLETED', 'LEASE_LOST'].includes(outcome.status));
  });

  // =========================================================================
  // WORKSTREAM B — STRICT JOB ID REDACTION (F-06G-03)
  // =========================================================================

  it('6. [F-06G-03] Preserves exact 64-hex string under case-insensitive jobId keys', () => {
    const sha256Hash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';

    const payload = {
      jobId: sha256Hash,
      jobid: sha256Hash,
      JOBID: sha256Hash,
      JobId: sha256Hash,
      otherKey: 'normal-value',
    };

    const sanitized = sanitizePayload(payload);
    assert.strictEqual(sanitized.jobId, sha256Hash);
    assert.strictEqual(sanitized.jobid, sha256Hash);
    assert.strictEqual(sanitized.JOBID, sha256Hash);
    assert.strictEqual(sanitized.JobId, sha256Hash);
    assert.strictEqual(sanitized.otherKey, 'normal-value');
  });

  it('7. [F-06G-03] Strictly redacts JWT tokens even if passed under the key jobId', () => {
    const jwtToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const payload = {
      jobId: jwtToken,
      nested: {
        jobId: jwtToken,
      },
    };

    const sanitized = sanitizePayload(payload);
    assert.strictEqual(sanitized.jobId, '[REDACTED]');
    assert.strictEqual(sanitized.nested.jobId, '[REDACTED]');
  });

  it('8. [F-06G-03] Redacts non-64-hex and secret-like strings passed under key jobId', () => {
    const payload = {
      jobId1: 'too-short-to-be-64-hex',
      jobId2: '0123456789abcdef', // 16 chars
      jobId3: 'Bearer secret_token_xyz',
      jobId4: 'password12345678',
    };

    const sanitized = sanitizePayload({
      jobId: payload.jobId1,
      nested: {
        jobId: payload.jobId2,
        secretJobId: payload.jobId3,
      },
    });

    assert.strictEqual(sanitized.jobId, '[REDACTED]');
    assert.strictEqual(sanitized.nested.jobId, '[REDACTED]');
    assert.strictEqual(sanitized.nested.secretJobId, '[REDACTED]');
  });

  it('9. [F-06G-03] Redacts 64-hex strings passed under non-jobId keys', () => {
    const sha256Hash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';

    const payload = {
      clientSecret: sha256Hash,
      authToken: sha256Hash,
      randomHash: sha256Hash,
      metadata: {
        hash: sha256Hash,
      },
    };

    const sanitized = sanitizePayload(payload);
    assert.strictEqual(sanitized.clientSecret, '[REDACTED]');
    assert.strictEqual(sanitized.authToken, '[REDACTED]');
    assert.strictEqual(sanitized.randomHash, '[REDACTED]');
    assert.strictEqual(sanitized.metadata.hash, '[REDACTED]');
  });

  it('10. [F-06G-03] Always redacts sensitive parent keys regardless of value', () => {
    const payload = {
      password: 'password-content',
      secret: 'secret-content',
      authorization: 'Bearer token-content',
      token: 'token-content',
    };

    const sanitized = sanitizePayload(payload);
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.secret, '[REDACTED]');
    assert.strictEqual(sanitized.authorization, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
  });

  // =========================================================================
  // WORKSTREAM C — PRODUCTION TRANSACTION ENFORCEMENT (F-06G-04)
  // =========================================================================

  function buildValidProdEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      NODE_ENV: 'production',
      PORT: '5000',
      MONGODB_URI: 'mongodb://127.0.0.1:27018/connectly_prod_test?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'prod_access_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
      JWT_REFRESH_SECRET: 'prod_refresh_secret_9876543210_abcdefghijklmnopqrstuvwxyz',
      CONNECTLY_ENCRYPTION_KEY_V1: '9f8e7d6c5b4a392817161514131211100f0e0d0c0b0a090807060504030201f0',
      CLIENT_ORIGIN: 'https://app.connectly.example',
      LIVEKIT_URL: 'wss://connectly.livekit.cloud',
      LIVEKIT_API_KEY: 'APIprodkey1234567890',
      LIVEKIT_API_SECRET: 'prodLiveKitSecretKey_9876543210_secure',
      LIVEKIT_SIGNAL_GATEWAY_ENABLED: 'auto',
      SOCKET_IO_ADAPTER: 'redis',
      SOCKET_IO_MULTI_INSTANCE: 'true',
      REDIS_URL: 'rediss://redis.prod.internal:6379',
      PROXY_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ...overrides,
    };
  }

  it('11. [F-06G-04] envSchema rejects NODE_ENV=production when REQUIRE_TRANSACTIONS=false', () => {
    const invalidProdEnv = buildValidProdEnv({ REQUIRE_TRANSACTIONS: 'false' });

    const parsed = envSchema.safeParse(invalidProdEnv);
    assert.strictEqual(parsed.success, false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes('REQUIRE_TRANSACTIONS'));
      assert.ok(issue, 'Found REQUIRE_TRANSACTIONS validation issue');
      assert.ok(
        issue.message.includes('REQUIRE_TRANSACTIONS=false is strictly prohibited in production'),
        `Expected error message, got: ${issue.message}`
      );
    }
  });

  it('12. [F-06G-04] envSchema permits production when REQUIRE_TRANSACTIONS is omitted or true', () => {
    const validProdEnvDefault = buildValidProdEnv();
    delete (validProdEnvDefault as any).REQUIRE_TRANSACTIONS;

    const parsedDefault = envSchema.safeParse(validProdEnvDefault);
    assert.strictEqual(parsedDefault.success, true);
    if (parsedDefault.success) {
      assert.strictEqual(parsedDefault.data.REQUIRE_TRANSACTIONS, 'auto');
    }

    const validProdEnvExplicit = buildValidProdEnv({
      REQUIRE_TRANSACTIONS: 'true',
    });
    const parsedExplicit = envSchema.safeParse(validProdEnvExplicit);
    assert.strictEqual(parsedExplicit.success, true);
    if (parsedExplicit.success) {
      assert.strictEqual(parsedExplicit.data.REQUIRE_TRANSACTIONS, 'true');
    }
  });

  it('13. [F-06G-04] Worker and services strictly enforce requireTransactions=true in production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
        // Caller attempts to pass requireTransactions: false
        requireTransactions: false,
      });

      // Private property inspection
      assert.strictEqual((worker as any).requireTransactions, true);

      const hub = new MeetingRealtimeHub();
      const coordinator = new LiveKitRevocationCoordinator({
        pollIntervalMs: 60_000,
        enableChangeStream: false,
        requireTransactions: false,
      });
      assert.strictEqual((coordinator as any).requireTransactions, true);

      const meetingService = new MeetingService(
        hub,
        { requireTransactions: false },
        mockLiveKit,
        new LiveKitSignalGateway(mockLiveKit, {}, coordinator),
        undefined,
        coordinator,
        { requireTransactions: false }
      );
      assert.strictEqual((meetingService as any).requireTransactions, true);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('14. [F-06G-04] operatorRetryJob fails closed with TRANSACTION_REQUIRED in production when transactions unsupported', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
      });

      // On standalone MongoDB (27017), transactions are unsupported
      await assert.rejects(
        async () => {
          await worker.operatorRetryJob('job-prod-standalone', 'admin-user');
        },
        (err: any) => {
          assert.ok(err instanceof ServiceUnavailableError);
          assert.strictEqual(err.code, 'TRANSACTION_REQUIRED');
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('15. [F-06G-04] operatorRetryJob fails closed if passed a non-transactional session in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
      });

      // Mock session where inTransaction() returns false
      const mockSession = {
        inTransaction: () => false,
      } as any;

      await assert.rejects(
        async () => {
          await worker.operatorRetryJob('job-prod-notx-session', 'admin-user', {
            session: mockSession,
          });
        },
        (err: any) => {
          assert.ok(err instanceof ServiceUnavailableError);
          assert.strictEqual(err.code, 'TRANSACTION_REQUIRED');
          assert.ok(err.message.includes('session must be within an active multi-document transaction'));
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('16. [F-06G-04] markJobEscalated fails closed with TRANSACTION_REQUIRED in production when transactions unsupported', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const worker = new LiveKitEvictionWorker({
        pollIntervalMs: 0,
        livekit: mockLiveKit,
      });

      const dummyJob = {
        _id: new Types.ObjectId(),
        jobId: 'job-escalate-prod',
        userId: new Types.ObjectId(),
        meetingId: new Types.ObjectId(),
        identity: 'usr_dummy',
      } as any;

      await assert.rejects(
        async () => {
          await (worker as any).markJobEscalated(
            dummyJob,
            'token-xyz',
            3,
            'Simulated exhaustion',
            new Date()
          );
        },
        (err: any) => {
          assert.ok(err instanceof ServiceUnavailableError);
          assert.strictEqual(err.code, 'TRANSACTION_REQUIRED');
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('17. [F-06G-04] Standalone MongoDB permits non-transactional execution in test/development', async () => {
    const worker = new LiveKitEvictionWorker({
      pollIntervalMs: 0,
      livekit: mockLiveKit,
      requireTransactions: false,
    });

    const dummyJobId = generateEvictionJobId('m-dev', 'u-dev', 1, 's-dev');
    await LiveKitEvictionJob.create({
      jobId: dummyJobId,
      meetingId: new Types.ObjectId(),
      meetingCode: 'cly-h17-rm7',
      userId: new Types.ObjectId(),
      epoch: 1,
      sessionId: 's-dev',
      identity: 'usr_000000000000000000000001_sdev',
      status: 'ESCALATED',
      attempts: 3,
      maxAttempts: 3,
      nextRunAt: new Date(),
    });

    // In dev/test when requireTransactions is false, operator retry succeeds with rollback fallback
    const result = await worker.operatorRetryJob(dummyJobId, 'dev-operator');
    assert.strictEqual(result.success, true);

    const updatedJob = await LiveKitEvictionJob.findOne({ jobId: dummyJobId });
    assert.strictEqual(updatedJob?.status, 'PENDING');
    assert.strictEqual(updatedJob?.attempts, 0);
  });

  // =========================================================================
  // WORKSTREAM D — SESSION FORMAT & UUID CLARIFICATION (F-06G-02)
  // =========================================================================

  it('18. [F-06G-02] Exact 12-char hex session IDs parse cleanly on backend and client', () => {
    const userIdHex = '65f0a1b2c3d4e5f6a7b8c9e2';
    const session12Hex = 'a1b2c3d4e5f6';
    const identity = `usr_${userIdHex}_${session12Hex}`;

    assert.strictEqual(parseLiveKitParticipantUserId(identity), userIdHex);
    assert.strictEqual(parseLiveKitParticipantSessionId(identity), session12Hex);
    assert.strictEqual(clientParseLiveKitUserId(identity), userIdHex);
  });

  it('19. [F-06G-02] Un-hyphenated 32-hex UUIDs parse cleanly on backend and client', () => {
    const userIdHex = '65f0a1b2c3d4e5f6a7b8c9e2';
    const session32Hex = '550e8400e29b41d4a716446655440000';
    const identity = `usr_${userIdHex}_${session32Hex}`;

    assert.strictEqual(parseLiveKitParticipantUserId(identity), userIdHex);
    assert.strictEqual(parseLiveKitParticipantSessionId(identity), session32Hex);
    assert.strictEqual(clientParseLiveKitUserId(identity), userIdHex);
  });

  it('20. [F-06G-02] Standard RFC 4122 hyphenated UUIDs return null under alphanumeric regexes on backend', () => {
    const userIdHex = '65f0a1b2c3d4e5f6a7b8c9e2';
    const hyphenatedUuid = '550e8400-e29b-41d4-a716-446655440000';
    const identity = `usr_${userIdHex}_${hyphenatedUuid}`;

    // Confirms F-06G-02 finding: hyphens are rejected by [a-zA-Z0-9]+ regex
    assert.strictEqual(parseLiveKitParticipantUserId(identity), null);
    assert.strictEqual(parseLiveKitParticipantSessionId(identity), null);
  });

  it('21. [F-06G-02] Standard RFC 4122 hyphenated UUIDs return null on client parser', () => {
    const userIdHex = '65f0a1b2c3d4e5f6a7b8c9e2';
    const hyphenatedUuid = '550e8400-e29b-41d4-a716-446655440000';
    const identity = `usr_${userIdHex}_${hyphenatedUuid}`;

    assert.strictEqual(clientParseLiveKitUserId(identity), null);
  });
});
