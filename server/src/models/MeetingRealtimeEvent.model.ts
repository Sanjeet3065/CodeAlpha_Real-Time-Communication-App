import crypto from 'node:crypto';
import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { isSupabaseActive } from '../config/supabase.js';

export type MeetingRealtimeEventType =
  | 'ADMISSION_APPROVED'
  | 'PARTICIPANT_JOINED'
  | 'MEETING_ENDED';

/**
 * Recoverable Transactional Outbox State Machine:
 *
 * - `PENDING`: Committed atomically with the authoritative state change (or released
 *   after a transient operational failure for retry). `terminalAt` is strictly `null`.
 *   NEVER eligible for TTL expiration.
 * - `CLAIMED`: Actively leased by one dispatcher instance (`leaseOwner`, `leaseToken`,
 *   `leaseExpiresAt`). If the owning process crashes before completion, another instance
 *   atomically reclaims the record once `leaseExpiresAt <= now`. `terminalAt` is strictly
 *   `null`. NEVER eligible for TTL expiration.
 * - `DISPATCHED` (Terminal): Emission completed and confirmed under the active `leaseToken`.
 *   Sets `dispatchedAt` and `terminalAt`. Subject to 24h terminal-only TTL retention.
 * - `SUPPRESSED` (Terminal): Suppressed because the meeting ended/expired or the admission
 *   is no longer valid. Sets `suppressedAt` and `terminalAt`. Subject to 24h terminal-only
 *   TTL retention.
 *
 * Delivery Guarantee: **At-least-once** (NOT exactly-once). If a process crashes after
 * Socket.IO emission and before recording `CLAIMED -> DISPATCHED`, another instance will
 * reclaim the expired lease and redeliver with the same stable `eventId` so idempotent
 * consumers safely ignore duplicates.
 */
export type MeetingRealtimeOutboxStatus = 'PENDING' | 'CLAIMED' | 'DISPATCHED' | 'SUPPRESSED';

export const MEETING_OUTBOX_TERMINAL_TTL_SECONDS = 86400; // 24 hours strictly for terminal records

export interface IMeetingRealtimeEvent extends Document {
  eventId: string;
  meetingId: Types.ObjectId;
  meetingVersion: number;
  targetUserId?: Types.ObjectId | null;
  type: MeetingRealtimeEventType;
  status: MeetingRealtimeOutboxStatus;
  leaseOwner?: string | null;
  leaseToken?: string | null;
  claimedAt?: Date | null;
  leaseExpiresAt?: Date | null;
  attemptCount: number;
  lastError?: string | null;
  nextAttemptAt?: Date | null;
  dispatchedAt?: Date | null;
  suppressedAt?: Date | null;
  terminalAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingRealtimeEventSchema = new Schema<IMeetingRealtimeEvent>(
  {
    eventId: {
      type: String,
      required: true,
      default: () => crypto.randomUUID(),
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
    },
    meetingVersion: {
      type: Number,
      required: true,
      min: 0,
    },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      required: true,
      enum: ['ADMISSION_APPROVED', 'PARTICIPANT_JOINED', 'MEETING_ENDED'],
    },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'CLAIMED', 'DISPATCHED', 'SUPPRESSED'],
      default: 'PENDING',
    },
    leaseOwner: {
      type: String,
      default: null,
    },
    leaseToken: {
      type: String,
      default: null,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    attemptCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lastError: {
      type: String,
      default: null,
      maxlength: 500,
    },
    nextAttemptAt: {
      type: Date,
      default: null,
    },
    dispatchedAt: {
      type: Date,
      default: null,
    },
    suppressedAt: {
      type: Date,
      default: null,
    },
    // ONLY populated when entering terminal states (`DISPATCHED` or `SUPPRESSED`).
    // Strictly `null` for `PENDING` and `CLAIMED` so non-terminal records can NEVER expire.
    terminalAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'meeting_realtime_events',
    timestamps: true,
    versionKey: false,
  }
);

MeetingRealtimeEventSchema.index({ eventId: 1 }, { unique: true, name: 'eventId_unique' });
MeetingRealtimeEventSchema.index(
  { meetingId: 1, status: 1, type: 1 },
  { name: 'meetingId_1_status_1_type_1' }
);
MeetingRealtimeEventSchema.index(
  { status: 1, leaseExpiresAt: 1, nextAttemptAt: 1, createdAt: 1 },
  { name: 'outbox_recovery_scan' }
);
MeetingRealtimeEventSchema.index(
  { meetingId: 1, meetingVersion: 1 },
  { name: 'meetingId_1_meetingVersion_1' }
);

// SAFE TERMINAL-ONLY TTL INDEX:
// Double-protected against deleting PENDING/CLAIMED outbox records:
// 1. `partialFilterExpression` includes ONLY terminal statuses (`DISPATCHED`, `SUPPRESSED`).
// 2. `terminalAt` is strictly `null` (not a BSON Date) on all non-terminal documents.
// Therefore, `PENDING` and `CLAIMED` events remain durable & recoverable even after
// outages exceeding 24 hours.
MeetingRealtimeEventSchema.index(
  { terminalAt: 1 },
  {
    name: 'terminalAt_ttl_24h',
    expireAfterSeconds: MEETING_OUTBOX_TERMINAL_TTL_SECONDS,
    partialFilterExpression: {
      status: { $in: ['DISPATCHED', 'SUPPRESSED'] },
    },
  }
);

