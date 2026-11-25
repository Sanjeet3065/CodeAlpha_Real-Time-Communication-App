import type { Request, Response } from 'express';
import { notificationService } from '../services/notification.service.js';
import type { ListNotificationsQuery } from '../schemas/notification.schema.js';

export async function listNotificationsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const query = (req.query as unknown) as ListNotificationsQuery;

  const result = await notificationService.listUserNotifications(userId, {
    page: query.page,
    limit: query.limit,
    unreadOnly: query.unreadOnly,
  });

  res.status(200).json({
    status: 200,
    data: result,
    timestamp: new Date().toISOString(),
  });
}

export async function markNotificationReadHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { notificationId } = req.params;

  const success = await notificationService.markAsRead(userId, notificationId);

  res.status(200).json({
    status: 200,
    data: { success },
    message: success ? 'Notification marked as read.' : 'Notification not found.',
    timestamp: new Date().toISOString(),
  });
}

export async function markAllNotificationsReadHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;

  const modifiedCount = await notificationService.markAllAsRead(userId);

  res.status(200).json({
    status: 200,
    data: { modifiedCount },
    message: 'All notifications marked as read.',
    timestamp: new Date().toISOString(),
  });
}
