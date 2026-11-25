import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { ScheduledReminder } from '../models/ScheduledReminder.model.js';
import { Meeting, type IMeeting } from '../models/Meeting.model.js';
import { notificationService } from './notification.service.js';
import { logger } from '../utils/logger.js';

export class ReminderWorkerService {
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;
  private pollIntervalMs = 30_000;
  private maxIdlePollIntervalMs = 60_000;
  private currentPollDelayMs = 30_000;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Generates durable, database-backed reminder documents for a scheduled meeting.
   * Uses unique compound index (meetingId, userId, triggerMinutesBefore) to strictly prevent duplicates.
   */
  async generateRemindersForMeeting(meeting: IMeeting): Promise<number> {
    if (!meeting.scheduledStartAt || meeting.status === 'CANCELLED' || meeting.status === 'ENDED') {
      return 0;
    }

    const preferences =
      Array.isArray(meeting.reminderPreferences) && meeting.reminderPreferences.length > 0
        ? meeting.reminderPreferences
        : [15, 60];

    const targetUserIds = new Set<string>();
    targetUserIds.add(meeting.hostId.toString());

    if (Array.isArray(meeting.invitees)) {
      for (const inv of meeting.invitees) {
        if (inv.userId) {
          targetUserIds.add(inv.userId.toString());
        }
      }
    }

    const now = Date.now();
    let createdCount = 0;

    for (const userIdStr of targetUserIds) {
      const userObjId = new Types.ObjectId(userIdStr);

      for (const minutesBefore of preferences) {
        const remindAtTime = meeting.scheduledStartAt.getTime() - minutesBefore * 60 * 1000;
        // Do not generate reminders that are already in the past
        if (remindAtTime <= now) continue;

        const remindAt = new Date(remindAtTime);

        try {
          await ScheduledReminder.updateOne(
            {
              meetingId: meeting._id,
              userId: userObjId,
              triggerMinutesBefore: minutesBefore,
            },
            {
              $setOnInsert: {
                meetingId: meeting._id,
                userId: userObjId,
                remindAt,
                triggerMinutesBefore: minutesBefore,
                status: 'PENDING',
              },
            },
            { upsert: true }
          );
          createdCount++;
        } catch (err: any) {
          // Ignore duplicate key errors (code 11000) under concurrent scheduling
          if (err?.code !== 11000) {
            logger.warn(
              `[ReminderWorker] Failed to create reminder for meeting ${meeting.meetingCode}: ${err?.message}`
            );
          }
        }
      }
    }

    if (createdCount > 0) {
      this.resetBackoff();
    }

    return createdCount;
  }

  /**
   * Cancels all pending or active reminders for a cancelled meeting.
   */
  async cancelRemindersForMeeting(meetingId: Types.ObjectId | string): Promise<number> {
    const meetingObjId = new Types.ObjectId(meetingId);
    const res = await ScheduledReminder.updateMany(
      {
        meetingId: meetingObjId,
        status: { $in: ['PENDING', 'CLAIMED'] },
      },
      {
        $set: {
          status: 'CANCELLED',
        },
      }
    );
    return res.modifiedCount;
  }

  /**
   * Atomically invalidates previous reminders and generates new ones for a rescheduled meeting.
   */
  async rescheduleRemindersForMeeting(meeting: IMeeting): Promise<number> {
    await this.cancelRemindersForMeeting(meeting._id);
    return this.generateRemindersForMeeting(meeting);
  }

  /**
   * Multi-instance lease claim & dispatch with monotonic fencing tokens.
   * Atomically claims due reminders using findOneAndUpdate with lease duration and claimFenceVersion
   * to prevent duplicate delivery and prevent stale workers from overwriting newer worker states.
   */
  async processDueReminders(batchLimit = 20): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    const now = new Date();
    // 60-second lease protects against dead worker instances
    const leaseExpiry = new Date(now.getTime() - 60_000);

