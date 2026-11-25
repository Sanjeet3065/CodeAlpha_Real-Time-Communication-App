/**
 * CONNECTLY Dashboard Domain Types & Data Contracts
 * Defines the future-proof typed contracts for:
 * - Upcoming Meetings Agenda (Phase 08 Meeting Room Management & Phase 16 Scheduling)
 * - Recent Downloads & Shared Files Widget (Phase 13 File Sharing integration)
 * - Recent Meeting Activity Feed (Phase 16 Scheduling & Meeting History)
 */

export interface IMeetingAgendaItem {
  id: string;
  code: string; // e.g. 'cly-789-qwa'
  title: string;
  scheduledStart: string; // ISO 8601 string
  scheduledEnd: string; // ISO 8601 string
  host: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  isWaitingRoomEnabled: boolean;
  participantCount: number;
  inviteUrl: string;
}

export interface ISharedFileItem {
  id: string;
  name: string;
  extension: string; // e.g. 'pdf', 'xlsx', 'png'
  sizeBytes: number;
  sharedAt: string; // ISO 8601 string
  associatedMeetingName: string; // Traceable meeting name
  associatedMeetingCode: string; // Traceable meeting code
  sharedBy: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  mimeType: string;
}

export interface IActivityEvent {
  id: string;
  type: 'meeting_hosted' | 'meeting_attended' | 'file_shared';
  title: string;
  timestamp: string; // ISO 8601 string
  durationMinutes?: number;
  participantCount?: number;
  meetingCode?: string;
}

export interface QuickStatsData {
  // Reserved for Phase 08/16 when real telemetry exists.
  // Never populate with fabricated counters.
  totalHosted?: number;
  totalAttended?: number;
  totalDurationMinutes?: number;
}
