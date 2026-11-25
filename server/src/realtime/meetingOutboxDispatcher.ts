import crypto from 'node:crypto';
import os from 'node:os';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Meeting, type IMeeting } from '../models/Meeting.model.js';
import {
  MeetingParticipant,
  type IMeetingParticipant,
} from '../models/MeetingParticipant.model.js';
import { User } from '../models/User.model.js';
import {
  MeetingRealtimeEvent,
  ensureMeetingRealtimeOutboxReady,
  type IMeetingRealtimeEvent,
} from '../models/MeetingRealtimeEvent.model.js';
import { meetingRealtime, type MeetingRealtimeHub } from './meetingSocket.js';
import { logger } from '../utils/logger.js';

export interface OutboxDispatchPreloadedContext {
  serializedMeeting: Record<string, any>;
  serializedParticipant: Record<string, any>;
  waitingList: Record<string, any>[];
  activeParticipantCount: number;
}

export interface MeetingOutboxTestHooks {
  /** Fired before attempting to atomically claim an outbox record. */
  beforeClaim?: (outboxId?: string) => Promise<void>;
  /** Fired immediately after PENDING/expired-CLAIMED -> CLAIMED succeeds, before pre-emit checks. */
  afterClaimBeforePreEmitCheck?: (doc: IMeetingRealtimeEvent) => Promise<void>;
  /** Fired immediately before Socket.IO emission (after hydration & first pre-emit check). */
  beforeEmit?: (doc: IMeetingRealtimeEvent) => Promise<void>;
  /** Fired immediately after Socket.IO emission completes, before recording CLAIMED -> DISPATCHED. */
  afterEmitBeforeMarkDispatched?: (doc: IMeetingRealtimeEvent) => Promise<void>;
}

export interface MeetingOutboxDispatcherOptions {
  instanceId?: string;
  /** Periodic background sweep interval in ms (default 1000ms; 0 disables background timer). */
  pollIntervalMs?: number;
  /** Maximum idle background sweep interval in ms (adaptive backoff; default 10000ms). */
  maxIdlePollIntervalMs?: number;
  /** Lease duration in ms before an uncompleted CLAIMED record is eligible for recovery (default 10000ms). */
  leaseDurationMs?: number;
  /** Delay before retrying after a non-crash operational dispatch error (default 1000ms). */
  retryBackoffMs?: number;
  /** Maximum records processed per background sweep tick (default 25). */
  maxBatchSize?: number;
  /** Injectable clock for deterministic lease-expiry & >24h outage tests. */
  nowFn?: () => Date;
  realtime?: MeetingRealtimeHub;
  hooks?: MeetingOutboxTestHooks;
}

export type OutboxDispatchOutcomeStatus =
  | 'DISPATCHED'
  | 'SUPPRESSED'
  | 'ALREADY_DISPATCHED'
  | 'LEASED_BY_OTHER'
  | 'LEASE_LOST'
  | 'LEASE_EXPIRED'
  | 'NOT_FOUND'
  | 'RETRY_SCHEDULED';

export interface OutboxDispatchResult {
  status: OutboxDispatchOutcomeStatus;
  eventId?: string;
  attemptCount?: number;
  leaseToken?: string;
  error?: string;
}

export interface OutboxSweepSummary {
  processed: number;
  dispatched: number;
  suppressed: number;
  retryScheduled: number;
  leaseLost: number;
}

/**
 * Helper to create a simulated hard process crash error (SIGKILL / power loss) in tests.
 * When thrown from a test hook, the dispatcher intentionally skips graceful lease release,
 * leaving the event in `CLAIMED` until `leaseExpiresAt` elapses so another instance recovers it.
 */
export function createSimulatedOutboxCrash(message: string): Error & { simulateCrash: true } {
  const err = new Error(message) as Error & { simulateCrash: true };
  err.simulateCrash = true;
  return err;
}

function isSimulatedCrashError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { simulateCrash?: unknown }).simulateCrash === true);
}

