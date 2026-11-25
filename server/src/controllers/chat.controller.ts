import type { Request, Response } from 'express';
import { chatService } from '../services/chat.service.js';
import { getChatHistoryQuerySchema } from '../schemas/chat.schema.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { UnauthorizedError } from '../utils/errors.js';

function requireUserId(req: Request): string {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required.');
  }
  return userId;
}

export async function getMeetingChatHistory(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;
  const query = getChatHistoryQuerySchema.parse(req.query);

  const result = await chatService.getChatHistory(meetingCode, userId, query);
  sendSuccess(res, result, 200);
}

export async function sendMeetingChatMessage(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await chatService.sendMessage(meetingCode, userId, req.body);
  sendSuccess(res, result, 201, { message: 'Message sent.' });
}

export async function sendMeetingReaction(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await chatService.sendReaction(meetingCode, userId, req.body);
  sendSuccess(res, result, 200, { message: 'Reaction sent.' });
}
