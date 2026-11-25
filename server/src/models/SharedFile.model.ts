import mongoose, { Document, Schema, type Model, type Types } from 'mongoose';
import type { ParticipantRole } from './MeetingParticipant.model.js';

export type FileLifecycleStatus = 'PENDING' | 'UPLOADING' | 'CLEANING' | 'AVAILABLE' | 'FAILED' | 'DELETED';

export interface ISharedFile extends Document {
  meetingId: Types.ObjectId;
  uploaderId: Types.ObjectId;
  uploaderName: string;
  uploaderRole: ParticipantRole;
  uploaderAvatarUrl?: string | null;
  originalFilename: string;
  sanitizedFilename: string;
  storageKey: string;
  storageProvider: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  status: FileLifecycleStatus;
  versionId?: string | null;
  checksumSha256?: string | null;
  pendingExpiresAt?: Date | null;
  cleanupStatus: 'NONE' | 'PENDING_STORAGE_DELETE' | 'STORAGE_DELETE_FAILED' | 'STORAGE_DELETE_TERMINAL_FAILED' | 'CLEANED';
  cleanupRetries: number;
  cleanupClaimedAt?: Date | null;
  cleanupClaimedBy?: string | null;
  cleanupClaimToken?: string | null;
  cleanupLastError?: string | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SharedFileDto {
  id: string;
  meetingId: string;
  meetingCode?: string;
  meetingTitle?: string;
  uploaderId: string;
  uploaderName: string;
  uploaderRole: ParticipantRole;
  uploaderAvatarUrl: string | null;
  originalFilename: string;
  sanitizedFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  status: FileLifecycleStatus;
  versionId?: string | null;
  checksumSha256?: string | null;
  createdAt: string;
}

const SharedFileSchema = new Schema<ISharedFile>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
      index: true,
    },
    uploaderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    uploaderName: {
      type: String,
      required: true,
      trim: true,
    },
    uploaderRole: {
      type: String,
      enum: ['host', 'co-host', 'participant'],
      required: true,
    },
    uploaderAvatarUrl: {
      type: String,
      default: null,
    },
    originalFilename: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    sanitizedFilename: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    storageProvider: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    extension: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['PENDING', 'UPLOADING', 'CLEANING', 'AVAILABLE', 'FAILED', 'DELETED'],
      default: 'PENDING',
      index: true,
    },
    versionId: {
      type: String,
      default: null,
      trim: true,
    },
    checksumSha256: {
      type: String,
      default: null,
      trim: true,
    },
    pendingExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    cleanupStatus: {
      type: String,
      enum: [
        'NONE',
        'PENDING_STORAGE_DELETE',
        'STORAGE_DELETE_FAILED',
        'STORAGE_DELETE_TERMINAL_FAILED',
        'CLEANED',
      ],
      default: 'NONE',
      index: true,
    },
    cleanupRetries: {
      type: Number,
      default: 0,
    },
    cleanupClaimedAt: {
      type: Date,
      default: null,
      index: true,
    },
    cleanupClaimedBy: {
      type: String,
      default: null,
    },
    cleanupClaimToken: {
      type: String,
      default: null,
    },
    cleanupLastError: {
      type: String,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes for meeting file listing & dashboard downloads
SharedFileSchema.index({ meetingId: 1, isDeleted: 1, createdAt: -1 });
SharedFileSchema.index({ meetingId: 1, isDeleted: 1, status: 1, createdAt: -1 });
SharedFileSchema.index({ uploaderId: 1, isDeleted: 1, createdAt: -1 });
SharedFileSchema.index({ status: 1, isDeleted: 1, pendingExpiresAt: 1, cleanupClaimedAt: 1 });
SharedFileSchema.index({ cleanupStatus: 1, cleanupRetries: 1, cleanupClaimedAt: 1 });
SharedFileSchema.index({ storageKey: 1, versionId: 1 });

export function toSharedFileDto(
  doc: ISharedFile,
  metadata?: { meetingCode?: string; meetingTitle?: string }
): SharedFileDto {
  return {
    id: doc._id.toString(),
    meetingId: doc.meetingId.toString(),
    meetingCode: metadata?.meetingCode,
    meetingTitle: metadata?.meetingTitle,
    uploaderId: doc.uploaderId.toString(),
    uploaderName: doc.uploaderName,
    uploaderRole: doc.uploaderRole,
    uploaderAvatarUrl: doc.uploaderAvatarUrl || null,
    originalFilename: doc.originalFilename,
    sanitizedFilename: doc.sanitizedFilename,
    mimeType: doc.mimeType,
    extension: doc.extension,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    versionId: doc.versionId || null,
    checksumSha256: doc.checksumSha256 || null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export const SharedFile: Model<ISharedFile> =
  mongoose.models.SharedFile || mongoose.model<ISharedFile>('SharedFile', SharedFileSchema);
