import type { Request, Response } from 'express';
import { schedulingService } from '../services/scheduling.service.js';
import type {
  ScheduleMeetingInput,
  UpdateScheduledMeetingInput,
  RescheduleMeetingInput,
  CancelMeetingInput,
  ListScheduledMeetingsQuery,
  MeetingHistoryQuery,
  DeleteMeetingHistoryBatchInput,
} from '../schemas/meeting.schema.js';

function sendSchedulingSuccess<T>(
  req: Request,
  res: Response,
  statusCode: number,
  data: T,
  message?: string
): void {
  res.status(statusCode).json({
    success: true,
    status: statusCode,
    data,
    ...(message ? { message } : {}),
    ...(req.id ? { meta: { requestId: req.id } } : {}),
    timestamp: new Date().toISOString(),
  });
}

export async function scheduleMeetingHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const input = req.body as ScheduleMeetingInput;

  const meeting = await schedulingService.scheduleMeeting(userId, input);

  sendSchedulingSuccess(req, res, 201, { meeting }, 'Meeting scheduled successfully.');
}

export async function getScheduledMeetingHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;

  const meeting = await schedulingService.getScheduledMeeting(userId, meetingId);

  sendSchedulingSuccess(req, res, 200, { meeting });
}

export async function updateScheduledMeetingHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;
  const input = req.body as UpdateScheduledMeetingInput;

  const meeting = await schedulingService.updateScheduledMeeting(userId, meetingId, input);

  sendSchedulingSuccess(req, res, 200, { meeting }, 'Scheduled meeting updated successfully.');
}

export async function rescheduleMeetingHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;
  const input = req.body as RescheduleMeetingInput;

  const result = await schedulingService.rescheduleMeeting(userId, meetingId, input);

  sendSchedulingSuccess(req, res, 200, result, 'Meeting rescheduled successfully.');
}

export async function cancelMeetingHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;
  const input = req.body as CancelMeetingInput;

  const meeting = await schedulingService.cancelScheduledMeeting(userId, meetingId, input);

  sendSchedulingSuccess(req, res, 200, { meeting }, 'Meeting cancelled successfully.');
}

export async function listUpcomingMeetingsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const query = (req.query as unknown) as ListScheduledMeetingsQuery;

  const result = await schedulingService.listUpcomingScheduledMeetings(userId, query);

  sendSchedulingSuccess(req, res, 200, result);
}

export async function listMeetingHistoryHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const query = (req.query as unknown) as MeetingHistoryQuery;

  const result = await schedulingService.listMeetingHistory(userId, query);

  sendSchedulingSuccess(req, res, 200, result);
}

export async function getMeetingHistoryDetailsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;

  const result = await schedulingService.getMeetingHistoryDetails(userId, meetingId);

  sendSchedulingSuccess(req, res, 200, result);
}

export async function deleteMeetingHistoryEntryHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const { meetingId } = req.params;

  const result = await schedulingService.deleteMeetingHistoryEntry(userId, meetingId);

  sendSchedulingSuccess(req, res, 200, result, 'Meeting removed from your history.');
}

export async function deleteMeetingHistoryBatchHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.sub;
  const input = req.body as DeleteMeetingHistoryBatchInput;

  const result = await schedulingService.deleteMeetingHistoryEntries(userId, input.meetingIds);

  sendSchedulingSuccess(req, res, 200, result, 'Selected meetings removed from your history.');
}

export async function getMeetingInvitationHandler(req: Request, res: Response): Promise<void> {
  const { meetingCode } = req.params;

  const result = await schedulingService.generateInvitation(meetingCode);

  sendSchedulingSuccess(req, res, 200, result);
}
