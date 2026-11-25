import crypto from 'node:crypto';
import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type LiveKitEvictionJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED';

export interface ILiveKitEvictionJob extends Document {
  jobId: string;
  meetingId: Types.ObjectId;
  meetingCode: string;
  userId: Types.ObjectId;
  identity: string;
  sessionId?: string | null;
  epoch: number;
  status: LiveKitEvictionJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lastError?: string | null;
  leaseOwner?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
  completedAt?: Date | null;
  escalatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function generateEvictionJobId(
  meetingId: string | Types.ObjectId,
  userId: string | Types.ObjectId,
  epoch: number,
  sessionId?: string | null
): string {
  const mId = typeof meetingId === 'string' ? meetingId : meetingId.toString();
  const uId = typeof userId === 'string' ? userId : userId.toString();
  const sId = sessionId ? sessionId.trim().toLowerCase() : '';
  return crypto
    .createHash('sha256')
    .update(`${mId.toLowerCase().trim()}:${uId.toLowerCase().trim()}:${epoch}${sId ? ':' + sId : ''}`)
    .digest('hex');
}

export function sanitizeEvictionError(err: unknown): string {
  if (!err) return 'Unknown eviction error';
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s/]+):([^@\s/]+)@/g, '$1[REDACTED]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .slice(0, 500);
}

const LiveKitEvictionJobSchema = new Schema<ILiveKitEvictionJob>(
  {
    jobId: {
      type: String,
      required: true,
      trim: true,
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
    },
    meetingCode: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    identity: {
      type: String,
      required: true,
      trim: true,
    },
    sessionId: {
      type: String,
      default: null,
      trim: true,
    },
    epoch: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ESCALATED'],
      default: 'PENDING',
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    nextRunAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastError: {
      type: String,
      default: null,
      maxlength: 500,
    },
    leaseOwner: {
      type: String,
      default: null,
    },
    leaseToken: {
      type: String,
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    escalatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'livekit_eviction_jobs',
    timestamps: true,
    versionKey: false,
  }
);

LiveKitEvictionJobSchema.index({ jobId: 1 }, { unique: true, name: 'jobId_unique' });
LiveKitEvictionJobSchema.index(
  { status: 1, nextRunAt: 1, leaseExpiresAt: 1 },
  { name: 'eviction_job_acquisition' }
);
LiveKitEvictionJobSchema.index(
  { meetingId: 1, userId: 1, epoch: 1 },
  { name: 'meeting_user_epoch' }
);

export const LiveKitEvictionJob: Model<ILiveKitEvictionJob> =
  mongoose.models.LiveKitEvictionJob ||
  mongoose.model<ILiveKitEvictionJob>('LiveKitEvictionJob', LiveKitEvictionJobSchema);

export async function ensureLiveKitEvictionJobReady(): Promise<void> {
  await LiveKitEvictionJob.init().catch(() => {});
}