    try {
      for (let i = 0; i < batchLimit; i++) {
        const reminder = await ScheduledReminder.findOneAndUpdate(
          {
            $or: [
              { status: 'PENDING', remindAt: { $lte: now } },
              { status: 'CLAIMED', claimedAt: { $lte: leaseExpiry } },
              { status: 'FAILED', retryCount: { $lt: 3 }, remindAt: { $lte: now } },
            ],
          },
          {
            $set: {
              status: 'CLAIMED',
              claimedAt: now,
              claimedBy: this.workerId,
            },
            $inc: {
              claimFenceVersion: 1,
            },
          },
          { new: true }
        );

        if (!reminder) {
          // No more due reminders
          break;
        }

        // Verify meeting lifecycle status before delivery
        const meeting = await Meeting.findById(reminder.meetingId).select(
          'meetingCode title status scheduledStartAt'
        );

        if (!meeting || meeting.status === 'CANCELLED' || meeting.status === 'ENDED') {
          await ScheduledReminder.updateOne(
            {
              _id: reminder._id,
              status: 'CLAIMED',
              claimedBy: this.workerId,
              claimFenceVersion: reminder.claimFenceVersion,
            },
            { $set: { status: 'CANCELLED' } }
          );
          continue;
        }

        const deliveryKey = `reminder:${reminder._id}:${reminder.userId}:${reminder.triggerMinutesBefore}`;

        try {
          const title = `Reminder: ${meeting.title}`;
          const message = `Your meeting "${meeting.title}" is scheduled to start in ${reminder.triggerMinutesBefore} minutes.`;

          await notificationService.createNotification({
            userId: reminder.userId,
            type: 'MEETING_REMINDER',
            title,
            message,
            meetingId: meeting._id,
            meetingCode: meeting.meetingCode,
            deliveryKey,
            metadata: {
              scheduledStartAt: meeting.scheduledStartAt,
              triggerMinutesBefore: reminder.triggerMinutesBefore,
            },
          });

          // Conditional transition strictly requiring current worker claim ownership and fencing token
          const result = await ScheduledReminder.updateOne(
            {
              _id: reminder._id,
              status: 'CLAIMED',
              claimedBy: this.workerId,
              claimFenceVersion: reminder.claimFenceVersion,
            },
            {
              $set: {
                status: 'SENT',
                sentAt: new Date(),
                error: null,
              },
            }
          );

          if (result.modifiedCount > 0) {
            processedCount++;
          } else {
            logger.warn(
              `[ReminderWorker] Lease lost for reminder ${reminder._id} during dispatch. State transition to SENT aborted.`
            );
          }
        } catch (deliveryError: any) {
          logger.error(
            `[ReminderWorker] Failed to deliver reminder ${reminder._id}: ${deliveryError?.message}`
          );
          const currentRetries = reminder.retryCount || 0;
          const nextRetryCount = currentRetries + 1;
          const isTerminalFailure = nextRetryCount >= 3;

          await ScheduledReminder.updateOne(
            {
              _id: reminder._id,
              status: 'CLAIMED',
              claimedBy: this.workerId,
              claimFenceVersion: reminder.claimFenceVersion,
            },
            {
              $set: {
                status: isTerminalFailure ? 'FAILED' : 'PENDING',
                remindAt: isTerminalFailure ? reminder.remindAt : new Date(Date.now() + 30_000), // 30s backoff
                claimedAt: null,
                claimedBy: null,
                error: String(deliveryError?.message || 'Delivery error').slice(0, 500),
              },
              $inc: {
                retryCount: 1,
              },
            }
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  /**
   * Starts periodic polling in background with adaptive backoff.
   */
  start(pollIntervalMs = 30_000, maxIdlePollIntervalMs = 60_000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollIntervalMs = pollIntervalMs;
    this.maxIdlePollIntervalMs = maxIdlePollIntervalMs;
    this.currentPollDelayMs = pollIntervalMs;
    this.scheduleNextSweep(this.pollIntervalMs);
  }

  public resetBackoff(triggerImmediate = false): void {
    this.currentPollDelayMs = this.pollIntervalMs;
    if (!this.isRunning) return;
    if (triggerImmediate) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.processDueReminders().catch(() => {});
      this.scheduleNextSweep(this.pollIntervalMs);
    }
  }

  private scheduleNextSweep(delayMs?: number): void {
    if (!this.isRunning) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delay = delayMs ?? this.currentPollDelayMs;
    this.timer = setTimeout(async () => {
      if (!this.isRunning) return;
      try {
        const processed = await this.processDueReminders();
        if (processed > 0) {
          this.currentPollDelayMs = this.pollIntervalMs;
        } else {
          this.currentPollDelayMs = Math.min(
            this.currentPollDelayMs * 1.5,
            this.maxIdlePollIntervalMs
          );
        }
      } catch (err) {
        logger.error(`[ReminderWorker] Polling error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (this.isRunning) {
          this.scheduleNextSweep(this.currentPollDelayMs);
        }
      }
    }, delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops background polling cleanly.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export const reminderWorker = new ReminderWorkerService();
