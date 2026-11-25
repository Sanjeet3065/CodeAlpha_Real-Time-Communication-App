import type { Request, Response } from 'express';
import { meetingService } from '../services/meeting.service.js';
import { LIVEKIT_SIGNAL_GATEWAY_PATH } from '../realtime/livekitSignalGateway.js';
import { UnauthorizedError } from '../utils/errors.js';
import { sendSuccess } from '../utils/apiResponse.js';

function requireUserId(req: Request): string {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required.');
  }
  return userId;
}

export async function createMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.createMeeting(userId, req.body);
  sendSuccess(res, result, 201, { message: 'Meeting created successfully.' });
}

export async function validateMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.getMeetingMetadata(req.params.meetingCode, userId);
  sendSuccess(res, result, 200);
}

export async function getMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.getMeetingMetadata(req.params.meetingCode, userId);
  sendSuccess(res, result, 200);
}

export async function joinMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.joinMeeting(req.params.meetingCode, userId, req.body);
  sendSuccess(res, result, 200);
}

export async function leaveMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.leaveMeeting(req.params.meetingCode, userId);
  sendSuccess(res, result, 200, { message: 'Left meeting successfully.' });
}

export async function getMeetingState(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.getMeetingState(req.params.meetingCode, userId);
  sendSuccess(res, result, 200);
}

export async function listParticipants(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.listParticipants(req.params.meetingCode, userId);
  sendSuccess(res, result, 200);
}

export async function listWaitingRoom(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.listWaitingRoom(req.params.meetingCode, userId);
  sendSuccess(res, result, 200);
}

export async function admitParticipant(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.admitParticipant(
    req.params.meetingCode,
    userId,
    req.params.targetUserId
  );
  sendSuccess(res, result, 200, { message: 'Participant admitted to meeting.' });
}

export async function rejectParticipant(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.rejectParticipant(
    req.params.meetingCode,
    userId,
    req.params.targetUserId,
    req.body?.reason
  );
  sendSuccess(res, result, 200, { message: 'Waiting room request rejected.' });
}

export async function removeParticipant(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.removeParticipant(
    req.params.meetingCode,
    userId,
    req.params.targetUserId,
    req.body?.reason
  );
  sendSuccess(res, result, 200, { message: 'Participant removed from meeting.' });
}

export async function updateParticipantRole(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.updateParticipantRole(
    req.params.meetingCode,
    userId,
    req.params.targetUserId,
    req.body
  );
  sendSuccess(res, result, 200, { message: 'Participant role updated.' });
}

export async function lockMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.setMeetingLock(req.params.meetingCode, userId, true);
  sendSuccess(res, result, 200, { message: 'Meeting locked.' });
}

export async function unlockMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.setMeetingLock(req.params.meetingCode, userId, false);
  sendSuccess(res, result, 200, { message: 'Meeting unlocked.' });
}

export async function updateMeetingSettings(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.updateSettings(req.params.meetingCode, userId, req.body);
  sendSuccess(res, result, 200, { message: 'Meeting settings updated.' });
}

export async function endMeeting(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const result = await meetingService.endMeeting(req.params.meetingCode, userId);
  sendSuccess(res, result, 200, { message: 'Meeting ended for all participants.' });
}

export async function issueLiveKitToken(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const host = req.get('host');
  const wsProto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
  const gatewayUrl = host ? `${wsProto}://${host}${LIVEKIT_SIGNAL_GATEWAY_PATH}` : undefined;
  const result = await meetingService.issueLiveKitToken(req.params.meetingCode, userId, req.id, {
    gatewayUrl,
  });
  sendSuccess(res, result, 200, { message: 'LiveKit access token issued.' });
}
