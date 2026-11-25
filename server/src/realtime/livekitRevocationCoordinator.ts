import mongoose, { Types, type ClientSession } from 'mongoose';
import { env } from '../config/env.js';
import {
  allocateNextRevocationSeq,
  ensureRevocationCollectionsReady,
  isReplicaSetTransactionsSupported,
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  LiveKitRevocationEvent,
  type LiveKitRevocationKind,
} from '../models/LiveKitRevocationEvent.model.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface DistributedRevocationPayload {
  eventId: string;
  seq: number;
  meetingId: string;
  userId: string | null;
  kind: LiveKitRevocationKind;
  revokedEpoch: number | null;
  fenceVersion: number | null;
  reason: string | null;
  createdAt: Date;
}

export type RevocationListener = (event: DistributedRevocationPayload) => void;
export type RevocationHealthListener = (healthy: boolean, reason?: string) => void;

export interface SafeCoordinatorErrorInfo {
  name: string;
  message: string;
  code?: number | string;
  codeName?: string;
}

function redactErrorText(text: string): string {
  return text
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s/]+):([^@\s/]+)@/g, '$1[REDACTED]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
}

function extractSafeErrorInfo(err: unknown): SafeCoordinatorErrorInfo | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: number | string; codeName?: string };
    const info: SafeCoordinatorErrorInfo = {
      name: anyErr.name || 'Error',
      message: redactErrorText(anyErr.message || 'Unknown error'),
    };
    if (typeof anyErr.code === 'number' || typeof anyErr.code === 'string') {
      info.code = anyErr.code;
    }
    if (typeof anyErr.codeName === 'string' && anyErr.codeName) {
      info.codeName = anyErr.codeName;
    }
    return info;
  }
  if (typeof err === 'object') {
    const obj = err as { name?: unknown; message?: unknown; code?: unknown; codeName?: unknown };
    const info: SafeCoordinatorErrorInfo = {
      name: typeof obj.name === 'string' && obj.name ? obj.name : 'UnknownError',
      message: redactErrorText(
        typeof obj.message === 'string' && obj.message ? obj.message : String(err)
      ),
    };
    if (typeof obj.code === 'number' || typeof obj.code === 'string') {
      info.code = obj.code;
    }
    if (typeof obj.codeName === 'string' && obj.codeName) {
      info.codeName = obj.codeName;
    }
    return info;
  }
  return {
    name: 'Error',
    message: redactErrorText(String(err)),
  };
}

export interface PublishLiveKitRevocationParams {
  meetingId: string;
  userId?: string | null;
  kind: LiveKitRevocationKind;
  revokedEpoch?: number | null;
  fenceVersion?: number | null;
  reason?: string | null;
  /** Optional caller-managed MongoDB transaction session (atomic participant + revocation). */
  session?: ClientSession;
  /**
   * Transaction enforcement policy:
   * - `'required'` (default in production): MUST execute inside a MongoDB ACID transaction;
   *   fails closed (`503 LIVEKIT_REVOCATION_TRANSACTION_REQUIRED` / `LIVEKIT_REVOCATION_TRANSACTION_FAILED`)
   *   if transactions are unavailable or fail. Never silently falls back to non-atomic writes.
   * - `'auto'` (default in non-production): Uses a real MongoDB ACID transaction whenever connected
   *   to a Replica Set / mongos (with zero silent fallback on tx failure). Permits standalone
   *   non-transactional dev/test execution ONLY when MongoDB is standalone AND `NODE_ENV !== 'production'`.
   */
  transactionPolicy?: 'required' | 'auto';
  /** Deterministic test hook executed strictly AFTER sequence allocation, BEFORE event insert. */
  beforeEventInsertForTest?: () => Promise<void>;
  /** Override NODE_ENV for deterministic policy tests. */
  nodeEnvOverride?: string;
}

export interface LiveKitRevocationCoordinatorHooks {
  /** Fires strictly AFTER a revocation event is observed, BEFORE listeners process it. */
  beforeEventProcess?: (event: DistributedRevocationPayload) => Promise<void>;
  /** Fires strictly AFTER listeners processed the event, BEFORE durable checkpoint persistence. */
  afterEventProcessBeforeCheckpoint?: (event: DistributedRevocationPayload) => Promise<void>;
  /** Fires immediately BEFORE writing the durable cursor checkpoint to MongoDB. */
  beforeCheckpointPersist?: (
    lastContiguousSeq: number,
    resumeToken: Record<string, unknown> | null
  ) => Promise<void>;
}

export interface LiveKitRevocationCoordinatorOptions {
  /** Poll interval (ms) for durable cursor catch-up / standalone MongoDB fallback. */
  pollIntervalMs?: number;
  /** Maximum idle poll interval (ms) when no revocation events are pending (adaptive backoff). */
  maxIdlePollIntervalMs?: number;
  /** Attempt to attach a MongoDB Change Stream (requires Replica Set in production). */
  enableChangeStream?: boolean;
  /** Consecutive DB poll failures before transitioning to fail-closed unhealthy state. */
  maxConsecutiveFailures?: number;
  /**
   * Maximum elapsed ms without a successful delivery sync before marking
   * the coordinator stalled/unhealthy (fail-closed).
   */
  maxStaleDeliveryMs?: number;
  /**
   * Maximum elapsed ms an observed sequence gap may remain missing before the
   * coordinator transitions to UNHEALTHY / FAIL-CLOSED. Missing sequences are
   * NEVER silently skipped or marked dispatched.
   */
  gapFailClosedGraceMs?: number;
  /** Deprecated alias for `gapFailClosedGraceMs` (never skips gaps). */
  gapSkipGraceMs?: number;
  /** Optional initial durable cursor `seq` (for deterministic tests). */
  initialCursorSeq?: number;
  /**
   * Optional stable instance identifier for persisting durable cursor checkpoints
   * (`lastContiguousSeq` + Change Stream `resumeToken`) in `LiveKitRevocationCursor`.
   */
  instanceId?: string;
  /**
   * When true (default in `NODE_ENV=production`), `start()` verifies MongoDB Replica Set
   * support and transitions to UNHEALTHY / FAIL-CLOSED if transactions & Change Streams
   * are unavailable (no silent standalone fallback in production).
   */
  requireTransactions?: boolean;
  /** Reconnect delay (ms) after a Change Stream interruption. */
  changeStreamReconnectDelayMs?: number;
  /** Deterministic lifecycle hooks for crash/restart checkpoint verification tests. */
  hooks?: LiveKitRevocationCoordinatorHooks;
}

