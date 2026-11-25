import crypto from 'node:crypto';
import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ParticipantRole = 'host' | 'co-host' | 'participant';

export type AdmissionStatus =
  | 'WAITING'
  | 'ADMITTED'
  | 'REJECTED'
  | 'LEFT'
  | 'REMOVED'
  | 'CANCELLED';

export type PresenceStatus = 'ONLINE' | 'OFFLINE';

/**
 * Generates a cryptographically random 12-character lowercase hex session token.
 * Note: Session-scoped identities use `usr_<userId>_<sessionId>`. Parsers match alphanumeric
 * strings `[a-zA-Z0-9]+` (such as 12-hex, 16-hex, or un-hyphenated 32-hex). Standard RFC 4122
 * hyphenated UUIDs contain hyphens and would return null; production strictly uses 12-hex.
 */
export function generateAdmissionSessionId(): string {
  return crypto.randomBytes(6).toString('hex'); // 12-char lowercase hex
}

export interface IMeetingParticipant extends Document {
  meetingId: Types.ObjectId;
  userId: Types.ObjectId;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  role: ParticipantRole;
  admissionStatus: AdmissionStatus;
  presenceStatus: PresenceStatus;
  admissionSessionId?: string | null;
  requestedAt: Date;
  admittedAt?: Date | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  rejectionReason?: string | null;
  removalReason?: string | null;
  tokenEpoch: number;
  tokenRevokedBefore?: Date | null;
  signalFenceVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingParticipantSchema = new Schema<IMeetingParticipant>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      required: true,
      enum: ['host', 'co-host', 'participant'],
      default: 'participant',
    },
    admissionStatus: {
      type: String,
      required: true,
      enum: ['WAITING', 'ADMITTED', 'REJECTED', 'LEFT', 'REMOVED', 'CANCELLED'],
      default: 'WAITING',
    },
    presenceStatus: {
      type: String,
      required: true,
      enum: ['ONLINE', 'OFFLINE'],
      default: 'OFFLINE',
    },
    admissionSessionId: {
      type: String,
      default: null,
      trim: true,
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    admittedAt: {
      type: Date,
      default: null,
    },
    joinedAt: {
      type: Date,
      default: null,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      maxlength: 200,
      default: null,
    },
    removalReason: {
      type: String,
      maxlength: 200,
      default: null,
    },
    tokenEpoch: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    tokenRevokedBefore: {
      type: Date,
      default: null,
    },
    signalFenceVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    collection: 'meeting_participants',
    timestamps: true,
  }
);

// Unique compound index strictly enforces 1 active/tracked record per user per meeting,
// preventing duplicate participant entries under concurrent joins or reconnections.
MeetingParticipantSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
MeetingParticipantSchema.index({ meetingId: 1, admissionStatus: 1, joinedAt: 1 });
MeetingParticipantSchema.index({ meetingId: 1, admissionStatus: 1, requestedAt: 1 });
MeetingParticipantSchema.index({ userId: 1, admissionStatus: 1 });

export const MeetingParticipant: Model<IMeetingParticipant> =
  mongoose.models.MeetingParticipant ||
  mongoose.model<IMeetingParticipant>('MeetingParticipant', MeetingParticipantSchema);
