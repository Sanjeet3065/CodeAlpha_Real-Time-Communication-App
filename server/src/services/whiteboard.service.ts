import mongoose, { Types, type ClientSession } from 'mongoose';
import {
  Whiteboard,
  toWhiteboardStateDto,
  toWhiteboardElementDto,
  type IWhiteboardElement,
  type WhiteboardStateDto,
} from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { isReplicaSetTransactionsSupported } from '../models/LiveKitRevocationEvent.model.js';
import { meetingService } from './meeting.service.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { chatRedisService, ChatRedisService } from './chatRedis.service.js';
import {
  submitWhiteboardOperationsSchema,
  type SubmitWhiteboardOperationsInput,
  type WhiteboardOperationInput,
} from '../schemas/whiteboard.schema.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  ServiceUnavailableError,
  AppError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const WHITEBOARD_OP_RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
export const WHITEBOARD_OP_RATE_LIMIT_MAX_OPS = 120; // 120 operations per 10s window

export const WHITEBOARD_CLEAR_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const WHITEBOARD_CLEAR_RATE_LIMIT_MAX = 5; // 5 clears per minute

export const WHITEBOARD_MAX_OCC_RETRIES = 5; // Max optimistic concurrency retries

export interface WhiteboardServiceOptions {
  redisService?: ChatRedisService;
  transactionPolicy?: 'required';
}

export class WhiteboardService {
  private redisService: ChatRedisService;
  private opQueues = new Map<string, Promise<any>>();

  constructor(
    redisServiceOrOptions: ChatRedisService | WhiteboardServiceOptions = chatRedisService
  ) {
    if (
      redisServiceOrOptions &&
      typeof (redisServiceOrOptions as any).checkRateLimit === 'function'
    ) {
      this.redisService = redisServiceOrOptions as ChatRedisService;
    } else {
      const opts = (redisServiceOrOptions as WhiteboardServiceOptions) || {};
      this.redisService = opts.redisService || chatRedisService;
    }
  }

  public clearRateLimits(): void {
    this.redisService.clearLocalState();
  }

  /**
   * Serializes mutating operations per meeting to prevent concurrent race conditions
   * and lost updates on collaborative whiteboard state within a process.
   */
  private async withMeetingLock<T>(meetingId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.opQueues.get(meetingId) || Promise.resolve();
    let resolveLock!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.opQueues.set(meetingId, current);

    try {
      await prev.catch(() => {});
      return await fn();
    } finally {
      resolveLock();
      if (this.opQueues.get(meetingId) === current) {
        this.opQueues.delete(meetingId);
      }
    }
  }