let warnedStandalonePublish = false;

function mapDocToPayload(doc: {
  _id: unknown;
  seq: number;
  meetingId: unknown;
  userId?: unknown | null;
  kind: LiveKitRevocationKind;
  revokedEpoch?: number | null;
  fenceVersion?: number | null;
  reason?: string | null;
  createdAt?: Date | string;
}): DistributedRevocationPayload {
  return {
    eventId: String(doc._id),
    seq: doc.seq,
    meetingId: String(doc.meetingId),
    userId: doc.userId ? String(doc.userId) : null,
    kind: doc.kind,
    revokedEpoch: typeof doc.revokedEpoch === 'number' ? doc.revokedEpoch : null,
    fenceVersion: typeof doc.fenceVersion === 'number' ? doc.fenceVersion : null,
    reason: typeof doc.reason === 'string' ? doc.reason : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
  };
}

/**
 * Publishes an authoritative, durable cross-instance revocation event into MongoDB
 * with a globally monotonic, clock-skew-independent `seq`.
 *
 * Crash Consistency & Atomicity:
 * - On MongoDB Replica Sets / sharded clusters (all production deployments), the
 *   counter increment (`LiveKitRevocationCounter`) and event insert (`LiveKitRevocationEvent`)
 *   execute inside a single ACID MongoDB transaction (`readConcern: majority`,
 *   `writeConcern: majority`). Because MongoDB acquires an exclusive WiredTiger write
 *   lock on the single counter document until transaction commit/abort:
 *     1. A crash or failure before commit atomically rolls back BOTH counter and event
 *        (sequence `N` is never leaked without event `N`).
 *     2. Concurrent publishers serialize cleanly on the counter lock with automatic
 *        `WriteConflict` retries, ensuring event `N` is committed before `N+1` can be
 *        allocated (no out-of-order commit gaps).
 * - If a transaction fails, this function NEVER silently falls back to non-atomic writes;
 *   it throws `ServiceUnavailableError('LIVEKIT_REVOCATION_TRANSACTION_FAILED')`.
 * - In `NODE_ENV=production` (or `transactionPolicy: 'required'`), standalone MongoDB
 *   fails closed immediately with `503 LIVEKIT_REVOCATION_TRANSACTION_REQUIRED`.
 */
export async function publishLiveKitRevocation(
  params: PublishLiveKitRevocationParams
): Promise<DistributedRevocationPayload> {
  const effectiveNodeEnv = params.nodeEnvOverride ?? env.NODE_ENV;
  const policy: 'required' | 'auto' =
    params.transactionPolicy ?? (effectiveNodeEnv === 'production' ? 'required' : 'auto');

  const insertWithOptionalSession = async (
    session?: ClientSession
  ): Promise<DistributedRevocationPayload> => {
    const seq = await allocateNextRevocationSeq(session);
    if (params.beforeEventInsertForTest) {
      await params.beforeEventInsertForTest();
    }
    const eventDoc = {
      seq,
      meetingId: new Types.ObjectId(params.meetingId),
      userId: params.userId ? new Types.ObjectId(params.userId) : null,
      kind: params.kind,
      revokedEpoch: params.revokedEpoch ?? null,
      fenceVersion: params.fenceVersion ?? null,
      reason: params.reason ?? null,
      createdAt: new Date(),
    };

    if (session) {
      const [created] = await LiveKitRevocationEvent.create([eventDoc], { session });
      return mapDocToPayload(created);
    }

    const created = await LiveKitRevocationEvent.create(eventDoc);
    return mapDocToPayload(created);
  };

  // Path 1: Caller already opened an ACID MongoDB transaction session
  if (params.session) {
    return insertWithOptionalSession(params.session);
  }

  const txSupported = await isReplicaSetTransactionsSupported();

  // Path 2: Fail closed when transactions are required but topology is standalone
  if (policy === 'required' && !txSupported) {
    logger.error(
      '[LiveKitRevocation] Refusing non-atomic revocation publish: MongoDB Replica Set transactions are required',
      {
        metadata: {
          meetingId: params.meetingId,
          kind: params.kind,
          nodeEnv: effectiveNodeEnv,
        },
      }
    );
    throw new ServiceUnavailableError(
      'MongoDB Replica Set transactions are required for atomic revocation publishing.',
      'LIVEKIT_REVOCATION_TRANSACTION_REQUIRED'
    );
  }

  // Path 3: Atomic MongoDB Multi-Document Transaction (Replica Set / Sharded Cluster)
  if (txSupported) {
    await ensureRevocationCollectionsReady();
    const session = await mongoose.startSession();
    try {
      let published: DistributedRevocationPayload | null = null;
      await session.withTransaction(
        async () => {
          published = await insertWithOptionalSession(session);
        },
        {
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' },
        }
      );
      if (!published) {
        throw new Error('Revocation transaction completed without committing event payload.');
      }
      return published;
    } catch (err) {
      const safeErr = extractSafeErrorInfo(err);
      logger.error(
        '[LiveKitRevocation] Atomic revocation transaction failed (no non-atomic fallback)',
        {
          metadata: {
            meetingId: params.meetingId,
            kind: params.kind,
            ...(safeErr?.codeName ? { errorCodeName: safeErr.codeName } : {}),
          },
          ...(safeErr ? { error: safeErr } : {}),
        }
      );
      throw new ServiceUnavailableError(
        'Atomic revocation event transaction failed.',
        'LIVEKIT_REVOCATION_TRANSACTION_FAILED'
      );
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  // Path 4: Explicitly non-production standalone MongoDB development/test ONLY
  if (!warnedStandalonePublish) {
    warnedStandalonePublish = true;
    logger.warn(
      '[LiveKitRevocation] Standalone MongoDB detected in non-production mode; multi-document transactions unavailable. Production requires a MongoDB Replica Set.'
    );
  }

  try {
    return await insertWithOptionalSession(undefined);
  } catch (err) {
    const safeErr = extractSafeErrorInfo(err);
    logger.error('[LiveKitRevocation] Standalone revocation event insertion failed', {
      metadata: {
        meetingId: params.meetingId,
        kind: params.kind,
        ...(safeErr?.codeName ? { errorCodeName: safeErr.codeName } : {}),
      },
      ...(safeErr ? { error: safeErr } : {}),
    });
    throw new ServiceUnavailableError(
      'Durable revocation event publication failed.',
      'LIVEKIT_REVOCATION_PUBLISH_FAILED'
    );
  }
}

function isUnresumableChangeStreamError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number; codeName?: string; message?: string };
  if (e.code === 286 || e.code === 260) return true; // ChangeStreamHistoryLost / InvalidResumeToken
  if (e.codeName === 'ChangeStreamHistoryLost' || e.codeName === 'InvalidResumeToken') return true;
  const msg = String(e.message || '').toLowerCase();
  return (
    msg.includes('resume token') ||
    msg.includes('changestreamhistorylost') ||
    msg.includes('invalidresumetoken') ||
    msg.includes('oplog')
  );
}

