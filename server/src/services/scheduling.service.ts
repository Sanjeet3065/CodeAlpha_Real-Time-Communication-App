import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Meeting, type IMeeting, type IMeetingInvitee } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { User } from '../models/User.model.js';
import {
  generateSecureMeetingCode,
  normalizeMeetingCode,
} from '../utils/meetingCode.js';
import {
  calculateScheduledEnd,
  formatInTimeZone,
  normalizeIanaTimeZone,
} from '../utils/timezone.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.js';
import type {
  ScheduleMeetingInput,
  UpdateScheduledMeetingInput,
  RescheduleMeetingInput,
  CancelMeetingInput,
  ListScheduledMeetingsQuery,
  MeetingHistoryQuery,
} from '../schemas/meeting.schema.js';
import { reminderWorker } from './reminderWorker.service.js';
import { notificationService } from './notification.service.js';
import {
  isMeetingHistoryExpired,
  purgeMeetingsAndCascade,
} from './meetingHistoryRetentionWorker.service.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';

const MAX_CODE_GENERATION_RETRIES = 6;
const MAX_AUDIT_ENTRIES = 50;

/**
 * Escapes regex metacharacters in user search queries to prevent regex injection / ReDoS (DEF-16-01)
 */
export function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SerializedScheduledMeeting {
  id: string;
  meetingCode: string;
  title: string;
  description: string | null;
  joinUrl: string;
  hostId: string;
  hostName: string;
  hostEmail: string;
  status: string;
  isLocked: boolean;
  maxParticipants: number;
  activeParticipantCount: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduledTimeZone: string;
  durationMinutes: number;
  invitees: Array<{ email: string; userId?: string | null; name?: string | null }>;
  reminderPreferences: number[];
  scheduleVersion: number;
  settings: {
    waitingRoomEnabled: boolean;
    allowCoHostAdmit: boolean;
    allowCoHostRemove: boolean;
    allowCoHostLock: boolean;
  };
  cancelledAt: string | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingHistoryItem {
  id: string;
  meetingCode: string;
  title: string;
  description: string | null;
  hostId: string;
  hostName: string;
  userRole: 'host' | 'co-host' | 'participant';
  status: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduledTimeZone: string | null;
  activatedAt: string | null;
  endedAt: string | null;
  actualDurationSeconds: number | null;
  formattedDuration: string;
  participantCount: number;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export class SchedulingService {
  /**
   * Helper to format a duration in seconds into human-readable text.
   */
  private formatDuration(seconds: number | null): string {
    if (seconds === null || seconds < 0) return 'Unavailable';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  }

  /**
   * Helper to serialize a scheduled meeting document safely.
   */
  private async serializeScheduledMeeting(
    meeting: IMeeting
  ): Promise<SerializedScheduledMeeting> {
    const host = await User.findById(meeting.hostId).select('firstName lastName email');
    const hostName = host ? `${host.firstName} ${host.lastName}`.trim() : 'Unknown Host';
    const hostEmail = host ? host.email : '';
    const baseOrigin = env.CLIENT_ORIGIN.replace(/\/+$/, '');

    let durationMinutes = 60;
    if (meeting.scheduledStartAt && meeting.scheduledEndAt) {
      durationMinutes = Math.round(
        (meeting.scheduledEndAt.getTime() - meeting.scheduledStartAt.getTime()) / 60000
      );
    }

    return {
      id: meeting._id.toString(),
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      description: meeting.description || null,
      joinUrl: `${baseOrigin}/join/${meeting.meetingCode}`,
      hostId: meeting.hostId.toString(),
      hostName,
      hostEmail,
      status: meeting.status,
      isLocked: meeting.isLocked,
      maxParticipants: meeting.maxParticipants,
      activeParticipantCount: meeting.activeParticipantCount,
      scheduledStartAt: meeting.scheduledStartAt ? meeting.scheduledStartAt.toISOString() : null,
      scheduledEndAt: meeting.scheduledEndAt ? meeting.scheduledEndAt.toISOString() : null,
      scheduledTimeZone: meeting.scheduledTimeZone || 'UTC',
      durationMinutes,
      invitees: (meeting.invitees || []).map((inv) => ({
        email: inv.email,
        userId: inv.userId ? inv.userId.toString() : null,
        name: inv.name || null,
      })),
      reminderPreferences: meeting.reminderPreferences || [15, 60],
      scheduleVersion: meeting.scheduleVersion || 1,
      settings: {
        waitingRoomEnabled: meeting.settings.waitingRoomEnabled,
        allowCoHostAdmit: meeting.settings.allowCoHostAdmit,
        allowCoHostRemove: meeting.settings.allowCoHostRemove,
        allowCoHostLock: meeting.settings.allowCoHostLock,
      },
      cancelledAt: meeting.cancelledAt ? meeting.cancelledAt.toISOString() : null,
      cancelledBy: meeting.cancelledBy ? meeting.cancelledBy.toString() : null,
      cancellationReason: meeting.cancellationReason || null,
      createdAt: meeting.createdAt.toISOString(),
      updatedAt: meeting.updatedAt.toISOString(),
    };
  }

  /**
   * Feature A1 — Create Scheduled Meeting
   */
  async scheduleMeeting(
    userId: string,
    input: ScheduleMeetingInput
  ): Promise<SerializedScheduledMeeting> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const host = await User.findById(userId);
    if (!host) {
      throw new NotFoundError('Host user account not found.', 'USER_NOT_FOUND');
    }

    const startAt = new Date(input.scheduledStartAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestError('Invalid scheduledStartAt timestamp.', 'INVALID_DATETIME');
    }
    if (startAt.getTime() < Date.now() - 60_000) {
      throw new BadRequestError('Meetings cannot be scheduled in the past.', 'PAST_DATETIME');
    }

    const timeZone = normalizeIanaTimeZone(input.scheduledTimeZone);
    const durationMinutes = input.durationMinutes || 60;
    const endAt = calculateScheduledEnd(startAt, durationMinutes);

    // Resolve invitees: attach userId if an invitee has an existing CONNECTLY account
    const resolvedInvitees: IMeetingInvitee[] = [];
    if (Array.isArray(input.invitees) && input.invitees.length > 0) {
      const emails = Array.from(new Set(input.invitees.map((i) => i.email.toLowerCase().trim())));
      const existingUsers = await User.find({ email: { $in: emails } }).select('_id email firstName lastName');
      const userByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

      for (const cleanEmail of emails) {
        const matchedUser = userByEmail.get(cleanEmail);
        const originalInv = input.invitees.find(
          (i) => i.email.toLowerCase().trim() === cleanEmail
        );
        resolvedInvitees.push({
          email: cleanEmail,
          userId: matchedUser ? (matchedUser._id as Types.ObjectId) : null,
          name:
            originalInv?.name?.trim() ||
            (matchedUser ? `${matchedUser.firstName} ${matchedUser.lastName}`.trim() : null),
        });
      }
    }

    // Generate unique meeting code with collision retries
    let meetingCode = '';
    let doc: IMeeting | null = null;
    let attempts = 0;

    // Scheduled meeting expires 24 hours after its scheduled end time
    const expiresAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);

    while (attempts < MAX_CODE_GENERATION_RETRIES) {
      attempts++;
      meetingCode = generateSecureMeetingCode();

      try {
        doc = await Meeting.create({
          meetingCode,
          title: input.title?.trim() || 'Scheduled Meeting',
          description: input.description?.trim() || null,
          hostId: host._id,
          originalHostId: host._id,
          status: 'SCHEDULED',
          isLocked: false,
          maxParticipants: 60,
          activeParticipantCount: 0,
          settings: {
            waitingRoomEnabled: input.settings?.waitingRoomEnabled ?? false,
            allowCoHostAdmit: input.settings?.allowCoHostAdmit ?? true,
            allowCoHostRemove: input.settings?.allowCoHostRemove ?? true,
            allowCoHostLock: input.settings?.allowCoHostLock ?? false,
          },
          scheduledStartAt: startAt,
          scheduledEndAt: endAt,
          scheduledTimeZone: timeZone,
          scheduledBy: host._id,
          invitees: resolvedInvitees,
          reminderPreferences: input.reminderPreferences || [15, 60],
          scheduleVersion: 1,
          version: 1,
          expiresAt,
          auditLog: [
            {
              action: 'SCHEDULED',
              actorId: host._id,
              details: `Meeting scheduled for ${startAt.toISOString()} (${timeZone})`,
              timestamp: new Date(),
            },
          ],
        });
        break;
      } catch (err: any) {
        if (err?.code === 11000 && err?.keyPattern?.meetingCode) {
          continue;
        }
        throw err;
      }
    }

    if (!doc) {
      throw new ConflictError(
        'Unable to allocate a unique meeting code. Please try again.',
        'MEETING_CODE_COLLISION'
      );
    }

    // Generate durable reminders
    await reminderWorker.generateRemindersForMeeting(doc);

    // Send in-app invitation notification to registered invitees
    const formattedStartTime = formatInTimeZone(startAt, timeZone);
    for (const inv of resolvedInvitees) {
      if (inv.userId && !inv.userId.equals(host._id)) {
        await notificationService.createNotification({
          userId: inv.userId,
          type: 'MEETING_INVITATION',
          title: `Invited: ${doc.title}`,
          message: `${host.firstName} ${host.lastName} invited you to "${doc.title}" scheduled for ${formattedStartTime} (${timeZone}).`,
          meetingId: doc._id,
          meetingCode: doc.meetingCode,
          deliveryKey: `invitation:${doc._id}:${inv.userId}:v${doc.scheduleVersion}`,
          metadata: {
            scheduledStartAt: startAt,
            scheduledTimeZone: timeZone,
            hostName: `${host.firstName} ${host.lastName}`.trim(),
          },
        });
      }
    }

    const serialized = await this.serializeScheduledMeeting(doc);

    // Emit real-time event to host user channel
    meetingRealtime.emitMeetingScheduled(host._id.toString(), serialized);

    return serialized;
  }

  /**
   * Retrieves a scheduled meeting by ID or code, enforcing access control.
   */
  async getScheduledMeeting(
    userId: string,
    meetingIdOrCode: string
  ): Promise<SerializedScheduledMeeting> {
    const user = await User.findById(userId).select('email');
    if (!user) {
      throw new NotFoundError('User not found.', 'USER_NOT_FOUND');
    }

    const isCode = meetingCodeRegex.test(meetingIdOrCode.trim().toLowerCase());
    const query = isCode
      ? { meetingCode: normalizeMeetingCode(meetingIdOrCode) }
      : { _id: new Types.ObjectId(meetingIdOrCode) };

    const meeting = await Meeting.findOne(query);
    if (!meeting) {
      throw new NotFoundError('Scheduled meeting not found.', 'MEETING_NOT_FOUND');
    }

    // Authorization: User must be host, participant, or invitee
    const isHost = meeting.hostId.equals(user._id);
    const isInvitee =
      meeting.invitees?.some(
        (inv) =>
          (inv.userId && inv.userId.equals(user._id)) ||
          inv.email.toLowerCase() === user.email.toLowerCase()
      ) ?? false;

    if (!isHost && !isInvitee) {
      const participant = await MeetingParticipant.findOne({
        meetingId: meeting._id,
        userId: user._id,
      });
      if (!participant) {
        throw new ForbiddenError(
          'You do not have permission to view this scheduled meeting.',
          'FORBIDDEN'
        );
      }
    }

    return this.serializeScheduledMeeting(meeting);
  }

  /**
   * Feature A2 — Edit Scheduled Meeting
   */
  async updateScheduledMeeting(
    userId: string,
    meetingId: string,
    input: UpdateScheduledMeetingInput
  ): Promise<SerializedScheduledMeeting> {
    if (!Types.ObjectId.isValid(meetingId)) {
      throw new BadRequestError('Invalid meeting ID.', 'INVALID_IDENTIFIER');
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      throw new NotFoundError('Scheduled meeting not found.', 'MEETING_NOT_FOUND');
    }

    // Host-only authorization
    if (!meeting.hostId.equals(new Types.ObjectId(userId))) {
      throw new ForbiddenError(
        'Only the meeting host can edit scheduled meeting details.',
        'FORBIDDEN'
      );
    }

    if (meeting.status === 'CANCELLED' || meeting.status === 'ENDED') {
      throw new BadRequestError(
        'Cannot edit a meeting that has already ended or been cancelled.',
        'INVALID_MEETING_STATE'
      );
    }

    const updateFields: Record<string, any> = {
      $inc: { version: 1 },
    };

    const setFields: Record<string, any> = {};

    if (input.title !== undefined) setFields.title = input.title.trim();
    if (input.description !== undefined) setFields.description = input.description?.trim() || null;

    if (input.settings) {
      if (input.settings.waitingRoomEnabled !== undefined) {
        setFields['settings.waitingRoomEnabled'] = input.settings.waitingRoomEnabled;
      }
      if (input.settings.allowCoHostAdmit !== undefined) {
        setFields['settings.allowCoHostAdmit'] = input.settings.allowCoHostAdmit;
      }
      if (input.settings.allowCoHostRemove !== undefined) {
        setFields['settings.allowCoHostRemove'] = input.settings.allowCoHostRemove;
      }
      if (input.settings.allowCoHostLock !== undefined) {
        setFields['settings.allowCoHostLock'] = input.settings.allowCoHostLock;
      }
    }

    let inviteesChanged = false;
    let newlyAddedInvitees: IMeetingInvitee[] = [];
    if (input.invitees !== undefined) {
      inviteesChanged = true;
      const emails = Array.from(new Set(input.invitees.map((i) => i.email.toLowerCase().trim())));
      const existingUsers = await User.find({ email: { $in: emails } }).select('_id email firstName lastName');
      const userByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

      const resolved: IMeetingInvitee[] = emails.map((cleanEmail) => {
        const matched = userByEmail.get(cleanEmail);
        const originalInv = input.invitees!.find(
          (i) => i.email.toLowerCase().trim() === cleanEmail
        );
        return {
          email: cleanEmail,
          userId: matched ? (matched._id as Types.ObjectId) : null,
          name:
            originalInv?.name?.trim() ||
            (matched ? `${matched.firstName} ${matched.lastName}`.trim() : null),
        };
      });
      setFields.invitees = resolved;

      const existingEmailSet = new Set(
        (meeting.invitees || []).map((i) => i.email.toLowerCase().trim())
      );
      newlyAddedInvitees = resolved.filter((r) => !existingEmailSet.has(r.email));
    }

    let remindersChanged = false;
    if (input.reminderPreferences !== undefined) {
      remindersChanged = true;
      setFields.reminderPreferences = input.reminderPreferences;
    }

    updateFields.$set = setFields;
    updateFields.$push = {
      auditLog: {
        $each: [
          {
            action: 'SETTINGS_UPDATED',
            actorId: new Types.ObjectId(userId),
            details: 'Meeting schedule details updated',
            timestamp: new Date(),
          },
        ],
        $slice: -MAX_AUDIT_ENTRIES,
      },
    };

    const updated = await Meeting.findByIdAndUpdate(meetingId, updateFields, {
      new: true,
    });

    if (!updated) {
      throw new NotFoundError('Meeting not found after update.', 'MEETING_NOT_FOUND');
    }

    if (remindersChanged || inviteesChanged) {
      await reminderWorker.rescheduleRemindersForMeeting(updated);
    }

    // Notify newly added registered invitees
    if (newlyAddedInvitees.length > 0) {
      const host = await User.findById(userId).select('firstName lastName');
      const hostName = host ? `${host.firstName} ${host.lastName}`.trim() : 'The host';
      const formattedStartTime = formatInTimeZone(
        updated.scheduledStartAt || new Date(),
        updated.scheduledTimeZone || 'UTC'
      );
      for (const inv of newlyAddedInvitees) {
        if (inv.userId && !inv.userId.equals(updated.hostId)) {
          await notificationService.createNotification({
            userId: inv.userId,
            type: 'MEETING_INVITATION',
            title: `Invited: ${updated.title}`,
            message: `${hostName} invited you to "${updated.title}" scheduled for ${formattedStartTime} (${updated.scheduledTimeZone || 'UTC'}).`,
            meetingId: updated._id,
            meetingCode: updated.meetingCode,
            deliveryKey: `invitation:${updated._id}:${inv.userId}:v${updated.scheduleVersion}`,
            metadata: {
              scheduledStartAt: updated.scheduledStartAt,
              scheduledTimeZone: updated.scheduledTimeZone,
              hostName,
            },
          });
        }
      }
    }

    const serialized = await this.serializeScheduledMeeting(updated);
    meetingRealtime.emitMeetingUpdated(userId, serialized);

    return serialized;
  }

  /**
   * Feature A3 — Reschedule Meeting
   */
  async rescheduleMeeting(
    userId: string,
    meetingId: string,
    input: RescheduleMeetingInput
  ): Promise<{
    meeting: SerializedScheduledMeeting;
    previousStartAt: string | null;
    newStartAt: string;
  }> {
    if (!Types.ObjectId.isValid(meetingId)) {
      throw new BadRequestError('Invalid meeting ID.', 'INVALID_IDENTIFIER');
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    if (!meeting.hostId.equals(new Types.ObjectId(userId))) {
      throw new ForbiddenError(
        'Only the meeting host can reschedule this meeting.',
        'FORBIDDEN'
      );
    }

    if (meeting.status === 'ACTIVE' || meeting.status === 'CANCELLED' || meeting.status === 'ENDED') {
      throw new BadRequestError(
        meeting.status === 'ACTIVE'
          ? 'Cannot reschedule a meeting that is currently in progress.'
          : 'Cannot reschedule a meeting that has already ended or been cancelled.',
        'INVALID_MEETING_STATE'
      );
    }

    const previousStartAt = meeting.scheduledStartAt ? meeting.scheduledStartAt.toISOString() : null;
    const newStart = new Date(input.scheduledStartAt);
    if (isNaN(newStart.getTime())) {
      throw new BadRequestError('Invalid new scheduledStartAt timestamp.', 'INVALID_DATETIME');
    }
    if (newStart.getTime() < Date.now() - 60_000) {
      throw new BadRequestError('Cannot reschedule a meeting to a time in the past.', 'PAST_DATETIME');
    }

    const previousDuration =
      meeting.scheduledStartAt && meeting.scheduledEndAt
        ? Math.round(
            (meeting.scheduledEndAt.getTime() - meeting.scheduledStartAt.getTime()) / 60000
          )
        : 60;

    const durationMinutes = input.durationMinutes || previousDuration;
    const newEnd = calculateScheduledEnd(newStart, durationMinutes);
    const newTimeZone = input.scheduledTimeZone
      ? normalizeIanaTimeZone(input.scheduledTimeZone)
      : meeting.scheduledTimeZone || 'UTC';

    const newExpiresAt = new Date(newEnd.getTime() + 24 * 60 * 60 * 1000);

    const updated = await Meeting.findOneAndUpdate(
      { _id: meeting._id, version: meeting.version, status: 'SCHEDULED' },
      {
        $set: {
          scheduledStartAt: newStart,
          scheduledEndAt: newEnd,
          scheduledTimeZone: newTimeZone,
          expiresAt: newExpiresAt,
        },
        $inc: {
          scheduleVersion: 1,
          version: 1,
        },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'RESCHEDULED',
                actorId: new Types.ObjectId(userId),
                details: `Rescheduled from ${previousStartAt || 'unspecified'} to ${newStart.toISOString()} (${newTimeZone})`,
                timestamp: new Date(),
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Meeting.findById(meeting._id).select('status version');
      if (latest && latest.status === 'ACTIVE') {
        throw new BadRequestError(
          'Cannot reschedule a meeting that is currently in progress.',
          'INVALID_MEETING_STATE'
        );
      }
      throw new ConflictError(
        'Meeting was modified concurrently. Please refresh and try again.',
        'CONCURRENT_MODIFICATION'
      );
    }

    // Invalidate old reminders and schedule fresh reminders atomically
    await reminderWorker.rescheduleRemindersForMeeting(updated);

    // Notify registered invitees of the new schedule
    const host = await User.findById(userId).select('firstName lastName');
    const hostName = host ? `${host.firstName} ${host.lastName}`.trim() : 'The host';
    const formattedStartTime = formatInTimeZone(newStart, newTimeZone);

    if (Array.isArray(updated.invitees)) {
      for (const inv of updated.invitees) {
        if (inv.userId && !inv.userId.equals(meeting.hostId)) {
          await notificationService.createNotification({
            userId: inv.userId,
            type: 'MEETING_RESCHEDULED',
            title: `Rescheduled: ${updated.title}`,
            message: `${hostName} rescheduled "${updated.title}" to ${formattedStartTime} (${newTimeZone}).`,
            meetingId: updated._id,
            meetingCode: updated.meetingCode,
            deliveryKey: `rescheduled:${updated._id}:${inv.userId}:v${updated.scheduleVersion}`,
            metadata: {
              previousStartAt,
              newStartAt: newStart.toISOString(),
              scheduledTimeZone: newTimeZone,
            },
          });
        }
      }
    }

    const serialized = await this.serializeScheduledMeeting(updated);
    meetingRealtime.emitMeetingRescheduled(userId, serialized);

    return {
      meeting: serialized,
      previousStartAt,
      newStartAt: newStart.toISOString(),
    };
  }

  /**
   * Feature A4 — Cancel Scheduled Meeting (Idempotent)
   */
  async cancelScheduledMeeting(
    userId: string,
    meetingId: string,
    input: CancelMeetingInput = {}
  ): Promise<SerializedScheduledMeeting> {
    if (!Types.ObjectId.isValid(meetingId)) {
      throw new BadRequestError('Invalid meeting ID.', 'INVALID_IDENTIFIER');
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    if (!meeting.hostId.equals(new Types.ObjectId(userId))) {
      throw new ForbiddenError(
        'Only the meeting host can cancel this meeting.',
        'FORBIDDEN'
      );
    }

    // Idempotent cancellation: if already cancelled, return existing cancelled record
    if (meeting.status === 'CANCELLED') {
      return this.serializeScheduledMeeting(meeting);
    }

    if (meeting.status === 'ACTIVE') {
      throw new BadRequestError(
        'Cannot cancel a meeting that is currently in progress.',
        'INVALID_MEETING_STATE'
      );
    }

    if (meeting.status === 'ENDED') {
      throw new BadRequestError(
        'Cannot cancel a meeting that has already completed.',
        'MEETING_ALREADY_ENDED'
      );
    }

    const now = new Date();
    const reason = input.reason?.trim() || null;

    const updated = await Meeting.findOneAndUpdate(
      { _id: new Types.ObjectId(meetingId), status: 'SCHEDULED' },
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: new Types.ObjectId(userId),
          cancellationReason: reason,
        },
        $inc: { version: 1 },
        $push: {
          auditLog: {
            $each: [
              {
                action: 'CANCELLED',
                actorId: new Types.ObjectId(userId),
                details: reason ? `Cancelled: ${reason}` : 'Meeting cancelled by host',
                timestamp: now,
              },
            ],
            $slice: -MAX_AUDIT_ENTRIES,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const latest = await Meeting.findById(meetingId);
      if (latest && latest.status === 'CANCELLED') {
        return this.serializeScheduledMeeting(latest);
      }
      if (latest && latest.status === 'ACTIVE') {
        throw new BadRequestError(
          'Cannot cancel a meeting that is currently in progress.',
          'INVALID_MEETING_STATE'
        );
      }
      throw new BadRequestError(
        'Cannot cancel meeting in its current state.',
        'INVALID_MEETING_STATE'
      );
    }

    // Invalidate all pending reminders
    await reminderWorker.cancelRemindersForMeeting(updated._id);

    // Notify registered invitees of meeting cancellation
    const host = await User.findById(userId).select('firstName lastName');
    const hostName = host ? `${host.firstName} ${host.lastName}`.trim() : 'The host';

    if (Array.isArray(updated.invitees)) {
      for (const inv of updated.invitees) {
        if (inv.userId && !inv.userId.equals(meeting.hostId)) {
          await notificationService.createNotification({
            userId: inv.userId,
            type: 'MEETING_CANCELLED',
            title: `Cancelled: ${updated.title}`,
            message: `${hostName} cancelled "${updated.title}"${reason ? `: ${reason}` : '.'}`,
            meetingId: updated._id,
            meetingCode: updated.meetingCode,
            deliveryKey: `cancelled:${updated._id}:${inv.userId}:v${updated.scheduleVersion}`,
            metadata: {
              cancellationReason: reason,
              cancelledAt: now.toISOString(),
            },
          });
        }
      }
    }

    const serialized = await this.serializeScheduledMeeting(updated);
    meetingRealtime.emitMeetingCancelled(userId, serialized);

    return serialized;
  }

  /**
   * Feature C — Upcoming Meetings Dashboard
   */
  async listUpcomingScheduledMeetings(
    userId: string,
    query: ListScheduledMeetingsQuery = { page: 1, limit: 10 }
  ): Promise<{
    meetings: SerializedScheduledMeeting[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const user = await User.findById(userId).select('email');
    if (!user) {
      throw new NotFoundError('User not found.', 'USER_NOT_FOUND');
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    // Default window: from 30 minutes in the past onwards
    const fromDate = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 60 * 1000);
    const toDate = query.to ? new Date(query.to) : null;

    const startFilter: Record<string, any> = { $gte: fromDate };
    if (toDate) {
      startFilter.$lte = toDate;
    }

    const userScope = {
      $or: [
        { hostId: user._id },
        { 'invitees.userId': user._id },
        { 'invitees.email': user.email.toLowerCase() },
      ],
    };

    // ACTIVE meetings are always included; SCHEDULED meetings must fall within time window (DEF-16-06)
    const statusOrTime = {
      $or: [
        { status: 'ACTIVE' },
        { status: 'SCHEDULED', scheduledStartAt: startFilter },
      ],
    };

    const filter: Record<string, any> = {
      $and: [userScope, statusOrTime],
    };

    const [docs, total] = await Promise.all([
      Meeting.find(filter)
        .sort({ scheduledStartAt: 1 })
        .skip(skip)
        .limit(limit),
      Meeting.countDocuments(filter),
    ]);

    const meetings = await Promise.all(docs.map((d) => this.serializeScheduledMeeting(d)));

    return {
      meetings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Feature D — Meeting History (Hosted or Attended)
   */
  async listMeetingHistory(
    userId: string,
    query: MeetingHistoryQuery = { page: 1, limit: 10, role: 'all', status: 'all', sort: 'desc' }
  ): Promise<{
    meetings: MeetingHistoryItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const userObjId = new Types.ObjectId(userId);
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    // 1. Identify meetings where user was a participant
    const participantRecords = await MeetingParticipant.find({
      userId: userObjId,
      $or: [
        { admissionStatus: 'ADMITTED' },
        { joinedAt: { $ne: null } },
      ],
    }).select('meetingId role joinedAt leftAt');

    const participantMeetingMap = new Map<string, string>();
    for (const p of participantRecords) {
      participantMeetingMap.set(p.meetingId.toString(), p.role);
    }
    const participantMeetingIds = Array.from(participantMeetingMap.keys()).map(
      (id) => new Types.ObjectId(id)
    );

    // 2. Build Query Filters
    const filter: Record<string, any> = {
      historyHiddenBy: { $ne: userObjId },
    };

    // Role filtering: host vs participant
    if (query.role === 'host') {
      filter.hostId = userObjId;
    } else if (query.role === 'participant') {
      filter.hostId = { $ne: userObjId };
      filter._id = { $in: participantMeetingIds };
    } else {
      // 'all' — user is host OR participant
      filter.$or = [{ hostId: userObjId }, { _id: { $in: participantMeetingIds } }];
    }

    // Status filtering: ENDED, CANCELLED, ACTIVE, or all historical states
    if (query.status === 'ENDED') {
      filter.status = { $in: ['ENDED', 'EXPIRED'] };
    } else if (query.status === 'CANCELLED') {
      filter.status = 'CANCELLED';
    } else if (query.status === 'ACTIVE') {
      filter.status = 'ACTIVE';
    } else {
      // By default, meeting history includes ended, cancelled, expired, or completed meetings
      filter.status = { $in: ['ENDED', 'CANCELLED', 'EXPIRED'] };
    }

    // Date range filtering against occurrence timestamp (endedAt -> activatedAt -> scheduledStartAt -> createdAt) (DEF-16-07)
    if (query.from || query.to) {
      const dateFilter: Record<string, any> = {};
      if (query.from) dateFilter.$gte = new Date(query.from);
      if (query.to) dateFilter.$lte = new Date(query.to);

      const occurrenceClauses = [
        { endedAt: dateFilter },
        { endedAt: null, activatedAt: dateFilter },
        { endedAt: null, activatedAt: null, scheduledStartAt: dateFilter },
        { endedAt: null, activatedAt: null, scheduledStartAt: null, createdAt: dateFilter },
      ];

      if (filter.$or) {
        const existingOr = filter.$or;
        delete filter.$or;
        filter.$and = [
          { $or: existingOr },
          { $or: occurrenceClauses },
        ];
      } else {
        filter.$or = occurrenceClauses;
      }
    }

    // Search filtering (title or meeting code) with regex escaping (DEF-16-01)
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      const normalizedCode = normalizeMeetingCode(term);
      if (normalizedCode) {
        filter.meetingCode = normalizedCode;
      } else {
        filter.title = { $regex: escapeRegex(term), $options: 'i' };
      }
    }

    const sortOrder = query.sort === 'asc' ? 1 : -1;
    const now = new Date();

    const matchedDocs = await Meeting.find(filter)
      .sort({ createdAt: sortOrder, _id: sortOrder })
      .populate('hostId', 'firstName lastName email');

    const retainedDocs =
      query.status === 'ACTIVE'
        ? matchedDocs
        : matchedDocs.filter((doc) => !isMeetingHistoryExpired(doc, now));

    const total = retainedDocs.length;
    const docs = retainedDocs.slice(skip, skip + limit);

    // Calculate accurate attended participant counts from MeetingParticipant (DEF-16-05)
    const meetingIds = docs.map((d) => d._id);
    const attendedAggregation = await MeetingParticipant.aggregate([
      {
        $match: {
          meetingId: { $in: meetingIds },
          $or: [
            { joinedAt: { $ne: null } },
            { admissionStatus: { $in: ['ADMITTED', 'LEFT', 'REMOVED'] } },
          ],
        },
      },
      {
        $group: {
          _id: '$meetingId',
          uniqueUsers: { $addToSet: { $ifNull: ['$userId', '$peerId'] } },
        },
      },
      {
        $project: {
          _id: 1,
          count: { $size: '$uniqueUsers' },
        },
      },
    ]);

    const attendedCountMap = new Map<string, number>();
    for (const row of attendedAggregation) {
      attendedCountMap.set(row._id.toString(), row.count);
    }

    const items: MeetingHistoryItem[] = [];

    for (const doc of docs) {
      const isHost = doc.hostId && (doc.hostId as any)._id?.equals(userObjId);
      const participantRole = isHost
        ? 'host'
        : (participantMeetingMap.get(doc._id.toString()) as any) || 'participant';

      let durationSeconds: number | null = null;
      if (doc.activatedAt && doc.endedAt) {
        durationSeconds = Math.max(
          0,
          Math.round((doc.endedAt.getTime() - doc.activatedAt.getTime()) / 1000)
        );
      }

      const hostDoc = doc.hostId as any;
      const hostName = hostDoc
        ? `${hostDoc.firstName || ''} ${hostDoc.lastName || ''}`.trim()
        : 'Unknown Host';

      items.push({
        id: doc._id.toString(),
        meetingCode: doc.meetingCode,
        title: doc.title,
        description: doc.description || null,
        hostId: hostDoc?._id?.toString() || doc.hostId.toString(),
        hostName,
        userRole: participantRole,
        status: doc.status,
        scheduledStartAt: doc.scheduledStartAt ? doc.scheduledStartAt.toISOString() : null,
        scheduledEndAt: doc.scheduledEndAt ? doc.scheduledEndAt.toISOString() : null,
        scheduledTimeZone: doc.scheduledTimeZone || null,
        activatedAt: doc.activatedAt ? doc.activatedAt.toISOString() : null,
        endedAt: doc.endedAt ? doc.endedAt.toISOString() : null,
        actualDurationSeconds: durationSeconds,
        formattedDuration: this.formatDuration(durationSeconds),
        participantCount:
          doc.status === 'ACTIVE'
            ? (doc.activeParticipantCount || 0)
            : (attendedCountMap.get(doc._id.toString()) ?? 0),
        cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
        cancellationReason: doc.cancellationReason || null,
        createdAt: doc.createdAt.toISOString(),
      });
    }

    return {
      meetings: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Feature D3 — Meeting History Details (Object-Level Authorization)
   */
  async getMeetingHistoryDetails(
    userId: string,
    meetingId: string
  ): Promise<{
    meeting: MeetingHistoryItem;
    participants: Array<{
      userId: string;
      displayName: string;
      role: string;
      joinedAt: string | null;
      leftAt: string | null;
    }>;
    timeline: Array<{
      action: string;
      details?: string;
      timestamp: string;
    }>;
  }> {
    if (!Types.ObjectId.isValid(meetingId)) {
      throw new BadRequestError('Invalid meeting ID.', 'INVALID_IDENTIFIER');
    }

    const userObjId = new Types.ObjectId(userId);
    const meeting = await Meeting.findById(meetingId).populate('hostId', 'firstName lastName email');
    if (!meeting) {
      throw new NotFoundError('Meeting history record not found.', 'MEETING_NOT_FOUND');
    }

    // Verify object-level authorization BEFORE checking expiration window so third-party callers receive 403
    const isHost = meeting.hostId && (meeting.hostId as any)._id?.equals(userObjId);
    let userRole: 'host' | 'co-host' | 'participant' = isHost ? 'host' : 'participant';

    if (!isHost) {
      const participation = await MeetingParticipant.findOne({
        meetingId: meeting._id,
        userId: userObjId,
      });

      if (!participation || (participation.admissionStatus !== 'ADMITTED' && !participation.joinedAt)) {
        throw new ForbiddenError(
          'You do not have authorization to view this meeting history.',
          'FORBIDDEN'
        );
      }
      userRole = participation.role;
    }

    if ((meeting.historyHiddenBy || []).some((id) => id.toString() === userId)) {
      throw new NotFoundError('Meeting history record not found.', 'MEETING_NOT_FOUND');
    }

    if (isMeetingHistoryExpired(meeting)) {
      throw new NotFoundError('Meeting history has expired after the 2-day retention window.', 'HISTORY_EXPIRED');
    }

    let durationSeconds: number | null = null;
    if (meeting.activatedAt && meeting.endedAt) {
      durationSeconds = Math.max(
        0,
        Math.round((meeting.endedAt.getTime() - meeting.activatedAt.getTime()) / 1000)
      );
    }

    const hostDoc = meeting.hostId as any;
    const hostName = hostDoc
      ? `${hostDoc.firstName || ''} ${hostDoc.lastName || ''}`.trim()
      : 'Unknown Host';

    // Retrieve participant attendance logs (no passwords, tokens, or private secrets) (DEF-16-05)
    const participantsDocs = await MeetingParticipant.find({
      meetingId: meeting._id,
      $or: [
        { admissionStatus: { $in: ['ADMITTED', 'LEFT', 'REMOVED'] } },
        { joinedAt: { $ne: null } },
      ],
    }).select('userId displayName role joinedAt leftAt');

    const uniqueAttendedCount = new Set(
      participantsDocs.map((p) => (p.userId ? p.userId.toString() : p._id.toString()))
    ).size;

    const historyItem: MeetingHistoryItem = {
      id: meeting._id.toString(),
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      description: meeting.description || null,
      hostId: hostDoc?._id?.toString() || meeting.hostId.toString(),
      hostName,
      userRole,
      status: meeting.status,
      scheduledStartAt: meeting.scheduledStartAt ? meeting.scheduledStartAt.toISOString() : null,
      scheduledEndAt: meeting.scheduledEndAt ? meeting.scheduledEndAt.toISOString() : null,
      scheduledTimeZone: meeting.scheduledTimeZone || null,
      activatedAt: meeting.activatedAt ? meeting.activatedAt.toISOString() : null,
      endedAt: meeting.endedAt ? meeting.endedAt.toISOString() : null,
      actualDurationSeconds: durationSeconds,
      formattedDuration: this.formatDuration(durationSeconds),
      participantCount:
        meeting.status === 'ACTIVE'
          ? (meeting.activeParticipantCount || 0)
          : uniqueAttendedCount,
      cancelledAt: meeting.cancelledAt ? meeting.cancelledAt.toISOString() : null,
      cancellationReason: meeting.cancellationReason || null,
      createdAt: meeting.createdAt.toISOString(),
    };

    const participants = participantsDocs.map((p) => ({
      userId: p.userId ? p.userId.toString() : p._id.toString(),
      displayName: p.displayName,
      role: p.role,
      joinedAt: p.joinedAt ? p.joinedAt.toISOString() : null,
      leftAt: p.leftAt ? p.leftAt.toISOString() : null,
    }));

    // Build historical timeline from audit log
    const timeline = (meeting.auditLog || []).map((entry) => ({
      action: entry.action,
      details: entry.details,
      timestamp: entry.timestamp.toISOString(),
    }));

    return {
      meeting: historyItem,
      participants,
      timeline,
    };
  }

  /**
   * Removes historical meetings from the caller's personal account history, and
   * permanently purges any meeting once zero non-hidden viewers remain.
   */
  async deleteMeetingHistoryEntries(
    userId: string,
    meetingIds: string[]
  ): Promise<{ deletedIds: string[]; deletedCount: number; purgedIds: string[] }> {
    const uniqueIds = Array.from(new Set(meetingIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new BadRequestError('At least one meeting ID is required.', 'VALIDATION_ERROR');
    }

    for (const id of uniqueIds) {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestError('Invalid meeting ID.', 'INVALID_IDENTIFIER');
      }
    }

    const userObjId = new Types.ObjectId(userId);
    const objIds = uniqueIds.map((id) => new Types.ObjectId(id));
    const meetings = await Meeting.find({ _id: { $in: objIds } });
    const meetingById = new Map(meetings.map((m) => [m._id.toString(), m]));

    if (meetingById.size !== uniqueIds.length) {
      throw new NotFoundError('Meeting history record not found.', 'MEETING_NOT_FOUND');
    }

    const participantRows = await MeetingParticipant.find({
      meetingId: { $in: objIds },
      $or: [{ admissionStatus: 'ADMITTED' }, { joinedAt: { $ne: null } }],
    }).select('meetingId userId');

    const attendeesByMeeting = new Map<string, Set<string>>();
    for (const row of participantRows) {
      if (!row.userId) continue;
      const mId = row.meetingId.toString();
      let set = attendeesByMeeting.get(mId);
      if (!set) {
        set = new Set<string>();
        attendeesByMeeting.set(mId, set);
      }
      set.add(row.userId.toString());
    }

    // Authorize and validate state for every requested ID atomically before mutating
    const purgeIds: Types.ObjectId[] = [];
    for (const id of uniqueIds) {
      const meeting = meetingById.get(id)!;
      const isHost = meeting.hostId.toString() === userId;
      const isAttendee = attendeesByMeeting.get(id)?.has(userId) ?? false;

      if (!isHost && !isAttendee) {
        throw new ForbiddenError(
          'You do not have authorization to remove this meeting history.',
          'FORBIDDEN'
        );
      }

      if (!['ENDED', 'CANCELLED', 'EXPIRED'].includes(meeting.status)) {
        throw new BadRequestError(
          'Only ended, cancelled, or expired meetings can be removed from history.',
          'INVALID_STATE'
        );
      }

      if ((meeting.historyHiddenBy || []).some((hiddenId) => hiddenId.toString() === userId)) {
        throw new NotFoundError('Meeting history record not found.', 'MEETING_NOT_FOUND');
      }

      const viewerIds = new Set<string>([meeting.hostId.toString()]);
      for (const attendeeId of attendeesByMeeting.get(id) || []) {
        viewerIds.add(attendeeId);
      }
      const hiddenAfter = new Set<string>(
        (meeting.historyHiddenBy || []).map((hiddenId) => hiddenId.toString())
      );
      hiddenAfter.add(userId);

      const hasRemainingViewers = Array.from(viewerIds).some((viewerId) => !hiddenAfter.has(viewerId));
      if (!hasRemainingViewers) {
        purgeIds.push(meeting._id as Types.ObjectId);
      }
    }

    await Meeting.updateMany(
      { _id: { $in: objIds } },
      { $addToSet: { historyHiddenBy: userObjId } }
    );

    if (purgeIds.length > 0) {
      await purgeMeetingsAndCascade(purgeIds);
    }

    return {
      deletedIds: uniqueIds,
      deletedCount: uniqueIds.length,
      purgedIds: purgeIds.map((id) => id.toString()),
    };
  }

  async deleteMeetingHistoryEntry(
    userId: string,
    meetingId: string
  ): Promise<{ deletedId: string; purged: boolean }> {
    const result = await this.deleteMeetingHistoryEntries(userId, [meetingId]);
    return {
      deletedId: result.deletedIds[0],
      purged: result.purgedIds.includes(result.deletedIds[0]),
    };
  }

  /**
   * Feature F — Generate Meeting Invitation Text
   */
  async generateInvitation(meetingIdOrCode: string): Promise<{
    meetingCode: string;
    title: string;
    joinUrl: string;
    scheduledTimeFormatted: string;
    invitationText: string;
  }> {
    const isCode = meetingCodeRegex.test(meetingIdOrCode.trim().toLowerCase());
    const query = isCode
      ? { meetingCode: normalizeMeetingCode(meetingIdOrCode) }
      : { _id: new Types.ObjectId(meetingIdOrCode) };

    const meeting = await Meeting.findOne(query).populate('hostId', 'firstName lastName');
    if (!meeting) {
      throw new NotFoundError('Meeting not found.', 'MEETING_NOT_FOUND');
    }

    const hostDoc = meeting.hostId as any;
    const hostName = hostDoc ? `${hostDoc.firstName} ${hostDoc.lastName}`.trim() : 'The host';
    const baseOrigin = env.CLIENT_ORIGIN.replace(/\/+$/, '');
    const joinUrl = `${baseOrigin}/join/${meeting.meetingCode}`;

    let timeText = 'Now (Instant Room)';
    if (meeting.scheduledStartAt) {
      const tz = meeting.scheduledTimeZone || 'UTC';
      timeText = `${formatInTimeZone(meeting.scheduledStartAt, tz)} (${tz})`;
    }

    const invitationText = [
      `You're invited to join a CONNECTLY video collaboration session:`,
      ``,
      `Topic: ${meeting.title}`,
      `Host: ${hostName}`,
      `Time: ${timeText}`,
      `Meeting Code: ${meeting.meetingCode}`,
      `Join Link: ${joinUrl}`,
      ``,
      `Click the link or enter the meeting code in CONNECTLY to join.`,
    ].join('\n');

    return {
      meetingCode: meeting.meetingCode,
      title: meeting.title,
      joinUrl,
      scheduledTimeFormatted: timeText,
      invitationText,
    };
  }
}

const meetingCodeRegex = /^cly-[a-z0-9]{3}-[a-z0-9]{3}$/;
export const schedulingService = new SchedulingService();
