import { Types } from 'mongoose';
import { Meeting, type MeetingLifecycleStatus } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { SharedFile } from '../models/SharedFile.model.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { ScheduledReminder } from '../models/ScheduledReminder.model.js';
import { MeetingRealtimeEvent } from '../models/MeetingRealtimeEvent.model.js';
import { Notification } from '../models/Notification.model.js';
import { getStorageProvider } from '../storage/storageFactory.js';
import type { IStorageProvider } from '../storage/storageProvider.interface.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * 2-day (48-hour) retention window for completed/cancelled/expired meeting history.
 * Entering Day 3 (>= 48h past completion/expiry) triggers permanent DB + storage cleanup.
 */
export const MEETING_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;
export const HISTORY_RETENTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export const HISTORICAL_MEETING_STATUSES: ReadonlyArray<MeetingLifecycleStatus> = [
  'ENDED',
  'CANCELLED',
  'EXPIRED',
];

export interface MeetingRetentionTimestampSource {
  status?: string;
  endedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  scheduledEndAt?: Date | string | null;
  activatedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface HistoryPurgeReport {
  purgedMeetingsCount: number;
  purgedFilesCount: number;
  deletedStorageObjectsCount: number;
  cutoffIso: string;
}

function toValidDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  const parsed = val instanceof Date ? val : new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resolves the authoritative age timestamp used for the 48-hour retention check.
 * - For SCHEDULED/CREATED/ACTIVE meetings: uses `expiresAt` first so future or
 *   ongoing rooms are only cleaned when long-abandoned past their expiration window.
 * - For ENDED/CANCELLED/EXPIRED history: uses completion timestamp (`endedAt` or
 *   `cancelledAt`), falling back cleanly for legacy records.
 */
export function resolveMeetingRetentionTimestamp(meeting: MeetingRetentionTimestampSource): Date {
  const status = String(meeting.status || '').toUpperCase();
  if (status === 'SCHEDULED' || status === 'CREATED' || status === 'ACTIVE') {
    return (
      toValidDate(meeting.expiresAt) ??
      toValidDate(meeting.scheduledEndAt) ??
      toValidDate(meeting.updatedAt) ??
      toValidDate(meeting.createdAt) ??
      new Date(0)
    );
  }

  return (
    toValidDate(meeting.endedAt) ??
    toValidDate(meeting.cancelledAt) ??
    toValidDate(meeting.scheduledEndAt) ??
    toValidDate(meeting.activatedAt) ??
    toValidDate(meeting.expiresAt) ??
    toValidDate(meeting.updatedAt) ??
    toValidDate(meeting.createdAt) ??
    new Date(0)
  );
}

export function isMeetingHistoryExpired(
  meeting: MeetingRetentionTimestampSource,
  now: Date = new Date()
): boolean {
  const status = String(meeting.status || '').toUpperCase();
  if (!['ENDED', 'CANCELLED', 'EXPIRED'].includes(status)) {
    return false;
  }
  const cutoffMs = now.getTime() - MEETING_HISTORY_RETENTION_MS;
  return resolveMeetingRetentionTimestamp(meeting).getTime() <= cutoffMs;
}

export class MeetingHistoryRetentionWorker {
  private isRunning = false;
  private isSweeping = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly customStorage?: IStorageProvider;

  constructor(customStorage?: IStorageProvider) {
    this.customStorage = customStorage;
  }

