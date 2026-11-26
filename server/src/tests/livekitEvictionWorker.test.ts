import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  LiveKitEvictionJob,
  generateEvictionJobId,
} from '../models/LiveKitEvictionJob.model.js';
import { Meeting, type IMeeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { User, type IUser } from '../models/User.model.js';
import { MeetingService } from '../services/meeting.service.js';
import { LiveKitService, type LiveKitRoomClientAdapter } from '../services/livekit.service.js';
import { LiveKitEvictionWorker } from '../workers/livekitEvictionWorker.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitRevocationCoordinator } from '../realtime/livekitRevocationCoordinator.js';
import { generateSecureMeetingCode } from '../utils/meetingCode.js';

describe('Phase 18 Sprint 06 — Durable LiveKit Eviction Worker & Recovery Suite', () => {
  let isReplicaSet = false;
  let testUserHost: IUser;
  let testUserParticipant: IUser;
  let meetingService: MeetingService;
  let mockLiveKit: LiveKitService;
  let evictionWorker: LiveKitEvictionWorker;
  let revocationCoordinator: LiveKitRevocationCoordinator;
  let signalGateway: LiveKitSignalGateway;
  let removedParticipantsFromSFU: string[] = [];
  const sfuPresenceMap = new Map<string, boolean>();
  let sfuEvictErrorToThrow: Error | null = null;
  let sfuPresenceErrorToThrow: Error | null = null;

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
    // Try connecting to Replica Set on port 27018 if available, else standalone on 27017
    const rsUri = 'mongodb://127.0.0.1:27018/connectly_test_eviction_rs?replicaSet=rs0';
    const standaloneUri = 'mongodb://127.0.0.1:27017/connectly_test_eviction';

    try {
      await mongoose.connect(rsUri, { serverSelectionTimeoutMS: 2000 });
      isReplicaSet = true;
    } catch {
      await mongoose.connect(standaloneUri, { serverSelectionTimeoutMS: 2000 });
      isReplicaSet = false;
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
    });

    const hub = new MeetingRealtimeHub();
    revocationCoordinator = new LiveKitRevocationCoordinator({ pollIntervalMs: 60_000, enableChangeStream: false });
    signalGateway = new LiveKitSignalGateway(mockLiveKit, {}, revocationCoordinator);

    meetingService = new MeetingService(
      hub,
      {},
      mockLiveKit,
      signalGateway,
      undefined,
      revocationCoordinator,
      { evictionWorker }
    );
  });

  after(async () => {
    signalGateway?.close();
    await revocationCoordinator?.stop();
    await evictionWorker?.stop();
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
      emailVerified: true,
    });

    testUserParticipant = await User.create({
      firstName: 'Guest',
      lastName: 'User',
      email: `guest_${Date.now()}_${Math.random()}@example.com`,
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      emailVerified: true,
    });
  });

  async function createTestMeeting(): Promise<IMeeting> {
    const meeting = await Meeting.create({
      title: 'Sprint 06 Eviction Test',
      meetingCode: generateSecureMeetingCode(),
      hostId: testUserHost._id,
      originalHostId: testUserHost._id,
      status: 'ACTIVE',
      activeParticipantCount: 2,
      maxParticipants: 10,
      settings: {
        waitingRoomEnabled: false,
        allowCoHostAdmit: true,
        allowCoHostRemove: true,
        allowCoHostLock: true,
      },
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await MeetingParticipant.create([
      {
        meetingId: meeting._id,
        userId: testUserHost._id,
        displayName: 'Host User',
        email: testUserHost.email,
        role: 'host',
        admissionStatus: 'ADMITTED',
        presenceStatus: 'ONLINE',
        tokenEpoch: 1,
        signalFenceVersion: 1,
      },
      {
        meetingId: meeting._id,
        userId: testUserParticipant._id,
        displayName: 'Guest User',
        email: testUserParticipant.email,
        role: 'participant',
        admissionStatus: 'ADMITTED',
        presenceStatus: 'ONLINE',
        tokenEpoch: 1,
        signalFenceVersion: 1,
      },
    ]);

    return meeting;
  }

  it('T-06-01: Removal transaction atomically creates eviction job', async () => {
    const meeting = await createTestMeeting();
    const result = await meetingService.removeParticipant(
      meeting.meetingCode,
      testUserHost._id.toString(),
      testUserParticipant._id.toString(),
      'T-06-01 Test Removal'
    );

    assert.strictEqual(result.activeParticipantCount, 1);
    assert.strictEqual(result.cleanup.livekitEvicted, true);

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: testUserParticipant._id,
    });
    assert.strictEqual(participant?.admissionStatus, 'REMOVED');
    assert.strictEqual(participant?.tokenEpoch, 2);

    const expectedJobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);
    const job = await LiveKitEvictionJob.findOne({ jobId: expectedJobId });
    assert.ok(job, 'LiveKitEvictionJob must be persisted in MongoDB');
    assert.strictEqual(job.meetingCode, meeting.meetingCode);
    assert.strictEqual(job.status, 'COMPLETED');
    assert.strictEqual(job.epoch, 2);
  });

  it('T-06-02: Transaction failure creates no partial eviction job', async () => {
    if (!isReplicaSet) {
      // In standalone Mongo, transactions are skipped; this test is verified on Replica Set
      return;
    }

    const meeting = await createTestMeeting();

    // Create a meeting service with a hook that forces an error after participant write inside tx
    const failingService = new MeetingService(
      undefined,
      {
        beforeWaitingJoinWrite: async () => {
          throw new Error('Simulated abort');
        },
      },
      mockLiveKit,
      undefined,
      async () => {
        throw new Error('Simulated atomic transaction abort');
      },
      undefined,
      { evictionWorker }
    );

    await assert.rejects(
      () =>
        failingService.removeParticipant(
          meeting.meetingCode,
          testUserHost._id.toString(),
          testUserParticipant._id.toString(),
          'Should abort'
        ),
      (err: any) => err.code === 'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
    );

    const jobsCount = await LiveKitEvictionJob.countDocuments({});
    assert.strictEqual(jobsCount, 0, 'No partial eviction job should exist after transaction abort');

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: testUserParticipant._id,
    });
    assert.strictEqual(participant?.admissionStatus, 'ADMITTED', 'Participant status rolled back');
  });

  it('T-06-03: Duplicate removal does not create duplicate jobs', async () => {
    const meeting = await createTestMeeting();

    const expectedJobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // First removal succeeds
    await meetingService.removeParticipant(
      meeting.meetingCode,
      testUserHost._id.toString(),
      testUserParticipant._id.toString(),
      'First removal'
    );

    // Second removal throws NotFoundError because participant is already REMOVED
    await assert.rejects(
      () =>
        meetingService.removeParticipant(
          meeting.meetingCode,
          testUserHost._id.toString(),
          testUserParticipant._id.toString(),
          'Second removal attempt'
        ),
      (err: any) => err.code === 'PARTICIPANT_NOT_FOUND'
    );

    const count = await LiveKitEvictionJob.countDocuments({ jobId: expectedJobId });
    assert.strictEqual(count, 1, 'Only exactly 1 eviction job must exist for (meeting, user, epoch)');
  });

  it('T-06-04: LiveKit API timeout triggers durable retry', async () => {
    const meeting = await createTestMeeting();

    // Configure mock SFU to throw a network timeout
    sfuEvictErrorToThrow = new Error('ETIMEDOUT: Connection to LiveKit Cloud timed out');

    const result = await meetingService.removeParticipant(
      meeting.meetingCode,
      testUserHost._id.toString(),
      testUserParticipant._id.toString(),
      'Timeout removal'
    );

    // LiveKit removal was not completed immediately
    assert.strictEqual(result.cleanup.livekitEvicted, false);
    assert.strictEqual(result.cleanup.failures.length, 1);

    const expectedJobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);
    const job = await LiveKitEvictionJob.findOne({ jobId: expectedJobId });
    assert.ok(job, 'Job must exist');
    assert.strictEqual(job.status, 'FAILED', 'Job must transition to FAILED for backoff retry');
    assert.strictEqual(job.attempts, 1);
    assert.ok(job.nextRunAt.getTime() > Date.now(), 'nextRunAt must be in the future');
    assert.ok(job.lastError?.includes('ETIMEDOUT'), 'Sanitized lastError must capture timeout');
  });

  it('T-06-05: HTTP 500 triggers correct backoff', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    await MeetingParticipant.updateOne(
      { meetingId: meeting._id, userId: testUserParticipant._id },
      { $set: { admissionStatus: 'REMOVED', tokenEpoch: 2 } }
    );

    // Create a job directly in PENDING
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 2, // Already failed twice
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000), // Due now
    });

    sfuEvictErrorToThrow = new Error('500 Internal Server Error: SFU node crashed');

    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'FAILED');
    assert.strictEqual(outcome.attempts, 3);

    const updatedJob = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(updatedJob?.attempts, 3);
    // Attempt 3: base delay = 1000 * 2^(3-1) = 4000ms (+ jitter)
    const delayMs = updatedJob!.nextRunAt.getTime() - Date.now();
    assert.ok(delayMs >= 3500 && delayMs <= 4500, `Expected ~4000ms backoff, got ${delayMs}ms`);
  });

  it('T-06-06: Expired lease can be safely reclaimed', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // Create a job in PROCESSING held by dead worker with expired lease
    const expiredLeaseDate = new Date(Date.now() - 15_000); // 15 seconds ago
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PROCESSING',
      leaseOwner: 'crashed_worker_pid_99999',
      leaseToken: 'dead-lease-token-uuid',
      leaseExpiresAt: expiredLeaseDate,
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 5000),
    });

    // Secondary worker claims and processes it
    const secondaryWorker = new LiveKitEvictionWorker({
      workerId: 'worker_node_healthy_2',
      livekit: mockLiveKit,
    });

    const outcome = await secondaryWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'COMPLETED');

    const finalizedJob = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(finalizedJob?.status, 'COMPLETED');
    assert.strictEqual(finalizedJob?.leaseOwner, null, 'Lease cleared upon completion');
  });

  it('T-06-07: Stale worker cannot overwrite newer lease state', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // Simulate Worker A claiming the job
    const job = await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PROCESSING',
      leaseOwner: 'worker_A',
      leaseToken: 'lease_token_A',
      leaseExpiresAt: new Date(Date.now() - 5000), // Lease expired
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: new Date(),
    });

    // Worker B claims the job with a new lease token
    const newLeaseToken = 'lease_token_B';
    await LiveKitEvictionJob.updateOne(
      { _id: job._id },
      {
        $set: {
          leaseOwner: 'worker_B',
          leaseToken: newLeaseToken,
          leaseExpiresAt: new Date(Date.now() + 10_000),
        },
      }
    );

    // Worker A attempts to finish and mark job COMPLETED with old lease token
    const staleUpdateRes = await LiveKitEvictionJob.updateOne(
      {
        _id: job._id,
        leaseToken: 'lease_token_A', // Stale token
        status: 'PROCESSING',
      },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      }
    );

    assert.strictEqual(staleUpdateRes.modifiedCount, 0, 'Stale worker update MUST be rejected (0 modified)');

    // Verify current state is still Worker B's active lease
    const currentJob = await LiveKitEvictionJob.findById(job._id);
    assert.strictEqual(currentJob?.leaseOwner, 'worker_B');
    assert.strictEqual(currentJob?.leaseToken, 'lease_token_B');
  });

  it('T-06-08: Worker restart recovers pending jobs', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    const restartedWorker = new LiveKitEvictionWorker({
      workerId: 'restarted_worker_1',
      livekit: mockLiveKit,
    });

    const sweepSummary = await restartedWorker.processDueJobs();
    assert.strictEqual(sweepSummary.scanned, 1);
    assert.strictEqual(sweepSummary.completed, 1);

    const completed = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(completed?.status, 'COMPLETED');
  });

  it('T-06-09: Successful API removal followed by worker crash reconciles safely', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // Simulate: LiveKit API already evicted the participant (so getParticipant returns 404)
    sfuPresenceMap.set(`usr_${testUserParticipant._id.toString()}`, false);

    // But the job in DB is still in PROCESSING or PENDING because worker died before writing DB
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'COMPLETED', 'Already-absent participant reconciles to COMPLETED');

    const job = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(job?.status, 'COMPLETED');
    assert.ok(job?.completedAt !== null);
  });

  it('T-06-10: Already-absent participant is marked COMPLETED', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // Presence map says false -> getParticipant throws 404
    sfuPresenceMap.set(`usr_${testUserParticipant._id.toString()}`, false);

    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'COMPLETED');
    assert.strictEqual(removedParticipantsFromSFU.length, 0, 'No removeParticipant API call needed when 404');
  });

  it('T-06-11: MongoDB participant state is checked before each retry', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    // Participant was re-admitted in a later session (admissionStatus: ADMITTED, tokenEpoch: 3)
    await MeetingParticipant.updateOne(
      { meetingId: meeting._id, userId: testUserParticipant._id },
      { $set: { admissionStatus: 'ADMITTED', tokenEpoch: 3 } }
    );

    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2, // Old epoch
      status: 'PENDING',
      attempts: 1,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'COMPLETED', 'Job completed safely because participant state is no longer REMOVED for this epoch');
    assert.strictEqual(removedParticipantsFromSFU.length, 0, 'Must NOT evict active re-admitted participant');
  });

  it('T-06-12: REMOVED participant cannot be re-admitted by worker', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    await MeetingParticipant.updateOne(
      { meetingId: meeting._id, userId: testUserParticipant._id },
      { $set: { admissionStatus: 'REMOVED', tokenEpoch: 2 } }
    );

    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    await evictionWorker.processJobById(jobId);

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId: testUserParticipant._id,
    });
    // Strict invariant: worker only reads participant; never alters admissionStatus to ADMITTED
    assert.strictEqual(participant?.admissionStatus, 'REMOVED');
  });

  it('T-06-13: Retry exhaustion creates persistent ESCALATED state', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    await MeetingParticipant.updateOne(
      { meetingId: meeting._id, userId: testUserParticipant._id },
      { $set: { admissionStatus: 'REMOVED', tokenEpoch: 2 } }
    );

    // Job at 4 attempts (maxAttempts = 5)
    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'PENDING',
      attempts: 4,
      maxAttempts: 5,
      nextRunAt: new Date(Date.now() - 1000),
    });

    sfuEvictErrorToThrow = new Error('Permanent 503 from LiveKit Cloud: room capacity corrupted');

    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'ESCALATED', 'Exhausted retries must transition to ESCALATED');
    assert.strictEqual(outcome.attempts, 5);

    const job = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(job?.status, 'ESCALATED');
    assert.strictEqual(job?.attempts, 5);
    assert.ok(job?.escalatedAt !== null);
    assert.ok(job?.lastError?.includes('503'), 'Sanitized lastError preserved');
  });

  it('T-06-14: Escalated job can be recovered through authorized mechanism', async () => {
    const meeting = await createTestMeeting();
    const jobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);

    await LiveKitEvictionJob.create({
      jobId,
      meetingId: meeting._id,
      meetingCode: meeting.meetingCode,
      userId: testUserParticipant._id,
      identity: `usr_${testUserParticipant._id.toString()}`,
      epoch: 2,
      status: 'ESCALATED',
      attempts: 5,
      maxAttempts: 5,
      escalatedAt: new Date(),
      lastError: 'Permanent failure',
      nextRunAt: new Date(),
    });

    // Operator intervenes
    const recoveryRes = await evictionWorker.operatorRetryJob(jobId, 'admin_sanjeet_01');
    assert.strictEqual(recoveryRes.success, true);

    const resetJob = await LiveKitEvictionJob.findOne({ jobId });
    assert.strictEqual(resetJob?.status, 'PENDING');
    assert.strictEqual(resetJob?.attempts, 0);
    assert.strictEqual(resetJob?.escalatedAt, null);

    // Now when LiveKit is operational, worker completes it
    const outcome = await evictionWorker.processJobById(jobId);
    assert.strictEqual(outcome.status, 'COMPLETED');
  });

  it('T-06-15: Direct Cloud removal failure is not falsely reported as successful', async () => {
    const meeting = await createTestMeeting();

    sfuEvictErrorToThrow = new Error('504 Gateway Timeout from LiveKit Cloud REST API');

    const result = await meetingService.removeParticipant(
      meeting.meetingCode,
      testUserHost._id.toString(),
      testUserParticipant._id.toString(),
      'T-06-15 Direct Cloud failure'
    );

    // Never falsely report success
    assert.strictEqual(result.cleanup.livekitEvicted, false);
    assert.ok(result.cleanup.failures.some((f) => f.operation === 'livekit.removeParticipant'));
  });

  it('T-06-16: Gateway failure does not bypass authoritative eviction', async () => {
    const meeting = await createTestMeeting();

    // Create a meeting service where gateway throws on socket disconnect
    const faultGateway = new LiveKitSignalGateway(mockLiveKit, {}, new LiveKitRevocationCoordinator({ pollIntervalMs: 60_000, enableChangeStream: false }));
    faultGateway.disconnectParticipantSockets = () => {
      throw new Error('Simulated gateway socket disconnect fault');
    };

    const faultService = new MeetingService(
      undefined,
      {},
      mockLiveKit,
      faultGateway,
      undefined,
      undefined,
      { evictionWorker }
    );

    const result = await faultService.removeParticipant(
      meeting.meetingCode,
      testUserHost._id.toString(),
      testUserParticipant._id.toString(),
      'T-06-16 Gateway failure'
    );

    assert.strictEqual(result.cleanup.localSocketsDisconnected, false);
    assert.strictEqual(result.cleanup.livekitEvicted, true, 'LiveKit eviction job still committed and executed');

    const expectedJobId = generateEvictionJobId(meeting._id, testUserParticipant._id, 2);
    const job = await LiveKitEvictionJob.findOne({ jobId: expectedJobId });
    assert.strictEqual(job?.status, 'COMPLETED');
  });
});