/**
 * Recoverable, multi-instance-safe transactional outbox dispatcher for meeting realtime events.
 *
 * State machine:
 *   PENDING  --(atomic lease claim)--> CLAIMED  --(emit + confirm under leaseToken)--> DISPATCHED (terminalAt set)
 *   PENDING  --(meeting ended/expired)--> SUPPRESSED (terminalAt set)
 *   CLAIMED  --(meeting ended/expired)--> SUPPRESSED (terminalAt set, lease cleared)
 *   CLAIMED  --(leaseExpiresAt <= now)--> CLAIMED (reclaimed with new leaseOwner/leaseToken, attemptCount++)
 *   CLAIMED  --(operational emit error)--> PENDING (nextAttemptAt backoff, lastError recorded)
 *
 * Delivery Guarantee: **At-least-once** (NOT exactly-once).
 * - Crashing before claim -> recovered from `PENDING`.
 * - Crashing after claim before emit -> recovered after `leaseExpiresAt`.
 * - Crashing after emit before marking `DISPATCHED` -> reclaimed after `leaseExpiresAt` and
 *   re-emitted with the exact same `eventId` so idempotent consumers safely deduplicate.
 * - `PENDING` and `CLAIMED` records NEVER have `terminalAt` set and are excluded from the
 *   24-hour terminal-only TTL index, so recovery succeeds even after outages > 24 hours.
 */
export class MeetingRealtimeOutboxDispatcher {
  public readonly instanceId: string;
  private readonly pollIntervalMs: number;
  private readonly maxIdlePollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly retryBackoffMs: number;
  private readonly maxBatchSize: number;
  private readonly nowFn: () => Date;
  private readonly realtime: MeetingRealtimeHub;
  private readonly hooks: MeetingOutboxTestHooks;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPollDelayMs: number;
  private started = false;
  private sweepInFlight: Promise<OutboxSweepSummary> | null = null;

