import mongoose, { Schema, Document, Model, Types, type ClientSession } from 'mongoose';
import { ensureMeetingRealtimeOutboxReady } from './MeetingRealtimeEvent.model.js';
import { isSupabaseActive } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export const LIVEKIT_REVOCATION_EVENT_TTL_SECONDS = 86400;
export const LIVEKIT_REVOCATION_TTL_INDEX_NAME = 'createdAt_1';

export type LiveKitRevocationKind =
  | 'PARTICIPANT_REMOVED'
  | 'PARTICIPANT_LEFT'
  | 'MEETING_ENDED';

/**
 * Global monotonic sequence counter stored in MongoDB so multi-instance
 * revocation events have a clock-skew-independent total order (`seq = 1, 2, 3, ...`).
 */
export interface ILiveKitRevocationCounter extends Document<string> {
  _id: string;
  seq: number;
}

const LiveKitRevocationCounterSchema = new Schema<ILiveKitRevocationCounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: false, versionKey: false }
);

export const LiveKitRevocationCounter: Model<ILiveKitRevocationCounter> =
  mongoose.models.LiveKitRevocationCounter ||
  mongoose.model<ILiveKitRevocationCounter>(
    'LiveKitRevocationCounter',
    LiveKitRevocationCounterSchema
  );

/**
 * Durable per-instance coordinator cursor checkpoint stored in MongoDB so
 * restarted coordinator instances recover their exact contiguous `seq` and
 * Change Stream `resumeToken` without relying on volatile in-memory state.
 */
export interface ILiveKitRevocationCursor extends Document<string> {
  _id: string;
  lastContiguousSeq: number;
  resumeToken?: Record<string, unknown> | null;
  updatedAt: Date;
}

