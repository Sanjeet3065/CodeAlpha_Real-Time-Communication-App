/**
 * CONNECTLY Phase 13 — Production File Cleanup Worker Service
 * Automatically running background service that enforces:
 * - Distributed atomic claims with 5-minute renewable leases (prevents multi-instance conflicts)
 * - Safe lease recovery after worker/process crashes
 * - Pre-deletion re-verification (AVAILABLE files are NEVER deleted by expired PENDING cleanup)
 * - Resilient retry of failed storage deletions up to 5 attempts with observable terminal failure state
 * - Orphaned local temporary upload recovery across process crashes and restarts
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SharedFile } from '../models/SharedFile.model.js';
import { getStorageProvider } from '../storage/storageFactory.js';
import type { IStorageProvider } from '../storage/storageProvider.interface.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const CLEANUP_LEASE_DURATION_MS = 5 * 60 * 1000; // 5-minute distributed lease
export const CLEANUP_INTERVAL_MS = 60 * 1000; // 1-minute sweep interval
export const MAX_CLEANUP_RETRIES = 5;
export const ORPHANED_TEMP_FILE_AGE_MS = 60 * 60 * 1000; // 1 hour max age for abandoned temp files

export interface CleanupCycleReport {
  workerId: string;
  expiredPendingClaimed: number;
  expiredPendingCleaned: number;
  failedDeletionsClaimed: number;
  failedDeletionsSucceeded: number;
  failedDeletionsTerminated: number;
  orphanedTempFilesRemoved: number;
}

export class FileCleanupWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId: string;
  private _storageProvider: IStorageProvider | null = null;

  constructor(customStorage?: IStorageProvider) {
    this.workerId = `worker_${crypto.randomUUID().slice(0, 8)}`;
    if (customStorage) {
      this._storageProvider = customStorage;
    }
  }

  private get storageProvider(): IStorageProvider {
    if (!this._storageProvider) {
      this._storageProvider = getStorageProvider();
    }
    return this._storageProvider;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public getStatus(): { isRunning: boolean; workerId: string } {
    return {
      isRunning: this.isRunning,
      workerId: this.workerId,
    };
  }

  /**
   * Starts the background cleanup worker service and schedules periodic sweeps.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    if (!env.ENABLE_FILE_SHARING || env.STORAGE_PROVIDER === 'disabled') {
      logger.info('[FileCleanupWorker] File sharing is disabled; background file cleanup worker is inactive.', {
        metadata: { workerId: this.workerId },
      });
      return;
    }
    this.isRunning = true;

    logger.info('[FileCleanupWorker] Starting background file cleanup service', {
      metadata: { workerId: this.workerId },
    });

    // Initial crash recovery and reconciliation sweep
    await this.recoverOrphanedTempDiskFiles().catch((err) => {
      logger.warn('[FileCleanupWorker] Startup temp file recovery encountered an error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    await this.runCleanupCycle().catch((err) => {
      logger.error('[FileCleanupWorker] Initial cleanup cycle failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Schedule periodic sweeps
    this.timer = setInterval(() => {
      if (!this.isRunning) return;
      this.runCleanupCycle().catch((err) => {
        logger.error('[FileCleanupWorker] Scheduled cleanup cycle error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, CLEANUP_INTERVAL_MS);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Gracefully shuts down the background cleanup worker service.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    logger.info('[FileCleanupWorker] Stopped background file cleanup service', {
      metadata: { workerId: this.workerId },
    });
  }

  /**
   * Recovers orphaned temporary upload files left in the temp directory from prior crashes.
   */
  public async recoverOrphanedTempDiskFiles(): Promise<number> {
    const uploadDir = path.join(os.tmpdir(), 'connectly_uploads');
    let removedCount = 0;

    try {
      if (!fs.existsSync(uploadDir)) {
        return 0;
      }

      const files = await fs.promises.readdir(uploadDir);
      const now = Date.now();

      for (const file of files) {
        const fullPath = path.join(uploadDir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (now - stat.mtimeMs > ORPHANED_TEMP_FILE_AGE_MS) {
            await fs.promises.unlink(fullPath);
            removedCount += 1;
          }
        } catch {
          // File might have been cleaned up by another thread
        }
      }

      if (removedCount > 0) {
        logger.info('[FileCleanupWorker] Recovered orphaned temporary upload files', {
          metadata: { removedCount },
        });
      }
    } catch (err) {
      logger.warn('[FileCleanupWorker] Failed scanning temporary upload directory', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return removedCount;
  }

  /**
   * Executes a single atomic cleanup cycle across expired pending uploads and failed deletions.
   */
  public async runCleanupCycle(): Promise<CleanupCycleReport> {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - CLEANUP_LEASE_DURATION_MS);

    const report: CleanupCycleReport = {
      workerId: this.workerId,
      expiredPendingClaimed: 0,
      expiredPendingCleaned: 0,
      failedDeletionsClaimed: 0,
      failedDeletionsSucceeded: 0,
      failedDeletionsTerminated: 0,
      orphanedTempFilesRemoved: 0,
    };

    // 1. Clean up expired PENDING uploads using distributed atomic claims with state transition to CLEANING (DEF-13-12)
    const pendingCandidates = await SharedFile.find({
      $or: [
        { status: 'PENDING', pendingExpiresAt: { $lt: now } },
        { status: 'CLEANING', cleanupClaimedAt: { $lt: leaseCutoff } }, // Recover crashed worker leases
      ],
      isDeleted: false,
    }).limit(50);

    for (const candidate of pendingCandidates) {
      const claimToken = crypto.randomUUID();

      // Atomic claim transitioning PENDING/stale CLEANING -> CLEANING with unique claimToken
      const claimed = await SharedFile.findOneAndUpdate(
        {
          _id: candidate._id,
          $or: [
            {
              status: 'PENDING',
              pendingExpiresAt: { $lt: now },
              $or: [
                { cleanupClaimedAt: null },
                { cleanupClaimedAt: { $lt: leaseCutoff } },
              ],
            },
            {
              status: 'CLEANING',
              cleanupClaimedAt: { $lt: leaseCutoff },
            },
          ],
          isDeleted: false,
        },
        {
          $set: {
            status: 'CLEANING',
            cleanupClaimedAt: now,
            cleanupClaimedBy: this.workerId,
            cleanupClaimToken: claimToken,
          },
        },
        { new: true }
      );

      if (!claimed) continue;
      report.expiredPendingClaimed += 1;

      // PRE-DELETION CHECK: Verify claimToken is still valid and has not been recovered or superseded
      const activeClaim = await SharedFile.findOne({
        _id: claimed._id,
        status: 'CLEANING',
        cleanupClaimToken: claimToken,
      });

      if (!activeClaim) {
        logger.warn('[FileCleanupWorker] Worker lost claim or file status changed; aborting storage deletion', {
          metadata: { fileId: claimed._id.toString(), workerId: this.workerId },
        });
        continue;
      }

      // Safe to purge physical storage object
      try {
        await this.storageProvider.deleteObject(claimed.storageKey, claimed.versionId || undefined);
      } catch (storageErr) {
        logger.warn('[FileCleanupWorker] Non-fatal error deleting storage object during pending cleanup', {
          metadata: { fileId: claimed._id.toString(), error: storageErr instanceof Error ? storageErr.message : String(storageErr) },
        });
      }

      // Finalize atomic transition from CLEANING to FAILED & CLEANED matching the exact claimToken fence
      const finalized = await SharedFile.updateOne(
        {
          _id: claimed._id,
          status: 'CLEANING',
          cleanupClaimToken: claimToken,
        },
        {
          $set: {
            status: 'FAILED',
            cleanupStatus: 'CLEANED',
            cleanupClaimedAt: null,
            cleanupClaimedBy: null,
            cleanupClaimToken: null,
          },
        }
      );

      if (finalized.modifiedCount > 0) {
        report.expiredPendingCleaned += 1;
      }
    }

    // 2. Retry failed storage deletions with distributed atomic claims
    const failedCandidates = await SharedFile.find({
      cleanupStatus: 'STORAGE_DELETE_FAILED',
      cleanupRetries: { $lt: MAX_CLEANUP_RETRIES },
      $or: [
        { cleanupClaimedAt: null },
        { cleanupClaimedAt: { $lt: leaseCutoff } },
      ],
    }).limit(50);

    for (const candidate of failedCandidates) {
      const claimed = await SharedFile.findOneAndUpdate(
        {
          _id: candidate._id,
          cleanupStatus: 'STORAGE_DELETE_FAILED',
          cleanupRetries: { $lt: MAX_CLEANUP_RETRIES },
          $or: [
            { cleanupClaimedAt: null },
            { cleanupClaimedAt: { $lt: leaseCutoff } },
          ],
        },
        {
          $set: {
            cleanupClaimedAt: now,
            cleanupClaimedBy: this.workerId,
          },
        },
        { new: true }
      );

      if (!claimed) continue;
      report.failedDeletionsClaimed += 1;

      try {
        await this.storageProvider.deleteObject(
          claimed.storageKey,
          claimed.versionId || undefined
        );

        claimed.cleanupStatus = 'CLEANED';
        claimed.cleanupClaimedAt = null;
        claimed.cleanupClaimedBy = null;
        claimed.cleanupLastError = null;
        await claimed.save();
        report.failedDeletionsSucceeded += 1;
      } catch (err: unknown) {
        const nextRetries = claimed.cleanupRetries + 1;
        claimed.cleanupRetries = nextRetries;
        claimed.cleanupLastError = err instanceof Error ? err.message : String(err);
        claimed.cleanupClaimedAt = null;
        claimed.cleanupClaimedBy = null;

        if (nextRetries >= MAX_CLEANUP_RETRIES) {
          // Observable terminal failure state
          claimed.cleanupStatus = 'STORAGE_DELETE_TERMINAL_FAILED';
          report.failedDeletionsTerminated += 1;
          logger.error('[FileCleanupWorker] Storage deletion reached terminal failure state', {
            metadata: {
              fileId: claimed._id.toString(),
              retries: nextRetries,
              error: claimed.cleanupLastError,
            },
          });
        }
        await claimed.save();
      }
    }

    return report;
  }
}

export const fileCleanupWorker = new FileCleanupWorker();
