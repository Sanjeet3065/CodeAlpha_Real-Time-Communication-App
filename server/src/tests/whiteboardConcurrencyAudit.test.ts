import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { WhiteboardService } from '../services/whiteboard.service.js';
import { chatRedisService } from '../services/chatRedis.service.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { User } from '../models/User.model.js';
import { resetRevocationTopologyCache } from '../models/LiveKitRevocationEvent.model.js';

describe('Whiteboard Cross-Instance Concurrency & Mutex Audit Suite', () => {
  let user1Id: Types.ObjectId;
  let user2Id: Types.ObjectId;
  let meetingCode: string;
  let meetingMongoId: Types.ObjectId;

  before(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(
      process.env.MONGODB_URI_RS || 'mongodb://127.0.0.1:27018/connectly_whiteboard_audit_test?directConnection=true'
    );
    resetRevocationTopologyCache();

    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await User.deleteMany({});

    const user1 = await User.create({
      email: 'host_wb@example.com',
      passwordHash: 'argon_hash_dummy_1',
      firstName: 'Host',
      lastName: 'Whiteboard',
      isEmailVerified: true,
    });
    user1Id = user1._id;

    const user2 = await User.create({
      email: 'peer_wb@example.com',
      passwordHash: 'argon_hash_dummy_2',
      firstName: 'Peer',
      lastName: 'Whiteboard',
      isEmailVerified: true,
    });
    user2Id = user2._id;

    meetingCode = 'cly-wbc-aud';
    const now = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const meeting = await Meeting.create({
      title: 'Whiteboard Audit Meeting',
      meetingCode,
      hostId: user1Id,
      originalHostId: user1Id,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt,
      maxParticipants: 60,
      settings: { waitingRoomEnabled: false },
    });
    meetingMongoId = meeting._id;

    await MeetingParticipant.create({
      meetingId: meetingMongoId,
      userId: user1Id,
      displayName: 'Host User',
      email: 'host_wb@example.com',
      role: 'host',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });

    await MeetingParticipant.create({
      meetingId: meetingMongoId,
      userId: user2Id,
      displayName: 'Peer User',
      email: 'peer_wb@example.com',
      role: 'participant',
      admissionStatus: 'ADMITTED',
      presenceStatus: 'ONLINE',
    });
  });

  after(async () => {
    await chatRedisService.close();
    await Whiteboard.deleteMany({});
    await WhiteboardOperation.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it('1. Process-local serialization within a single WhiteboardService instance', async () => {
    const service = new WhiteboardService();

    const opsA = [{
      operationId: 'op-local-1',
      type: 'add' as const,
      elementId: 'elem-local-1',
      element: {
        id: 'elem-local-1',
        type: 'rect' as const,
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        strokeColor: '#000000',
        strokeWidth: 2,
        zIndex: 1,
      },
    }];

    const opsB = [{
      operationId: 'op-local-2',
      type: 'add' as const,
      elementId: 'elem-local-2',
      element: {
        id: 'elem-local-2',
        type: 'circle' as const,
        x: 50,
        y: 50,
        width: 40,
        height: 40,
        strokeColor: '#168B83',
        strokeWidth: 2,
        zIndex: 2,
      },
    }];

    // Execute concurrently within single instance
    const [resA, resB] = await Promise.all([
      service.applyOperations(meetingCode, user1Id.toString(), opsA),
      service.applyOperations(meetingCode, user2Id.toString(), opsB),
    ]);

    assert.ok(resA.success);
    assert.ok(resB.success);

    const board = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(board);
    assert.strictEqual(board.elements.has('elem-local-1'), true);
    assert.strictEqual(board.elements.has('elem-local-2'), true);
    assert.strictEqual(board.elements.size, 2);
  });

  it('2. Multi-instance concurrency: two independent WhiteboardService instances against same DB', async () => {
    // Instantiate two distinct service instances simulating two separate Node server processes
    const instanceA = new WhiteboardService();
    const instanceB = new WhiteboardService();

    const opFromA = [{
      operationId: 'op-inst-a-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-inst-a',
      element: {
        id: 'elem-inst-a',
        type: 'text' as const,
        x: 100,
        y: 100,
        text: 'From Instance A',
        strokeColor: '#ff0000',
        strokeWidth: 1,
        zIndex: 3,
      },
    }];

    const opFromB = [{
      operationId: 'op-inst-b-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-inst-b',
      element: {
        id: 'elem-inst-b',
        type: 'highlighter' as const,
        x: 150,
        y: 150,
        width: 200,
        height: 20,
        strokeColor: '#ffff00',
        strokeWidth: 10,
        zIndex: 4,
      },
    }];

    // Concurrent execution across two independent instances
    const [resultA, resultB] = await Promise.all([
      instanceA.applyOperations(meetingCode, user1Id.toString(), opFromA),
      instanceB.applyOperations(meetingCode, user2Id.toString(), opFromB),
    ]);

    assert.ok(resultA.success);
    assert.ok(resultB.success);

    // Verify operations table persistence: both operations must be persisted in log
    const opRecords = await WhiteboardOperation.find({
      meetingId: meetingMongoId,
      operationId: { $in: [opFromA[0].operationId, opFromB[0].operationId] },
    });
    assert.strictEqual(opRecords.length, 2, 'Both operations must be recorded in WhiteboardOperation collection');

    // Check board elements: both concurrent operations must survive in the final snapshot
    const board = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(board);
    assert.strictEqual(board.elements.has('elem-inst-a'), true, 'elem-inst-a must be present in board snapshot');
    assert.strictEqual(board.elements.has('elem-inst-b'), true, 'elem-inst-b must be present in board snapshot');
    assert.ok(board.elements.size >= 2, 'Both concurrent elements must survive in board snapshot');
  });

  it('3. Cross-instance idempotency: duplicate operation rejected across independent instances', async () => {
    const instanceA = new WhiteboardService();
    const instanceB = new WhiteboardService();

    const sharedOpId = 'op-shared-idempotency-' + Date.now();
    const op = [{
      operationId: sharedOpId,
      type: 'add' as const,
      elementId: 'elem-shared',
      element: {
        id: 'elem-shared',
        type: 'rect' as const,
        x: 30,
        y: 30,
        width: 60,
        height: 60,
        strokeColor: '#333333',
        strokeWidth: 2,
        zIndex: 5,
      },
    }];

    // Instance A applies operation
    const firstResult = await instanceA.applyOperations(meetingCode, user1Id.toString(), op);
    assert.strictEqual(firstResult.appliedCount, 1);

    // Instance B receives the exact same operationId
    const dupResult = await instanceB.applyOperations(meetingCode, user2Id.toString(), op);
    assert.strictEqual(dupResult.appliedCount, 0, 'Duplicate operation must be skipped via DB idempotency index');

    // Verify database only has 1 record for this operationId
    const opCount = await WhiteboardOperation.countDocuments({
      meetingId: meetingMongoId,
      operationId: sharedOpId,
    });
    assert.strictEqual(opCount, 1, 'MongoDB unique index { meetingId: 1, operationId: 1 } strictly prevents duplicates');
  });

  it('4. Monotonic sequence and undo across instances', async () => {
    const instanceA = new WhiteboardService();
    const instanceB = new WhiteboardService();

    // User 1 adds an element via instance A
    const addOpId = 'op-add-undo-test-' + Date.now();
    await instanceA.applyOperations(meetingCode, user1Id.toString(), [{
      operationId: addOpId,
      type: 'add' as const,
      elementId: 'elem-undo-target',
      element: {
        id: 'elem-undo-target',
        type: 'circle' as const,
        x: 80,
        y: 80,
        width: 30,
        height: 30,
        strokeColor: '#123456',
        strokeWidth: 2,
        zIndex: 6,
      },
    }]);

    // User 1 calls undo via instance B
    const undoResult = await instanceB.undoOperation(meetingCode, user1Id.toString());
    assert.ok(undoResult.success);
    assert.strictEqual(undoResult.elementId, 'elem-undo-target');

    // Verify element marked deleted
    const board = await Whiteboard.findOne({ meetingId: meetingMongoId });
    const elem = board?.elements.get('elem-undo-target');
    assert.ok(elem);
    assert.strictEqual(elem.isDeleted, true);

    // User 1 calls redo via instance A
    const redoResult = await instanceA.redoOperation(meetingCode, user1Id.toString());
    assert.ok(redoResult.success);

    const boardAfterRedo = await Whiteboard.findOne({ meetingId: meetingMongoId });
    const elemAfterRedo = boardAfterRedo?.elements.get('elem-undo-target');
    assert.ok(elemAfterRedo);
    assert.strictEqual(elemAfterRedo.isDeleted, false);
  });

  it('5. OCC contention resilience: simultaneous overlapping writes across instances recover without data loss', async () => {
    const instanceA = new WhiteboardService();
    const instanceB = new WhiteboardService();

    const initialBoard = await Whiteboard.findOne({ meetingId: meetingMongoId });
    const initialVersion = initialBoard?.version || 1;

    const opA = [{
      operationId: 'op-occ-a-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-occ-a',
      element: {
        id: 'elem-occ-a',
        type: 'rect' as const,
        x: 200,
        y: 200,
        width: 80,
        height: 40,
        strokeColor: '#0055ff',
        strokeWidth: 3,
        zIndex: 10,
      },
    }];

    const opB = [{
      operationId: 'op-occ-b-' + Date.now(),
      type: 'add' as const,
      elementId: 'elem-occ-b',
      element: {
        id: 'elem-occ-b',
        type: 'circle' as const,
        x: 250,
        y: 250,
        width: 50,
        height: 50,
        strokeColor: '#ff5500',
        strokeWidth: 3,
        zIndex: 11,
      },
    }];

    // Execute concurrently across two independent instances
    const [resA, resB] = await Promise.all([
      instanceA.applyOperations(meetingCode, user1Id.toString(), opA),
      instanceB.applyOperations(meetingCode, user2Id.toString(), opB),
    ]);

    assert.ok(resA.success);
    assert.ok(resB.success);

    // Both operations must survive in the final persisted board snapshot
    const finalBoard = await Whiteboard.findOne({ meetingId: meetingMongoId });
    assert.ok(finalBoard);
    assert.strictEqual(finalBoard.elements.has('elem-occ-a'), true, 'elem-occ-a must be present');
    assert.strictEqual(finalBoard.elements.has('elem-occ-b'), true, 'elem-occ-b must be present');
    assert.strictEqual(finalBoard.version, initialVersion + 2, 'Board version must increment by exactly 2');

    // Both operations must be recorded with monotonic sequences
    const opRecords = await WhiteboardOperation.find({
      meetingId: meetingMongoId,
      operationId: { $in: [opA[0].operationId, opB[0].operationId] },
    }).sort({ sequence: 1 });

    assert.strictEqual(opRecords.length, 2);
    assert.strictEqual(opRecords[1].sequence, opRecords[0].sequence + 1, 'Sequences must be consecutive');
  });
});
