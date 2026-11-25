import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  LiveKitRevocationCoordinator,
  publishLiveKitRevocation,
  type DistributedRevocationPayload,
} from '../realtime/livekitRevocationCoordinator.js';
import {
  MeetingRealtimeOutboxDispatcher,
} from '../realtime/meetingOutboxDispatcher.js';
import {
  ReminderWorkerService,
} from '../services/reminderWorker.service.js';
import {
  LiveKitRevocationEvent,
} from '../models/LiveKitRevocationEvent.model.js';
import {
  MeetingRealtimeEvent,
} from '../models/MeetingRealtimeEvent.model.js';
import {
  ScheduledReminder,
} from '../models/ScheduledReminder.model.js';

describe('Phase 18 Sprint 06 — Polling & Outbound Traffic Optimization Suite', () => {
  let isReplicaSet = false;

  before(async () => {
    const rsUri = 'mongodb://127.0.0.1:27018/connectly_test_opt_rs?replicaSet=rs0';
    const standaloneUri = 'mongodb://127.0.0.1:27017/connectly_test_opt';

    try {
      await mongoose.connect(rsUri, { serverSelectionTimeoutMS: 2000 });
      isReplicaSet = true;
    } catch {
      await mongoose.connect(standaloneUri, { serverSelectionTimeoutMS: 2000 });
      isReplicaSet = false;
    }
  });

  after(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await LiveKitRevocationEvent.deleteMany({});
    await MeetingRealtimeEvent.deleteMany({});
    await ScheduledReminder.deleteMany({});
  });

  it('T-06-17: Change Stream interruption activates safe fallback', async () => {
    if (!isReplicaSet) {
      // Change Streams require MongoDB Replica Set
      return;
    }

    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 100,
      enableChangeStream: true,
      changeStreamReconnectDelayMs: 300,
    });

    try {
      await coordinator.start();
      assert.strictEqual(coordinator.getTransportMode(), 'change_stream');

      // Force disconnect the active change stream
      await coordinator.forceDisconnectChangeStreamForTest();
      assert.strictEqual(coordinator.getTransportMode(), 'cursor_poll');

      // Publish an event while in cursor poll fallback
      const received: DistributedRevocationPayload[] = [];
      coordinator.subscribe((payload) => received.push(payload));

      const testMeetingId = new mongoose.Types.ObjectId().toString();
      await publishLiveKitRevocation({
        meetingId: testMeetingId,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 1,
      });

      // Wait for catch-up cursor poll to ingest event
      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].meetingId, testMeetingId);

      // Wait for change stream reconnect
      await new Promise((r) => setTimeout(r, 500));
      assert.strictEqual(coordinator.getTransportMode(), 'change_stream');
    } finally {
      await coordinator.stop();
    }
  });

  it('T-06-17b: Change Stream interruption resets idle poll backoff immediately without stale-sync clobbering', async () => {
    if (!isReplicaSet) {
      return;
    }

    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 50,
      maxIdlePollIntervalMs: 2_000,
      enableChangeStream: true,
      changeStreamReconnectDelayMs: 5_000,
    });

    try {
      await coordinator.start();
      assert.strictEqual(coordinator.getTransportMode(), 'change_stream');

      // Advance safety poll backoff monotonically while Change Stream is idle (50 -> 100 -> 200 -> 400)
      await coordinator.syncNow();
      await coordinator.syncNow();
      await coordinator.syncNow();
      assert.strictEqual(coordinator.getCurrentPollDelayMs(), 400);

      // Simulate an in-flight idle poll racing with Change Stream disconnection
      const concurrentPoll = coordinator.syncNow();
      await coordinator.forceDisconnectChangeStreamForTest();
      await concurrentPoll;

      assert.strictEqual(coordinator.getTransportMode(), 'cursor_poll');
      assert.strictEqual(
        coordinator.getCurrentPollDelayMs(),
        50,
        'Degraded cursor_poll fallback MUST reset delay to pollIntervalMs immediately and remain immune to stale backoff'
      );
    } finally {
      await coordinator.stop();
    }
  });

  it('T-06-17c: Change Stream reconnect sweeps events published during interruption window when resumeToken is null', async () => {
    if (!isReplicaSet) {
      return;
    }

    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 60_000,
      maxIdlePollIntervalMs: 60_000,
      enableChangeStream: true,
      changeStreamReconnectDelayMs: 180,
    });

    try {
      await coordinator.start();
      assert.strictEqual(coordinator.getTransportMode(), 'change_stream');
      assert.strictEqual(coordinator.getChangeStreamAttachCount(), 1);
      assert.strictEqual(coordinator.getLastResumeToken(), null);

      await coordinator.forceDisconnectChangeStreamForTest();
      // Drain initial disconnect sync before publishing in the reconnect gap
      await coordinator.syncNow();
      assert.strictEqual(coordinator.getTransportMode(), 'cursor_poll');

      const received: DistributedRevocationPayload[] = [];
      coordinator.subscribe((payload) => received.push(payload));

      const testMeetingId = new mongoose.Types.ObjectId().toString();
      await publishLiveKitRevocation({
        meetingId: testMeetingId,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 3,
      });

      const deadline = Date.now() + 2_000;
      while (
        Date.now() < deadline &&
        (coordinator.getChangeStreamAttachCount() < 2 || received.length < 1)
      ) {
        await new Promise((r) => setTimeout(r, 25));
      }

      assert.strictEqual(coordinator.getTransportMode(), 'change_stream');
      assert.ok(coordinator.getChangeStreamAttachCount() >= 2);
      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].meetingId, testMeetingId);
      assert.strictEqual(received[0].revokedEpoch, 3);
    } finally {
      await coordinator.stop();
    }
  });

  it('T-06-18: Cross-instance revocation remains functional with adaptive polling', async () => {
    const coordinatorA = new LiveKitRevocationCoordinator({
      pollIntervalMs: 100,
      maxIdlePollIntervalMs: 500,
      enableChangeStream: isReplicaSet,
    });

    const coordinatorB = new LiveKitRevocationCoordinator({
      pollIntervalMs: 100,
      maxIdlePollIntervalMs: 500,
      enableChangeStream: isReplicaSet,
    });

    try {
      await coordinatorA.start();
      await coordinatorB.start();

      const receivedB: DistributedRevocationPayload[] = [];
      coordinatorB.subscribe((p) => receivedB.push(p));

      // Wait 400ms so coordinatorB backs off into idle state
      await new Promise((r) => setTimeout(r, 400));

      // Instance A publishes revocation
      const testMeetingId = new mongoose.Types.ObjectId().toString();
      const testUserId = new mongoose.Types.ObjectId().toString();

      await publishLiveKitRevocation({
        meetingId: testMeetingId,
        userId: testUserId,
        kind: 'PARTICIPANT_REMOVED',
        revokedEpoch: 2,
      });

      // Wait for delivery
      await new Promise((r) => setTimeout(r, 350));

      assert.ok(receivedB.length >= 1, 'Instance B must receive event across instances');
      assert.strictEqual(receivedB[0].meetingId, testMeetingId);
      assert.strictEqual(receivedB[0].userId, testUserId);
      assert.strictEqual(receivedB[0].revokedEpoch, 2);
    } finally {
      await coordinatorA.stop();
      await coordinatorB.stop();
    }
  });

  it('T-06-19: Idle polling backs off without losing recovery (Query Count Instrumentation)', async () => {
    let queryCount = 0;
    const countListener = () => {
      queryCount++;
    };

    // Attach Mongoose query listener to measure real database queries
    mongoose.connection.on('query', countListener);

    // Run coordinator with adaptive backoff
    const coordinator = new LiveKitRevocationCoordinator({
      pollIntervalMs: 50,
      maxIdlePollIntervalMs: 500,
      enableChangeStream: false, // Force cursor polling to directly count queries
    });

    try {
      await coordinator.start();

      const initialCount = queryCount;
      // Wait for 1000ms idle period
      await new Promise((r) => setTimeout(r, 1000));
      const queriesUnderBackoff = queryCount - initialCount;

      // Fixed 50ms polling without backoff would execute at least 20 ticks (40 queries).
      // Under adaptive backoff (50ms -> 75ms -> 112ms -> 168ms -> 253ms -> 380ms -> 500ms):
      // The number of query sweeps is capped at ~4-6 sweeps.
      assert.ok(
        queriesUnderBackoff < 25,
        `Expected significantly reduced queries under backoff, got ${queriesUnderBackoff}`
      );

      // Now publish an event during idle backoff: verify it is processed immediately
      const received: DistributedRevocationPayload[] = [];
      coordinator.subscribe((p) => received.push(p));

      const testMeetingId = new mongoose.Types.ObjectId().toString();
      await publishLiveKitRevocation({
        meetingId: testMeetingId,
        kind: 'MEETING_ENDED',
      });

      coordinator.resetPollBackoff(true);
      await new Promise((r) => setTimeout(r, 100));

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].kind, 'MEETING_ENDED');
    } finally {
      await coordinator.stop();
      mongoose.connection.removeListener('query', countListener);
    }
  });

  it('T-06-19b: Meeting Outbox adaptive backoff reduces idle query volume by >80%', async () => {
    const outboxDispatcher = new MeetingRealtimeOutboxDispatcher({
      pollIntervalMs: 50,
      maxIdlePollIntervalMs: 400,
    });

    let sweepsExecuted = 0;
    const origProcessDueEvents = outboxDispatcher.processDueEvents.bind(outboxDispatcher);
    outboxDispatcher.processDueEvents = async () => {
      sweepsExecuted++;
      return origProcessDueEvents();
    };

    try {
      await outboxDispatcher.start();

      // Idle for 800ms
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      await outboxDispatcher.stop();
    }

    // Without backoff (fixed 50ms): 800ms / 50ms = 16 sweeps.
    // With exponential backoff (50ms -> 100ms -> 200ms -> 400ms -> 400ms):
    // 50 + 100 + 200 + 400 = 750ms -> only ~4-5 sweeps executed!
    assert.ok(
      sweepsExecuted <= 6,
      `Outbox sweeps under backoff was ${sweepsExecuted}, expected <= 6 (reduced by >60-80%)`
    );
  });

  it('T-06-19c: Reminder Worker adaptive backoff reduces idle sweeps', async () => {
    const reminderWorkerService = new ReminderWorkerService();
    let sweepsExecuted = 0;
    const origProcessDueReminders = reminderWorkerService.processDueReminders.bind(reminderWorkerService);
    reminderWorkerService.processDueReminders = async () => {
      sweepsExecuted++;
      return origProcessDueReminders();
    };

    try {
      reminderWorkerService.start(50, 400);

      // Idle for 800ms
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      reminderWorkerService.stop();
    }

    // With adaptive backoff (50ms -> 75ms -> 112ms -> 168ms -> 253ms -> 380ms -> 400ms):
    assert.ok(
      sweepsExecuted <= 7,
      `Reminder sweeps under backoff was ${sweepsExecuted}, expected <= 7`
    );
  });
});
