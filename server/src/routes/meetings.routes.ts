import { Router } from 'express';
import {
  createMeeting,
  validateMeeting,
  getMeeting,
  joinMeeting,
  leaveMeeting,
  getMeetingState,
  listParticipants,
  listWaitingRoom,
  admitParticipant,
  rejectParticipant,
  removeParticipant,
  updateParticipantRole,
  lockMeeting,
  unlockMeeting,
  updateMeetingSettings,
  endMeeting,
  issueLiveKitToken,
} from '../controllers/meeting.controller.js';
import {
  getMeetingChatHistory,
  sendMeetingChatMessage,
  sendMeetingReaction,
} from '../controllers/chat.controller.js';
import {
  uploadMeetingFile,
  initPresignedUpload,
  completePresignedUpload,
  listMeetingFiles,
  downloadMeetingFile,
  deleteMeetingFile,
} from '../controllers/file.controller.js';
import {
  getMeetingWhiteboard,
  submitMeetingWhiteboardOperations,
  undoMeetingWhiteboardOperation,
  redoMeetingWhiteboardOperation,
  clearMeetingWhiteboard,
} from '../controllers/whiteboard.controller.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireFileSharingEnabled } from '../middlewares/fileSharingGate.js';
import { validateRequestOrigin } from '../middlewares/csrf.middleware.js';
import { validateBody, validateRequest } from '../middlewares/validation.middleware.js';
import {
  meetingCreateLimiter,
  meetingActionLimiter,
  livekitTokenLimiter,
} from '../middlewares/rateLimiter.js';
import {
  scheduleMeetingHandler,
  getScheduledMeetingHandler,
  updateScheduledMeetingHandler,
  rescheduleMeetingHandler,
  cancelMeetingHandler,
  listUpcomingMeetingsHandler,
  listMeetingHistoryHandler,
  getMeetingHistoryDetailsHandler,
  deleteMeetingHistoryEntryHandler,
  deleteMeetingHistoryBatchHandler,
  getMeetingInvitationHandler,
} from '../controllers/scheduling.controller.js';
import {
  createMeetingSchema,
  joinMeetingSchema,
  updateRoleSchema,
  rejectWaitingSchema,
  removeParticipantSchema,
  updateMeetingSettingsSchema,
  livekitTokenRequestSchema,
  scheduleMeetingSchema,
  updateScheduledMeetingSchema,
  rescheduleMeetingSchema,
  cancelMeetingSchema,
  listScheduledMeetingsQuerySchema,
  meetingHistoryQuerySchema,
  deleteMeetingHistoryBatchSchema,
} from '../schemas/meeting.schema.js';
import { sendChatMessageSchema, sendReactionSchema } from '../schemas/chat.schema.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const meetingsRouter = Router();

// All Phase 08 meeting room management endpoints require authentication
meetingsRouter.use(requireAuth);

// Create meeting (canonical & /instant alias per API specification)
meetingsRouter.post(
  '/',
  meetingCreateLimiter,
  validateBody(createMeetingSchema),
  asyncHandler(createMeeting)
);
meetingsRouter.post(
  '/instant',
  meetingCreateLimiter,
  validateBody(createMeetingSchema),
  asyncHandler(createMeeting)
);

// Phase 16 — Scheduling & History Endpoints (Must precede /:meetingCode)
meetingsRouter.post(
  '/scheduled',
  meetingCreateLimiter,
  validateBody(scheduleMeetingSchema),
  asyncHandler(scheduleMeetingHandler)
);

meetingsRouter.get(
  '/scheduled',
  validateRequest({ query: listScheduledMeetingsQuerySchema }),
  asyncHandler(listUpcomingMeetingsHandler)
);

meetingsRouter.get(
  '/scheduled/:meetingId',
  asyncHandler(getScheduledMeetingHandler)
);

meetingsRouter.patch(
  '/scheduled/:meetingId',
  validateRequestOrigin,
  meetingActionLimiter,
  validateBody(updateScheduledMeetingSchema),
  asyncHandler(updateScheduledMeetingHandler)
);

meetingsRouter.post(
  '/scheduled/:meetingId/reschedule',
  validateRequestOrigin,
  meetingActionLimiter,
  validateBody(rescheduleMeetingSchema),
  asyncHandler(rescheduleMeetingHandler)
);

meetingsRouter.post(
  '/scheduled/:meetingId/cancel',
  validateRequestOrigin,
  meetingActionLimiter,
  validateBody(cancelMeetingSchema),
  asyncHandler(cancelMeetingHandler)
);

meetingsRouter.get(
  '/history',
  validateRequest({ query: meetingHistoryQuerySchema }),
  asyncHandler(listMeetingHistoryHandler)
);

meetingsRouter.get(
  '/history/:meetingId',
  asyncHandler(getMeetingHistoryDetailsHandler)
);

meetingsRouter.delete(
  '/history',
  validateRequestOrigin,
  meetingActionLimiter,
  validateBody(deleteMeetingHistoryBatchSchema),
  asyncHandler(deleteMeetingHistoryBatchHandler)
);

meetingsRouter.delete(
  '/history/:meetingId',
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(deleteMeetingHistoryEntryHandler)
);

meetingsRouter.get(
  '/:meetingCode/invitation',
  asyncHandler(getMeetingInvitationHandler)
);

