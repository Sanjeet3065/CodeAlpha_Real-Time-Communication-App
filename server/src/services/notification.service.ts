import { Types } from 'mongoose';
import { Notification, type INotification, type NotificationType } from '../models/Notification.model.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';

export interface CreateNotificationParams {
  userId: Types.ObjectId | string;
  type: NotificationType;
  title: string;
  message: string;
  meetingId?: Types.ObjectId | string | null;
  meetingCode?: string | null;
  deliveryKey?: string | null;
  metadata?: Record<string, unknown>;
}

export class NotificationService {
  async createNotification(params: CreateNotificationParams): Promise<INotification> {
    const userObjId = new Types.ObjectId(params.userId);
    const meetingObjId = params.meetingId ? new Types.ObjectId(params.meetingId) : null;

    let doc: INotification;
    let isNew = false;

    if (params.deliveryKey) {
      // Idempotent delivery using unique deliveryKey
      const existing = await Notification.findOne({ deliveryKey: params.deliveryKey });
      if (existing) {
        return existing;
      }

      try {
        doc = await Notification.create({
          userId: userObjId,
          type: params.type,
          title: params.title,
          message: params.message,
          meetingId: meetingObjId,
          meetingCode: params.meetingCode || null,
          deliveryKey: params.deliveryKey,
          metadata: params.metadata || {},
          read: false,
        });
        isNew = true;
      } catch (err: any) {
        if (err?.code === 11000 && err?.keyPattern?.deliveryKey) {
          const recheck = await Notification.findOne({ deliveryKey: params.deliveryKey });
          if (recheck) return recheck;
        }
        throw err;
      }
    } else {
      doc = await Notification.create({
        userId: userObjId,
        type: params.type,
        title: params.title,
        message: params.message,
        meetingId: meetingObjId,
        meetingCode: params.meetingCode || null,
        metadata: params.metadata || {},
        read: false,
      });
      isNew = true;
    }

    if (isNew) {
      const serialized = {
        id: doc._id.toString(),
        type: doc.type,
        title: doc.title,
        message: doc.message,
        meetingId: doc.meetingId ? doc.meetingId.toString() : null,
        meetingCode: doc.meetingCode,
        read: doc.read,
        createdAt: doc.createdAt,
      };

      meetingRealtime.emitNotification(userObjId.toString(), serialized);
    }

    return doc;
  }

  async listUserNotifications(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ) {
    const userObjId = new Types.ObjectId(userId);
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { userId: userObjId };
    if (options.unreadOnly) {
      filter.read = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: userObjId, read: false }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n._id.toString(),
        type: n.type,
        title: n.title,
        message: n.message,
        meetingId: n.meetingId ? n.meetingId.toString() : null,
        meetingCode: n.meetingCode,
        read: n.read,
        readAt: n.readAt || null,
        createdAt: n.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      unreadCount,
    };
  }

  async markAsRead(userId: string, notificationId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(notificationId)) return false;
    const res = await Notification.updateOne(
      { _id: new Types.ObjectId(notificationId), userId: new Types.ObjectId(userId) },
      { $set: { read: true, readAt: new Date() } }
    );
    return res.modifiedCount > 0;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const res = await Notification.updateMany(
      { userId: new Types.ObjectId(userId), read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    return res.modifiedCount;
  }
}

export const notificationService = new NotificationService();