/**
 * Distributed cross-instance revocation coordinator backed by MongoDB.
 *
 * Verified Guarantees:
 * - Global Monotonic Cursor (`seq`): Immune to cross-host ObjectId clock skew.
 * - Never Silently Skips Missing Sequences: `lastContiguousSeq` advances ONLY across
 *   actually delivered contiguous sequences. Missing sequences are NEVER added to
 *   `dispatchedSeqs` and late-arriving events are NEVER silently discarded.
 * - Unreconciled Gap Fail-Closed Protection: If a missing sequence gap persists beyond
 *   `gapFailClosedGraceMs` (or TTL retention loss is detected via event/counter checks),
 *   the coordinator transitions to UNHEALTHY / FAIL-CLOSED, terminating active/pending
 *   signaling sockets and rejecting new upgrades with `503`. If the delayed event later
 *   arrives and closes the gap, it IS delivered and the coordinator can recover cleanly.
 * - Deduplication & Out-of-Order Safety: Both `seq <= lastContiguousSeq` and
 *   `dispatchedSeqs.has(seq)` drop duplicates safely without losing unseen lower sequences.
 * - Durable Cursor Checkpointing: When `instanceId` is configured, persists
 *   `{ lastContiguousSeq, resumeToken }` in `LiveKitRevocationCursor` for restart recovery.
 * - Production Replica-Set Enforcement: When `requireTransactions` is true (default in
 *   production), fails closed if MongoDB is standalone instead of silently downgrading.
 */
export class LiveKitRevocationCoordinator {
  private readonly pollIntervalMs: number;
  private readonly maxIdlePollIntervalMs: number;
  private readonly enableChangeStream: boolean;
  private readonly maxConsecutiveFailures: number;
  private readonly maxStaleDeliveryMs: number;
  private readonly gapFailClosedGraceMs: number;
  private readonly initialCursorSeq?: number;
  private readonly instanceId?: string;
  private readonly requireTransactions: boolean;
  private readonly changeStreamReconnectDelayMs: number;
  private readonly hooks: LiveKitRevocationCoordinatorHooks;

  private readonly eventListeners = new Set<RevocationListener>();
  private readonly healthListeners = new Set<RevocationHealthListener>();

  private running = false;
  private healthy = true;
  private deliveryPaused = false;
  private unavailableReason: string | null = null;
  private lastHealthError: SafeCoordinatorErrorInfo | null = null;
  private transportMode: 'stopped' | 'change_stream' | 'cursor_poll' = 'stopped';
  private consecutiveFailures = 0;
  private lastSuccessfulSyncAt = Date.now();

  private lastContiguousSeq = 0;
  private readonly dispatchedSeqs = new Set<number>();
  private readonly gapFirstSeenAt = new Map<number, number>();
  /**
   * Staged Change Stream resume tokens indexed by `seq`. A token is ONLY promoted
   * to `lastResumeToken` (and eligible for durable checkpoint persistence) AFTER
   * the event has been safely processed by listeners AND `lastContiguousSeq` has
   * advanced contiguously to or past that `seq`.
   */
  private readonly stagedResumeTokensBySeq = new Map<number, Record<string, unknown>>();
  private lastResumeToken: Record<string, unknown> | null = null;
  private lastResumeTokenSeq = 0;
  private lastPersistedSeq = -1;
  private lastPersistedResumeToken: Record<string, unknown> | null = null;
  private checkpointWriteChain: Promise<void> = Promise.resolve();
  private changeProcessChain: Promise<void> = Promise.resolve();
  private changeStreamAttachCount = 0;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPollDelayMs: number;
  private lastCounterCheckAt = 0;
  private cachedCounterSeq = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private changeStream: { close: () => Promise<void> } | null = null;
  private inflightSync: Promise<boolean> | null = null;
  private syncStateEpoch = 0;