// Validate & retrieve meeting metadata
meetingsRouter.get('/validate/:meetingCode', asyncHandler(validateMeeting));
meetingsRouter.get('/:meetingCode', asyncHandler(getMeeting));

// Join, Leave, and Authoritative State Sync
meetingsRouter.post(
  '/:meetingCode/join',
  meetingActionLimiter,
  validateBody(joinMeetingSchema),
  asyncHandler(joinMeeting)
);
meetingsRouter.post('/:meetingCode/leave', meetingActionLimiter, asyncHandler(leaveMeeting));
meetingsRouter.get('/:meetingCode/state', asyncHandler(getMeetingState));

// Participant Management
meetingsRouter.get('/:meetingCode/participants', asyncHandler(listParticipants));
meetingsRouter.patch(
  '/:meetingCode/participants/:targetUserId/role',
  meetingActionLimiter,
  validateBody(updateRoleSchema),
  asyncHandler(updateParticipantRole)
);
meetingsRouter.delete(
  '/:meetingCode/participants/:targetUserId',
  meetingActionLimiter,
  validateBody(removeParticipantSchema),
  asyncHandler(removeParticipant)
);

// Waiting Room Management
meetingsRouter.get('/:meetingCode/waiting-room', asyncHandler(listWaitingRoom));
meetingsRouter.post(
  '/:meetingCode/waiting-room/:targetUserId/admit',
  meetingActionLimiter,
  asyncHandler(admitParticipant)
);
meetingsRouter.post(
  '/:meetingCode/waiting-room/:targetUserId/reject',
  meetingActionLimiter,
  validateBody(rejectWaitingSchema),
  asyncHandler(rejectParticipant)
);

// Room Controls (Lock, Unlock, Settings, Terminate)
meetingsRouter.post('/:meetingCode/lock', meetingActionLimiter, asyncHandler(lockMeeting));
meetingsRouter.post('/:meetingCode/unlock', meetingActionLimiter, asyncHandler(unlockMeeting));
meetingsRouter.patch(
  '/:meetingCode/settings',
  meetingActionLimiter,
  validateBody(updateMeetingSettingsSchema),
  asyncHandler(updateMeetingSettings)
);
meetingsRouter.post('/:meetingCode/end', meetingActionLimiter, asyncHandler(endMeeting));

// Phase 09 — LiveKit SFU Short-Lived Token Issuance (Strictly DB-Authorized)
meetingsRouter.post(
  '/:meetingCode/livekit-token',
  validateRequestOrigin,
  livekitTokenLimiter,
  validateBody(livekitTokenRequestSchema),
  asyncHandler(issueLiveKitToken)
);

// Phase 12 — Real-Time Meeting Chat & Reactions
meetingsRouter.get(
  '/:meetingCode/chat',
  asyncHandler(getMeetingChatHistory)
);
meetingsRouter.post(
  '/:meetingCode/chat',
  validateRequestOrigin,
  validateBody(sendChatMessageSchema),
  asyncHandler(sendMeetingChatMessage)
);
meetingsRouter.post(
  '/:meetingCode/reactions',
  validateRequestOrigin,
  validateBody(sendReactionSchema),
  asyncHandler(sendMeetingReaction)
);

// Phase 13 — File Sharing & Downloads (DEF-13-03: Memory-safe disk storage)
const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), 'connectly_uploads');
if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
  fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
}

const fileUploadDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}_${crypto.randomUUID()}`;
    const safeExt = path.extname(file.originalname).slice(0, 10);
    cb(null, `cly_upload_${uniqueSuffix}${safeExt}.tmp`);
  },
});

const upload = multer({
  storage: fileUploadDiskStorage,
  limits: {
    fileSize: env.STORAGE_MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});

meetingsRouter.post(
  '/:meetingCode/files/upload',
  requireFileSharingEnabled,
  validateRequestOrigin,
  meetingActionLimiter,
  upload.single('file'),
  asyncHandler(uploadMeetingFile)
);

meetingsRouter.post(
  '/:meetingCode/files/init-upload',
  requireFileSharingEnabled,
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(initPresignedUpload)
);

meetingsRouter.post(
  '/:meetingCode/files/:fileId/complete',
  requireFileSharingEnabled,
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(completePresignedUpload)
);

meetingsRouter.get(
  '/:meetingCode/files',
  requireFileSharingEnabled,
  asyncHandler(listMeetingFiles)
);

meetingsRouter.get(
  '/:meetingCode/files/:fileId/download',
  requireFileSharingEnabled,
  asyncHandler(downloadMeetingFile)
);

meetingsRouter.delete(
  '/:meetingCode/files/:fileId',
  requireFileSharingEnabled,
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(deleteMeetingFile)
);

// Phase 14 — Collaborative Whiteboard Endpoints
meetingsRouter.get(
  '/:meetingCode/whiteboard',
  asyncHandler(getMeetingWhiteboard)
);

meetingsRouter.post(
  '/:meetingCode/whiteboard/operations',
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(submitMeetingWhiteboardOperations)
);

meetingsRouter.post(
  '/:meetingCode/whiteboard/undo',
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(undoMeetingWhiteboardOperation)
);

meetingsRouter.post(
  '/:meetingCode/whiteboard/redo',
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(redoMeetingWhiteboardOperation)
);

meetingsRouter.delete(
  '/:meetingCode/whiteboard/clear',
  validateRequestOrigin,
  meetingActionLimiter,
  asyncHandler(clearMeetingWhiteboard)
);

