import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ReminderStatus = 'PENDING' | 'CLAIMED' | 'SENT' | 'CANCELLED' | 'FAILED';

export interface IScheduledReminder extends Document {
  meetingId: Types.ObjectId;
  userId: Types.ObjectId;
  remindAt: Date;
  triggerMinutesBefore: number;
  status: ReminderStatus;
  claimedAt?: Date | null;
  claimedBy?: string | null;
  claimFenceVersion?: number;
  retryCount?: number;
  sentAt?: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledReminderSchema = new Schema<IScheduledReminder>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    remindAt: {
      type: Date,
      required: true,
      index: true,
    },
    triggerMinutesBefore: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'CLAIMED', 'SENT', 'CANCELLED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    claimedBy: {
      type: String,
      default: null,
    },
    claimFenceVersion: {
      type: Number,
      required: true,
      default: 0,
    },
    retryCount: {
      type: Number,
      required: true,
      default: 0,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: null,
      maxlength: 500,
    },
  },
  {
    collection: 'scheduled_reminders',
    timestamps: true,
  }
);

// Compound index for efficient polling and multi-worker claiming
ScheduledReminderSchema.index({ status: 1, remindAt: 1 });
// Compound index for bulk meeting cancellation / rescheduling
ScheduledReminderSchema.index({ meetingId: 1, status: 1 });
// Unique constraint prevents duplicate reminder triggers for the same user, meeting, and time offset
ScheduledReminderSchema.index(
  { meetingId: 1, userId: 1, triggerMinutesBefore: 1 },
  { unique: true }
);

export const ScheduledReminder: Model<IScheduledReminder> =
  mongoose.models.ScheduledReminder ||
  mongoose.model<IScheduledReminder>('ScheduledReminder', ScheduledReminderSchema);