const LiveKitRevocationCursorSchema = new Schema<ILiveKitRevocationCursor>(
  {
    _id: { type: String, required: true },
    lastContiguousSeq: { type: Number, required: true, default: 0, min: 0 },
    resumeToken: { type: Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

export const LiveKitRevocationCursor: Model<ILiveKitRevocationCursor> =
  mongoose.models.LiveKitRevocationCursor ||
  mongoose.model<ILiveKitRevocationCursor>(
    'LiveKitRevocationCursor',
    LiveKitRevocationCursorSchema
  );

export async function allocateNextRevocationSeq(session?: ClientSession): Promise<number> {
  const options: { upsert: true; new: true; session?: ClientSession } = {
    upsert: true,
    new: true,
  };
  if (session) {
    options.session = session;
  }
  const counter = await LiveKitRevocationCounter.findOneAndUpdate(
    { _id: 'livekit_revocation_global_seq' },
    { $inc: { seq: 1 } },
    options
  ).lean();
  return counter ? counter.seq : 1;
}

let cachedTopologyConnId: number | null = null;
let cachedTxSupported: boolean | null = null;
let cachedCollectionsReadyConnId: number | null = null;
let inflightCollectionsReady: { connId: number | null; promise: Promise<void> } | null = null;

/**
 * Resets cached MongoDB topology detection (useful when switching connections in tests).
 */
export function resetRevocationTopologyCache(): void {
  cachedTopologyConnId = null;
  cachedTxSupported = null;
  cachedCollectionsReadyConnId = null;
  inflightCollectionsReady = null;
}

export function setReplicaSetTransactionsSupportedForTesting(supported: boolean | null): void {
  cachedTxSupported = supported;
  cachedTopologyConnId = typeof LiveKitRevocationEvent.db?.id === 'number' ? LiveKitRevocationEvent.db.id : null;
}

/**
 * Detects whether the active MongoDB deployment supports multi-document ACID
 * transactions and Change Streams (Replica Set or sharded `mongos`).
 */
export async function isReplicaSetTransactionsSupported(
  forceRefresh = false
): Promise<boolean> {
  if (isSupabaseActive()) {
    return true;
  }
  const conn = LiveKitRevocationEvent.db;
  const connId = typeof conn?.id === 'number' ? conn.id : null;
  if (
    !forceRefresh &&
    cachedTxSupported !== null &&
    cachedTopologyConnId === connId &&
    conn?.readyState === 1
  ) {
    return cachedTxSupported;
  }

  try {
    const admin = conn?.db?.admin();
    if (!admin) {
      return false;
    }
    const hello = await admin.command({ hello: 1 });
    const supported = Boolean(hello?.setName || hello?.msg === 'isdbgrid');
    cachedTopologyConnId = connId;
    cachedTxSupported = supported;
    return supported;
  } catch {
    return false;
  }
}

function isCollModFallbackEligible(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number; codeName?: string; message?: string };
  if (e.code === 59 || e.code === 72 || e.code === 27 || e.code === 115) {
    return true;
  }
  if (
    e.codeName === 'CommandNotFound' ||
    e.codeName === 'InvalidOptions' ||
    e.codeName === 'IndexNotFound' ||
    e.codeName === 'CommandNotSupported'
  ) {
    return true;
  }
  const msg = String(e.message || '');
  return /collmod.*not (supported|found)|no such command.*collmod|not a ttl index/i.test(msg);
}

/**
 * Safely migrates an existing `livekitrevocationevents.createdAt_1` index whose TTL
 * differs from the required 24-hour (`86400s`) retention window BEFORE Mongoose
 * calls `createIndexes()` (preventing MongoDB error 85 `IndexOptionsConflict`).
 *
 * Strategy:
 * 1. Inspect existing indexes. If missing or already `86400s`, do nothing.
 * 2. When an existing `createdAt_1` TTL index has an older/wrong TTL (e.g. `3600s`),
 *    atomically update it in place via MongoDB `collMod` (zero-downtime, safe under
 *    concurrent startups).
 * 3. Only if `collMod` is unsupported (or the existing `{ createdAt: 1 }` index is
 *    non-TTL / differently named), execute an explicit, logged drop-and-recreate
 *    fallback with concurrent-race tolerance (`IndexNotFound` on drop; concurrent
 *    create errors validated strictly by post-migration verification).
 * 4. Genuine DB/permission/network errors are logged and rethrown fail-closed.
 */
async function migrateRevocationTtlIndexIfNeeded(): Promise<void> {
  const collection = LiveKitRevocationEvent.collection;
  const collectionName = collection.collectionName;
  const indexes = await collection.indexes();

  const existing = indexes.find(
    (idx) =>
      idx.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME ||
      (idx.key && Object.keys(idx.key).length === 1 && idx.key.createdAt === 1)
  );

  if (!existing) {
    return;
  }

  if (
    existing.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME &&
    existing.expireAfterSeconds === LIVEKIT_REVOCATION_EVENT_TTL_SECONDS
  ) {
    return;
  }

  const prevTtl =
    typeof existing.expireAfterSeconds === 'number' ? existing.expireAfterSeconds : null;

  logger.info('[LiveKitRevocation] Migrating createdAt TTL index to required 24h retention', {
    metadata: {
      collection: collectionName,
      indexName: existing.name ?? null,
      previousExpireAfterSeconds: prevTtl,
      targetExpireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
    },
  });

  // Prefer atomic, zero-downtime in-place `collMod` when modifying an existing TTL index
  if (
    existing.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME &&
    typeof existing.expireAfterSeconds === 'number'
  ) {
    const db = LiveKitRevocationEvent.db?.db;
    if (!db) {
      throw new Error(
        'MongoDB database handle unavailable for LiveKit revocation TTL index migration.'
      );
    }

    try {
      await db.command({
        collMod: collectionName,
        index: {
          keyPattern: { createdAt: 1 },
          expireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
        },
      });
      logger.info('[LiveKitRevocation] Migrated createdAt_1 TTL index in-place via collMod', {
        metadata: {
          collection: collectionName,
          indexName: existing.name,
          previousExpireAfterSeconds: prevTtl,
          expireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
        },
      });
      return;
    } catch (collModErr: any) {
      if (!isCollModFallbackEligible(collModErr)) {
        logger.error('[LiveKitRevocation] collMod TTL index migration failed (fail-closed)', {
          metadata: {
            collection: collectionName,
            indexName: existing.name,
            previousExpireAfterSeconds: prevTtl,
            targetExpireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
            errorCodeName: collModErr?.codeName,
          },
          error: collModErr,
        });
        throw collModErr;
      }

      logger.warn(
        '[LiveKitRevocation] collMod TTL migration unsupported; executing explicit drop-and-recreate fallback',
        {
          metadata: {
            collection: collectionName,
            indexName: existing.name,
            previousExpireAfterSeconds: prevTtl,
            targetExpireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
            collModErrorName: collModErr?.name,
            collModErrorCode: collModErr?.code,
            collModErrorCodeName: collModErr?.codeName,
            collModErrorMessage: collModErr?.message,
          },
        }
      );
    }
  } else {
    logger.warn(
      '[LiveKitRevocation] Existing createdAt index is non-TTL or uses a legacy name; executing explicit drop-and-recreate migration',
      {
        metadata: {
          collection: collectionName,
          indexName: existing.name ?? null,
          previousExpireAfterSeconds: prevTtl,
          targetExpireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
        },
      }
    );
  }

  // Explicit drop-and-recreate fallback with concurrent-startup safety
  if (existing.name) {
    try {
      await collection.dropIndex(existing.name);
    } catch (dropErr: any) {
      // Tolerate IndexNotFound (27) ONLY because a concurrent instance may have dropped it first
      if (dropErr?.code !== 27 && dropErr?.codeName !== 'IndexNotFound') {
        logger.error('[LiveKitRevocation] Failed to drop legacy createdAt index during migration', {
          metadata: {
            collection: collectionName,
            indexName: existing.name,
            errorCodeName: dropErr?.codeName,
          },
          error: dropErr,
        });
        throw dropErr;
      }
    }
  }

  try {
    await collection.createIndex(
      { createdAt: 1 },
      {
        name: LIVEKIT_REVOCATION_TTL_INDEX_NAME,
        expireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
      }
    );
  } catch (createErr: any) {
    // Under concurrent startup, another instance may have recreated `createdAt_1` with 86400s
    // simultaneously. Only defer concurrent-index-conflict codes to strict post-verification below;
    // any other error fails closed immediately.
    const isConcurrentCreateConflict =
      createErr?.code === 68 ||
      createErr?.code === 85 ||
      createErr?.code === 86 ||
      createErr?.codeName === 'IndexAlreadyExists' ||
      createErr?.codeName === 'IndexOptionsConflict' ||
      createErr?.codeName === 'IndexKeySpecsConflict';
    if (!isConcurrentCreateConflict) {
      logger.error(
        '[LiveKitRevocation] Failed to recreate createdAt_1 TTL index during migration',
        {
          metadata: {
            collection: collectionName,
            targetExpireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS,
            errorCodeName: createErr?.codeName,
          },
          error: createErr,
        }
      );
      throw createErr;
    }
    logger.warn(
      '[LiveKitRevocation] Concurrent index creation detected during TTL migration; verifying final index options',
      {
        metadata: {
          collection: collectionName,
          errorCode: createErr?.code,
          errorCodeName: createErr?.codeName,
        },
      }
    );
  }
}

async function verifyRevocationEventIndexes(): Promise<void> {
  const collection = LiveKitRevocationEvent.collection;
  const indexes = await collection.indexes();

  const ttlIndex = indexes.find(
    (idx) =>
      idx.name === LIVEKIT_REVOCATION_TTL_INDEX_NAME &&
      idx.key &&
      Object.keys(idx.key).length === 1 &&
      idx.key.createdAt === 1
  );
  if (!ttlIndex) {
    throw new Error(
      `Required LiveKit revocation TTL index '${LIVEKIT_REVOCATION_TTL_INDEX_NAME}' is missing after initialization.`
    );
  }
  if (ttlIndex.expireAfterSeconds !== LIVEKIT_REVOCATION_EVENT_TTL_SECONDS) {
    throw new Error(
      `LiveKit revocation TTL index '${LIVEKIT_REVOCATION_TTL_INDEX_NAME}' has expireAfterSeconds=${String(
        ttlIndex.expireAfterSeconds
      )}, expected ${LIVEKIT_REVOCATION_EVENT_TTL_SECONDS}.`
    );
  }

  const seqUnique = indexes.find(
    (idx) =>
      idx.key &&
      Object.keys(idx.key).length === 1 &&
      idx.key.seq === 1 &&
      idx.unique === true
  );
  if (!seqUnique) {
    throw new Error(
      'Required unique LiveKit revocation index on { seq: 1 } is missing after initialization.'
    );
  }

  const lookupCompound = indexes.find(
    (idx) =>
      idx.key &&
      idx.key.meetingId === 1 &&
      idx.key.userId === 1 &&
      idx.key.seq === -1
  );
  if (!lookupCompound) {
    throw new Error(
      'Required compound LiveKit revocation index on { meetingId: 1, userId: 1, seq: -1 } is missing after initialization.'
    );
  }
}

/**
 * Ensures revocation collections and indexes exist before running MongoDB
 * multi-document transactions (prevents implicit DDL errors inside transactions).
 *
 * Migrates legacy `livekitrevocationevents.createdAt_1` TTL indexes (e.g. 3600s -> 86400s)
 * before calling `LiveKitRevocationEvent.init()`, coalesces concurrent intra-process startup
 * calls, and verifies final index options fail-closed before marking initialization ready.
 */
export async function ensureRevocationCollectionsReady(): Promise<void> {
  if (isSupabaseActive()) {
    return;
  }
  const conn = LiveKitRevocationEvent.db;
  const connId = typeof conn?.id === 'number' ? conn.id : null;
  if (cachedCollectionsReadyConnId === connId && conn?.readyState === 1) {
    return;
  }

  if (inflightCollectionsReady && inflightCollectionsReady.connId === connId) {
    return inflightCollectionsReady.promise;
  }

  const initPromise = (async () => {
    const createIgnoreExists = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err: any) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') {
          throw err;
        }
      }
    };

    await Promise.all([
      createIgnoreExists(() => LiveKitRevocationCounter.createCollection()),
      createIgnoreExists(() => LiveKitRevocationEvent.createCollection()),
      createIgnoreExists(() => LiveKitRevocationCursor.createCollection()),
    ]);

    // Migrate legacy TTL index BEFORE Mongoose init()/createIndexes() runs
    await migrateRevocationTtlIndexIfNeeded();

    await Promise.all([
      LiveKitRevocationEvent.init().then(() => LiveKitRevocationEvent.createIndexes()),
      LiveKitRevocationCounter.init().then(() => LiveKitRevocationCounter.createIndexes()),
      LiveKitRevocationCursor.init().then(() => LiveKitRevocationCursor.createIndexes()),
      ensureMeetingRealtimeOutboxReady(),
    ]);

    // Strictly verify final index options before declaring initialization healthy/ready
    await verifyRevocationEventIndexes();

    cachedCollectionsReadyConnId = connId;
  })();

  inflightCollectionsReady = { connId, promise: initPromise };
  try {
    await initPromise;
  } finally {
    if (inflightCollectionsReady?.promise === initPromise) {
      inflightCollectionsReady = null;
    }
  }
}