  constructor(options: LiveKitRevocationCoordinatorOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxIdlePollIntervalMs = options.maxIdlePollIntervalMs ?? 5_000;
    this.currentPollDelayMs = this.pollIntervalMs;
    this.enableChangeStream = options.enableChangeStream ?? true;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 2;
    this.maxStaleDeliveryMs =
      options.maxStaleDeliveryMs ?? Math.max(5_000, this.pollIntervalMs * 10);
    this.gapFailClosedGraceMs = options.gapFailClosedGraceMs ?? options.gapSkipGraceMs ?? 5_000;
    this.initialCursorSeq = options.initialCursorSeq;
    this.instanceId = options.instanceId;
    const isProd = process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
    this.requireTransactions =
      isProd
        ? true
        : (options.requireTransactions ?? (process.env.REQUIRE_TRANSACTIONS === 'true' || env.REQUIRE_TRANSACTIONS === 'true'));
    this.changeStreamReconnectDelayMs = options.changeStreamReconnectDelayMs ?? 1_000;
    this.hooks = options.hooks ?? {};

    if (typeof options.initialCursorSeq === 'number' && options.initialCursorSeq >= 0) {
      this.lastContiguousSeq = options.initialCursorSeq;
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getLastContiguousSeq(): number {
    return this.lastContiguousSeq;
  }

  public getTransportMode(): 'stopped' | 'change_stream' | 'cursor_poll' {
    return this.transportMode;
  }

  public getCurrentPollDelayMs(): number {
    return this.currentPollDelayMs;
  }

  public getUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  public getLastHealthError(): SafeCoordinatorErrorInfo | null {
    return this.lastHealthError;
  }

  public getLastResumeToken(): Record<string, unknown> | null {
    return this.lastResumeToken;
  }

  public getChangeStreamAttachCount(): number {
    return this.changeStreamAttachCount;
  }

  public getPendingGapSeqs(): number[] {
    return Array.from(this.gapFirstSeenAt.keys()).sort((a, b) => a - b);
  }

  /**
   * Checks BOTH explicit health state AND delivery-staleness watchdog.
   * If running and delivery has stalled beyond `maxStaleDeliveryMs`, transitions
   * immediately to UNHEALTHY (fail-closed) and notifies subscribed gateways.
   */
  public isHealthy(): boolean {
    if (!this.healthy) return false;
    if (this.running && Date.now() - this.lastSuccessfulSyncAt > this.maxStaleDeliveryMs) {
      this.setHealth(false, 'Revocation delivery stalled beyond staleness threshold.');
      return false;
    }
    return true;
  }

  public subscribe(listener: RevocationListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onHealthChange(listener: RevocationHealthListener): () => void {
    this.healthListeners.add(listener);
    return () => {
      this.healthListeners.delete(listener);
    };
  }

  /**
   * Pauses background notification delivery (used by deterministic security tests
   * to simulate delayed cross-instance revocation delivery without arbitrary sleeps).
   */
  public pauseDelivery(): void {
    this.deliveryPaused = true;
  }

  public resumeDelivery(): void {
    this.deliveryPaused = false;
  }

  private setHealth(nextHealthy: boolean, reason?: string, err?: unknown): void {
    const prev = this.healthy;
    const safeError = nextHealthy ? undefined : extractSafeErrorInfo(err);
    this.healthy = nextHealthy;
    this.lastHealthError = nextHealthy ? null : (safeError ?? null);
    this.unavailableReason = nextHealthy
      ? null
      : redactErrorText(reason || safeError?.message || 'Revocation coordinator unavailable.');

    if (prev !== nextHealthy) {
      if (!nextHealthy) {
        logger.error('[LiveKitRevocation] Coordinator transitioned to UNHEALTHY (fail-closed)', {
          metadata: {
            reason: this.unavailableReason,
            instanceId: this.instanceId ?? null,
            transportMode: this.transportMode,
            lastContiguousSeq: this.lastContiguousSeq,
            ...(safeError?.codeName ? { errorCodeName: safeError.codeName } : {}),
          },
          ...(safeError ? { error: safeError } : {}),
        });
      } else {
        logger.info('[LiveKitRevocation] Coordinator recovered to HEALTHY', {
          metadata: {
            instanceId: this.instanceId ?? null,
            transportMode: this.transportMode,
            lastContiguousSeq: this.lastContiguousSeq,
          },
        });
      }
      for (const listener of Array.from(this.healthListeners)) {
        try {
          listener(nextHealthy, this.unavailableReason ?? undefined);
        } catch {
          // isolate subscriber errors
        }
      }
    }
  }

  public markUnavailable(
    reason = 'Revocation notification channel disconnected.',
    err?: unknown
  ): void {
    this.setHealth(false, reason, err);
  }

  /**
   * Manually forces a staleness timestamp for deterministic watchdog tests.
   */
  public setLastSuccessfulSyncAtForTest(timestampMs: number): void {
    this.lastSuccessfulSyncAt = timestampMs;
  }

  /**
   * Manually ages a tracked gap timestamp for deterministic gap fail-closed tests
   * without requiring arbitrary wall-clock sleeps.
   */
  public ageGapFirstSeenForTest(seq: number, timestampMs: number): void {
    if (this.gapFirstSeenAt.has(seq)) {
      this.gapFirstSeenAt.set(seq, timestampMs);
    }
  }

  /**
   * Promotes staged Change Stream resume tokens ONLY for sequences strictly
   * covered by `lastContiguousSeq` (already processed by listeners with zero
   * unresolved lower sequence gaps). Never advances `lastResumeToken` past an
   * unprocessed event or unresolved gap.
   */
  private promoteContiguousResumeToken(): void {
    let bestSeq = this.lastResumeTokenSeq;
    let bestToken = this.lastResumeToken;

    for (const [seq, token] of Array.from(this.stagedResumeTokensBySeq.entries())) {
      if (seq <= this.lastContiguousSeq) {
        if (seq >= bestSeq) {
          bestSeq = seq;
          bestToken = token;
        }
        if (seq < this.lastContiguousSeq) {
          this.stagedResumeTokensBySeq.delete(seq);
        }
      }
    }

    this.lastResumeTokenSeq = bestSeq;
    this.lastResumeToken = bestToken;
  }

  /**
   * Serialized, strictly monotonic durable checkpoint persistence.
   * Prevents concurrent polling (`syncNow`) and Change Stream callbacks from
   * racing an older `(seq, resumeToken)` over a newer committed checkpoint.
   */
  private persistCursorCheckpoint(force = false): Promise<void> {
    if (!this.instanceId) return Promise.resolve();

    const task = async () => {
      if (!this.instanceId) return;
      this.promoteContiguousResumeToken();
      const targetSeq = this.lastContiguousSeq;
      const targetResumeToken = this.lastResumeToken;

      const tokenChanged = targetResumeToken !== this.lastPersistedResumeToken;
      if (!force && targetSeq === this.lastPersistedSeq && !tokenChanged) {
        return;
      }

      if (this.hooks.beforeCheckpointPersist) {
        await this.hooks.beforeCheckpointPersist(targetSeq, targetResumeToken);
      }

      try {
        // Conditional monotonic update: NEVER regress lastContiguousSeq in MongoDB
        const updateRes = await LiveKitRevocationCursor.updateOne(
          { _id: this.instanceId, lastContiguousSeq: { $lte: targetSeq } },
          {
            $set: {
              lastContiguousSeq: targetSeq,
              resumeToken: targetResumeToken,
              updatedAt: new Date(),
            },
          }
        );

        if (updateRes.matchedCount === 0) {
          try {
            await LiveKitRevocationCursor.updateOne(
              { _id: this.instanceId },
              {
                $setOnInsert: {
                  _id: this.instanceId,
                  lastContiguousSeq: targetSeq,
                  resumeToken: targetResumeToken,
                  updatedAt: new Date(),
                },
              },
              { upsert: true }
            );
          } catch (upsertErr: any) {
            if (upsertErr?.code !== 11000) {
              throw upsertErr;
            }
          }
        }

        this.lastPersistedSeq = Math.max(this.lastPersistedSeq, targetSeq);
        this.lastPersistedResumeToken = targetResumeToken;
      } catch (err) {
        const safeErr = extractSafeErrorInfo(err);
        logger.warn('[LiveKitRevocation] Failed to persist durable cursor checkpoint', {
          metadata: {
            instanceId: this.instanceId,
            lastContiguousSeq: targetSeq,
            errorName: safeErr?.name,
            errorCode: safeErr?.code,
            errorMessage: safeErr?.message ?? 'Cursor checkpoint write failed',
          },
        });
      }
    };

    const next = this.checkpointWriteChain.then(task, task);
    this.checkpointWriteChain = next.catch(() => {});
    return next;
  }

  /**
   * Delivers a single revocation event with exact deduplication and strict
   * contiguous-sequence cursor advancement.
   *
   * Crash-safety invariant:
   * - Listeners process the event BEFORE `lastContiguousSeq` or `lastResumeToken`
   *   are advanced or checkpointed.
   * - Because `lastContiguousSeq` NEVER skips over unseen sequences, any late-arriving
   *   lower `seq` is guaranteed to satisfy `seq > lastContiguousSeq` and `!dispatchedSeqs.has(seq)`
   *   and will ALWAYS be delivered rather than silently discarded.
   */
  public ingestEvent(
    payload: DistributedRevocationPayload,
    options?: { skipAutoCheckpoint?: boolean }
  ): boolean {
    if (payload.seq <= this.lastContiguousSeq || this.dispatchedSeqs.has(payload.seq)) {
      return false;
    }

    // 1. Apply event to all listeners FIRST before advancing durable cursors
    for (const listener of Array.from(this.eventListeners)) {
      try {
        listener(payload);
      } catch (err) {
        const safeErr = extractSafeErrorInfo(err);
        logger.error('[LiveKitRevocation] Listener error while applying revocation', {
          metadata: {
            eventId: payload.eventId,
            seq: payload.seq,
            ...(safeErr?.codeName ? { errorCodeName: safeErr.codeName } : {}),
          },
          ...(safeErr ? { error: safeErr } : {}),
        });
      }
    }

    // 2. Mark sequence delivered and advance contiguous cursor STRICTLY across consecutive delivered seqs
    this.dispatchedSeqs.add(payload.seq);
    this.gapFirstSeenAt.delete(payload.seq);

    while (this.dispatchedSeqs.has(this.lastContiguousSeq + 1)) {
      this.lastContiguousSeq += 1;
      this.gapFirstSeenAt.delete(this.lastContiguousSeq);
    }

    // 3. Promote Change Stream resumeToken ONLY up to the safely processed contiguous cursor
    this.promoteContiguousResumeToken();

    // 4. Bound memory of dispatchedSeqs by pruning entries strictly behind lastContiguousSeq
    // (duplicates <= lastContiguousSeq remain blocked by the `payload.seq <= this.lastContiguousSeq` check above)
    if (this.dispatchedSeqs.size > 4000) {
      for (const s of Array.from(this.dispatchedSeqs)) {
        if (s <= this.lastContiguousSeq) {
          this.dispatchedSeqs.delete(s);
        }
      }
    }

    if (!options?.skipAutoCheckpoint && this.instanceId && this.lastContiguousSeq !== this.lastPersistedSeq) {
      void this.persistCursorCheckpoint();
    }

    return true;
  }

  /**
   * Tracks missing sequence gaps in `(lastContiguousSeq, maxKnownSeq]` without
   * EVER skipping them or marking them dispatched.
   *
   * If any missing sequence persists beyond `gapFailClosedGraceMs` (or predates an
   * already-aged higher event, indicating TTL expiry / orphaned allocation), returns
   * `{ hasUnreconciledGap: true, expiredGapSeq }` so the caller transitions to
   * UNHEALTHY / FAIL-CLOSED.
   */
  private evaluateSequenceGaps(
    maxKnownSeq: number,
    firstReturnedSeq: number | null,
    firstReturnedCreatedAt: Date | null
  ): { hasUnreconciledGap: boolean; expiredGapSeq: number | null } {
    const now = Date.now();
    let expiredGapSeq: number | null = null;

    // Prune any stale entries <= lastContiguousSeq or already dispatched
    for (const tracked of Array.from(this.gapFirstSeenAt.keys())) {
      if (tracked <= this.lastContiguousSeq || this.dispatchedSeqs.has(tracked)) {
        this.gapFirstSeenAt.delete(tracked);
      }
    }

    // Cap per-sweep iteration range to avoid unbounded loops on corrupted counters,
    // while immediately failing closed if the gap span itself is abnormally large.
    const maxScanSeq = Math.min(maxKnownSeq, this.lastContiguousSeq + 10_000);
    if (maxKnownSeq - this.lastContiguousSeq > 10_000) {
      return { hasUnreconciledGap: true, expiredGapSeq: this.lastContiguousSeq + 1 };
    }

    for (let missing = this.lastContiguousSeq + 1; missing <= maxScanSeq; missing += 1) {
      if (this.dispatchedSeqs.has(missing)) continue;

      let firstSeen = this.gapFirstSeenAt.get(missing);
      if (firstSeen === undefined) {
        firstSeen = now;
        this.gapFirstSeenAt.set(missing, firstSeen);
      }

      const ageFromFirstObserved = now - firstSeen;
      const predatesAgedHigherEvent =
        firstReturnedSeq !== null &&
        firstReturnedCreatedAt !== null &&
        missing < firstReturnedSeq &&
        now - firstReturnedCreatedAt.getTime() >= this.gapFailClosedGraceMs;

      if (ageFromFirstObserved >= this.gapFailClosedGraceMs || predatesAgedHigherEvent) {
        if (expiredGapSeq === null) {
          expiredGapSeq = missing;
        }
      }
    }

    return {
      hasUnreconciledGap: expiredGapSeq !== null,
      expiredGapSeq,
    };
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.consecutiveFailures = 0;

    let topologyBlocked = false;

    try {
      await ensureRevocationCollectionsReady();

      const txSupported = await isReplicaSetTransactionsSupported(true);
      if (this.requireTransactions && !txSupported) {
        topologyBlocked = true;
        this.transportMode = 'stopped';
        this.setHealth(
          false,
          'MongoDB Replica Set is required for production Change Streams and atomic revocation transactions.'
        );
      }

      if (typeof this.initialCursorSeq === 'number' && this.initialCursorSeq >= 0) {
        this.lastContiguousSeq = this.initialCursorSeq;
      } else if (this.instanceId) {
        const saved = await LiveKitRevocationCursor.findById(this.instanceId).lean();
        if (saved && typeof saved.lastContiguousSeq === 'number' && saved.lastContiguousSeq >= 0) {
          this.lastContiguousSeq = saved.lastContiguousSeq;
          this.lastPersistedSeq = saved.lastContiguousSeq;
          this.lastResumeToken =
            saved.resumeToken && typeof saved.resumeToken === 'object'
              ? (saved.resumeToken as Record<string, unknown>)
              : null;
          this.lastResumeTokenSeq = saved.lastContiguousSeq;
          this.lastPersistedResumeToken = this.lastResumeToken;
        } else {
          const [latest, counterDoc] = await Promise.all([
            LiveKitRevocationEvent.findOne({}).sort({ seq: -1 }).select('seq').lean(),
            LiveKitRevocationCounter.findById('livekit_revocation_global_seq')
              .select('seq')
              .lean(),
          ]);
          const latestEventSeq = latest && typeof latest.seq === 'number' ? latest.seq : 0;
          const counterSeq =
            counterDoc && typeof counterDoc.seq === 'number' ? counterDoc.seq : 0;
          this.lastContiguousSeq = Math.max(latestEventSeq, counterSeq);
          await this.persistCursorCheckpoint(true);
        }
      } else {
        const [latest, counterDoc] = await Promise.all([
          LiveKitRevocationEvent.findOne({}).sort({ seq: -1 }).select('seq').lean(),
          LiveKitRevocationCounter.findById('livekit_revocation_global_seq')
            .select('seq')
            .lean(),
        ]);
        const latestEventSeq = latest && typeof latest.seq === 'number' ? latest.seq : 0;
        const counterSeq =
          counterDoc && typeof counterDoc.seq === 'number' ? counterDoc.seq : 0;
        this.lastContiguousSeq = Math.max(latestEventSeq, counterSeq);
      }

      this.lastSuccessfulSyncAt = Date.now();
      if (!topologyBlocked) {
        this.setHealth(true);
      }
    } catch (err) {
      const safeErr = extractSafeErrorInfo(err);
      this.setHealth(
        false,
        safeErr?.message || 'Unable to initialize revocation cursor.',
        err
      );
    }

    if (topologyBlocked) {
      return;
    }

    if (this.enableChangeStream) {
      await this.tryAttachChangeStream();
    } else {
      this.transportMode = 'cursor_poll';
    }

    this.scheduleNextPoll(this.pollIntervalMs);
  }

  public resetPollBackoff(triggerImmediate = false): void {
    this.syncStateEpoch += 1;
    this.currentPollDelayMs = this.pollIntervalMs;
    if (!this.running) return;
    if (triggerImmediate) {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      void this.syncNow({ skipBackoffOnEmpty: true });
      this.scheduleNextPoll(this.pollIntervalMs);
    }
  }

  private scheduleNextPoll(delayMs?: number): void {
    if (!this.running) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const delay = delayMs ?? this.currentPollDelayMs;
    this.pollTimer = setTimeout(async () => {
      if (!this.running) return;
      if (this.deliveryPaused) {
        this.isHealthy();
        this.scheduleNextPoll(this.currentPollDelayMs);
        return;
      }
      await this.syncNow();
      if (this.running) {
        this.scheduleNextPoll();
      }
    }, delay);
    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  private scheduleChangeStreamReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) {
        void this.tryAttachChangeStream();
      }
    }, this.changeStreamReconnectDelayMs);
    if (typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref();
    }
  }

