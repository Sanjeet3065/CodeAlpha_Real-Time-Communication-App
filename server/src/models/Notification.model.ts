import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type NotificationType =
  | 'MEETING_INVITATION'
  | 'MEETING_REMINDER'
  | 'MEETING_RESCHEDULED'
  | 'MEETING_CANCELLED';

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  meetingId?: Types.ObjectId | null;
  meetingCode?: string | null;
  read: boolean;
  readAt?: Date | null;
  deliveryKey?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'MEETING_INVITATION',
        'MEETING_REMINDER',
        'MEETING_RESCHEDULED',
        'MEETING_CANCELLED',
      ],
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      default: null,
      index: true,
    },
    meetingCode: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    read: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    deliveryKey: {
      type: String,
      default: null,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    collection: 'notifications',
    timestamps: true,
  }
);

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ deliveryKey: 1 }, { unique: true, sparse: true });

export const Notification: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>('Notification', NotificationSchema);
