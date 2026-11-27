import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type MeetingLifecycleStatus =
  | 'CREATED'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface IMeetingInvitee {
  email: string;
  userId?: Types.ObjectId | null;
  name?: string | null;
}

export interface IMeetingSettings {
  waitingRoomEnabled: boolean;
  allowCoHostAdmit: boolean;
  allowCoHostRemove: boolean;
  allowCoHostLock: boolean;
}

export interface IMeetingAuditEntry {
  action:
    | 'CREATED'
    | 'SCHEDULED'
    | 'ACTIVATED'
    | 'RESCHEDULED'
    | 'CANCELLED'
    | 'LOCKED'
    | 'UNLOCKED'
    | 'SETTINGS_UPDATED'
    | 'PARTICIPANT_ADMITTED'
    | 'PARTICIPANT_REJECTED'
    | 'PARTICIPANT_REMOVED'
    | 'ROLE_UPDATED'
    | 'HOST_TRANSFERRED'
    | 'ENDED'
    | 'EXPIRED';
  actorId: Types.ObjectId;
  targetUserId?: Types.ObjectId | null;
  details?: string;
  timestamp: Date;
}

export interface IMeeting extends Document {
  meetingCode: string;
  title: string;
  description?: string | null;
  hostId: Types.ObjectId;
  originalHostId: Types.ObjectId;
  status: MeetingLifecycleStatus;
  isLocked: boolean;
  maxParticipants: number;
  activeParticipantCount: number;
  settings: IMeetingSettings;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  scheduledTimeZone?: string | null;
  scheduledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancellationReason?: string | null;
  invitees: IMeetingInvitee[];
  reminderPreferences: number[];
  scheduleVersion: number;
  version: number;
  activatedAt?: Date | null;
  endedAt?: Date | null;
  expiresAt: Date;
  auditLog: IMeetingAuditEntry[];
  historyHiddenBy: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const MeetingSettingsSchema = new Schema<IMeetingSettings>(
  {
    waitingRoomEnabled: { type: Boolean, required: true, default: false },
    allowCoHostAdmit: { type: Boolean, required: true, default: true },
    allowCoHostRemove: { type: Boolean, required: true, default: true },
    allowCoHostLock: { type: Boolean, required: true, default: false },
  },
  { _id: false }
);

const MeetingInviteeSchema = new Schema<IMeetingInvitee>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
  },
  { _id: false }
);

const MeetingAuditEntrySchema = new Schema<IMeetingAuditEntry>(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'CREATED',
        'SCHEDULED',
        'ACTIVATED',
        'RESCHEDULED',
        'CANCELLED',
        'LOCKED',
        'UNLOCKED',
        'SETTINGS_UPDATED',
        'PARTICIPANT_ADMITTED',
        'PARTICIPANT_REJECTED',
        'PARTICIPANT_REMOVED',
        'ROLE_UPDATED',
        'HOST_TRANSFERRED',
        'ENDED',
        'EXPIRED',
      ],
    },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    details: { type: String, maxlength: 240 },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const MeetingSchema = new Schema<IMeeting>(
  {
    meetingCode: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^cly-[a-z0-9]{3}-[a-z0-9]{3}$/,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
      default: 'Instant Meeting',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    hostId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    originalHostId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['CREATED', 'SCHEDULED', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED'],
      default: 'CREATED',
    },
    isLocked: {
      type: Boolean,
      required: true,
      default: false,
    },
    maxParticipants: {
      type: Number,
      required: true,
      min: 2,
      max: 60,
      default: 60,
    },
    activeParticipantCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    settings: {
      type: MeetingSettingsSchema,
      required: true,
      default: () => ({
        waitingRoomEnabled: false,
        allowCoHostAdmit: true,
        allowCoHostRemove: true,
        allowCoHostLock: false,
      }),
    },
    scheduledStartAt: {
      type: Date,
      default: null,
    },
    scheduledEndAt: {
      type: Date,
      default: null,
    },
    scheduledTimeZone: {
      type: String,
      trim: true,
      maxlength: 50,
      default: 'UTC',
    },
    scheduledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
    },
    invitees: {
      type: [MeetingInviteeSchema],
      default: () => [],
    },
    reminderPreferences: {
      type: [Number],
      default: () => [15, 60],
    },
    scheduleVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    auditLog: {
      type: [MeetingAuditEntrySchema],
      default: () => [],
    },
    historyHiddenBy: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: () => [],
    },
  },
  {
    collection: 'meetings',
    timestamps: true,
  }
);

MeetingSchema.index({ hostId: 1, status: 1 });
MeetingSchema.index({ status: 1, expiresAt: 1 });
MeetingSchema.index({ hostId: 1, scheduledStartAt: 1, status: 1 });
MeetingSchema.index({ status: 1, scheduledStartAt: 1 });
MeetingSchema.index({ 'invitees.email': 1, status: 1 });
MeetingSchema.index({ 'invitees.userId': 1, status: 1 });
MeetingSchema.index({ hostId: 1, endedAt: -1 });
MeetingSchema.index({ hostId: 1, createdAt: -1 });

export const Meeting: Model<IMeeting> =
  mongoose.models.Meeting || mongoose.model<IMeeting>('Meeting', MeetingSchema);
