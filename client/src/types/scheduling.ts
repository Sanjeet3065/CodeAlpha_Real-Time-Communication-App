export interface IScheduledMeeting {
  id: string;
  meetingCode: string;
  title: string;
  description: string | null;
  joinUrl: string;
  hostId: string;
  hostName: string;
  hostEmail: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'EXPIRED' | 'CANCELLED';
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

export interface IMeetingHistoryItem {
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

export interface IMeetingHistoryDetails {
  meeting: IMeetingHistoryItem;
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
}

export interface IMeetingInvitation {
  meetingCode: string;
  title: string;
  joinUrl: string;
  scheduledTimeFormatted: string;
  invitationText: string;
}

export interface IInAppNotification {
  id: string;
  type: 'MEETING_INVITATION' | 'MEETING_REMINDER' | 'MEETING_RESCHEDULED' | 'MEETING_CANCELLED';
  title: string;
  message: string;
  meetingId: string | null;
  meetingCode: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface ScheduleMeetingPayload {
  title: string;
  description?: string;
  scheduledStartAt: string;
  durationMinutes: number;
  scheduledTimeZone: string;
  invitees?: Array<{ email: string; name?: string }>;
  reminderPreferences?: number[];
  settings?: {
    waitingRoomEnabled?: boolean;
    allowCoHostAdmit?: boolean;
    allowCoHostRemove?: boolean;
    allowCoHostLock?: boolean;
  };
}

export interface UpdateScheduledMeetingPayload {
  title?: string;
  description?: string;
  invitees?: Array<{ email: string; name?: string }>;
  reminderPreferences?: number[];
  settings?: {
    waitingRoomEnabled?: boolean;
    allowCoHostAdmit?: boolean;
    allowCoHostRemove?: boolean;
    allowCoHostLock?: boolean;
  };
}

export interface RescheduleMeetingPayload {
  scheduledStartAt: string;
  durationMinutes?: number;
  scheduledTimeZone?: string;
}