  private async tryAttachChangeStream(): Promise<void> {
    if (!this.running) return;
    const isReconnect = this.changeStreamAttachCount > 0;
    try {
      const txSupported = await isReplicaSetTransactionsSupported();
      if (!txSupported) {
        this.transportMode = 'cursor_poll';
        return;
      }

      if (this.changeStream) {
        const oldStream = this.changeStream;
        this.changeStream = null;
        await oldStream.close().catch(() => {});
      }

      const watchOpts: Record<string, unknown> = { fullDocument: 'updateLookup' };
      if (this.lastResumeToken) {
        watchOpts.resumeAfter = this.lastResumeToken;
      }

      const stream = LiveKitRevocationEvent.watch(
        [{ $match: { operationType: 'insert' } }],
        watchOpts
      );

      let handledDisconnect = false;
      const handleStreamInterruption = (err?: unknown) => {
        if (handledDisconnect) return;
        handledDisconnect = true;

        if (isUnresumableChangeStreamError(err)) {
          const safeErr = extractSafeErrorInfo(err);
          logger.warn(
            '[LiveKitRevocation] Change stream resume token no longer valid; resetting token and running durable seq cursor catch-up',
            {
              metadata: {
                instanceId: this.instanceId ?? null,
                errorName: safeErr?.name,
                errorCode: safeErr?.code,
                errorCodeName: safeErr?.codeName,
                errorMessage: safeErr?.message ?? 'Resume token invalid',
              },
            }
          );
          this.lastResumeToken = null;
        } else {
          const safeErr = extractSafeErrorInfo(err);
          logger.warn(
            '[LiveKitRevocation] Change stream interrupted; running durable cursor catch-up and scheduling resume',
            {
              metadata: {
                instanceId: this.instanceId ?? null,
                errorName: safeErr?.name,
                errorCode: safeErr?.code,
                errorCodeName: safeErr?.codeName,
                errorMessage: safeErr?.message ?? 'Change stream closed',
              },
            }
          );
        }

        if (this.changeStream === stream) {
          this.changeStream = null;
        }
        if (this.running) {
          this.transportMode = 'cursor_poll';
          this.syncStateEpoch += 1;
          this.currentPollDelayMs = this.pollIntervalMs;
          this.scheduleNextPoll(this.pollIntervalMs);
          if (!this.deliveryPaused) {
            void this.syncNow({ skipBackoffOnEmpty: true });
          }
          this.scheduleChangeStreamReconnect();
        }
      };

      stream.on('change', (change: any) => {
        const handleChange = async () => {
          if (!this.running || this.deliveryPaused) return;
          const doc = change?.fullDocument;
          if (!doc || !doc._id || !doc.meetingId || !doc.kind || typeof doc.seq !== 'number') {
            return;
          }

          const payload = mapDocToPayload(doc);
          if (this.hooks.beforeEventProcess) {
            await this.hooks.beforeEventProcess(payload);
          }
          if (!this.running || this.deliveryPaused) return;

          // Stage resumeToken under payload.seq ONLY AFTER validation; never promote or
          // persist it until listeners finish processing AND lastContiguousSeq covers it.
          if (change?._id && typeof change._id === 'object') {
            this.stagedResumeTokensBySeq.set(payload.seq, change._id as Record<string, unknown>);
          }

          this.resetPollBackoff();
          this.consecutiveFailures = 0;
          this.lastSuccessfulSyncAt = Date.now();
          const processed = this.ingestEvent(payload, { skipAutoCheckpoint: true });

          if (processed && this.hooks.afterEventProcessBeforeCheckpoint) {
            await this.hooks.afterEventProcessBeforeCheckpoint(payload);
          }
          if (!this.running) return;

          // Only persist checkpoint AFTER processing completed cleanly
          if (this.instanceId) {
            await this.persistCursorCheckpoint(true);
          }

          if (this.gapFirstSeenAt.size === 0 && this.running && !this.healthy) {
            void this.syncNow();
          }
        };

        this.changeProcessChain = this.changeProcessChain
          .then(handleChange, handleChange)
          .catch((err) => {
            const safeErr = extractSafeErrorInfo(err);
            logger.error('[LiveKitRevocation] Change stream event processing failed before checkpoint', {
              metadata: {
                instanceId: this.instanceId ?? null,
                ...(safeErr?.codeName ? { errorCodeName: safeErr.codeName } : {}),
              },
              ...(safeErr ? { error: safeErr } : {}),
            });
          });
      });

      stream.on('error', (err: any) => {
        handleStreamInterruption(err);
      });

      stream.on('close', () => {
        if (this.running && this.changeStream === stream) {
          handleStreamInterruption(new Error('Change stream closed unexpectedly.'));
        }
      });

      this.changeStream = stream;
      this.changeStreamAttachCount += 1;
      this.transportMode = 'change_stream';
      this.syncStateEpoch += 1;
      this.currentPollDelayMs = this.pollIntervalMs;
      if (isReconnect && this.running) {
        this.scheduleNextPoll(this.pollIntervalMs);
        if (!this.deliveryPaused) {
          void this.syncNow({ skipBackoffOnEmpty: true });
        }
      }
    } catch (err) {
      if (isUnresumableChangeStreamError(err)) {
        this.lastResumeToken = null;
      }
      this.transportMode = 'cursor_poll';
      this.changeStream = null;
      if (this.running) {
        this.syncStateEpoch += 1;
        this.currentPollDelayMs = this.pollIntervalMs;
        this.scheduleNextPoll(this.pollIntervalMs);
        this.scheduleChangeStreamReconnect();
      }
    }
  }

