import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { ParticipantRole } from './MeetingParticipant.model.js';
import { cryptoEngine } from '../utils/crypto.js';

export interface IChatMessage extends Document {
  meetingId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderName: string;
  senderRole: ParticipantRole;
  senderAvatarUrl?: string | null;
  content: string;
  clientMessageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageDto {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  senderAvatarUrl?: string | null;
  content: string;
  clientMessageId?: string | null;
  createdAt: string;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    senderRole: {
      type: String,
      enum: ['host', 'co-host', 'participant'],
      required: true,
    },
    senderAvatarUrl: {
      type: String,
      default: null,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 10000,
      get: function (this: any, val: string) {
        if (!val || typeof val !== 'string') return val;
        if (cryptoEngine.isEncrypted(val)) {
          const meetingIdStr = this?.meetingId ? this.meetingId.toString() : '';
          return cryptoEngine.decryptString(val, {
            aad: meetingIdStr ? `chat:${meetingIdStr}` : undefined,
          });
        }
        return val;
      },
    },
    clientMessageId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Compound index for deterministic keyset pagination and chronological message retrieval
ChatMessageSchema.index({ meetingId: 1, createdAt: -1, _id: -1 });

// Compound index for idempotency per meeting
ChatMessageSchema.index(
  { meetingId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }
);

export function toChatMessageDto(doc: IChatMessage): ChatMessageDto {
  let content = doc.content;
  if (cryptoEngine.isEncrypted(content)) {
    const meetingIdStr = doc.meetingId ? doc.meetingId.toString() : '';
    content = cryptoEngine.decryptString(content, {
      aad: meetingIdStr ? `chat:${meetingIdStr}` : undefined,
    });
  }

  return {
    id: doc._id.toString(),
    meetingId: doc.meetingId.toString(),
    senderId: doc.senderId.toString(),
    senderName: doc.senderName,
    senderRole: doc.senderRole,
    senderAvatarUrl: doc.senderAvatarUrl || null,
    content,
    clientMessageId: doc.clientMessageId || null,
    createdAt: doc.createdAt.toISOString ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString(),
  };
}

export const ChatMessage: Model<IChatMessage> =
  mongoose.models.ChatMessage || mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
