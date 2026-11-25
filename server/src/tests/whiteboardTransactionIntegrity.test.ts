import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { WhiteboardService } from '../services/whiteboard.service.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { User } from '../models/User.model.js';
import { resetRevocationTopologyCache } from '../models/LiveKitRevocationEvent.model.js';

const REPLICA_SET_URI = 'mongodb://127.0.0.1:27018/connectly_wb_tx_test?directConnection=true';
const STANDALONE_URI = 'mongodb://127.0.0.1:27017/connectly_wb_standalone_test';

describe('Whiteboard Transaction Integrity & Failure-Injection Verification Suite', () => {
  let user1Id: Types.ObjectId;
  let user2Id: Types.ObjectId;
  let hostId: Types.ObjectId;
  let meetingCode: string;
  let meetingMongoId: Types.ObjectId;

  before(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(REPLICA_SET_URI);
    resetRevocationTopologyCache();

    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await User.deleteMany({});

    const hostUser = await User.create({
      email: 'host_tx@example.com',
      passwordHash: 'argon_hash_dummy_host',
      firstName: 'Host',
      lastName: 'Tx',
      isEmailVerified: true,
    });
    hostId = hostUser._id;

    const user1 = await User.create({
      email: 'user1_tx@example.com',
      passwordHash: 'argon_hash_dummy_1',
      firstName: 'Alice',
      lastName: 'Tx',
      isEmailVerified: true,
    });
    user1Id = user1._id;

    const user2 = await User.create({
      email: 'user2_tx@example.com',
      passwordHash: 'argon_hash_dummy_2',
      firstName: 'Bob',
      lastName: 'Tx',
      isEmailVerified: true,
    });
    user2Id = user2._id;

    meetingCode = 'cly-txa-001';
    const now = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const meeting = await Meeting.create({
      title: 'Whiteboard Transaction Integrity Meeting',
      meetingCode,
      hostId,
      originalHostId: hostId,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt,
      maxParticipants: 60,
      settings: { waitingRoomEnabled: false },
    });
    meetingMongoId = meeting._id;

    await MeetingParticipant.create({
      meetingId: meetingMongoId,
      userId: hostId,
      displayName: 'Host User',
      email: 'host_tx@example.com',
      role: 'host',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    await MeetingParticipant.create({
      meetingId: meetingMongoId,
      userId: user1Id,
      displayName: 'Alice User',
      email: 'user1_tx@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    await MeetingParticipant.create({
      meetingId: meetingMongoId,
      userId: user2Id,
      displayName: 'Bob User',
      email: 'user2_tx@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await Whiteboard.deleteMany({});
      await WhiteboardOperation.deleteMany({});
      await Meeting.deleteMany({});
      await MeetingParticipant.deleteMany({});
      await User.deleteMany({});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    // Clear whiteboard data between tests for isolation
    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});
  });

  it('1. Crash injection after snapshot CAS: transaction abort rolls back version and elements cleanly', async () => {
    const service = new WhiteboardService({ transactionPolicy: 'required' });

    // Ensure board starts at clean state
    const initialBoard = await Whiteboard.create({
      meetingId: meetingMongoId,
      version: 1,
      elements: new Map(),
      appliedOperationIds: [],
    });
    assert.strictEqual(initialBoard.version, 1);

    const failOp = [{
      operationId: 'op-fail-cas-1',
      type: 'add' as const,
      elementId: 'elem-fail-1',
      element: {
        id: 'elem-fail-1',
        type: 'rect' as const,
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        strokeColor: '#ff0000',
        strokeWidth: 2,
        zIndex: 1,
      },
    }];

    // Execute with failure injection hook active
    await assert.rejects(
      async () => {
        await service.applyOperations(meetingCode, user1Id.toString(), failOp, {
          failAfterCasForTest: true,
        });
      },
      (err: any) => {
        assert.match(err.message, /SIMULATED_CRASH_AFTER_CAS_BEFORE_LOG_INSERT/);
        return true;
      }
    );

    // Verify atomic ACID rollback: snapshot must remain at version 1 without new element
    const boardAfterCrash = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(boardAfterCrash);
    assert.strictEqual(boardAfterCrash.version, 1, 'Board version must remain 1 after transaction rollback');
    assert.strictEqual(
      boardAfterCrash.elements.has('elem-fail-1'),
      false,
      'Uncommitted element must not exist in snapshot'
    );
    assert.strictEqual(
      boardAfterCrash.appliedOperationIds?.includes('op-fail-cas-1'),
      false,
      'Operation ID must not exist in appliedOperationIds journal'
    );

    // Verify operation log: 0 orphan operation records
    const opDocs = await WhiteboardOperation.find({
      meetingId: meetingMongoId,
      operationId: 'op-fail-cas-1',
    });
    assert.strictEqual(opDocs.length, 0, 'Zero operation records must be persisted');
  });

  it('2. Concurrent identical operationId across instances: exactly 1 mutation, 1 op doc, version increments by 1', async () => {
    const instanceA = new WhiteboardService({ transactionPolicy: 'required' });
    const instanceB = new WhiteboardService({ transactionPolicy: 'required' });

    const sharedOpId = 'op-shared-concurrent-' + Date.now();
    const op = [{
      operationId: sharedOpId,
      type: 'add' as const,
      elementId: 'elem-shared-concurrent',
      element: {
        id: 'elem-shared-concurrent',
        type: 'circle' as const,
        x: 40,
        y: 40,
        width: 50,
        height: 50,
        strokeColor: '#00aa00',
        strokeWidth: 3,
        zIndex: 2,
      },
    }];

    // Two independent instances execute the exact same operationId concurrently
    const [resA, resB] = await Promise.all([
      instanceA.applyOperations(meetingCode, user1Id.toString(), op),
      instanceB.applyOperations(meetingCode, user2Id.toString(), op),
    ]);

    assert.ok(resA.success);
    assert.ok(resB.success);

    // One instance applied the mutation, the losing instance received idempotent duplicate acknowledgment
    const totalApplied = (resA.appliedCount || 0) + (resB.appliedCount || 0);
    assert.strictEqual(totalApplied, 1, 'Exactly one instance must apply the mutation (1 applied, 0 duplicate)');

    // Verify Whiteboard snapshot
    const board = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(board);
    assert.strictEqual(board.version, 2, 'Version must increment by exactly 1');
    assert.strictEqual(board.elements.has('elem-shared-concurrent'), true);
    assert.strictEqual(board.elements.size, 1);

    // Verify WhiteboardOperation collection: exactly 1 durable record
    const opDocs = await WhiteboardOperation.find({
      meetingId: meetingMongoId,
      operationId: sharedOpId,
    });
    assert.strictEqual(opDocs.length, 1, 'Exactly 1 operation record in WhiteboardOperation');
  });

  it('3. Concurrent distinct operationIds across instances: both operations commit with consecutive sequences', async () => {
    const instanceA = new WhiteboardService({ transactionPolicy: 'required' });
    const instanceB = new WhiteboardService({ transactionPolicy: 'required' });

    const opA = [{
      operationId: 'op-dist-a-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-dist-a',
      element: {
        id: 'elem-dist-a',
        type: 'text' as const,
        x: 100,
        y: 100,
        text: 'Text A',
        strokeColor: '#333333',
        strokeWidth: 2,
        zIndex: 1,
      },
    }];

    const opB = [{
      operationId: 'op-dist-b-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-dist-b',
      element: {
        id: 'elem-dist-b',
        type: 'rect' as const,
        x: 200,
        y: 200,
        width: 80,
        height: 60,
        strokeColor: '#0055ff',
        strokeWidth: 2,
        zIndex: 2,
      },
    }];

    const [resA, resB] = await Promise.all([
      instanceA.applyOperations(meetingCode, user1Id.toString(), opA),
      instanceB.applyOperations(meetingCode, user2Id.toString(), opB),
    ]);

    assert.ok(resA.success);
    assert.ok(resB.success);
    assert.strictEqual(resA.appliedCount, 1);
    assert.strictEqual(resB.appliedCount, 1);

    const board = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(board);
    assert.strictEqual(board.elements.has('elem-dist-a'), true);
    assert.strictEqual(board.elements.has('elem-dist-b'), true);
    assert.strictEqual(board.elements.size, 2);
    assert.strictEqual(board.version, 3, 'Initial version 1 + 2 operations = version 3');

    const ops = await WhiteboardOperation.find({
      meetingId: meetingMongoId,
      operationId: { $in: [opA[0].operationId, opB[0].operationId] },
    }).sort({ sequence: 1 });

    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[1].sequence, ops[0].sequence + 1, 'Sequences must be consecutive');
  });

  it('4. Lost-response retry: client retries already-committed operation idempotently', async () => {
    const instanceA = new WhiteboardService({ transactionPolicy: 'required' });
    const instanceB = new WhiteboardService({ transactionPolicy: 'required' });

    const opId = 'op-lost-resp-' + Date.now();
    const op = [{
      operationId: opId,
      type: 'add' as const,
      elementId: 'elem-lost-resp',
      element: {
        id: 'elem-lost-resp',
        type: 'circle' as const,
        x: 60,
        y: 60,
        width: 30,
        height: 30,
        strokeColor: '#aa00aa',
        strokeWidth: 2,
        zIndex: 1,
      },
    }];

    // First attempt commits
    const firstRes = await instanceA.applyOperations(meetingCode, user1Id.toString(), op);
    assert.strictEqual(firstRes.appliedCount, 1);
    const committedVersion = firstRes.version;

    // Client lost network response and retries via instance B
    const retryRes = await instanceB.applyOperations(meetingCode, user1Id.toString(), op);
    assert.ok(retryRes.success);
    assert.strictEqual(retryRes.appliedCount, 0, 'Retry must report 0 applied operations');
    assert.strictEqual(retryRes.version, committedVersion, 'Version must not change on retry');

    const opCount = await WhiteboardOperation.countDocuments({
      meetingId: meetingMongoId,
      operationId: opId,
    });
    assert.strictEqual(opCount, 1, 'Exactly 1 operation doc in DB');
  });

  it('5. Undo and redo atomic transaction consistency: rollback on injected crash', async () => {
    const instanceA = new WhiteboardService({ transactionPolicy: 'required' });
    const instanceB = new WhiteboardService({ transactionPolicy: 'required' });

    const elemId = 'elem-undo-crash-test';
    await instanceA.applyOperations(meetingCode, user1Id.toString(), [{
      operationId: 'op-add-for-undo-' + Date.now(),
      type: 'add' as const,
      elementId: elemId,
      element: {
        id: elemId,
        type: 'rect' as const,
        x: 50,
        y: 50,
        width: 100,
        height: 50,
        strokeColor: '#123456',
        strokeWidth: 2,
        zIndex: 1,
      },
    }]);

    const boardBeforeUndo = await Whiteboard.findOne({ meetingId: meetingMongoId });
    const vBeforeUndo = boardBeforeUndo?.version || 1;

    // Simulate crash inside undo transaction after CAS
    await assert.rejects(
      async () => {
        await instanceB.undoOperation(meetingCode, user1Id.toString(), {
          failAfterCasForTest: true,
        });
      },
      (err: any) => {
        assert.match(err.message, /SIMULATED_CRASH_AFTER_CAS_BEFORE_UNDO_UPDATE/);
        return true;
      }
    );

    // Verify undo transaction rolled back cleanly
    const boardAfterCrash = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(boardAfterCrash?.version, vBeforeUndo, 'Version must not increment on aborted undo');
    const elemAfterCrash = boardAfterCrash?.elements.get(elemId);
    assert.strictEqual(elemAfterCrash?.isDeleted, false, 'Element must remain active');

    const opAfterCrash = await WhiteboardOperation.findOne({
      meetingId: meetingMongoId,
      elementId: elemId,
    });
    assert.strictEqual(opAfterCrash?.isUndone, false, 'Operation must not be marked isUndone');

    // Clean undo succeeds
    const cleanUndo = await instanceB.undoOperation(meetingCode, user1Id.toString());
    assert.ok(cleanUndo.success);
    assert.strictEqual(cleanUndo.elementId, elemId);

    const boardAfterUndo = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(boardAfterUndo?.elements.get(elemId)?.isDeleted, true);

    // Simulate crash inside redo transaction after CAS
    await assert.rejects(
      async () => {
        await instanceA.redoOperation(meetingCode, user1Id.toString(), {
          failAfterCasForTest: true,
        });
      },
      (err: any) => {
        assert.match(err.message, /SIMULATED_CRASH_AFTER_CAS_BEFORE_REDO_UPDATE/);
        return true;
      }
    );

    // Verify redo transaction rolled back cleanly
    const boardAfterRedoCrash = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(
      boardAfterRedoCrash?.elements.get(elemId)?.isDeleted,
      true,
      'Element must still be deleted after aborted redo'
    );

    // Clean redo succeeds
    const cleanRedo = await instanceA.redoOperation(meetingCode, user1Id.toString());
    assert.ok(cleanRedo.success);
    const boardAfterRedo = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(boardAfterRedo?.elements.get(elemId)?.isDeleted, false);
  });

  it('6. Clear operation failure and rollback: active elements preserved on aborted clear', async () => {
    const service = new WhiteboardService({ transactionPolicy: 'required' });

    // Add elements
    await service.applyOperations(meetingCode, user1Id.toString(), [
      {
        operationId: 'op-clear-1',
        type: 'add' as const,
        elementId: 'elem-clear-1',
        element: {
          id: 'elem-clear-1',
          type: 'circle' as const,
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          strokeColor: '#000',
          strokeWidth: 1,
          zIndex: 1,
        },
      },
      {
        operationId: 'op-clear-2',
        type: 'add' as const,
        elementId: 'elem-clear-2',
        element: {
          id: 'elem-clear-2',
          type: 'rect' as const,
          x: 30,
          y: 30,
          width: 20,
          height: 20,
          strokeColor: '#000',
          strokeWidth: 1,
          zIndex: 2,
        },
      },
    ]);

    const boardBeforeClear = await Whiteboard.findOne({ meetingId: meetingMongoId });
    const vBeforeClear = boardBeforeClear?.version || 1;

    // Injected crash during clear transaction
    await assert.rejects(
      async () => {
        await service.clearWhiteboard(meetingCode, hostId.toString(), {
          failAfterCasForTest: true,
        });
      },
      (err: any) => {
        assert.match(err.message, /SIMULATED_CRASH_AFTER_CAS_BEFORE_CLEAR_LOG/);
        return true;
      }
    );

    // Verify rollback: elements must NOT be deleted
    const boardAfterAbortedClear = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(boardAfterAbortedClear?.version, vBeforeClear);
    assert.strictEqual(boardAfterAbortedClear?.elements.get('elem-clear-1')?.isDeleted, false);
    assert.strictEqual(boardAfterAbortedClear?.elements.get('elem-clear-2')?.isDeleted, false);

    // Normal clear succeeds
    const clearRes = await service.clearWhiteboard(meetingCode, hostId.toString());
    assert.ok(clearRes.ok);
    assert.strictEqual(clearRes.version, vBeforeClear + 1);

    const boardAfterCleanClear = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.strictEqual(boardAfterCleanClear?.elements.get('elem-clear-1')?.isDeleted, true);
    assert.strictEqual(boardAfterCleanClear?.elements.get('elem-clear-2')?.isDeleted, true);
  });

  it('7. Concurrent first-time board creation across instances: handles race without E11000 crash', async () => {
    const instanceA = new WhiteboardService({ transactionPolicy: 'required' });
    const instanceB = new WhiteboardService({ transactionPolicy: 'required' });

    const freshMeeting = await Meeting.create({
      title: 'Fresh Meeting',
      meetingCode: 'cly-frs-001',
      hostId,
      originalHostId: hostId,
      status: 'ACTIVE',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxParticipants: 60,
      settings: { waitingRoomEnabled: false },
    });

    await MeetingParticipant.create({
      meetingId: freshMeeting._id,
      userId: user1Id,
      displayName: 'Alice User',
      email: 'user1_tx@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    await MeetingParticipant.create({
      meetingId: freshMeeting._id,
      userId: user2Id,
      displayName: 'Bob User',
      email: 'user2_tx@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    // Simultaneously apply initial operations when no Whiteboard document exists
    const [resA, resB] = await Promise.all([
      instanceA.applyOperations(freshMeeting.meetingCode, user1Id.toString(), [{
        operationId: 'op-init-a-' + Date.now(),
        type: 'add' as const,
        elementId: 'elem-init-a',
        element: {
          id: 'elem-init-a',
          type: 'circle' as const,
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          strokeColor: '#123',
          strokeWidth: 2,
          zIndex: 1,
        },
      }]),
      instanceB.applyOperations(freshMeeting.meetingCode, user2Id.toString(), [{
        operationId: 'op-init-b-' + Date.now(),
        type: 'add' as const,
        elementId: 'elem-init-b',
        element: {
          id: 'elem-init-b',
          type: 'rect' as const,
          x: 30,
          y: 30,
          width: 40,
          height: 40,
          strokeColor: '#456',
          strokeWidth: 2,
          zIndex: 2,
        },
      }]),
    ]);

    assert.ok(resA.success);
    assert.ok(resB.success);

    const boardCount = await Whiteboard.countDocuments({ meetingId: freshMeeting._id });
    assert.strictEqual(boardCount, 1, 'Exactly 1 Whiteboard document must be created');

    const board = await Whiteboard.findOne({ meetingId: freshMeeting._id });
    assert.strictEqual(board?.elements.has('elem-init-a'), true);
    assert.strictEqual(board?.elements.has('elem-init-b'), true);
  });

  it('8. Standalone fail-closed defense: rejects mutations when transactions required, read-only remains functional', async () => {
    // Switch connection to port 27017 (standalone MongoDB)
    await mongoose.disconnect();
    await mongoose.connect(STANDALONE_URI);
    resetRevocationTopologyCache();

    // Seed meeting and participant on standalone DB
    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});

    const standaloneMeeting = await Meeting.create({
      title: 'Standalone Whiteboard Meeting',
      meetingCode: 'cly-sta-001',
      hostId,
      originalHostId: hostId,
      status: 'ACTIVE',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxParticipants: 60,
      settings: { waitingRoomEnabled: false },
    });

    await MeetingParticipant.create({
      meetingId: standaloneMeeting._id,
      userId: hostId,
      displayName: 'Host User',
      email: 'host_tx@example.com',
      role: 'host',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    await MeetingParticipant.create({
      meetingId: standaloneMeeting._id,
      userId: user1Id,
      displayName: 'Alice User',
      email: 'user1_tx@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    // Instantiate service on standalone deployment
    const service = new WhiteboardService();

    // 1. Read-only state query must succeed on standalone MongoDB
    const state = await service.getWhiteboardState(standaloneMeeting.meetingCode, user1Id.toString());
    assert.ok(state);
    assert.strictEqual(typeof state.version, 'number');
    assert.strictEqual(state.elements.length, 0);

    // Initial snapshot verification
    const initialBoard = await Whiteboard.findOne({ meetingId: standaloneMeeting._id });
    assert.ok(initialBoard);
    const initialVersion = initialBoard.version;

    // 2. applyOperations must fail closed with 503 WHITEBOARD_TRANSACTION_REQUIRED
    await assert.rejects(
      async () => {
        await service.applyOperations(standaloneMeeting.meetingCode, user1Id.toString(), [{
          operationId: 'op-standalone-reject',
          type: 'add' as const,
          elementId: 'elem-standalone-reject',
          element: {
            id: 'elem-standalone-reject',
            type: 'rect' as const,
            x: 10,
            y: 10,
            width: 50,
            height: 50,
            strokeColor: '#000',
            strokeWidth: 2,
            zIndex: 1,
          },
        }]);
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'WHITEBOARD_TRANSACTION_REQUIRED');
        return true;
      }
    );

    // 3. undoOperation must fail closed with 503 WHITEBOARD_TRANSACTION_REQUIRED
    await assert.rejects(
      async () => {
        await service.undoOperation(standaloneMeeting.meetingCode, user1Id.toString());
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'WHITEBOARD_TRANSACTION_REQUIRED');
        return true;
      }
    );

    // 4. redoOperation must fail closed with 503 WHITEBOARD_TRANSACTION_REQUIRED
    await assert.rejects(
      async () => {
        await service.redoOperation(standaloneMeeting.meetingCode, user1Id.toString());
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'WHITEBOARD_TRANSACTION_REQUIRED');
        return true;
      }
    );

    // 5. clearWhiteboard must fail closed with 503 WHITEBOARD_TRANSACTION_REQUIRED
    await assert.rejects(
      async () => {
        await service.clearWhiteboard(standaloneMeeting.meetingCode, hostId.toString());
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'WHITEBOARD_TRANSACTION_REQUIRED');
        return true;
      }
    );

    // 6. Verify zero database mutations or orphan records produced by rejected mutations
    const boardAfterRejections = await Whiteboard.findOne({ meetingId: standaloneMeeting._id });
    assert.ok(boardAfterRejections);
    assert.strictEqual(
      boardAfterRejections.version,
      initialVersion,
      'Board version must be strictly unchanged'
    );
    assert.strictEqual(
      boardAfterRejections.elements.size,
      0,
      'Board elements map must remain empty'
    );
    assert.strictEqual(
      boardAfterRejections.appliedOperationIds?.length || 0,
      0,
      'appliedOperationIds array must remain empty'
    );

    const opRecordCount = await WhiteboardOperation.countDocuments({ meetingId: standaloneMeeting._id });
    assert.strictEqual(opRecordCount, 0, 'Zero WhiteboardOperation records must exist in database');
  });
});