  /**
   * Helper: validates meeting existence, expiration/ended status, and participant admission.
   */
  public async getAdmittedParticipant(meetingCodeOrId: string, userId: string) {
    const meeting = await meetingService.findMeetingAndEnforceExpiration(meetingCodeOrId);
    if (!meeting) {
      throw new NotFoundError('Meeting room not found or has expired.', 'MEETING_NOT_FOUND');
    }

    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED') {
      throw new AppError(
        'This meeting is no longer active.',
        410,
        meeting.status === 'EXPIRED' ? 'MEETING_EXPIRED' : 'MEETING_ENDED'
      );
    }

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant || participant.admissionStatus !== 'ADMITTED') {
      const msg = !participant
        ? 'You are not a participant in this meeting.'
        : participant.admissionStatus === 'WAITING'
        ? 'Waiting room participants cannot access the collaborative whiteboard.'
        : 'Only admitted participants can access the collaborative whiteboard.';
      throw new ForbiddenError(msg, 'WHITEBOARD_ACCESS_DENIED');
    }

    return { meeting, participant };
  }

  /**
   * Retrieves the current authoritative whiteboard state for a meeting, creating it if needed.
   * Read-only operations remain safe on both standalone and replica-set MongoDB topologies.
   */
  public async getWhiteboardState(
    meetingCodeOrId: string,
    userId: string
  ): Promise<WhiteboardStateDto> {
    const { meeting } = await this.getAdmittedParticipant(meetingCodeOrId, userId);

    let board = await Whiteboard.findOne({ meetingId: meeting._id });
    if (!board) {
      try {
        board = await Whiteboard.create({
          meetingId: meeting._id,
          version: 1,
          elements: new Map(),
          appliedOperationIds: [],
        });
      } catch (err: any) {
        board = await Whiteboard.findOne({ meetingId: meeting._id });
        if (!board) throw err;
      }
    }

    return toWhiteboardStateDto(board);
  }

  /**
   * Applies a batch of whiteboard operations (add, update, delete) atomically.
   * On transaction-capable topologies (Replica Set / mongos), mutations and operation logs
   * are committed atomically in the same ACID session.
   * On standalone topologies, fails closed in production, or uses atomic embedded-journal CAS in dev/test.
   */
  public async applyOperations(
    meetingCodeOrId: string,
    userId: string,
    input: SubmitWhiteboardOperationsInput,
    testHooks?: { failAfterCasForTest?: boolean; sessionOverride?: ClientSession }
  ): Promise<{ version: number; appliedCount: number; success?: boolean; ok?: boolean }> {
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    // Distributed rate-limiting
    const rateLimitKey = `connectly:rl:wb:ops:${meetingIdStr}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      WHITEBOARD_OP_RATE_LIMIT_WINDOW_MS,
      WHITEBOARD_OP_RATE_LIMIT_MAX_OPS
    );

    if (!allowed) {
      throw new TooManyRequestsError(
        'Whiteboard operation rate limit exceeded. Please wait a moment before drawing more.'
      );
    }

    // Validate payload structure
    const payload = Array.isArray(input) ? { operations: input } : input;
    const parsed = submitWhiteboardOperationsSchema.parse(payload);
    const operations = parsed.operations;

    // Check transaction capability: all mutations strictly require Replica Set multi-document transactions
    const txSupported =
      Boolean(testHooks?.sessionOverride) || (await isReplicaSetTransactionsSupported());

    if (!txSupported) {
      throw new ServiceUnavailableError(
        'Collaborative whiteboard mutations require a MongoDB Replica Set supporting multi-document transactions.',
        'WHITEBOARD_TRANSACTION_REQUIRED'
      );
    }

    return this.withMeetingLock(meetingIdStr, async () => {
      let attempt = 0;
      while (attempt < WHITEBOARD_MAX_OCC_RETRIES) {
        attempt++;

        const session = testHooks?.sessionOverride || (await mongoose.startSession());
        const isOwnSession = !testHooks?.sessionOverride;
        let committedResult: { version: number; appliedCount: number; success: boolean; ok: boolean } | null = null;
        let appliedOpsForBroadcast: WhiteboardOperationInput[] = [];

          try {
            await session.withTransaction(
              async () => {
                // 1. Ensure board exists within the transaction session
                let board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                if (!board) {
                  try {
                    const [newBoard] = await Whiteboard.create(
                      [
                        {
                          meetingId: meeting._id,
                          version: 1,
                          elements: new Map(),
                          appliedOperationIds: [],
                        },
                      ],
                      { session }
                    );
                    board = newBoard;
                  } catch (err: any) {
                    board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                    if (!board) throw err;
                  }
                }

                const currentVersion = board.version;
                const appliedOpIds = new Set(board.appliedOperationIds || []);

                // 2. Query WhiteboardOperation within transaction session for all incoming op IDs
                const incomingOpIds = operations.map((o) => o.operationId);
                const existingOpsInDb = await WhiteboardOperation.find(
                  { meetingId: meeting._id, operationId: { $in: incomingOpIds } },
                  null,
                  { session }
                );
                for (const e of existingOpsInDb) {
                  appliedOpIds.add(e.operationId);
                }

                // 3. Filter pending operations for atomic snapshot idempotency
                const pendingOperations = operations.filter((op) => !appliedOpIds.has(op.operationId));

                if (pendingOperations.length === 0) {
                  committedResult = {
                    success: true,
                    ok: true,
                    version: currentVersion,
                    appliedCount: 0,
                  };
                  return;
                }

                // 4. Stage mutations on board.elements
                const now = new Date();
                const appliedOps: WhiteboardOperationInput[] = [];
                const opDocs: any[] = [];
                let nextSequence = currentVersion;
                const newOpIds: string[] = [];

                for (const op of pendingOperations) {
                  const elementId = op.elementId;
                  const currentElement = board.elements.get(elementId);
                  let prevElementState: any = undefined;
                  let newElementState: any = undefined;

                  if (op.type === 'add') {
                    if (!op.element) {
                      throw new BadRequestError('Element data is required for add operation.', 'INVALID_OPERATION');
                    }
                    const newEl: IWhiteboardElement = {
                      id: elementId,
                      type: op.element.type || 'pen',
                      points: op.element.points || [],
                      x: op.element.x ?? 0,
                      y: op.element.y ?? 0,
                      width: op.element.width,
                      height: op.element.height,
                      x2: op.element.x2,
                      y2: op.element.y2,
                      text: op.element.text,
                      fontSize: op.element.fontSize ?? 16,
                      strokeColor: op.element.strokeColor || '#172B3A',
                      fillColor: op.element.fillColor,
                      strokeWidth: op.element.strokeWidth ?? 3,
                      opacity: op.element.opacity ?? 1,
                      zIndex: op.element.zIndex ?? board.elements.size,
                      createdBy: new Types.ObjectId(userId),
                      createdByName: participant.displayName || 'Participant',
                      createdAt: now,
                      updatedAt: now,
                      isDeleted: false,
                    };
                    board.elements.set(elementId, newEl);
                    newElementState = newEl;
                  } else if (op.type === 'update') {
                    if (!currentElement || currentElement.isDeleted) {
                      continue;
                    }
                    prevElementState = JSON.parse(JSON.stringify(currentElement));
                    if (op.element) {
                      if (op.element.x !== undefined) currentElement.x = op.element.x;
                      if (op.element.y !== undefined) currentElement.y = op.element.y;
                      if (op.element.width !== undefined) currentElement.width = op.element.width;
                      if (op.element.height !== undefined) currentElement.height = op.element.height;
                      if (op.element.x2 !== undefined) currentElement.x2 = op.element.x2;
                      if (op.element.y2 !== undefined) currentElement.y2 = op.element.y2;
                      if (op.element.points !== undefined) currentElement.points = op.element.points;
                      if (op.element.text !== undefined) currentElement.text = op.element.text;
                      if (op.element.fontSize !== undefined) currentElement.fontSize = op.element.fontSize;
                      if (op.element.strokeColor !== undefined) currentElement.strokeColor = op.element.strokeColor;
                      if (op.element.fillColor !== undefined) currentElement.fillColor = op.element.fillColor;
                      if (op.element.strokeWidth !== undefined) currentElement.strokeWidth = op.element.strokeWidth;
                      if (op.element.opacity !== undefined) currentElement.opacity = op.element.opacity;
                      if (op.element.zIndex !== undefined) currentElement.zIndex = op.element.zIndex;
                    }
                    currentElement.updatedAt = now;
                    board.elements.set(elementId, currentElement);
                    newElementState = currentElement;
                  } else if (op.type === 'delete') {
                    if (!currentElement || currentElement.isDeleted) {
                      continue;
                    }
                    prevElementState = JSON.parse(JSON.stringify(currentElement));
                    currentElement.isDeleted = true;
                    currentElement.updatedAt = now;
                    board.elements.set(elementId, currentElement);
                    newElementState = currentElement;
                  }

                  nextSequence += 1;
                  appliedOps.push(op);
                  newOpIds.push(op.operationId);
                  opDocs.push({
                    meetingId: meeting._id,
                    whiteboardId: board._id,
                    operationId: op.operationId,
                    userId: new Types.ObjectId(userId),
                    userName: participant.displayName || 'Participant',
                    type: op.type,
                    elementId,
                    element: newElementState,
                    previousElement: prevElementState,
                    sequence: nextSequence,
                    isUndone: false,
                  });
                }

                if (appliedOps.length === 0) {
                  committedResult = {
                    success: true,
                    ok: true,
                    version: currentVersion,
                    appliedCount: 0,
                  };
                  return;
                }

                // 5. Version-conditional atomic CAS within transaction
                const updatedBoard = await Whiteboard.findOneAndUpdate(
                  {
                    meetingId: meeting._id,
                    version: currentVersion,
                    appliedOperationIds: { $nin: newOpIds },
                  },
                  {
                    $set: {
                      elements: board.elements,
                      version: nextSequence,
                      lastModifiedBy: new Types.ObjectId(userId),
                      lastModifiedByName: participant.displayName || 'Participant',
                    },
                    $push: {
                      appliedOperationIds: {
                        $each: newOpIds,
                        $slice: -500,
                      },
                    },
                  },
                  { session, new: true }
                );

                if (!updatedBoard) {
                  const conflictErr = new Error('WHITEBOARD_CAS_CONFLICT');
                  (conflictErr as any).isCasConflict = true;
                  throw conflictErr;
                }

                // Test Hook: Failure injection between CAS and operation-log insertion
                if (testHooks?.failAfterCasForTest) {
                  throw new Error('SIMULATED_CRASH_AFTER_CAS_BEFORE_LOG_INSERT');
                }

                // 6. Persist operation records within the SAME transaction session
                await WhiteboardOperation.insertMany(opDocs, { session, ordered: true });

                appliedOpsForBroadcast = appliedOps;
                committedResult = {
                  success: true,
                  ok: true,
                  version: updatedBoard.version,
                  appliedCount: appliedOps.length,
                };
              },
              {
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority' },
              }
            );

            if (committedResult) {
              if (appliedOpsForBroadcast.length > 0) {
                meetingRealtime.emitWhiteboardOperation(meetingIdStr, {
                  meetingId: meetingIdStr,
                  version: (committedResult as any).version,
                  operations: appliedOpsForBroadcast,
                  userId,
                  userName: participant.displayName || 'Participant',
                });
              }
              return committedResult;
            }
          } catch (err: any) {
            if (err?.message === 'SIMULATED_CRASH_AFTER_CAS_BEFORE_LOG_INSERT') {
              throw err;
            }
            if (err?.isCasConflict || err?.errorLabels?.has?.('TransientTransactionError')) {
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 25));
              continue;
            }
            throw err;
          } finally {
            if (isOwnSession) {
              await session.endSession().catch(() => {});
            }
          }

      }

      throw new AppError(
        'Concurrent whiteboard modification conflict. Please retry your operation.',
        409,
        'WHITEBOARD_CONCURRENCY_CONFLICT'
      );
    });
  }

  /**
   * Undoes the user's latest active operation on the board.
   * Commits element state reversion, board version increment, and operation record update atomically.
   */
  public async undoOperation(
    meetingCodeOrId: string,
    userId: string,
    testHooks?: { failAfterCasForTest?: boolean; sessionOverride?: ClientSession }
  ): Promise<{ ok: boolean; success?: boolean; version?: number; elementId?: string }> {
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    // Rate-limiting for undo
    const rateLimitKey = `connectly:rl:wb:ops:${meetingIdStr}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      WHITEBOARD_OP_RATE_LIMIT_WINDOW_MS,
      WHITEBOARD_OP_RATE_LIMIT_MAX_OPS
    );
    if (!allowed) {
      throw new TooManyRequestsError('Rate limit exceeded. Please wait a moment.');
    }

    const txSupported =
      Boolean(testHooks?.sessionOverride) || (await isReplicaSetTransactionsSupported());

    if (!txSupported) {
      throw new ServiceUnavailableError(
        'Collaborative whiteboard mutations require a MongoDB Replica Set supporting multi-document transactions.',
        'WHITEBOARD_TRANSACTION_REQUIRED'
      );
    }

    return this.withMeetingLock(meetingIdStr, async () => {
      let attempt = 0;
      while (attempt < WHITEBOARD_MAX_OCC_RETRIES) {
        attempt++;
          const session = testHooks?.sessionOverride || (await mongoose.startSession());
          const isOwnSession = !testHooks?.sessionOverride;
          let committedResult: { ok: boolean; success?: boolean; version?: number; elementId?: string } | null = null;
          let broadcastPayload: any = null;

          try {
            await session.withTransaction(
              async () => {
                const lastOp = await WhiteboardOperation.findOne(
                  {
                    meetingId: meeting._id,
                    userId: new Types.ObjectId(userId),
                    isUndone: false,
                    type: { $in: ['add', 'update', 'delete'] },
                  },
                  null,
                  { session }
                ).sort({ sequence: -1 });

                if (!lastOp || !lastOp.elementId) {
                  committedResult = { ok: false };
                  return;
                }

                const board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                if (!board) {
                  committedResult = { ok: false };
                  return;
                }

                const currentVersion = board.version;
                const nextVersion = currentVersion + 1;
                const elementId = lastOp.elementId;
                const currentElement = board.elements.get(elementId);
                let revertedElement: any = undefined;

                if (lastOp.type === 'add') {
                  if (currentElement) {
                    currentElement.isDeleted = true;
                    currentElement.updatedAt = new Date();
                    board.elements.set(elementId, currentElement);
                    revertedElement = currentElement;
                  }
                } else if (lastOp.type === 'update') {
                  if (lastOp.previousElement) {
                    board.elements.set(elementId, lastOp.previousElement as IWhiteboardElement);
                    revertedElement = lastOp.previousElement;
                  }
                } else if (lastOp.type === 'delete') {
                  if (currentElement) {
                    currentElement.isDeleted = false;
                    currentElement.updatedAt = new Date();
                    board.elements.set(elementId, currentElement);
                    revertedElement = currentElement;
                  } else if (lastOp.previousElement) {
                    board.elements.set(elementId, lastOp.previousElement as IWhiteboardElement);
                    revertedElement = lastOp.previousElement;
                  }
                }

                const updatedBoard = await Whiteboard.findOneAndUpdate(
                  { meetingId: meeting._id, version: currentVersion },
                  {
                    $set: {
                      elements: board.elements,
                      version: nextVersion,
                      lastModifiedBy: new Types.ObjectId(userId),
                      lastModifiedByName: participant.displayName,
                    },
                  },
                  { session, new: true }
                );

                if (!updatedBoard) {
                  const conflictErr = new Error('WHITEBOARD_CAS_CONFLICT');
                  (conflictErr as any).isCasConflict = true;
                  throw conflictErr;
                }

                if (testHooks?.failAfterCasForTest) {
                  throw new Error('SIMULATED_CRASH_AFTER_CAS_BEFORE_UNDO_UPDATE');
                }

                lastOp.isUndone = true;
                await lastOp.save({ session });

                broadcastPayload = {
                  meetingId: meetingIdStr,
                  version: updatedBoard.version,
                  userId,
                  elementId,
                  operationType: 'undo',
                  element: revertedElement ? toWhiteboardElementDto(revertedElement) : undefined,
                };

                committedResult = {
                  success: true,
                  ok: true,
                  version: updatedBoard.version,
                  elementId,
                };
              },
              {
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority' },
              }
            );

            if (committedResult) {
              if (broadcastPayload) {
                meetingRealtime.emitWhiteboardUndo(meetingIdStr, broadcastPayload);
              }
              return committedResult;
            }
          } catch (err: any) {
            if (err?.message === 'SIMULATED_CRASH_AFTER_CAS_BEFORE_UNDO_UPDATE') {
              throw err;
            }
            if (err?.isCasConflict || err?.errorLabels?.has?.('TransientTransactionError')) {
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 25));
              continue;
            }
            throw err;
          } finally {
            if (isOwnSession) {
              await session.endSession().catch(() => {});
            }
          }

      }

      throw new AppError(
        'Concurrent whiteboard modification conflict during undo. Please retry.',
        409,
        'WHITEBOARD_CONCURRENCY_CONFLICT'
      );
    });
  }

  /**
   * Redoes the user's latest undone operation.
   * Atomically restores element state and marks the operation record active within a single transaction.
   */
  public async redoOperation(
    meetingCodeOrId: string,
    userId: string,
    testHooks?: { failAfterCasForTest?: boolean; sessionOverride?: ClientSession }
  ): Promise<{ ok: boolean; success?: boolean; version?: number; elementId?: string }> {
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    const txSupported =
      Boolean(testHooks?.sessionOverride) || (await isReplicaSetTransactionsSupported());

    if (!txSupported) {
      throw new ServiceUnavailableError(
        'Collaborative whiteboard mutations require a MongoDB Replica Set supporting multi-document transactions.',
        'WHITEBOARD_TRANSACTION_REQUIRED'
      );
    }

    return this.withMeetingLock(meetingIdStr, async () => {
      let attempt = 0;
      while (attempt < WHITEBOARD_MAX_OCC_RETRIES) {
        attempt++;
          const session = testHooks?.sessionOverride || (await mongoose.startSession());
          const isOwnSession = !testHooks?.sessionOverride;
          let committedResult: { ok: boolean; success?: boolean; version?: number; elementId?: string } | null = null;
          let broadcastPayload: any = null;

          try {
            await session.withTransaction(
              async () => {
                const lastUndone = await WhiteboardOperation.findOne(
                  {
                    meetingId: meeting._id,
                    userId: new Types.ObjectId(userId),
                    isUndone: true,
                    type: { $in: ['add', 'update', 'delete'] },
                  },
                  null,
                  { session }
                ).sort({ sequence: -1 });

                if (!lastUndone || !lastUndone.elementId) {
                  committedResult = { ok: false };
                  return;
                }

                const board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                if (!board) {
                  committedResult = { ok: false };
                  return;
                }

                const currentVersion = board.version;
                const nextVersion = currentVersion + 1;
                const elementId = lastUndone.elementId;
                let restoredElement: any = undefined;

                if (lastUndone.type === 'add') {
                  if (lastUndone.element) {
                    const el = { ...(lastUndone.element as any), isDeleted: false, updatedAt: new Date() };
                    board.elements.set(elementId, el);
                    restoredElement = el;
                  }
                } else if (lastUndone.type === 'update') {
                  if (lastUndone.element) {
                    board.elements.set(elementId, lastUndone.element as IWhiteboardElement);
                    restoredElement = lastUndone.element;
                  }
                } else if (lastUndone.type === 'delete') {
                  const current = board.elements.get(elementId);
                  if (current) {
                    current.isDeleted = true;
                    current.updatedAt = new Date();
                    board.elements.set(elementId, current);
                    restoredElement = current;
                  }
                }

                const updatedBoard = await Whiteboard.findOneAndUpdate(
                  { meetingId: meeting._id, version: currentVersion },
                  {
                    $set: {
                      elements: board.elements,
                      version: nextVersion,
                      lastModifiedBy: new Types.ObjectId(userId),
                      lastModifiedByName: participant.displayName,
                    },
                  },
                  { session, new: true }
                );

                if (!updatedBoard) {
                  const conflictErr = new Error('WHITEBOARD_CAS_CONFLICT');
                  (conflictErr as any).isCasConflict = true;
                  throw conflictErr;
                }

                if (testHooks?.failAfterCasForTest) {
                  throw new Error('SIMULATED_CRASH_AFTER_CAS_BEFORE_REDO_UPDATE');
                }

                lastUndone.isUndone = false;
                await lastUndone.save({ session });

                broadcastPayload = {
                  meetingId: meetingIdStr,
                  version: updatedBoard.version,
                  userId,
                  elementId,
                  operationType: 'redo',
                  element: restoredElement ? toWhiteboardElementDto(restoredElement) : undefined,
                };

                committedResult = {
                  success: true,
                  ok: true,
                  version: updatedBoard.version,
                  elementId,
                };
              },
              {
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority' },
              }
            );

            if (committedResult) {
              if (broadcastPayload) {
                meetingRealtime.emitWhiteboardRedo(meetingIdStr, broadcastPayload);
              }
              return committedResult;
            }
          } catch (err: any) {
            if (err?.message === 'SIMULATED_CRASH_AFTER_CAS_BEFORE_REDO_UPDATE') {
              throw err;
            }
            if (err?.isCasConflict || err?.errorLabels?.has?.('TransientTransactionError')) {
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 25));
              continue;
            }
            throw err;
          } finally {
            if (isOwnSession) {
              await session.endSession().catch(() => {});
            }
          }

      }

      throw new AppError(
        'Concurrent whiteboard modification conflict during redo. Please retry.',
        409,
        'WHITEBOARD_CONCURRENCY_CONFLICT'
      );
    });
  }

  /**
   * Host/Co-host action: clears all elements on the whiteboard with atomic persistence and broadcast.
   */
  public async clearWhiteboard(
    meetingCodeOrId: string,
    userId: string,
    testHooks?: { failAfterCasForTest?: boolean; sessionOverride?: ClientSession }
  ): Promise<{ ok: boolean; success?: boolean; version: number; clearedAt: string }> {
    const { meeting, participant } = await this.getAdmittedParticipant(meetingCodeOrId, userId);
    const meetingIdStr = meeting._id.toString();

    // Authorization: only host or co-host can clear the canvas
    const isElevated = participant.role === 'host' || participant.role === 'co-host';
    if (!isElevated) {
      throw new ForbiddenError(
        'Only the meeting host or co-host can clear the collaborative whiteboard.',
        'CLEAR_NOT_AUTHORIZED'
      );
    }

    // Rate-limiting on clear
    const rateLimitKey = `connectly:rl:wb:clear:${meetingIdStr}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      WHITEBOARD_CLEAR_RATE_LIMIT_WINDOW_MS,
      WHITEBOARD_CLEAR_RATE_LIMIT_MAX
    );

    if (!allowed) {
      throw new TooManyRequestsError(
        'Clear whiteboard rate limit exceeded. Please wait a moment before clearing again.'
      );
    }

    const txSupported =
      Boolean(testHooks?.sessionOverride) || (await isReplicaSetTransactionsSupported());

    if (!txSupported) {
      throw new ServiceUnavailableError(
        'Collaborative whiteboard mutations require a MongoDB Replica Set supporting multi-document transactions.',
        'WHITEBOARD_TRANSACTION_REQUIRED'
      );
    }

    return this.withMeetingLock(meetingIdStr, async () => {
      let attempt = 0;
      while (attempt < WHITEBOARD_MAX_OCC_RETRIES) {
        attempt++;
          const session = testHooks?.sessionOverride || (await mongoose.startSession());
          const isOwnSession = !testHooks?.sessionOverride;
          let committedResult: { ok: boolean; success?: boolean; version: number; clearedAt: string } | null = null;
          let broadcastPayload: any = null;

          try {
            await session.withTransaction(
              async () => {
                let board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                if (!board) {
                  try {
                    const [newBoard] = await Whiteboard.create(
                      [
                        {
                          meetingId: meeting._id,
                          version: 1,
                          elements: new Map(),
                          appliedOperationIds: [],
                        },
                      ],
                      { session }
                    );
                    board = newBoard;
                  } catch (err: any) {
                    board = await Whiteboard.findOne({ meetingId: meeting._id }).session(session);
                    if (!board) throw err;
                  }
                }

                const currentVersion = board.version;
                const nextVersion = currentVersion + 1;
                const now = new Date();

                // Soft delete all active elements
                for (const [key, element] of board.elements.entries()) {
                  if (!element.isDeleted) {
                    element.isDeleted = true;
                    element.updatedAt = now;
                    board.elements.set(key, element);
                  }
                }

                const updatedBoard = await Whiteboard.findOneAndUpdate(
                  { meetingId: meeting._id, version: currentVersion },
                  {
                    $set: {
                      elements: board.elements,
                      version: nextVersion,
                      lastClearedAt: now,
                      lastClearedBy: new Types.ObjectId(userId),
                      lastModifiedBy: new Types.ObjectId(userId),
                      lastModifiedByName: participant.displayName || 'Host',
                    },
                  },
                  { session, new: true }
                );

                if (!updatedBoard) {
                  const conflictErr = new Error('WHITEBOARD_CAS_CONFLICT');
                  (conflictErr as any).isCasConflict = true;
                  throw conflictErr;
                }

                if (testHooks?.failAfterCasForTest) {
                  throw new Error('SIMULATED_CRASH_AFTER_CAS_BEFORE_CLEAR_LOG');
                }

                const clearOpId = `clear_${now.getTime()}_${Math.floor(Math.random() * 10000)}`;
                await WhiteboardOperation.create(
                  [
                    {
                      meetingId: meeting._id,
                      whiteboardId: board._id,
                      operationId: clearOpId,
                      userId: new Types.ObjectId(userId),
                      userName: participant.displayName || 'Host',
                      type: 'clear',
                      sequence: nextVersion,
                      isUndone: false,
                    },
                  ],
                  { session }
                );

                const clearedAtIso = now.toISOString();
                broadcastPayload = {
                  meetingId: meetingIdStr,
                  version: updatedBoard.version,
                  clearedBy: userId,
                  clearedByName: participant.displayName || 'Host',
                  clearedAt: clearedAtIso,
                };

                committedResult = {
                  success: true,
                  ok: true,
                  version: updatedBoard.version,
                  clearedAt: clearedAtIso,
                };
              },
              {
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority' },
              }
            );

            if (committedResult) {
              if (broadcastPayload) {
                meetingRealtime.emitWhiteboardCleared(meetingIdStr, broadcastPayload);
              }
              logger.info('[WhiteboardService] Whiteboard cleared by host/co-host', {
                metadata: { meetingId: meetingIdStr, userId, version: (committedResult as any).version },
              });
              return committedResult;
            }
          } catch (err: any) {
            if (err?.message === 'SIMULATED_CRASH_AFTER_CAS_BEFORE_CLEAR_LOG') {
              throw err;
            }
            if (err?.isCasConflict || err?.errorLabels?.has?.('TransientTransactionError')) {
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 25));
              continue;
            }
            throw err;
          } finally {
            if (isOwnSession) {
              await session.endSession().catch(() => {});
            }
          }

      }

      throw new AppError(
        'Concurrent whiteboard modification conflict during clear. Please retry.',
        409,
        'WHITEBOARD_CONCURRENCY_CONFLICT'
      );
    });
  }
}

export const whiteboardService = new WhiteboardService();