export interface ILiveKitRevocationEvent extends Document {
  seq: number;
  meetingId: Types.ObjectId;
  userId?: Types.ObjectId | null;
  kind: LiveKitRevocationKind;
  revokedEpoch?: number | null;
  fenceVersion?: number | null;
  reason?: string | null;
  createdAt: Date;
}

const LiveKitRevocationEventSchema = new Schema<ILiveKitRevocationEvent>(
  {
    seq: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    kind: {
      type: String,
      required: true,
      enum: ['PARTICIPANT_REMOVED', 'PARTICIPANT_LEFT', 'MEETING_ENDED'],
    },
    revokedEpoch: {
      type: Number,
      default: null,
      min: 1,
    },
    fenceVersion: {
      type: Number,
      default: null,
      min: 0,
    },
    reason: {
      type: String,
      maxlength: 200,
      default: null,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    // Indexes are migrated and created explicitly via ensureRevocationCollectionsReady()
    // so Mongoose never races ahead of legacy createdAt_1 TTL migration on connect().
    autoIndex: false,
  }
);

// Fast lookup for cursor sweeps & per-participant fencing queries
LiveKitRevocationEventSchema.index({ meetingId: 1, userId: 1, seq: -1 });
// 24-hour TTL (24x max 1-hour configurable JWT TTL, 144x default 10-min TTL)
// ensures no active unexpired JWT can ever outlive its revocation event.
LiveKitRevocationEventSchema.index(
  { createdAt: 1 },
  { name: LIVEKIT_REVOCATION_TTL_INDEX_NAME, expireAfterSeconds: LIVEKIT_REVOCATION_EVENT_TTL_SECONDS }
);

export const LiveKitRevocationEvent: Model<ILiveKitRevocationEvent> =
  mongoose.models.LiveKitRevocationEvent ||
  mongoose.model<ILiveKitRevocationEvent>(
    'LiveKitRevocationEvent',
    LiveKitRevocationEventSchema
  );
