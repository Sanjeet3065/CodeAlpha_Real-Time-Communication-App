import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { IWhiteboardElement } from './Whiteboard.model.js';

export type WhiteboardOperationType =
  | 'add'
  | 'update'
  | 'delete'
  | 'clear'
  | 'undo'
  | 'redo';

export interface IWhiteboardOperation extends Document {
  meetingId: Types.ObjectId;
  whiteboardId: Types.ObjectId;
  operationId: string; // Unique client/server operation UUID
  userId: Types.ObjectId;
  userName: string;
  type: WhiteboardOperationType;
  elementId?: string;
  element?: Partial<IWhiteboardElement>;
  previousElement?: Partial<IWhiteboardElement>;
  sequence: number; // Monotonically increasing sequence per meeting
  isUndone: boolean;
  createdAt: Date;
}

const WhiteboardOperationSchema = new Schema<IWhiteboardOperation>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
      index: true,
    },
    whiteboardId: {
      type: Schema.Types.ObjectId,
      ref: 'Whiteboard',
      required: true,
      index: true,
    },
    operationId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    type: {
      type: String,
      enum: ['add', 'update', 'delete', 'clear', 'undo', 'redo'],
      required: true,
    },
    elementId: {
      type: String,
      default: undefined,
    },
    element: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    previousElement: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    sequence: {
      type: Number,
      required: true,
    },
    isUndone: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Idempotency: exact operationId cannot be duplicated within a meeting
WhiteboardOperationSchema.index({ meetingId: 1, operationId: 1 }, { unique: true });

// Ordered sequence index for recovery and synchronization
WhiteboardOperationSchema.index({ meetingId: 1, sequence: 1 });

// User-scoped undo query optimization: finds the user's latest active operation in this meeting
WhiteboardOperationSchema.index({ meetingId: 1, userId: 1, isUndone: 1, sequence: -1 });

export const WhiteboardOperation: Model<IWhiteboardOperation> = mongoose.model<IWhiteboardOperation>(
  'WhiteboardOperation',
  WhiteboardOperationSchema
);
