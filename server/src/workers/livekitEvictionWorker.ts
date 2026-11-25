import crypto from 'node:crypto';
import os from 'node:os';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { env } from '../config/env.js';
import {
  LiveKitEvictionJob,
  ensureLiveKitEvictionJobReady,
  sanitizeEvictionError,
  type ILiveKitEvictionJob,
  type LiveKitEvictionJobStatus,
} from '../models/LiveKitEvictionJob.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { isReplicaSetTransactionsSupported } from '../models/LiveKitRevocationEvent.model.js';
import {
  livekitService,
  LiveKitService,
  getLiveKitParticipantIdentity,
  parseLiveKitParticipantSessionId,
} from '../services/livekit.service.js';
import { logger } from '../utils/logger.js';
import { securityAudit } from '../utils/securityAudit.js';
import { ServiceUnavailableError } from '../utils/errors.js';

export interface LiveKitEvictionWorkerTestHooks {
  beforeAcquire?: (jobId: string) => Promise<void>;
  afterAcquireBeforeExecution?: (job: ILiveKitEvictionJob) => Promise<void>;
  beforeLiveKitCall?: (job: ILiveKitEvictionJob) => Promise<void>;
  afterLiveKitCallBeforeStateUpdate?: (job: ILiveKitEvictionJob) => Promise<void>;
  beforeLeaseRenew?: (jobId: string) => Promise<void>;
  afterLeaseRenew?: (jobId: string, renewed: boolean) => Promise<void>;
}

export interface LiveKitEvictionWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  minPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  /**
   * Sprint 06J (F-06I-02): Pre-SFU lease expiry safety margin in milliseconds.
   * If remaining confirmed lease time is less than or equal to this threshold,
   * new external SFU requests will not be initiated.
   * Default: 1,000 ms.
   */
  leaseSafetyMarginMs?: number;
  maxBatchSize?: number;
  livekit?: LiveKitService;
  nowFn?: () => Date;
  hooks?: LiveKitEvictionWorkerTestHooks;
  requireTransactions?: boolean;
}

export interface LiveKitEvictionExecutionResult {
  jobId: string;
  status: LiveKitEvictionJobStatus | 'NOT_FOUND' | 'LEASE_LOST' | 'ALREADY_COMPLETED' | 'DEFERRED';
  attempts: number;
  error?: string;
}

export interface LiveKitEvictionSweepSummary {
  scanned: number;
  completed: number;
  retried: number;
  escalated: number;
  leaseLost: number;
  deferred: number;
}

export class LiveKitEvictionWorker {
  public readonly workerId: string;
  public readonly requireTransactions: boolean;
  private readonly initialPollIntervalMs: number;
  private readonly minPollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private currentPollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseSafetyMarginMs: number;
  private readonly maxBatchSize: number;
  private readonly livekit: LiveKitService;
  private readonly nowFn: () => Date;
  private readonly hooks: LiveKitEvictionWorkerTestHooks;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isStopped = false;
  private sweepInFlight: Promise<LiveKitEvictionSweepSummary> | null = null;
  private readonly activeHeartbeatTimers = new Set<NodeJS.Timeout>();
  private readonly activeHeartbeatPromises = new Set<Promise<unknown>>();
  private readonly activeJobExecutions = new Set<Promise<unknown>>();

