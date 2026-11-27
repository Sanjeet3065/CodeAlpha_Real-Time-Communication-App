import { Router } from 'express';
import {
  getMe,
  updateMe,
  updateMyEmail,
  updateMyPassword,
  getPreferences,
  updatePreferences,
} from '../controllers/user.controller.js';
import { getUserSharedFiles } from '../controllers/file.controller.js';
import {
  listNotificationsHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
} from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireFileSharingEnabled } from '../middlewares/fileSharingGate.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { validateRequestOrigin } from '../middlewares/csrf.middleware.js';
import {
  updateProfileSchema,
  updateEmailSchema,
  updatePasswordSchema,
  updatePreferencesSchema,
} from '../schemas/user.schema.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const usersRouter = Router();

// Profile & Credential Routes
usersRouter.get('/me', requireAuth, asyncHandler(getMe));
usersRouter.patch('/me', requireAuth, validateBody(updateProfileSchema), asyncHandler(updateMe));
usersRouter.patch(
  '/me/email',
  requireAuth,
  validateRequestOrigin,
  validateBody(updateEmailSchema),
  asyncHandler(updateMyEmail)
);
usersRouter.patch(
  '/me/password',
  requireAuth,
  validateRequestOrigin,
  validateBody(updatePasswordSchema),
  asyncHandler(updateMyPassword)
);

// Preferences Persistence Routes (Phase 07)
usersRouter.get('/me/preferences', requireAuth, asyncHandler(getPreferences));
usersRouter.put(
  '/me/preferences',
  requireAuth,
  validateBody(updatePreferencesSchema),
  asyncHandler(updatePreferences)
);
usersRouter.patch(
  '/me/preferences',
  requireAuth,
  validateBody(updatePreferencesSchema),
  asyncHandler(updatePreferences)
);

// Phase 13 — Files shared across user meetings (for Dashboard & Downloads page)
usersRouter.get('/me/shared-files', requireAuth, requireFileSharingEnabled, asyncHandler(getUserSharedFiles));

// Phase 16 — User In-App Notifications
usersRouter.get('/me/notifications', requireAuth, asyncHandler(listNotificationsHandler));
usersRouter.patch(
  '/me/notifications/:notificationId/read',
  requireAuth,
  asyncHandler(markNotificationReadHandler)
);
usersRouter.post(
  '/me/notifications/read-all',
  requireAuth,
  asyncHandler(markAllNotificationsReadHandler)
);

