import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import {
  MeetingRealtimeEvent,
  MEETING_OUTBOX_TERMINAL_TTL_SECONDS,
  ensureMeetingRealtimeOutboxReady,
} from '../models/MeetingRealtimeEvent.model.js';
import {
  LiveKitRevocationEvent,
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  resetRevocationTopologyCache,
} from '../models/LiveKitRevocationEvent.model.js';
import { MeetingRealtimeHub } from '../realtime/meetingSocket.js';
import {
  MeetingRealtimeOutboxDispatcher,
  createSimulatedOutboxCrash,
} from '../realtime/meetingOutboxDispatcher.js';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
} from '../realtime/livekitRevocationCoordinator.js';
import { LiveKitSignalGateway } from '../realtime/livekitSignalGateway.js';
import { LiveKitService } from '../services/livekit.service.js';
import { MeetingService, type MeetingServiceHooks } from '../services/meeting.service.js';
import { env } from '../config/env.js';

function createBarrier() {
  let arrivedResolve!: () => void;
  let releaseResolve!: () => void;
  const arrived = new Promise<void>((r) => {
    arrivedResolve = r;
  });
  const releaseGate = new Promise<void>((r) => {
    releaseResolve = r;
  });
  return {
    arrived,
    pause: async () => {
      arrivedResolve();
      await releaseGate;
    },
    release: () => {
      releaseResolve();
    },
  };
}

