import type { Request, Response } from 'express';
import { whiteboardService } from '../services/whiteboard.service.js';
import { submitWhiteboardOperationsSchema } from '../schemas/whiteboard.schema.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { UnauthorizedError } from '../utils/errors.js';

function requireUserId(req: Request): string {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required.');
  }
  return userId;
}

/**
 * GET /api/v1/meetings/:meetingCode/whiteboard
 * Fetches the current authoritative whiteboard state for the meeting.
 */
export async function getMeetingWhiteboard(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await whiteboardService.getWhiteboardState(meetingCode, userId);
  sendSuccess(res, result, 200);
}

/**
 * POST /api/v1/meetings/:meetingCode/whiteboard/operations
 * Submits a batch of drawing operations (add, update, delete).
 */
export async function submitMeetingWhiteboardOperations(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const input = submitWhiteboardOperationsSchema.parse(req.body);
  const result = await whiteboardService.applyOperations(meetingCode, userId, input);
  sendSuccess(res, result, 200, { message: 'Operations applied.' });
}

/**
 * POST /api/v1/meetings/:meetingCode/whiteboard/undo
 * Undoes the user's latest active whiteboard operation.
 */
export async function undoMeetingWhiteboardOperation(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await whiteboardService.undoOperation(meetingCode, userId);
  sendSuccess(res, result, 200);
}

/**
 * POST /api/v1/meetings/:meetingCode/whiteboard/redo
 * Redoes the user's latest undone whiteboard operation.
 */
export async function redoMeetingWhiteboardOperation(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await whiteboardService.redoOperation(meetingCode, userId);
  sendSuccess(res, result, 200);
}

/**
 * DELETE /api/v1/meetings/:meetingCode/whiteboard/clear
 * Clears all active elements from the whiteboard (Host/Co-Host only).
 */
export async function clearMeetingWhiteboard(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUserId(req);
  const meetingCode = req.params.meetingCode;

  const result = await whiteboardService.clearWhiteboard(meetingCode, userId);
  sendSuccess(res, result, 200, { message: 'Whiteboard cleared.' });
}