export const MeetingRealtimeEvent: Model<IMeetingRealtimeEvent> =
  mongoose.models.MeetingRealtimeEvent ||
  mongoose.model<IMeetingRealtimeEvent>('MeetingRealtimeEvent', MeetingRealtimeEventSchema);

export const REQUIRED_MEETING_OUTBOX_INDEX_NAMES = [
  'eventId_unique',
  'meetingId_1_status_1_type_1',
  'outbox_recovery_scan',
  'meetingId_1_meetingVersion_1',
  'terminalAt_ttl_24h',
] as const;

/**
 * Ensures the `meeting_realtime_events` collection and ALL required indexes exist,
 * actively drops any legacy unsafe `createdAt` TTL index, and verifies every required
 * index (including the terminal-only `terminalAt_ttl_24h` partial TTL index).
 *
 * FAIL-CLOSED: Never swallows index creation or verification errors. Throws if any
 * essential index is missing or misconfigured so startup fails loudly instead of running
 * with degraded or unsafe outbox indexing.
 */
export async function ensureMeetingRealtimeOutboxReady(): Promise<void> {
  if (isSupabaseActive()) {
    return;
  }
  try {
    await MeetingRealtimeEvent.createCollection();
  } catch (err: any) {
    if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') {
      throw new Error(
        `CRITICAL: Failed to create meeting_realtime_events collection: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Drop any legacy unconditional createdAt TTL index before creating the safe partial TTL index
  const preIndexes = await MeetingRealtimeEvent.collection.indexes();
  for (const idx of preIndexes) {
    if (
      idx.name &&
      idx.name !== '_id_' &&
      idx.key &&
      'createdAt' in idx.key &&
      typeof idx.expireAfterSeconds === 'number'
    ) {
      try {
        await MeetingRealtimeEvent.collection.dropIndex(idx.name);
      } catch (err: any) {
        if (err?.code !== 27 && err?.codeName !== 'IndexNotFound') {
          throw new Error(
            `CRITICAL: Failed to drop unsafe legacy TTL index '${idx.name}': ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
  }

  // Backfill eventId on any legacy pre-migration documents so eventId_unique creation succeeds cleanly
  const legacyMissingEventId = await MeetingRealtimeEvent.collection
    .find({ $or: [{ eventId: { $exists: false } }, { eventId: null }] }, { projection: { _id: 1 } })
    .toArray();
  for (const doc of legacyMissingEventId) {
    await MeetingRealtimeEvent.collection.updateOne(
      { _id: doc._id, $or: [{ eventId: { $exists: false } }, { eventId: null }] },
      { $set: { eventId: crypto.randomUUID() } }
    );
  }

  // Drop any legacy differently-named identical-key indexes (from prior schema iterations)
  for (const idx of preIndexes) {
    if (
      idx.name &&
      (idx.name === 'meeting_status_type' || idx.name === 'meeting_version')
    ) {
      await MeetingRealtimeEvent.collection.dropIndex(idx.name).catch(() => {});
    }
  }

  // Create/sync required indexes — NEVER swallow failures
  await MeetingRealtimeEvent.createIndexes();

  // Explicitly verify all essential indexes exist and match safety invariants
  const verifiedIndexes = await MeetingRealtimeEvent.collection.indexes();
  const byName = new Map(verifiedIndexes.map((idx) => [idx.name, idx]));

  for (const requiredName of REQUIRED_MEETING_OUTBOX_INDEX_NAMES) {
    if (!byName.has(requiredName)) {
      throw new Error(
        `CRITICAL: Required MeetingRealtimeEvent index '${requiredName}' is missing after initialization.`
      );
    }
  }

  const unsafeCreatedAtTtl = verifiedIndexes.find(
    (idx) => idx.key && 'createdAt' in idx.key && typeof idx.expireAfterSeconds === 'number'
  );
  if (unsafeCreatedAtTtl) {
    throw new Error(
      `CRITICAL: Unsafe unconditional createdAt TTL index '${unsafeCreatedAtTtl.name}' is still present on meeting_realtime_events.`
    );
  }

  const eventIdIdx = byName.get('eventId_unique');
  if (!eventIdIdx?.unique) {
    throw new Error(
      'CRITICAL: MeetingRealtimeEvent index eventId_unique must enforce unique: true.'
    );
  }

  const ttlIdx = byName.get('terminalAt_ttl_24h');
  const partialStatuses = (
    ttlIdx?.partialFilterExpression as { status?: { $in?: unknown[] } } | undefined
  )?.status?.$in;
  const hasOnlyTerminalStatuses =
    Array.isArray(partialStatuses) &&
    partialStatuses.length === 2 &&
    partialStatuses.includes('DISPATCHED') &&
    partialStatuses.includes('SUPPRESSED');
  if (
    !ttlIdx ||
    ttlIdx.expireAfterSeconds !== MEETING_OUTBOX_TERMINAL_TTL_SECONDS ||
    !hasOnlyTerminalStatuses
  ) {
    throw new Error(
      'CRITICAL: MeetingRealtimeEvent index terminalAt_ttl_24h failed safety verification (must expire ONLY DISPATCHED/SUPPRESSED after 86400s).'
    );
  }
}