describe('Phase 09 Final Transactional Outbox Reliability Audit (Issues 1–4)', () => {
  const TEST_DB_URI = env.MONGODB_URI.replace(
    /\/[^/?]+(\?|$)/,
    '/connectly_test_outboxaudit$1'
  );

  let users: Array<{ id: string; email: string }> = [];
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];
  let configuredLiveKit: LiveKitService;

  before(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    resetRevocationTopologyCache();
    await mongoose.connect(TEST_DB_URI);
    await ensureMeetingRealtimeOutboxReady();

    configuredLiveKit = new LiveKitService({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'test_outbox_audit_api_key_123456',
      apiSecret: 'test_outbox_audit_api_secret_abcdefghijklmnopqrstuvwxyz',
      tokenTtlSeconds: 600,
    });
    configuredLiveKit.ensureRoomExists = async () => {};
    configuredLiveKit.removeParticipant = async () => true;
    configuredLiveKit.deleteRoom = async () => {};

    const ts = Date.now();
    users = [];
    for (let i = 0; i < 3; i += 1) {
      const email = `outbox_audit_${ts}_${i}@connectly.dev`;
      const doc = await User.create({
        firstName: `Outbox${i}`,
        lastName: 'Tester',
        email,
        passwordHash: 'argon2id-test-hash-placeholder',
        isActive: true,
      });
      users.push({ id: doc._id.toString(), email });
    }
  });

  afterEach(async () => {
    if (createdMeetingIds.length > 0) {
      await MeetingRealtimeEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await LiveKitRevocationEvent.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
      await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
      createdMeetingIds.length = 0;
    }
  });

  after(async () => {
    await User.deleteMany({ email: { $in: users.map((u) => u.email) } });
    await LiveKitRevocationCursor.deleteMany({});
    await LiveKitRevocationCounter.deleteMany({});
    await mongoose.disconnect();
  });

  function createTrackingHub() {
    const hub = new MeetingRealtimeHub();
    const events: Array<{ type: string; eventId?: string; meetingId: string; userId?: string }> =
      [];
    const origApprove = hub.emitAdmissionApproved.bind(hub);
    const origJoined = hub.emitParticipantJoined.bind(hub);
    const origEnded = hub.emitMeetingEnded.bind(hub);
    const origWaiting = hub.emitWaitingRoomUpdated.bind(hub);

    hub.emitAdmissionApproved = async (meetingId, targetUserId, summary, participant, eventId) => {
      events.push({ type: 'admission-approved', eventId, meetingId, userId: targetUserId });
      return origApprove(meetingId, targetUserId, summary, participant, eventId);
    };
    hub.emitParticipantJoined = (meetingId, participant, count, eventId) => {
      events.push({
        type: 'participant-joined',
        eventId,
        meetingId,
        userId: participant?.userId,
      });
      return origJoined(meetingId, participant, count, eventId);
    };
    hub.emitWaitingRoomUpdated = (meetingId, waitingList) => {
      events.push({ type: 'waiting-room-updated', meetingId });
      return origWaiting(meetingId, waitingList);
    };
    hub.emitMeetingEnded = async (meetingId, endedBy, waitingUserIds, reason) => {
      events.push({ type: 'meeting-ended', meetingId });
      return origEnded(meetingId, endedBy, waitingUserIds, reason);
    };

    return { hub, events };
  }

  async function spawnService(opts: {
    hub?: MeetingRealtimeHub;
    hooks?: MeetingServiceHooks;
    dispatcher?: MeetingRealtimeOutboxDispatcher;
  } = {}) {
    const hub = opts.hub ?? new MeetingRealtimeHub();
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      enableChangeStream: false,
      maxStaleDeliveryMs: 60_000,
    });
    await coordinator.start();
    const gateway = new LiveKitSignalGateway(configuredLiveKit, {}, coordinator, {
      activeSocketRevalidationIntervalMs: 0,
    });
    const svc = new MeetingService(
      hub,
      opts.hooks ?? {},
      configuredLiveKit,
      gateway,
      publishLiveKitRevocation,
      coordinator,
      {
        requireTransactions: false,
        outboxDispatcher: opts.dispatcher,
      }
    );
    return {
      hub,
      coordinator,
      gateway,
      svc,
      close: async () => {
        gateway.close();
        await coordinator.stop();
      },
    };
  }

  it('1. Crash A (before claiming): event remains PENDING (terminalAt=null) and another dispatcher recovers & delivers it cleanly', async () => {
    const trackA = createTrackingHub();
    const trackB = createTrackingHub();
    const nowMs = Date.now();

    const dispA = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-crash-A',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      nowFn: () => new Date(nowMs),
      realtime: trackA.hub,
    });
    const dispB = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-recover-A',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      nowFn: () => new Date(nowMs),
      realtime: trackB.hub,
    });

    const nodeA = await spawnService({
      hub: trackA.hub,
      dispatcher: dispA,
      hooks: {
        beforeAdmitOutboxClaim: async () => {
          throw createSimulatedOutboxCrash('Simulated SIGKILL before claiming PENDING outbox event');
        },
      },
    });

    try {
      const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
        title: 'Crash A Recovery Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[1].id); // WAITING

      await assert.rejects(
        () => nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
        /SIGKILL before claiming/
      );

      // Outbox doc MUST remain PENDING with terminalAt === null and attemptCount === 0
      const pendingDoc = await MeetingRealtimeEvent.findOne({
        meetingId: meeting.id,
        type: 'ADMISSION_APPROVED',
      }).lean();
      assert.ok(pendingDoc);
      assert.strictEqual(pendingDoc.status, 'PENDING');
      assert.strictEqual(pendingDoc.attemptCount, 0);
      assert.strictEqual(pendingDoc.terminalAt, null);
      assert.strictEqual(trackA.events.filter((e) => e.type === 'admission-approved').length, 0);

      // Instance B starts/sweeps and recovers the PENDING event cleanly from cold DB state
      const sweep = await dispB.processDueEvents();
      assert.strictEqual(sweep.dispatched, 1);

      const finalDoc = await MeetingRealtimeEvent.findById(pendingDoc._id).lean();
      assert.strictEqual(finalDoc?.status, 'DISPATCHED');
      assert.strictEqual(finalDoc?.attemptCount, 1);
      assert.ok(finalDoc?.dispatchedAt instanceof Date);
      assert.ok(finalDoc?.terminalAt instanceof Date);
      assert.strictEqual(finalDoc?.leaseToken, null);

      const approved = trackB.events.filter((e) => e.type === 'admission-approved');
      const joined = trackB.events.filter((e) => e.type === 'participant-joined');
      assert.strictEqual(approved.length, 1);
      assert.strictEqual(approved[0].eventId, pendingDoc.eventId);
      assert.strictEqual(joined.length, 1);
      assert.strictEqual(joined[0].eventId, pendingDoc.eventId);
    } finally {
      await nodeA.close();
    }
  });

  it('2. Crash B (after claiming), Crash C (before emit), and transient emit failure all recover cleanly without losing events', async () => {
    const trackA = createTrackingHub();
    const trackB = createTrackingHub();
    let nowMs = Date.now();

    const dispA = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-crash-BC',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      retryBackoffMs: 1_000,
      nowFn: () => new Date(nowMs),
      realtime: trackA.hub,
    });
    const dispB = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-recover-BC',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      retryBackoffMs: 1_000,
      nowFn: () => new Date(nowMs),
      realtime: trackB.hub,
    });

    // Subtest 2a: Hard crash IMMEDIATELY after PENDING -> CLAIMED (Crash B)
    const nodeCrashB = await spawnService({
      hub: trackA.hub,
      dispatcher: dispA,
      hooks: {
        afterAdmitOutboxClaim: async () => {
          throw createSimulatedOutboxCrash('Simulated SIGKILL immediately after PENDING -> CLAIMED');
        },
      },
    });
    try {
      const { meeting } = await nodeCrashB.svc.createMeeting(users[0].id, {
        title: 'Crash B & C Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await nodeCrashB.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await nodeCrashB.svc.joinMeeting(meeting.meetingCode, users[1].id);

      await assert.rejects(
        () => nodeCrashB.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
        /immediately after PENDING -> CLAIMED/
      );

      const leasedDoc = await MeetingRealtimeEvent.findOne({
        meetingId: meeting.id,
        type: 'ADMISSION_APPROVED',
      }).lean();
      assert.ok(leasedDoc);
      assert.strictEqual(leasedDoc.status, 'CLAIMED');
      assert.strictEqual(leasedDoc.leaseOwner, 'inst-crash-BC');
      assert.ok(leasedDoc.leaseToken);
      assert.strictEqual(leasedDoc.attemptCount, 1);
      assert.strictEqual(leasedDoc.terminalAt, null);

      // Before lease expiry: Instance B MUST NOT reclaim active lease
      const earlySweep = await dispB.processDueEvents();
      assert.strictEqual(earlySweep.processed, 0);

      // Advance clock past leaseDurationMs (5s) -> Instance B reclaims and dispatches!
      nowMs += 6_000;
      const recoverySweep = await dispB.processDueEvents();
      assert.strictEqual(recoverySweep.dispatched, 1);

      const afterRecover = await MeetingRealtimeEvent.findById(leasedDoc._id).lean();
      assert.strictEqual(afterRecover?.status, 'DISPATCHED');
      assert.strictEqual(afterRecover?.attemptCount, 2);
      assert.ok(afterRecover?.terminalAt instanceof Date);
      assert.strictEqual(trackB.events.filter((e) => e.type === 'admission-approved').length, 1);

      // Subtest 2b: Hard crash right BEFORE Socket.IO emission (Crash C)
      await nodeCrashB.svc.joinMeeting(meeting.meetingCode, users[2].id);
      const nodeCrashC = await spawnService({
        hub: trackA.hub,
        dispatcher: dispA,
        hooks: {
          beforeAdmitEmit: async () => {
            throw createSimulatedOutboxCrash('Simulated SIGKILL immediately before Socket.IO emit');
          },
        },
      });
      try {
        await assert.rejects(
          () => nodeCrashC.svc.admitParticipant(meeting.meetingCode, users[0].id, users[2].id),
          /immediately before Socket\.IO emit/
        );

        const docC = await MeetingRealtimeEvent.findOne({
          meetingId: meeting.id,
          targetUserId: users[2].id,
          type: 'ADMISSION_APPROVED',
        }).lean();
        assert.strictEqual(docC?.status, 'CLAIMED');
        assert.strictEqual(docC?.terminalAt, null);

        // Advance clock past lease expiry -> Instance B recovers and dispatches!
        nowMs += 6_000;
        const sweepC = await dispB.processDueEvents();
        assert.strictEqual(sweepC.dispatched, 1);
        const finalC = await MeetingRealtimeEvent.findById(docC!._id).lean();
        assert.strictEqual(finalC?.status, 'DISPATCHED');
        assert.strictEqual(finalC?.attemptCount, 2);
      } finally {
        await nodeCrashC.close();
      }

      // Subtest 2c: Transient operational Socket.IO error (non-crash) -> schedules retry -> succeeds on retry
      const retryHub = createTrackingHub();
      let failFirstEmit = true;
      const origApprove = retryHub.hub.emitAdmissionApproved.bind(retryHub.hub);
      retryHub.hub.emitAdmissionApproved = async (...args) => {
        if (failFirstEmit) {
          failFirstEmit = false;
          throw new Error('Simulated transient Socket.IO adapter error');
        }
        return origApprove(...args);
      };

      const retryDisp = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-retry',
        pollIntervalMs: 0,
        leaseDurationMs: 5_000,
        retryBackoffMs: 2_000,
        nowFn: () => new Date(nowMs),
        realtime: retryHub.hub,
      });

      const manualPending = await MeetingRealtimeEvent.create({
        meetingId: meeting.id,
        meetingVersion: 2,
        targetUserId: users[1].id,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
      });

      const firstTry = await retryDisp.dispatchById(manualPending._id as mongoose.Types.ObjectId);
      assert.strictEqual(firstTry.status, 'RETRY_SCHEDULED');
      const afterFail = await MeetingRealtimeEvent.findById(manualPending._id).lean();
      assert.strictEqual(afterFail?.status, 'PENDING');
      assert.strictEqual(afterFail?.terminalAt, null);
      assert.match(afterFail?.lastError || '', /transient Socket\.IO adapter error/);
      assert.ok(afterFail?.nextAttemptAt && afterFail.nextAttemptAt.getTime() > nowMs);

      // Before retry backoff expires: not yet due
      assert.strictEqual((await retryDisp.processDueEvents()).processed, 0);

      // After retry backoff expires: succeeds cleanly!
      nowMs += 2_500;
      const retrySweep = await retryDisp.processDueEvents();
      assert.strictEqual(retrySweep.dispatched, 1);
      const afterSuccess = await MeetingRealtimeEvent.findById(manualPending._id).lean();
      assert.strictEqual(afterSuccess?.status, 'DISPATCHED');
      assert.strictEqual(afterSuccess?.attemptCount, 2);
      assert.ok(afterSuccess?.terminalAt instanceof Date);
    } finally {
      await nodeCrashB.close();
    }
  });

  it('3. Crash D (after Socket.IO emit, before DISPATCHED recorded): at-least-once recovery preserves same eventId & consumer deduplicates idempotently', async () => {
    const sharedSeenEventIds = new Set<string>();
    let logicalAdmissionApplications = 0;
    let rawWireEmissions = 0;
    const emittedEventIds: string[] = [];

    const makeConsumerHub = () => {
      const hub = new MeetingRealtimeHub();
      hub.emitAdmissionApproved = async (_m, _u, _s, _p, eventId) => {
        rawWireEmissions += 1;
        if (eventId) emittedEventIds.push(eventId);
        // Exact same idempotency contract as PreJoinLobbyPage / MeetingRoomPage
        if (!eventId || !sharedSeenEventIds.has(eventId)) {
          if (eventId) sharedSeenEventIds.add(eventId);
          logicalAdmissionApplications += 1;
        }
      };
      return hub;
    };

    let nowMs = Date.now();
    const hubA = makeConsumerHub();
    const hubB = makeConsumerHub();

    const dispA = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-crash-D',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      nowFn: () => new Date(nowMs),
      realtime: hubA,
    });
    const dispB = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-recover-D',
      pollIntervalMs: 0,
      leaseDurationMs: 5_000,
      nowFn: () => new Date(nowMs),
      realtime: hubB,
    });

    const nodeA = await spawnService({
      hub: hubA,
      dispatcher: dispA,
      hooks: {
        afterAdmitEmitBeforeMarkDispatched: async () => {
          throw createSimulatedOutboxCrash(
            'Simulated SIGKILL after Socket.IO emit before recording DISPATCHED'
          );
        },
      },
    });

    try {
      const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
        title: 'Crash D At-Least-Once Idempotency Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[1].id);

      await assert.rejects(
        () => nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id),
        /after Socket\.IO emit before recording DISPATCHED/
      );

      // First wire emission happened before crash, but DB still shows CLAIMED
      assert.strictEqual(rawWireEmissions, 1);
      assert.strictEqual(logicalAdmissionApplications, 1);
      const docAfterCrash = await MeetingRealtimeEvent.findOne({
        meetingId: meeting.id,
        type: 'ADMISSION_APPROVED',
      }).lean();
      assert.strictEqual(docAfterCrash?.status, 'CLAIMED');
      assert.strictEqual(docAfterCrash?.terminalAt, null);

      // Lease expires -> Instance B recovers and redelivers (at-least-once!) with SAME eventId
      nowMs += 6_000;
      const sweep = await dispB.processDueEvents();
      assert.strictEqual(sweep.dispatched, 1);
      assert.strictEqual(rawWireEmissions, 2, 'Honest at-least-once redelivery occurred on crash D recovery');
      assert.strictEqual(emittedEventIds[0], emittedEventIds[1], 'Redelivery MUST carry identical stable eventId');
      assert.strictEqual(
        logicalAdmissionApplications,
        1,
        'Idempotent consumer MUST apply the admission effect exactly once despite duplicate wire delivery'
      );

      // Subsequent sweeps produce zero additional emissions
      nowMs += 10_000;
      const thirdSweep = await dispB.processDueEvents();
      assert.strictEqual(thirdSweep.processed, 0);
      assert.strictEqual(rawWireEmissions, 2);
    } finally {
      await nodeA.close();
    }
  });

  it('4. Multi-instance claim contention (only 1 wins) AND stale lease-owner fencing (pausing past leaseExpiry never double-emits)', async () => {
    const track1 = createTrackingHub();
    const track2 = createTrackingHub();
    let nowMs = Date.now();

    const baseNode = await spawnService();
    try {
      const { meeting } = await baseNode.svc.createMeeting(users[0].id, {
        title: 'Multi-Instance Contention Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await baseNode.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await baseNode.svc.joinMeeting(meeting.meetingCode, users[1].id);
      await MeetingParticipant.updateOne(
        { meetingId: meeting.id, userId: users[1].id },
        { $set: { admissionStatus: 'ADMITTED', admittedAt: new Date(), joinedAt: new Date() } }
      );

      // Subtest 4a: Two instances race simultaneously on the exact same PENDING outbox doc
      const pending1 = await MeetingRealtimeEvent.create({
        meetingId: meeting.id,
        meetingVersion: 1,
        targetUserId: users[1].id,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
      });

      const disp1 = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-race-1',
        pollIntervalMs: 0,
        leaseDurationMs: 5_000,
        nowFn: () => new Date(nowMs),
        realtime: track1.hub,
      });
      const disp2 = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-race-2',
        pollIntervalMs: 0,
        leaseDurationMs: 5_000,
        nowFn: () => new Date(nowMs),
        realtime: track2.hub,
      });

      const [r1, r2] = await Promise.all([
        disp1.dispatchById(pending1._id as mongoose.Types.ObjectId),
        disp2.dispatchById(pending1._id as mongoose.Types.ObjectId),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert.ok(statuses.includes('DISPATCHED'), 'Exactly one instance must dispatch');
      assert.strictEqual(
        [r1.status, r2.status].filter((s) => s === 'DISPATCHED').length,
        1,
        'Never more than one instance wins active lease'
      );
      const totalApproved =
        track1.events.filter((e) => e.type === 'admission-approved').length +
        track2.events.filter((e) => e.type === 'admission-approved').length;
      assert.strictEqual(totalApproved, 1);

      // Subtest 4b: Stale lease owner fencing (Instance 1 pauses at beforeEmit past leaseExpiry; Instance 2 steals & finishes; Instance 1 aborts!)
      const stallBarrier = createBarrier();
      const pending2 = await MeetingRealtimeEvent.create({
        meetingId: meeting.id,
        meetingVersion: 2,
        targetUserId: users[1].id,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
      });

      track1.events.length = 0;
      track2.events.length = 0;

      const stalledDisp1 = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-stalled-1',
        pollIntervalMs: 0,
        leaseDurationMs: 5_000,
        nowFn: () => new Date(nowMs),
        realtime: track1.hub,
        hooks: { beforeEmit: stallBarrier.pause },
      });

      const pStalled = stalledDisp1.dispatchById(pending2._id as mongoose.Types.ObjectId);
      await stallBarrier.arrived;

      // Advance clock past leaseDurationMs; Instance 2 reclaims and completes dispatch
      nowMs += 6_000;
      const r2Win = await disp2.dispatchById(pending2._id as mongoose.Types.ObjectId);
      assert.strictEqual(r2Win.status, 'DISPATCHED');
      assert.strictEqual(track2.events.filter((e) => e.type === 'admission-approved').length, 1);

      // Now release stalled Instance 1 -> MUST detect lost leaseToken/DISPATCHED and NOT emit!
      stallBarrier.release();
      const r1Stale = await pStalled;
      assert.ok(r1Stale.status === 'ALREADY_DISPATCHED' || r1Stale.status === 'LEASE_LOST');
      assert.strictEqual(
        track1.events.filter((e) => e.type === 'admission-approved').length,
        0,
        'Stale lease owner MUST NOT emit after another instance reclaimed & dispatched'
      );
    } finally {
      await baseNode.close();
    }
  });

  it('5. Meeting termination while admission event is actively CLAIMED (leased) suppresses lease atomically and prevents emission', async () => {
    const claimBarrier = createBarrier();
    const trackA = createTrackingHub();
    const trackB = createTrackingHub();
    let nowMs = Date.now();

    const dispA = new MeetingRealtimeOutboxDispatcher({
      instanceId: 'inst-leased-admit',
      pollIntervalMs: 0,
      leaseDurationMs: 10_000,
      nowFn: () => new Date(nowMs),
      realtime: trackA.hub,
    });

    const nodeA = await spawnService({
      hub: trackA.hub,
      dispatcher: dispA,
      hooks: { afterAdmitOutboxClaim: claimBarrier.pause },
    });
    const nodeB = await spawnService({ hub: trackB.hub });

    try {
      const { meeting } = await nodeA.svc.createMeeting(users[0].id, {
        title: 'Termination During Active Lease Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await nodeA.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await nodeB.svc.joinMeeting(meeting.meetingCode, users[1].id);
      trackA.events.length = 0;

      const admitPromise = nodeA.svc.admitParticipant(meeting.meetingCode, users[0].id, users[1].id);
      await claimBarrier.arrived;

      // Verify record is actively CLAIMED in MongoDB right now
      const leased = await MeetingRealtimeEvent.findOne({
        meetingId: meeting.id,
        type: 'ADMISSION_APPROVED',
      }).lean();
      assert.strictEqual(leased?.status, 'CLAIMED');
      assert.strictEqual(leased?.leaseOwner, 'inst-leased-admit');

      // Instance B ends meeting while Instance A holds active CLAIMED lease!
      await nodeB.svc.endMeeting(meeting.meetingCode, users[0].id);

      // Verify endMeeting atomically suppressed the CLAIMED record and set terminalAt!
      const suppressedByEnd = await MeetingRealtimeEvent.findById(leased!._id).lean();
      assert.strictEqual(suppressedByEnd?.status, 'SUPPRESSED');
      assert.strictEqual(suppressedByEnd?.leaseToken, null);
      assert.ok(suppressedByEnd?.suppressedAt instanceof Date);
      assert.ok(suppressedByEnd?.terminalAt instanceof Date);

      // Release Instance A -> MUST abort cleanly with 410 MEETING_ENDED and emit ZERO admission events!
      claimBarrier.release();
      await assert.rejects(
        () => admitPromise,
        (err: any) => err.statusCode === 410 && err.code === 'MEETING_ENDED'
      );

      assert.strictEqual(trackA.events.filter((e) => e.type === 'admission-approved').length, 0);
      assert.strictEqual(trackA.events.filter((e) => e.type === 'participant-joined').length, 0);

      // Subsequent sweep after lease window also emits ZERO events
      nowMs += 15_000;
      const dispRecovery = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-post-end-sweep',
        pollIntervalMs: 0,
        nowFn: () => new Date(nowMs),
        realtime: trackB.hub,
      });
      const postSweep = await dispRecovery.processDueEvents();
      assert.strictEqual(postSweep.dispatched, 0);
    } finally {
      await nodeA.close();
      await nodeB.close();
    }
  });

  it('6. TTL Safety & >24h Outage Recovery: PENDING/CLAIMED records are excluded from TTL, legacy createdAt TTL is dropped, and recovery works after >24h outage', async () => {
    // 1. Simulate legacy unsafe createdAt_1 TTL index and verify ensureMeetingRealtimeOutboxReady() removes it
    await MeetingRealtimeEvent.collection.createIndex(
      { createdAt: 1 },
      { name: 'createdAt_1', expireAfterSeconds: 86400 }
    );
    await ensureMeetingRealtimeOutboxReady();

    const indexes = await MeetingRealtimeEvent.collection.indexes();
    const legacyCreatedAtTtl = indexes.find(
      (idx) => idx.key && 'createdAt' in idx.key && typeof idx.expireAfterSeconds === 'number'
    );
    assert.strictEqual(
      legacyCreatedAtTtl,
      undefined,
      'Unsafe unconditional createdAt TTL index MUST be removed'
    );

    const terminalTtl = indexes.find((idx) => idx.name === 'terminalAt_ttl_24h');
    assert.ok(terminalTtl, 'Safe terminalAt_ttl_24h index MUST exist');
    assert.strictEqual(terminalTtl.expireAfterSeconds, MEETING_OUTBOX_TERMINAL_TTL_SECONDS);
    assert.deepStrictEqual(terminalTtl.partialFilterExpression, {
      status: { $in: ['DISPATCHED', 'SUPPRESSED'] },
    });

    // 2. Verify recovery after an outage > 24 hours (26 hours elapsed!)
    const baseNow = Date.now();
    const baseNode = await spawnService();
    try {
      // Create an active meeting whose expiresAt is 48h in the future (still active after 26h outage)
      const { meeting } = await baseNode.svc.createMeeting(users[0].id, {
        title: 'Long Outage Recovery Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(meeting.id));
      await Meeting.updateOne(
        { _id: meeting.id },
        { $set: { expiresAt: new Date(baseNow + 48 * 60 * 60 * 1000) } }
      );
      await baseNode.svc.joinMeeting(meeting.meetingCode, users[0].id);
      await baseNode.svc.joinMeeting(meeting.meetingCode, users[1].id);
      await MeetingParticipant.updateOne(
        { meetingId: meeting.id, userId: users[1].id },
        { $set: { admissionStatus: 'ADMITTED', admittedAt: new Date(baseNow), joinedAt: new Date(baseNow) } }
      );

      // Insert a PENDING outbox event and a stalled CLAIMED event backdated 26 hours ago (both with terminalAt=null!)
      const twentySixHoursAgo = new Date(baseNow - 26 * 60 * 60 * 1000);
      const oldPending = await MeetingRealtimeEvent.create({
        meetingId: meeting.id,
        meetingVersion: 1,
        targetUserId: users[1].id,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
        terminalAt: null,
      });
      await MeetingRealtimeEvent.collection.updateOne(
        { _id: oldPending._id },
        { $set: { createdAt: twentySixHoursAgo, updatedAt: twentySixHoursAgo } }
      );

      const oldClaimed = await MeetingRealtimeEvent.create({
        meetingId: meeting.id,
        meetingVersion: 2,
        targetUserId: users[1].id,
        type: 'PARTICIPANT_JOINED',
        status: 'CLAIMED',
        leaseOwner: 'dead-node-26h-ago',
        leaseToken: 'stale-token-26h-ago',
        claimedAt: twentySixHoursAgo,
        leaseExpiresAt: new Date(twentySixHoursAgo.getTime() + 10_000),
        attemptCount: 1,
        terminalAt: null,
      });
      await MeetingRealtimeEvent.collection.updateOne(
        { _id: oldClaimed._id },
        { $set: { createdAt: twentySixHoursAgo, updatedAt: twentySixHoursAgo } }
      );

      // Verify both >24h-old non-terminal records remain durable with terminalAt=null
      const surviving = await MeetingRealtimeEvent.find({
        _id: { $in: [oldPending._id, oldClaimed._id] },
      }).lean();
      assert.strictEqual(surviving.length, 2);
      assert.strictEqual(surviving[0].terminalAt, null);
      assert.strictEqual(surviving[1].terminalAt, null);

      // Restart dispatcher after 26-hour outage -> recovers & dispatches BOTH cleanly!
      const recoverTrack = createTrackingHub();
      const restartedDisp = new MeetingRealtimeOutboxDispatcher({
        instanceId: 'inst-restarted-after-26h',
        pollIntervalMs: 0,
        nowFn: () => new Date(baseNow),
        realtime: recoverTrack.hub,
      });
      await restartedDisp.start();
      await restartedDisp.stop();

      const afterRecovery = await MeetingRealtimeEvent.find({
        _id: { $in: [oldPending._id, oldClaimed._id] },
      }).lean();
      for (const doc of afterRecovery) {
        assert.strictEqual(doc.status, 'DISPATCHED');
        assert.ok(doc.terminalAt instanceof Date, 'terminalAt MUST be set ONLY once DISPATCHED');
      }
      assert.strictEqual(
        recoverTrack.events.filter((e) => e.type === 'admission-approved').length,
        1
      );
      assert.strictEqual(
        recoverTrack.events.filter((e) => e.type === 'participant-joined').length,
        2
      );

      // 3. Also verify >24h-old PENDING event for an EXPIRED meeting is SUPPRESSED (not emitted) on recovery!
      const { meeting: expMeeting } = await baseNode.svc.createMeeting(users[0].id, {
        title: 'Expired During 26h Outage Room',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      createdMeetingIds.push(new mongoose.Types.ObjectId(expMeeting.id));
      await Meeting.updateOne(
        { _id: expMeeting.id },
        { $set: { expiresAt: new Date(baseNow - 12 * 60 * 60 * 1000) } }
      );
      const staleExpiredPending = await MeetingRealtimeEvent.create({
        meetingId: expMeeting.id,
        meetingVersion: 1,
        targetUserId: users[1].id,
        type: 'ADMISSION_APPROVED',
        status: 'PENDING',
        terminalAt: null,
      });

      recoverTrack.events.length = 0;
      const expSweep = await restartedDisp.processDueEvents();
      assert.strictEqual(expSweep.suppressed, 1);
      assert.strictEqual(recoverTrack.events.length, 0, 'Expired meeting MUST NOT emit stale admission');
      const expDoc = await MeetingRealtimeEvent.findById(staleExpiredPending._id).lean();
      assert.strictEqual(expDoc?.status, 'SUPPRESSED');
      assert.ok(expDoc?.terminalAt instanceof Date);
    } finally {
      await baseNode.close();
    }
  });
});