  constructor(options: LiveKitEvictionWorkerOptions = {}) {
    this.workerId =
      options.workerId ||
      `evict_worker_${os.hostname()}_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
    // F-06G-04: In production, transactions cannot be disabled via options
    const isProd = process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
    if (isProd) {
      this.requireTransactions = true;
    } else {
      this.requireTransactions =
        options.requireTransactions ??
        (process.env.REQUIRE_TRANSACTIONS === 'true' || env.REQUIRE_TRANSACTIONS === 'true');
    }
    this.initialPollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.minPollIntervalMs = options.minPollIntervalMs ?? 1_000;
    this.maxPollIntervalMs = options.maxPollIntervalMs ?? 10_000;
    this.currentPollIntervalMs = this.initialPollIntervalMs;
    this.leaseDurationMs = options.leaseDurationMs ?? 20_000;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ??
      Math.min(5_000, Math.max(1_000, Math.floor(this.leaseDurationMs / 4)));
    this.leaseSafetyMarginMs =
      options.leaseSafetyMarginMs ??
      Math.min(1_000, Math.max(50, Math.floor(this.leaseDurationMs / 5)));
    this.maxBatchSize = options.maxBatchSize ?? 25;
    this.livekit = options.livekit ?? livekitService;
    this.nowFn = options.nowFn ?? (() => new Date());
    this.hooks = options.hooks ?? {};
  }

  public getLeaseSafetyMarginMs(): number {
    return this.leaseSafetyMarginMs;
  }

  public getCurrentPollIntervalMs(): number {
    return this.currentPollIntervalMs;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await ensureLiveKitEvictionJobReady();

    // Initial sweep to recover pending or expired leases on startup
    await this.processDueJobs().catch((err) => {
      logger.error('[LiveKitEvictionWorker] Initial startup sweep failed', {
        metadata: {
          workerId: this.workerId,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    });

    this.scheduleNextSweep(this.currentPollIntervalMs);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    this.isStopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of this.activeHeartbeatTimers) {
      clearInterval(timer);
    }
    this.activeHeartbeatTimers.clear();

    // 1. Settle in-flight heartbeats
    if (this.activeHeartbeatPromises.size > 0) {
      await Promise.allSettled(Array.from(this.activeHeartbeatPromises));
      this.activeHeartbeatPromises.clear();
    }

    // 2. Settle in-flight job executions (standalone processJobById)
    if (this.activeJobExecutions.size > 0) {
      await Promise.allSettled(Array.from(this.activeJobExecutions));
      this.activeJobExecutions.clear();
    }

    // 3. Settle background sweep
    if (this.sweepInFlight) {
      await this.sweepInFlight.catch(() => {});
    }
  }

  /**
   * Resets idle backoff to minPollIntervalMs and triggers an immediate sweep.
   * Called when a new eviction job is enqueued or an operator retries a job.
   */
  public wakeUp(): void {
    if (!this.isRunning) return;
    this.currentPollIntervalMs = this.minPollIntervalMs;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Asynchronously trigger due jobs sweep immediately
    this.processDueJobs()
      .catch((err) => {
        logger.error('[LiveKitEvictionWorker] Wakeup sweep failed', {
          metadata: {
            workerId: this.workerId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      })
      .finally(() => {
        if (this.isRunning && !this.pollTimer) {
          this.scheduleNextSweep(this.currentPollIntervalMs);
        }
      });
  }

  private scheduleNextSweep(delayMs: number): void {
    if (!this.isRunning || this.initialPollIntervalMs <= 0) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(async () => {
      if (!this.isRunning) return;
      try {
        const summary = await this.processDueJobs();
        if (summary.scanned > 0) {
          // Active work processed: reset to minimum polling interval
          this.currentPollIntervalMs = this.minPollIntervalMs;
        } else {
          // Idle sweep: progressively back off up to maxPollIntervalMs
          this.currentPollIntervalMs = Math.min(
            Math.round(this.currentPollIntervalMs * 1.5),
            this.maxPollIntervalMs
          );
        }
      } catch (err) {
        logger.error('[LiveKitEvictionWorker] Periodic sweep failed', {
          metadata: {
            workerId: this.workerId,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (this.isRunning) {
          this.scheduleNextSweep(this.currentPollIntervalMs);
        }
      }
    }, delayMs);
  }

  /**
   * Claims and processes a specific eviction job by its stable deterministic jobId.
   * Uses atomic findOneAndUpdate with random UUID leaseToken fencing.
   */
  public async processJobById(
    jobId: string,
    perCallHooks?: Partial<LiveKitEvictionWorkerTestHooks>
  ): Promise<LiveKitEvictionExecutionResult> {
    const jobPromise = this.internalProcessJobById(jobId, perCallHooks);
    this.activeJobExecutions.add(jobPromise);
    try {
      return await jobPromise;
    } finally {
      this.activeJobExecutions.delete(jobPromise);
    }
  }

  private async internalProcessJobById(
    jobId: string,
    perCallHooks?: Partial<LiveKitEvictionWorkerTestHooks>
  ): Promise<LiveKitEvictionExecutionResult> {
    const hooks: LiveKitEvictionWorkerTestHooks = {
      ...this.hooks,
      ...perCallHooks,
    };

    if (hooks.beforeAcquire) {
      await hooks.beforeAcquire(jobId);
    }

    const now = this.nowFn();
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);

    // Atomically claim the job
    const claimed = await LiveKitEvictionJob.findOneAndUpdate(
      {
        jobId,
        status: { $in: ['PENDING', 'FAILED', 'PROCESSING'] },
        $or: [
          { status: { $in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseOwner: this.workerId,
          leaseToken,
          leaseExpiresAt,
        },
      },
      { new: true }
    );

    if (!claimed) {
      const existing = await LiveKitEvictionJob.findOne({ jobId }).select('status attempts').lean();
      if (!existing) {
        return { jobId, status: 'NOT_FOUND', attempts: 0 };
      }
      if (existing.status === 'COMPLETED') {
        return { jobId, status: 'ALREADY_COMPLETED', attempts: existing.attempts };
      }
      return { jobId, status: 'LEASE_LOST', attempts: existing.attempts };
    }

    return this.executeClaimedJob(claimed, leaseToken, hooks);
  }

  /**
   * Scans and processes due PENDING, FAILED, and expired PROCESSING jobs in batch.
   */
  public async processDueJobs(limit = this.maxBatchSize): Promise<LiveKitEvictionSweepSummary> {
    if (this.sweepInFlight) {
      return this.sweepInFlight;
    }

    const run = async (): Promise<LiveKitEvictionSweepSummary> => {
      const summary: LiveKitEvictionSweepSummary = {
        scanned: 0,
        completed: 0,
        retried: 0,
        escalated: 0,
        leaseLost: 0,
        deferred: 0,
      };

      const now = this.nowFn();

      const candidateDocs = await LiveKitEvictionJob.find({
        status: { $in: ['PENDING', 'FAILED', 'PROCESSING'] },
        $or: [
          {
            status: { $in: ['PENDING', 'FAILED'] },
            nextRunAt: { $lte: now },
          },
          {
            status: 'PROCESSING',
            leaseExpiresAt: { $lte: now },
          },
        ],
      })
        .sort({ nextRunAt: 1, createdAt: 1 })
        .limit(limit)
        .select('jobId')
        .lean();

      summary.scanned = candidateDocs.length;

      for (const cand of candidateDocs) {
        try {
          const outcome = await this.processJobById(cand.jobId);
          if (outcome.status === 'COMPLETED') {
            summary.completed++;
          } else if (outcome.status === 'FAILED') {
            summary.retried++;
          } else if (outcome.status === 'ESCALATED') {
            summary.escalated++;
          } else if (outcome.status === 'LEASE_LOST') {
            summary.leaseLost++;
          } else if (outcome.status === 'DEFERRED') {
            summary.deferred++;
          }
        } catch (jobErr) {
          logger.error('[LiveKitEvictionWorker] Unexpected error executing eviction candidate', {
            metadata: {
              jobId: cand.jobId,
              message: jobErr instanceof Error ? jobErr.message : String(jobErr),
            },
          });
        }
      }

      return summary;
    };

    this.sweepInFlight = run();
    try {
      return await this.sweepInFlight;
    } finally {
      this.sweepInFlight = null;
    }
  }

  /**
   * Internal execution of an atomically claimed eviction job under active lease fencing
   * and periodic in-flight lease renewal heartbeat.
   */
  private async executeClaimedJob(
    job: ILiveKitEvictionJob,
    leaseToken: string,
    hooks: LiveKitEvictionWorkerTestHooks
  ): Promise<LiveKitEvictionExecutionResult> {
    const now = this.nowFn();

    if (hooks.afterAcquireBeforeExecution) {
      await hooks.afterAcquireBeforeExecution(job);
    }

    // Step 0: If LiveKit is not configured in this environment, complete job immediately
    if (!this.livekit.isConfigured()) {
      const updated = await this.markJobCompleted(job._id, leaseToken, now);
      return {
        jobId: job.jobId,
        status: updated ? 'COMPLETED' : 'LEASE_LOST',
        attempts: job.attempts,
      };
    }

    // In-flight lease heartbeat state
    let leaseLost = false;
    let isRenewing = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let pendingHeartbeatPromise: Promise<boolean> | null = null;

    // F-06G-01: Track confirmed lease deadline locally. Initialized from claimed job expiry or now + leaseDurationMs.
    let confirmedLeaseDeadlineMs = job.leaseExpiresAt
      ? new Date(job.leaseExpiresAt).getTime()
      : now.getTime() + this.leaseDurationMs;

    /**
     * Sprint 06J (F-06I-02): Evaluates whether the worker currently holds confirmed lease ownership.
     * When marginMs > 0, additionally enforces that the remaining lease duration exceeds the safety
     * margin before initiating any new external SFU requests.
     *
     * Note: This safety margin prevents dispatching requests when the deadline is too close.
     * It does not (and cannot) cancel an HTTP request that has already been dispatched to the wire.
     */
    const isLeaseValid = (marginMs = 0): boolean => {
      if (leaseLost || this.isStopped) return false;
      const nowMs = this.nowFn().getTime();
      if (nowMs >= confirmedLeaseDeadlineMs) {
        leaseLost = true;
        return false;
      }
      if (marginMs > 0 && nowMs + marginMs >= confirmedLeaseDeadlineMs) {
        return false;
      }
      return true;
    };

    const renewLease = async (): Promise<boolean> => {
      // F-06E-01: Single-flight concurrency guard.
      // If a lease renewal is already in flight, return the existing in-flight promise.
      if (pendingHeartbeatPromise) {
        return pendingHeartbeatPromise;
      }
      if (!isLeaseValid() || this.isStopped) return false;

      const doRenew = async (): Promise<boolean> => {
        isRenewing = true;
        try {
          if (hooks.beforeLeaseRenew) {
            await hooks.beforeLeaseRenew(job.jobId);
          }
          if (!isLeaseValid() || this.isStopped) return false;

          const renewNow = this.nowFn();
          const nextExpiresAt = new Date(renewNow.getTime() + this.leaseDurationMs);
          const res = await LiveKitEvictionJob.updateOne(
            {
              _id: job._id,
              leaseToken,
              status: 'PROCESSING',
            },
            {
              $set: {
                leaseExpiresAt: nextExpiresAt,
              },
            }
          );
          const renewed = res.modifiedCount > 0;
          if (renewed) {
            // F-06G-01: Advance confirmed deadline ONLY upon validated DB update
            confirmedLeaseDeadlineMs = nextExpiresAt.getTime();
          } else {
            leaseLost = true;
            logger.warn('[LiveKitEvictionWorker] In-flight lease renewal failed; lease lost or stolen', {
              metadata: {
                workerId: this.workerId,
                jobId: job.jobId,
                leaseToken,
              },
            });
          }
          if (hooks.afterLeaseRenew) {
            await hooks.afterLeaseRenew(job.jobId, renewed);
          }
          return renewed;
        } catch (err) {
          logger.error('[LiveKitEvictionWorker] Error during in-flight lease renewal heartbeat', {
            metadata: {
              workerId: this.workerId,
              jobId: job.jobId,
              message: err instanceof Error ? err.message : String(err),
            },
          });
          // F-06G-01: Distinguish transient DB failure from confirmed lease loss.
          // If the confirmed local deadline has already elapsed, mark leaseLost.
          if (this.nowFn().getTime() >= confirmedLeaseDeadlineMs) {
            leaseLost = true;
          }
          return false;
        } finally {
          isRenewing = false;
          pendingHeartbeatPromise = null;
        }
      };

      const renewPromise = doRenew();
      pendingHeartbeatPromise = renewPromise;

      this.activeHeartbeatPromises.add(renewPromise);
      renewPromise.finally(() => {
        this.activeHeartbeatPromises.delete(renewPromise);
      });

      return renewPromise;
    };

    if (this.heartbeatIntervalMs > 0 && !this.isStopped) {
      heartbeatTimer = setInterval(() => {
        if (!isLeaseValid() || this.isStopped) {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            this.activeHeartbeatTimers.delete(heartbeatTimer);
            heartbeatTimer = null;
          }
          return;
        }
        // F-06E-01: Guard against spawning overlapping renewals when an existing renewal is in-flight
        if (!isRenewing && !pendingHeartbeatPromise) {
          renewLease().catch(() => false);
        }
      }, this.heartbeatIntervalMs);
      this.activeHeartbeatTimers.add(heartbeatTimer);
    }

    try {
      const targetIdentity =
        job.identity ||
        getLiveKitParticipantIdentity(job.userId.toString(), job.sessionId);

      // Step 1: Check authoritative MongoDB participant state before eviction attempt
      const participant = await MeetingParticipant.findOne({
        meetingId: job.meetingId,
        userId: job.userId,
      }).lean();

      // If participant record does not exist -> verified absence
      if (!participant) {
        if (!isLeaseValid()) {
          return { jobId: job.jobId, status: 'LEASE_LOST', attempts: job.attempts };
        }
        const updated = await this.markJobCompleted(job._id, leaseToken, now);
        return {
          jobId: job.jobId,
          status: updated ? 'COMPLETED' : 'LEASE_LOST',
          attempts: job.attempts,
        };
      }

      const hasSessionScope = Boolean(job.sessionId || parseLiveKitParticipantSessionId(targetIdentity));

      // For legacy jobs lacking session-scoped identity: if participant has been re-admitted
      // (ADMITTED or advanced tokenEpoch), evicting static usr_<userId> would terminate
      // their new active session. Complete safely without evicting the active user.
      if (!hasSessionScope && (participant.admissionStatus !== 'REMOVED' || participant.tokenEpoch > job.epoch)) {
        if (!isLeaseValid()) {
          return { jobId: job.jobId, status: 'LEASE_LOST', attempts: job.attempts };
        }
        const updated = await this.markJobCompleted(job._id, leaseToken, now);
        return {
          jobId: job.jobId,
          status: updated ? 'COMPLETED' : 'LEASE_LOST',
          attempts: job.attempts,
        };
      }

      // Pre-call check: If lease heartbeat failed, expired, or inside safety margin, prevent external SFU call
      if (!isLeaseValid(this.leaseSafetyMarginMs)) {
        if (leaseLost || this.nowFn().getTime() >= confirmedLeaseDeadlineMs) {
          return {
            jobId: job.jobId,
            status: 'LEASE_LOST',
            attempts: job.attempts,
          };
        }

        const reason = `Pre-presence lease safety margin triggered (${confirmedLeaseDeadlineMs - this.nowFn().getTime()}ms remaining <= ${this.leaseSafetyMarginMs}ms margin); deferring eviction`;
        logger.warn(`[LiveKitEvictionWorker] ${reason}`, {
          metadata: {
            workerId: this.workerId,
            jobId: job.jobId,
            remainingMs: confirmedLeaseDeadlineMs - this.nowFn().getTime(),
            safetyMarginMs: this.leaseSafetyMarginMs,
          },
        });

        const deferred = await this.deferJobUnderSafetyMargin(
          job._id,
          leaseToken,
          this.nowFn(),
          reason
        );
        return {
          jobId: job.jobId,
          status: deferred ? 'DEFERRED' : 'LEASE_LOST',
          attempts: job.attempts,
        };
      }

      // Step 2: LiveKit participant inspection before removal when configured
      if (hooks.beforeLiveKitCall) {
        await hooks.beforeLiveKitCall(job);
      }

      if (!isLeaseValid(this.leaseSafetyMarginMs)) {
        if (leaseLost || this.nowFn().getTime() >= confirmedLeaseDeadlineMs) {
          return {
            jobId: job.jobId,
            status: 'LEASE_LOST',
            attempts: job.attempts,
          };
        }

        const reason = `Pre-presence hook lease safety margin triggered; deferring eviction`;
        logger.warn(`[LiveKitEvictionWorker] ${reason}`, {
          metadata: {
            workerId: this.workerId,
            jobId: job.jobId,
            remainingMs: confirmedLeaseDeadlineMs - this.nowFn().getTime(),
            safetyMarginMs: this.leaseSafetyMarginMs,
          },
        });

        const deferred = await this.deferJobUnderSafetyMargin(
          job._id,
          leaseToken,
          this.nowFn(),
          reason
        );
        return {
          jobId: job.jobId,
          status: deferred ? 'DEFERRED' : 'LEASE_LOST',
          attempts: job.attempts,
        };
      }

      let isAbsent = false;
      let evictionError: string | null = null;

      try {
        // Query SFU presence using meetingId and targetIdentity
        const presence = await this.livekit.getParticipant(
          job.meetingId.toString(),
          targetIdentity
        );
        if (presence === null) {
          // Verified 404/not-found participant response on LiveKit SFU -> successful eviction!
          isAbsent = true;
        }
      } catch (inspErr) {
        // Inspection error (network, timeout, 5xx): record and proceed to eviction or backoff
        evictionError = sanitizeEvictionError(inspErr);
      }

      // Step 3: If not already confirmed absent, execute removal API
      if (!isAbsent && !evictionError) {
        if (isLeaseValid(this.leaseSafetyMarginMs)) {
          try {
            const res = await this.livekit.evictParticipant(
              job.meetingId.toString(),
              targetIdentity
            );
            if (res.success || res.notFound) {
              isAbsent = true;
            } else {
              evictionError = sanitizeEvictionError(res.error || 'Eviction returned false');
            }
          } catch (evictErr) {
            evictionError = sanitizeEvictionError(evictErr);
          }
        } else {
          if (leaseLost || this.nowFn().getTime() >= confirmedLeaseDeadlineMs) {
            return {
              jobId: job.jobId,
              status: 'LEASE_LOST',
              attempts: job.attempts,
            };
          }

          const reason = `Pre-eviction lease safety margin triggered (${confirmedLeaseDeadlineMs - this.nowFn().getTime()}ms remaining <= ${this.leaseSafetyMarginMs}ms margin); deferring eviction`;
          logger.warn(`[LiveKitEvictionWorker] ${reason}`, {
            metadata: {
              workerId: this.workerId,
              jobId: job.jobId,
              remainingMs: confirmedLeaseDeadlineMs - this.nowFn().getTime(),
              safetyMarginMs: this.leaseSafetyMarginMs,
            },
          });

          const deferred = await this.deferJobUnderSafetyMargin(
            job._id,
            leaseToken,
            this.nowFn(),
            reason
          );
          return {
            jobId: job.jobId,
            status: deferred ? 'DEFERRED' : 'LEASE_LOST',
            attempts: job.attempts,
          };
        }
      }

      if (hooks.afterLiveKitCallBeforeStateUpdate) {
        await hooks.afterLiveKitCallBeforeStateUpdate(job);
      }

      // Post-call check: If lease was lost or expired during the LiveKit call, prevent state modification
      if (!isLeaseValid()) {
        return {
          jobId: job.jobId,
          status: 'LEASE_LOST',
          attempts: job.attempts,
          error: evictionError ?? undefined,
        };
      }

      // Step 4: Persist outcome under leaseToken fencing
      if (isAbsent) {
        const updated = await this.markJobCompleted(job._id, leaseToken, now);
        return {
          jobId: job.jobId,
          status: updated ? 'COMPLETED' : 'LEASE_LOST',
          attempts: job.attempts,
        };
      }

      // Handle eviction failure with bounded exponential backoff
      const nextAttempts = job.attempts + 1;
      const isExhausted = nextAttempts >= job.maxAttempts;

      if (isExhausted) {
        // Retry exhaustion -> ESCALATED status
        const updated = await this.markJobEscalated(
          job,
          leaseToken,
          nextAttempts,
          evictionError || 'LiveKit eviction retries exhausted.',
          now
        );
        return {
          jobId: job.jobId,
          status: updated ? 'ESCALATED' : 'LEASE_LOST',
          attempts: nextAttempts,
          error: evictionError ?? undefined,
        };
      }

      // Bounded exponential backoff with jitter
      const baseDelayMs = Math.min(1_000 * Math.pow(2, nextAttempts - 1), 30_000);
      const jitterMs = Math.floor(Math.random() * 200);
      const nextRunAt = new Date(now.getTime() + baseDelayMs + jitterMs);

      const updated = await this.markJobFailedForRetry(
        job._id,
        leaseToken,
        nextAttempts,
        nextRunAt,
        evictionError || 'Transient eviction failure',
        now
      );

      return {
        jobId: job.jobId,
        status: updated ? 'FAILED' : 'LEASE_LOST',
        attempts: nextAttempts,
        error: evictionError ?? undefined,
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        this.activeHeartbeatTimers.delete(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pendingHeartbeatPromise) {
        await (pendingHeartbeatPromise as Promise<unknown>).catch(() => {});
      }
    }
  }

  /**
   * Sprint 06L (F-06K-02): Atomically and safely defers a job whose confirmed lease
   * is within the pre-SFU safety margin.
   *
   * Semantics:
   * - Sets status to 'PENDING'
   * - Leaves attempts UNCHANGED (deferral is not an eviction failure; attempt budget is preserved)
   * - Clears leaseOwner, leaseToken, leaseExpiresAt to null so the job is released
   * - Sets nextRunAt to now + deferralDelayMs (bounded to Math.max(1_000, leaseSafetyMarginMs))
   *   to prevent hot-looping while remaining promptly reclaimable.
   * - Filters by { _id: objId, leaseToken, status: 'PROCESSING' } ensuring ownership fencing.
   * - If res.modifiedCount === 0, worker has lost authority (lease stolen/expired) -> returns false.
   */
  public async deferJobUnderSafetyMargin(
    objId: Types.ObjectId,
    leaseToken: string,
    now: Date,
    reason: string
  ): Promise<boolean> {
    const deferralDelayMs = Math.max(1_000, this.leaseSafetyMarginMs);
    const nextRunAt = new Date(now.getTime() + deferralDelayMs);
    const res = await LiveKitEvictionJob.updateOne(
      {
        _id: objId,
        leaseToken,
        status: 'PROCESSING',
      },
      {
        $set: {
          status: 'PENDING',
          nextRunAt,
          lastError: sanitizeEvictionError(reason),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      }
    );
    return res.modifiedCount > 0;
  }

  private async markJobCompleted(
    objId: Types.ObjectId,
    leaseToken: string,
    now: Date
  ): Promise<boolean> {
    const res = await LiveKitEvictionJob.updateOne(
      {
        _id: objId,
        leaseToken,
        status: 'PROCESSING',
      },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: now,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      }
    );
    return res.modifiedCount > 0;
  }

  private async markJobFailedForRetry(
    objId: Types.ObjectId,
    leaseToken: string,
    attempts: number,
    nextRunAt: Date,
    lastError: string,
    _now: Date
  ): Promise<boolean> {
    const res = await LiveKitEvictionJob.updateOne(
      {
        _id: objId,
        leaseToken,
        status: 'PROCESSING',
      },
      {
        $set: {
          status: 'FAILED',
          attempts,
          nextRunAt,
          lastError: sanitizeEvictionError(lastError),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      }
    );
    return res.modifiedCount > 0;
  }

  private async markJobEscalated(
    job: ILiveKitEvictionJob,
    leaseToken: string,
    attempts: number,
    lastError: string,
    now: Date
  ): Promise<boolean> {
    const sanitizedErr = sanitizeEvictionError(lastError);
    const txSupported = await isReplicaSetTransactionsSupported();
    const isProd = process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
    const reqTx = isProd || this.requireTransactions;

    if (!txSupported && reqTx) {
      throw new ServiceUnavailableError(
        'Marking eviction job escalated requires a MongoDB Replica Set supporting multi-document transactions.',
        'TRANSACTION_REQUIRED'
      );
    }

    if (txSupported) {
      const session = await mongoose.startSession();
      try {
        let escalated = false;
        await session.withTransaction(async () => {
          const res = await LiveKitEvictionJob.updateOne(
            {
              _id: job._id,
              leaseToken,
              status: 'PROCESSING',
            },
            {
              $set: {
                status: 'ESCALATED',
                attempts,
                escalatedAt: now,
                lastError: sanitizedErr,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
            },
            { session }
          );

          if (res.modifiedCount > 0) {
            escalated = true;
            await securityAudit.logAsync(
              {
                eventType: 'EVICTION_JOB_ESCALATED',
                userId: job.userId.toString(),
                jobId: job.jobId,
                meetingId: job.meetingId.toString(),
                severity: 'CRITICAL',
                outcome: 'ESCALATED',
                details: {
                  jobId: job.jobId,
                  identity: job.identity,
                  attempts,
                  lastError: sanitizedErr,
                },
              },
              { session }
            );
          }
        });

        if (escalated) {
          logger.error(
            '[LiveKitEvictionWorker] Participant eviction retries exhausted; job ESCALATED to operator (transactional)',
            {
              metadata: {
                jobObjectId: job._id.toString(),
                attempts,
                lastError: sanitizedErr,
              },
            }
          );
          return true;
        }
        return false;
      } finally {
        await session.endSession();
      }
    } else {
      const res = await LiveKitEvictionJob.updateOne(
        {
          _id: job._id,
          leaseToken,
          status: 'PROCESSING',
        },
        {
          $set: {
            status: 'ESCALATED',
            attempts,
            escalatedAt: now,
            lastError: sanitizedErr,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }
      );

      if (res.modifiedCount > 0) {
        await securityAudit.logAsync({
          eventType: 'EVICTION_JOB_ESCALATED',
          userId: job.userId.toString(),
          jobId: job.jobId,
          meetingId: job.meetingId.toString(),
          severity: 'CRITICAL',
          outcome: 'ESCALATED',
          details: {
            jobId: job.jobId,
            identity: job.identity,
            attempts,
            lastError: sanitizedErr,
          },
        });
        logger.error(
          '[LiveKitEvictionWorker] Participant eviction retries exhausted; job ESCALATED to operator',
          {
            metadata: {
              jobObjectId: job._id.toString(),
              attempts,
              lastError: sanitizedErr,
            },
          }
        );
        return true;
      }
      return false;
    }
  }

  /**
   * Authorized operator recovery mechanism: resets an ESCALATED or FAILED job to PENDING.
   * F-06E-02: Failure-aware, transactional audit persistence. Atomically commits
   * the job update and the SecurityAuditEntry record within the same MongoDB transaction.
   * Never returns { success: true } if audit persistence fails or rolls back.
   */
  public async operatorRetryJob(
    jobId: string,
    operatorId: string,
    options?: { session?: ClientSession; requireTransactions?: boolean }
  ): Promise<{ success: boolean; message: string }> {
    const now = this.nowFn();
    const isProd = process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
    const reqTx = isProd ? true : (options?.requireTransactions ?? this.requireTransactions);
    const txSupported = options?.session ? true : await isReplicaSetTransactionsSupported();

    if (!txSupported && reqTx) {
      throw new ServiceUnavailableError(
        'Operator eviction job retry requires a MongoDB Replica Set supporting multi-document transactions.',
        'TRANSACTION_REQUIRED'
      );
    }

    if (options?.session) {
      if ((isProd || reqTx) && !options.session.inTransaction()) {
        throw new ServiceUnavailableError(
          'Operator eviction job retry session must be within an active multi-document transaction.',
          'TRANSACTION_REQUIRED'
        );
      }

      const existing = await LiveKitEvictionJob.findOne({
        jobId,
        status: { $in: ['ESCALATED', 'FAILED'] },
      }).session(options.session);

      if (!existing) {
        return { success: false, message: 'Job not found or not in ESCALATED/FAILED status.' };
      }

      await LiveKitEvictionJob.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'PENDING',
            attempts: 0,
            nextRunAt: now,
            lastError: `Operator ${operatorId} manual retry scheduled at ${now.toISOString()}`,
            escalatedAt: null,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        },
        { session: options.session }
      );

      await securityAudit.logAsync(
        {
          eventType: 'EVICTION_OPERATOR_RETRY',
          userId: operatorId,
          operatorId,
          jobId,
          severity: 'WARN',
          outcome: 'SUCCESS',
          details: { jobId, operatorId },
        },
        { session: options.session }
      );

      this.wakeUp();
      return { success: true, message: 'Eviction job queued for immediate retry.' };
    }

    if (txSupported) {
      const session = await mongoose.startSession();
      try {
        let jobUpdated = false;
        await session.withTransaction(async () => {
          const res = await LiveKitEvictionJob.updateOne(
            {
              jobId,
              status: { $in: ['ESCALATED', 'FAILED'] },
            },
            {
              $set: {
                status: 'PENDING',
                attempts: 0,
                nextRunAt: now,
                lastError: `Operator ${operatorId} manual retry scheduled at ${now.toISOString()}`,
                escalatedAt: null,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
            },
            { session }
          );

          if (res.modifiedCount === 0) {
            return;
          }
          jobUpdated = true;

          // Commit audit entry atomically in the same transaction session
          await securityAudit.logAsync(
            {
              eventType: 'EVICTION_OPERATOR_RETRY',
              userId: operatorId,
              operatorId,
              jobId,
              severity: 'WARN',
              outcome: 'SUCCESS',
              details: { jobId, operatorId },
            },
            { session }
          );
        });

        if (jobUpdated) {
          logger.info('[LiveKitEvictionWorker] Operator manually reset eviction job for retry (transactional)', {
            metadata: { jobId, operatorId },
          });
          this.wakeUp();
          return { success: true, message: 'Eviction job queued for immediate retry.' };
        }
        return { success: false, message: 'Job not found or not in ESCALATED/FAILED status.' };
      } finally {
        await session.endSession();
      }
    } else {
      // Standalone fallback when requireTransactions is false (e.g. unit test environment)
      const existing = await LiveKitEvictionJob.findOne({
        jobId,
        status: { $in: ['ESCALATED', 'FAILED'] },
      }).lean();

      if (!existing) {
        return { success: false, message: 'Job not found or not in ESCALATED/FAILED status.' };
      }

      const res = await LiveKitEvictionJob.updateOne(
        {
          _id: existing._id,
          status: existing.status,
        },
        {
          $set: {
            status: 'PENDING',
            attempts: 0,
            nextRunAt: now,
            lastError: `Operator ${operatorId} manual retry scheduled at ${now.toISOString()}`,
            escalatedAt: null,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }
      );

      if (res.modifiedCount === 0) {
        return { success: false, message: 'Job not found or not in ESCALATED/FAILED status.' };
      }

      try {
        await securityAudit.logAsync({
          eventType: 'EVICTION_OPERATOR_RETRY',
          userId: operatorId,
          operatorId,
          jobId,
          severity: 'WARN',
          outcome: 'SUCCESS',
          details: { jobId, operatorId },
        });
      } catch (auditErr) {
        // Rollback job status to avoid partial commit
        await LiveKitEvictionJob.updateOne(
          { _id: existing._id, status: 'PENDING' },
          {
            $set: {
              status: existing.status,
              attempts: existing.attempts,
              nextRunAt: existing.nextRunAt,
              lastError: existing.lastError,
              escalatedAt: existing.escalatedAt,
            },
          }
        );
        logger.error('[LiveKitEvictionWorker] Audit persistence failed during operator retry; rolled back job state', {
          metadata: { jobId, operatorId, error: auditErr instanceof Error ? auditErr.message : String(auditErr) },
        });
        throw auditErr;
      }

      logger.info('[LiveKitEvictionWorker] Operator manually reset eviction job for retry', {
        metadata: { jobId, operatorId },
      });
      this.wakeUp();
      return { success: true, message: 'Eviction job queued for immediate retry.' };
    }
  }
}

export const livekitEvictionWorker = new LiveKitEvictionWorker();