  /**
   * Forces an interruption of the active Change Stream (for deterministic Replica Set
   * reconnect/resume integration tests).
   */
  public async forceDisconnectChangeStreamForTest(): Promise<void> {
    const stream = this.changeStream;
    if (!stream) return;
    await stream.close().catch(() => {});
  }

  /**
   * Synchronously sweeps ALL durable `LiveKitRevocationEvent` records with
   * `seq > lastContiguousSeq` in paginated batches, reconciles against
   * `LiveKitRevocationCounter` to detect TTL/crash retention gaps, and NEVER
   * silently skips missing sequences.
   *
   * Returns `true` ONLY when sync succeeded AND zero unreconciled expired gaps exist.
   */
  public async syncNow(options?: { skipBackoffOnEmpty?: boolean }): Promise<boolean> {
    if (this.inflightSync) {
      return this.inflightSync;
    }

    const epochAtStart = this.syncStateEpoch;
    const skipBackoffOnEmpty = options?.skipBackoffOnEmpty === true;
    const run = async (): Promise<boolean> => {
      try {
        await ensureRevocationCollectionsReady();

        if (this.requireTransactions) {
          const txSupported = await isReplicaSetTransactionsSupported();
          if (!txSupported) {
            this.setHealth(
              false,
              'MongoDB Replica Set is required for production Change Streams and atomic revocation transactions.'
            );
            return false;
          }
        }

        const BATCH_SIZE = 500;
        let queryAfterSeq = this.lastContiguousSeq;
        let firstReturnedSeq: number | null = null;
        let firstReturnedCreatedAt: Date | null = null;
        let maxObservedEventSeq = this.lastContiguousSeq;

        // Paginate across all events > lastContiguousSeq so bursts > 500 are drained cleanly
        while (true) {
          const batch = await LiveKitRevocationEvent.find({
            seq: { $gt: queryAfterSeq },
          })
            .sort({ seq: 1 })
            .limit(BATCH_SIZE)
            .lean();

          if (batch.length === 0) break;

          if (firstReturnedSeq === null && typeof batch[0].seq === 'number') {
            firstReturnedSeq = batch[0].seq;
            firstReturnedCreatedAt = batch[0].createdAt ? new Date(batch[0].createdAt) : null;
          }

          for (const doc of batch) {
            if (typeof doc.seq !== 'number') continue;
            if (doc.seq > maxObservedEventSeq) maxObservedEventSeq = doc.seq;
            if (doc.seq > queryAfterSeq) queryAfterSeq = doc.seq;
            const payload = mapDocToPayload(doc);
            const alreadySeen =
              payload.seq <= this.lastContiguousSeq || this.dispatchedSeqs.has(payload.seq);
            if (!alreadySeen && this.hooks.beforeEventProcess) {
              await this.hooks.beforeEventProcess(payload);
            }
            const processed = this.ingestEvent(payload, { skipAutoCheckpoint: true });
            if (processed && this.hooks.afterEventProcessBeforeCheckpoint) {
              await this.hooks.afterEventProcessBeforeCheckpoint(payload);
            }
          }

          if (batch.length < BATCH_SIZE) break;
        }

        // Adaptive polling backoff calculation
        if (epochAtStart === this.syncStateEpoch) {
          if (firstReturnedSeq !== null) {
            this.currentPollDelayMs = this.pollIntervalMs;
          } else if (!skipBackoffOnEmpty) {
            if (this.transportMode === 'change_stream') {
              this.currentPollDelayMs = Math.min(
                this.currentPollDelayMs * 2,
                this.maxIdlePollIntervalMs
              );
            } else {
              this.currentPollDelayMs = Math.min(
                this.currentPollDelayMs * 1.5,
                Math.min(this.maxIdlePollIntervalMs, 2_000)
              );
            }
          }
        }

        let counterSeq = this.cachedCounterSeq;
        const needsCounterCheck =
          firstReturnedSeq !== null ||
          this.gapFirstSeenAt.size > 0 ||
          Date.now() - this.lastCounterCheckAt > 10_000;

        if (needsCounterCheck) {
          const counterDoc = await LiveKitRevocationCounter.findById(
            'livekit_revocation_global_seq'
          )
            .select('seq')
            .lean();
          counterSeq =
            counterDoc && typeof counterDoc.seq === 'number' ? counterDoc.seq : 0;
          this.cachedCounterSeq = counterSeq;
          this.lastCounterCheckAt = Date.now();
        }

        this.consecutiveFailures = 0;
        this.lastSuccessfulSyncAt = Date.now();

        const maxKnownSeq = Math.max(maxObservedEventSeq, counterSeq);
        const gapAudit = this.evaluateSequenceGaps(
          maxKnownSeq,
          firstReturnedSeq,
          firstReturnedCreatedAt
        );

        await this.persistCursorCheckpoint();

        if (gapAudit.hasUnreconciledGap) {
          this.setHealth(
            false,
            `Unreconciled revocation sequence gap detected at seq ${gapAudit.expiredGapSeq} (lastContiguousSeq=${this.lastContiguousSeq}, maxKnownSeq=${maxKnownSeq}); failing closed.`
          );
          return false;
        }

        if (this.running) {
          this.setHealth(true);
        }
        return true;
      } catch (err) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          const safeErr = extractSafeErrorInfo(err);
          this.setHealth(
            false,
            safeErr?.message || 'Revocation cursor sync failed.',
            err
          );
        }
        return false;
      }
    };

    this.inflightSync = run().finally(() => {
      this.inflightSync = null;
    });
    return this.inflightSync;
  }

  public async stop(options?: { skipCheckpointFlush?: boolean }): Promise<void> {
    this.running = false;
    this.deliveryPaused = false;
    this.transportMode = 'stopped';
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.changeStream) {
      const stream = this.changeStream;
      this.changeStream = null;
      await stream.close().catch(() => {});
    }
    if (!options?.skipCheckpointFlush) {
      await this.checkpointWriteChain.catch(() => {});
      await this.persistCursorCheckpoint(true);
    }
    this.eventListeners.clear();
    this.healthListeners.clear();
  }
}

export const livekitRevocationCoordinator = new LiveKitRevocationCoordinator();