  private resolveStorageProvider(): IStorageProvider | null {
    if (this.customStorage) {
      return this.customStorage;
    }
    if (!env.ENABLE_FILE_SHARING || env.STORAGE_PROVIDER === 'disabled') {
      return null;
    }
    try {
      return getStorageProvider();
    } catch {
      return null;
    }
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public async purgeExpiredMeetingHistory(now: Date = new Date()): Promise<HistoryPurgeReport> {
    const cutoff = new Date(now.getTime() - MEETING_HISTORY_RETENTION_MS);
    const report: HistoryPurgeReport = {
      purgedMeetingsCount: 0,
      purgedFilesCount: 0,
      deletedStorageObjectsCount: 0,
      cutoffIso: cutoff.toISOString(),
    };

    if (this.isSweeping) {
      return report;
    }

    this.isSweeping = true;
    try {
      const candidates = await Meeting.find({
        $or: [
          { status: { $in: [...HISTORICAL_MEETING_STATUSES] } },
          {
            status: { $in: ['SCHEDULED', 'CREATED', 'ACTIVE'] },
            expiresAt: { $lte: cutoff },
          },
        ],
      }).select('_id status endedAt cancelledAt scheduledEndAt activatedAt expiresAt updatedAt createdAt');

      const expiredIds: Types.ObjectId[] = [];
      for (const doc of candidates) {
        const refDate = resolveMeetingRetentionTimestamp(doc);
        if (refDate.getTime() <= cutoff.getTime()) {
          expiredIds.push(doc._id as Types.ObjectId);
        }
      }

      if (expiredIds.length === 0) {
        return report;
      }

      // 1. Best-effort delete associated shared file objects from storage before cascading DB rows
      const sharedFiles = await SharedFile.find({ meetingId: { $in: expiredIds } }).select(
        '_id storageKey versionId'
      );
      report.purgedFilesCount = sharedFiles.length;

      const storageProvider = sharedFiles.length > 0 ? this.resolveStorageProvider() : null;
      if (storageProvider) {
        for (const file of sharedFiles) {
          if (!file.storageKey) continue;
          try {
            const deleted = await storageProvider.deleteObject(
              file.storageKey,
              file.versionId || undefined
            );
            if (deleted) {
              report.deletedStorageObjectsCount += 1;
            }
          } catch (err) {
            logger.warn('[HistoryRetentionWorker] Best-effort storage blob cleanup failed', {
              error: err instanceof Error ? err.message : String(err),
              metadata: { fileId: file._id.toString() },
            });
          }
        }
      }

      // 2. Clean dependent collections explicitly for MongoDB parity (Supabase also has ON DELETE CASCADE)
      const whiteboards = await Whiteboard.find({ meetingId: { $in: expiredIds } }).select('_id');
      const whiteboardIds = whiteboards.map((w) => w._id);

      await Promise.all([
        WhiteboardOperation.deleteMany(
          whiteboardIds.length > 0
            ? { $or: [{ meetingId: { $in: expiredIds } }, { whiteboardId: { $in: whiteboardIds } }] }
            : { meetingId: { $in: expiredIds } }
        ),
        Whiteboard.deleteMany({ meetingId: { $in: expiredIds } }),
        ChatMessage.deleteMany({ meetingId: { $in: expiredIds } }),
        SharedFile.deleteMany({ meetingId: { $in: expiredIds } }),
        MeetingParticipant.deleteMany({ meetingId: { $in: expiredIds } }),
        ScheduledReminder.deleteMany({ meetingId: { $in: expiredIds } }),
        MeetingRealtimeEvent.deleteMany({ meetingId: { $in: expiredIds } }),
        Notification.deleteMany({ meetingId: { $in: expiredIds } }),
      ]);

      // 3. Delete expired meeting documents (cascades child PG rows when Supabase is active)
      const deleteResult = await Meeting.deleteMany({ _id: { $in: expiredIds } });
      report.purgedMeetingsCount = deleteResult.deletedCount ?? expiredIds.length;

      if (report.purgedMeetingsCount > 0) {
        logger.info('[HistoryRetentionWorker] Purged expired >48h meeting history records', {
          metadata: report,
        });
      }

      return report;
    } finally {
      this.isSweeping = false;
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('[HistoryRetentionWorker] Starting 48-hour meeting history auto-retention worker');

    await this.purgeExpiredMeetingHistory().catch((err) => {
      logger.error('[HistoryRetentionWorker] Startup retention sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    this.timer = setInterval(() => {
      if (!this.isRunning) return;
      this.purgeExpiredMeetingHistory().catch((err) => {
        logger.error('[HistoryRetentionWorker] Periodic retention sweep failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, HISTORY_RETENTION_SWEEP_INTERVAL_MS);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[HistoryRetentionWorker] Stopped 48-hour meeting history retention worker');
  }
}

export const meetingHistoryRetentionWorker = new MeetingHistoryRetentionWorker();