  constructor(options: MeetingOutboxDispatcherOptions = {}) {
    this.instanceId =
      options.instanceId ||
      `outbox_${os.hostname()}_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxIdlePollIntervalMs = options.maxIdlePollIntervalMs ?? 10_000;
    this.currentPollDelayMs = this.pollIntervalMs;
    this.leaseDurationMs = options.leaseDurationMs ?? 10_000;
    this.retryBackoffMs = options.retryBackoffMs ?? 1_000;
    this.maxBatchSize = options.maxBatchSize ?? 25;
    this.nowFn = options.nowFn ?? (() => new Date());
    this.realtime = options.realtime ?? meetingRealtime;
    this.hooks = options.hooks ?? {};
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await ensureMeetingRealtimeOutboxReady();
    // Run an immediate startup recovery sweep to recover any PENDING or expired CLAIMED events
    await this.processDueEvents().catch((err) => {
      logger.error('[MeetingOutbox] Initial startup recovery sweep failed', {
        metadata: {
          instanceId: this.instanceId,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    });

    if (this.pollIntervalMs > 0) {
      this.scheduleNextSweep(this.pollIntervalMs);
    }
  }

  public resetPollBackoff(triggerImmediate = false): void {
    this.currentPollDelayMs = this.pollIntervalMs;
    if (!this.started || this.pollIntervalMs <= 0) return;
    if (triggerImmediate) {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      void this.processDueEvents().catch(() => {});
      this.scheduleNextSweep(this.pollIntervalMs);
    }
  }

  private scheduleNextSweep(delayMs?: number): void {
    if (!this.started || this.pollIntervalMs <= 0) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const delay = delayMs ?? this.currentPollDelayMs;
    this.pollTimer = setTimeout(async () => {
      if (!this.started) return;
      try {
        const summary = await this.processDueEvents();
        if (summary.processed > 0) {
          this.currentPollDelayMs = this.pollIntervalMs;
        } else {
          this.currentPollDelayMs = Math.min(
            this.currentPollDelayMs * 2,
            this.maxIdlePollIntervalMs
          );
        }
      } catch (err) {
        logger.error('[MeetingOutbox] Background recovery sweep failed', {
          metadata: {
            instanceId: this.instanceId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (this.started) {
          this.scheduleNextSweep(this.currentPollDelayMs);
        }
      }
    }, delay);
    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.sweepInFlight) {
      await this.sweepInFlight.catch(() => {});
    }
  }

  /**
   * Attempts to claim and dispatch a specific outbox record by ID (used on the fast path
   * immediately after `admitParticipant()` commits, and directly in deterministic tests).
   */
  public async dispatchById(
    outboxId: Types.ObjectId | string,
    preloadedContext?: OutboxDispatchPreloadedContext,
    perCallHooks?: Partial<MeetingOutboxTestHooks>
  ): Promise<OutboxDispatchResult> {
    const objId = typeof outboxId === 'string' ? new Types.ObjectId(outboxId) : outboxId;
    const idStr = objId.toString();
    const hooks: MeetingOutboxTestHooks = {
      ...this.hooks,
      ...perCallHooks,
    };

    if (hooks.beforeClaim) {
      await hooks.beforeClaim(idStr);
    }

    this.resetPollBackoff();
    const now = this.nowFn();
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);

    const claimed = await MeetingRealtimeEvent.findOneAndUpdate(
      {
        _id: objId,
        type: { $ne: 'MEETING_ENDED' },
        $or: [
          {
            status: 'PENDING',
            $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
          },
          {
            status: 'CLAIMED',
            leaseExpiresAt: { $lte: now },
          },
        ],
      },
      {
        $set: {
          status: 'CLAIMED',
          leaseOwner: this.instanceId,
          leaseToken,
          claimedAt: now,
          leaseExpiresAt,
          lastError: null,
        },
        $inc: { attemptCount: 1 },
      },
      { new: true }
    ).lean();

    if (!claimed) {
      const existing = await MeetingRealtimeEvent.findById(objId)
        .select('status eventId attemptCount')
        .lean();
      if (!existing) return { status: 'NOT_FOUND' };
      if (existing.status === 'SUPPRESSED') {
        return {
          status: 'SUPPRESSED',
          eventId: existing.eventId,
          attemptCount: existing.attemptCount,
        };
      }
      if (existing.status === 'DISPATCHED') {
        return {
          status: 'ALREADY_DISPATCHED',
          eventId: existing.eventId,
          attemptCount: existing.attemptCount,
        };
      }
      return {
        status: 'LEASED_BY_OTHER',
        eventId: existing.eventId,
        attemptCount: existing.attemptCount,
      };
    }

    return this.executeClaimedRecord(
      claimed as unknown as IMeetingRealtimeEvent,
      leaseToken,
      preloadedContext,
      hooks
    );
  }

  /**
   * Claims and processes due `PENDING` and expired `CLAIMED` records in chronological order.
   * Multiple instances running concurrently compete safely via atomic `findOneAndUpdate`.
   */
  public async processDueEvents(limit = this.maxBatchSize): Promise<OutboxSweepSummary> {
    if (this.sweepInFlight) {
      return this.sweepInFlight;
    }

    const run = (async (): Promise<OutboxSweepSummary> => {
      const summary: OutboxSweepSummary = {
        processed: 0,
        dispatched: 0,
        suppressed: 0,
        retryScheduled: 0,
        leaseLost: 0,
      };

      for (let i = 0; i < limit; i += 1) {
        if (this.hooks.beforeClaim) {
          await this.hooks.beforeClaim(undefined);
        }

        const now = this.nowFn();
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);

        const claimed = await MeetingRealtimeEvent.findOneAndUpdate(
          {
            type: { $ne: 'MEETING_ENDED' },
            $or: [
              {
                status: 'PENDING',
                $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
              },
              {
                status: 'CLAIMED',
                leaseExpiresAt: { $lte: now },
              },
            ],
          },
          {
            $set: {
              status: 'CLAIMED',
              leaseOwner: this.instanceId,
              leaseToken,
              claimedAt: now,
              leaseExpiresAt,
              lastError: null,
            },
            $inc: { attemptCount: 1 },
          },
          {
            new: true,
            sort: { createdAt: 1, _id: 1 },
          }
        ).lean();

        if (!claimed) {
          break;
        }

        summary.processed += 1;
        const result = await this.executeClaimedRecord(
          claimed as unknown as IMeetingRealtimeEvent,
          leaseToken,
          undefined,
          this.hooks
        );

        if (result.status === 'DISPATCHED') summary.dispatched += 1;
        else if (result.status === 'SUPPRESSED') summary.suppressed += 1;
        else if (result.status === 'RETRY_SCHEDULED') summary.retryScheduled += 1;
        else if (result.status === 'LEASE_LOST' || result.status === 'LEASE_EXPIRED') {
          summary.leaseLost += 1;
        }
      }

      return summary;
    })();

    this.sweepInFlight = run;
    try {
      return await run;
    } finally {
      if (this.sweepInFlight === run) {
        this.sweepInFlight = null;
      }
    }
  }

  private async executeClaimedRecord(
    claimed: IMeetingRealtimeEvent,
    leaseToken: string,
    preloadedContext: OutboxDispatchPreloadedContext | undefined,
    hooks: MeetingOutboxTestHooks
  ): Promise<OutboxDispatchResult> {
    const meetingIdStr = claimed.meetingId.toString();

    return this.realtime.runMeetingLifecycleOrdered(meetingIdStr, async () => {
      try {
        if (hooks.afterClaimBeforePreEmitCheck) {
          await hooks.afterClaimBeforePreEmitCheck(claimed);
        }

        const preCheck = await this.verifyLeaseAndMeetingState(claimed, leaseToken);
        if (!preCheck.ok) {
          return preCheck.result;
        }

        // Hydrate payload from authoritative MongoDB state if not preloaded (cold recovery path)
        const payload =
          preloadedContext ??
          (await this.hydrateAdmissionPayload(
            preCheck.meetingDoc,
            preCheck.participantDoc
          ));

        if (hooks.beforeEmit) {
          await hooks.beforeEmit(claimed);
        }

        // Final lease & termination fence immediately before Socket.IO emission:
        // catches concurrent meeting termination or lease theft while paused/hydrating.
        const finalCheck = await this.verifyLeaseAndMeetingState(claimed, leaseToken);
        if (!finalCheck.ok) {
          return finalCheck.result;
        }

        if (claimed.type === 'ADMISSION_APPROVED') {
          const targetUserIdStr = claimed.targetUserId?.toString();
          if (!targetUserIdStr) {
            await this.suppressLeasedRecord(claimed._id as Types.ObjectId, leaseToken);
            return {
              status: 'SUPPRESSED',
              eventId: claimed.eventId,
              attemptCount: claimed.attemptCount,
            };
          }

          await this.realtime.emitAdmissionApproved(
            meetingIdStr,
            targetUserIdStr,
            payload.serializedMeeting,
            payload.serializedParticipant,
            claimed.eventId
          );
          this.realtime.emitParticipantJoined(
            meetingIdStr,
            payload.serializedParticipant,
            payload.activeParticipantCount,
            claimed.eventId
          );
          this.realtime.emitWaitingRoomUpdated(meetingIdStr, payload.waitingList);
        } else if (claimed.type === 'PARTICIPANT_JOINED') {
          this.realtime.emitParticipantJoined(
            meetingIdStr,
            payload.serializedParticipant,
            payload.activeParticipantCount,
            claimed.eventId
          );
        }

        if (hooks.afterEmitBeforeMarkDispatched) {
          await hooks.afterEmitBeforeMarkDispatched(claimed);
        }

        const doneAt = this.nowFn();
        const finalized = await MeetingRealtimeEvent.findOneAndUpdate(
          {
            _id: claimed._id,
            status: 'CLAIMED',
            leaseToken,
          },
          {
            $set: {
              status: 'DISPATCHED',
              dispatchedAt: doneAt,
              terminalAt: doneAt,
              leaseOwner: null,
              leaseToken: null,
              leaseExpiresAt: null,
              lastError: null,
              nextAttemptAt: null,
            },
          },
          { new: true }
        ).lean();

        if (!finalized) {
          const latest = await MeetingRealtimeEvent.findById(claimed._id)
            .select('status')
            .lean();
          return {
            status: latest?.status === 'SUPPRESSED' ? 'SUPPRESSED' : 'LEASE_LOST',
            eventId: claimed.eventId,
            attemptCount: claimed.attemptCount,
            leaseToken,
          };
        }

        return {
          status: 'DISPATCHED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
          leaseToken,
        };
      } catch (err) {
        // Simulated SIGKILL / hard process crash in tests: intentionally skip graceful release
        // so the record stays CLAIMED until leaseExpiresAt elapses and another instance recovers it.
        if (isSimulatedCrashError(err)) {
          throw err;
        }

        const errMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const retryAt = new Date(this.nowFn().getTime() + this.retryBackoffMs);
        logger.error('[MeetingOutbox] Outbox dispatch attempt failed; scheduling retry', {
          metadata: {
            instanceId: this.instanceId,
            outboxId: String(claimed._id),
            eventId: claimed.eventId,
            meetingId: meetingIdStr,
            attemptCount: claimed.attemptCount,
            message: errMessage,
          },
        });

        try {
          const released = await MeetingRealtimeEvent.updateOne(
            {
              _id: claimed._id,
              status: 'CLAIMED',
              leaseToken,
            },
            {
              $set: {
                status: 'PENDING',
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
                lastError: errMessage,
                nextAttemptAt: retryAt,
              },
            }
          );
          if (released.matchedCount === 0) {
            logger.warn(
              '[MeetingOutbox] Retry release matched 0 docs (lease already suppressed or reclaimed)',
              {
                metadata: {
                  instanceId: this.instanceId,
                  outboxId: String(claimed._id),
                  eventId: claimed.eventId,
                  leaseToken,
                },
              }
            );
          }
        } catch (releaseErr) {
          logger.error(
            '[MeetingOutbox] Failed to release lease back to PENDING; record will recover automatically after leaseExpiresAt',
            {
              metadata: {
                instanceId: this.instanceId,
                outboxId: String(claimed._id),
                eventId: claimed.eventId,
                leaseToken,
                leaseExpiresAt: claimed.leaseExpiresAt?.toISOString?.() ?? null,
                message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
              },
            }
          );
        }

        return {
          status: 'RETRY_SCHEDULED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
          leaseToken,
          error: errMessage,
        };
      }
    });
  }

  private async verifyLeaseAndMeetingState(
    claimed: IMeetingRealtimeEvent,
    leaseToken: string
  ): Promise<
    | { ok: true; meetingDoc: IMeeting; participantDoc: IMeetingParticipant }
    | { ok: false; result: OutboxDispatchResult }
  > {
    const meetingIdStr = claimed.meetingId.toString();
    const now = this.nowFn();

    const [leaseDoc, endedOutbox, meetingDoc, participantDoc] = await Promise.all([
      MeetingRealtimeEvent.findById(claimed._id)
        .select('status leaseToken leaseExpiresAt')
        .lean(),
      MeetingRealtimeEvent.exists({
        meetingId: claimed.meetingId,
        type: 'MEETING_ENDED',
      }),
      Meeting.findById(claimed.meetingId),
      claimed.targetUserId
        ? MeetingParticipant.findOne({
            meetingId: claimed.meetingId,
            userId: claimed.targetUserId,
          })
        : Promise.resolve(null),
    ]);

    if (!leaseDoc) {
      return { ok: false, result: { status: 'NOT_FOUND', eventId: claimed.eventId } };
    }

    if (leaseDoc.status === 'SUPPRESSED') {
      this.realtime.markMeetingEnded(meetingIdStr);
      return {
        ok: false,
        result: {
          status: 'SUPPRESSED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
        },
      };
    }

    if (leaseDoc.status !== 'CLAIMED' || leaseDoc.leaseToken !== leaseToken) {
      return {
        ok: false,
        result: {
          status: leaseDoc.status === 'DISPATCHED' ? 'ALREADY_DISPATCHED' : 'LEASE_LOST',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
          leaseToken,
        },
      };
    }

    // Strict lease-expiry fence: refuse to emit on an already-expired lease even if no other
    // instance has stolen it yet, preventing concurrent double-emission during a GC stall.
    if (leaseDoc.leaseExpiresAt && now >= new Date(leaseDoc.leaseExpiresAt)) {
      logger.warn('[MeetingOutbox] Aborting emission because local lease expired before emit', {
        metadata: {
          instanceId: this.instanceId,
          outboxId: String(claimed._id),
          eventId: claimed.eventId,
          leaseToken,
          leaseExpiresAt: new Date(leaseDoc.leaseExpiresAt).toISOString(),
        },
      });
      return {
        ok: false,
        result: {
          status: 'LEASE_EXPIRED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
          leaseToken,
        },
      };
    }

    const meetingEnded =
      this.realtime.isMeetingMarkedEnded(meetingIdStr) ||
      Boolean(endedOutbox) ||
      !meetingDoc ||
      meetingDoc.status === 'ENDED' ||
      meetingDoc.status === 'EXPIRED' ||
      now >= new Date(meetingDoc.expiresAt);

    if (meetingEnded) {
      this.realtime.markMeetingEnded(meetingIdStr);
      await this.suppressLeasedRecord(claimed._id as Types.ObjectId, leaseToken);
      return {
        ok: false,
        result: {
          status: 'SUPPRESSED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
        },
      };
    }

    if (!participantDoc || participantDoc.admissionStatus !== 'ADMITTED') {
      await this.suppressLeasedRecord(claimed._id as Types.ObjectId, leaseToken);
      return {
        ok: false,
        result: {
          status: 'SUPPRESSED',
          eventId: claimed.eventId,
          attemptCount: claimed.attemptCount,
        },
      };
    }

    return { ok: true, meetingDoc, participantDoc };
  }

  private async suppressLeasedRecord(
    outboxId: Types.ObjectId,
    leaseToken: string
  ): Promise<boolean> {
    const now = this.nowFn();
    try {
      const res = await MeetingRealtimeEvent.updateOne(
        {
          _id: outboxId,
          status: 'CLAIMED',
          leaseToken,
        },
        {
          $set: {
            status: 'SUPPRESSED',
            suppressedAt: now,
            terminalAt: now,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }
      );
      return res.modifiedCount > 0;
    } catch (err) {
      logger.error(
        '[MeetingOutbox] Failed to suppress leased outbox record; record will be re-evaluated and suppressed after leaseExpiresAt',
        {
          metadata: {
            instanceId: this.instanceId,
            outboxId: outboxId.toString(),
            leaseToken,
            message: err instanceof Error ? err.message : String(err),
          },
        }
      );
      return false;
    }
  }

  private async hydrateAdmissionPayload(
    meeting: IMeeting,
    participant: IMeetingParticipant
  ): Promise<OutboxDispatchPreloadedContext> {
    const [hostUser, waitingDocs] = await Promise.all([
      User.findById(meeting.hostId).select('firstName lastName').lean(),
      MeetingParticipant.find({
        meetingId: meeting._id,
        admissionStatus: 'WAITING',
      }).sort({ requestedAt: 1, createdAt: 1 }),
    ]);

    const hostName = hostUser
      ? `${hostUser.firstName} ${hostUser.lastName}`.trim()
      : 'Meeting Host';
    const baseOrigin = env.CLIENT_ORIGIN.replace(/\/+$/, '');

    const serializeParticipantDoc = (doc: IMeetingParticipant) => ({
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      displayName: doc.displayName,
      avatarUrl: doc.avatarUrl || null,
      role: doc.role,
      admissionStatus: doc.admissionStatus,
      presenceStatus: doc.presenceStatus,
      requestedAt: doc.requestedAt,
      admittedAt: doc.admittedAt || null,
      joinedAt: doc.joinedAt || null,
    });

    const serializedMeeting = {
      id: meeting._id.toString(),
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      joinUrl: `${baseOrigin}/join/${meeting.meetingCode}`,
      hostId: meeting.hostId.toString(),
      hostName,
      status: meeting.status,
      isLocked: meeting.isLocked,
      maxParticipants: meeting.maxParticipants,
      activeParticipantCount: meeting.activeParticipantCount,
      settings: {
        waitingRoomEnabled: meeting.settings.waitingRoomEnabled,
        allowCoHostAdmit: meeting.settings.allowCoHostAdmit,
        allowCoHostRemove: meeting.settings.allowCoHostRemove,
        allowCoHostLock: meeting.settings.allowCoHostLock,
      },
      activatedAt: meeting.activatedAt || null,
      endedAt: meeting.endedAt || null,
      expiresAt: meeting.expiresAt,
      createdAt: meeting.createdAt,
    };

    return {
      serializedMeeting,
      serializedParticipant: serializeParticipantDoc(participant),
      waitingList: waitingDocs.map(serializeParticipantDoc),
      activeParticipantCount: meeting.activeParticipantCount,
    };
  }
}

export const meetingOutboxDispatcher = new MeetingRealtimeOutboxDispatcher();
