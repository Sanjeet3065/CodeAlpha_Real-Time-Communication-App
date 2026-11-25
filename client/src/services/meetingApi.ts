import { fetchWithAuth, ApiError } from './authApi.ts';
import type {
  CreateMeetingPayload,
  JoinMeetingResponse,
  LeaveMeetingResponse,
  LiveKitTokenResponse,
  MeetingMetadataResponse,
  MeetingParticipantInfo,
  MeetingStateResponse,
  MeetingSummary,
  UpdateMeetingSettingsPayload,
} from '@/types/meeting';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

async function parseMeetingResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError({
      status: body?.status || res.status,
      code: body?.code || 'MEETING_API_ERROR',
      message: body?.message || `Request failed with status ${res.status}`,
      errors: body?.errors,
      timestamp: body?.timestamp || new Date().toISOString(),
    });
  }
  return (body?.data ?? body) as T;
}

export const meetingApi = {
  async createMeeting(payload: CreateMeetingPayload = {}): Promise<{ meeting: MeetingSummary }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/instant`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return parseMeetingResponse<{ meeting: MeetingSummary }>(res);
  },

  async getMeetingMetadata(meetingCode: string): Promise<MeetingMetadataResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}`, {
      method: 'GET',
    });
    return parseMeetingResponse<MeetingMetadataResponse>(res);
  },

  async validateMeetingCode(meetingCode: string): Promise<MeetingMetadataResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/validate/${encoded}`, {
      method: 'GET',
    });
    return parseMeetingResponse<MeetingMetadataResponse>(res);
  },

  async joinMeeting(
    meetingCode: string,
    payload: { displayName?: string } = {}
  ): Promise<JoinMeetingResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/join`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return parseMeetingResponse<JoinMeetingResponse>(res);
  },

  async leaveMeeting(meetingCode: string): Promise<LeaveMeetingResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/leave`, {
      method: 'POST',
    });
    return parseMeetingResponse<LeaveMeetingResponse>(res);
  },

  async getMeetingState(meetingCode: string): Promise<MeetingStateResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/state`, {
      method: 'GET',
    });
    return parseMeetingResponse<MeetingStateResponse>(res);
  },

  async listParticipants(
    meetingCode: string
  ): Promise<{ participants: MeetingParticipantInfo[]; count: number }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/participants`, {
      method: 'GET',
    });
    return parseMeetingResponse<{ participants: MeetingParticipantInfo[]; count: number }>(res);
  },

  async listWaitingRoom(
    meetingCode: string
  ): Promise<{ waitingList: MeetingParticipantInfo[]; count: number }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/waiting-room`, {
      method: 'GET',
    });
    return parseMeetingResponse<{ waitingList: MeetingParticipantInfo[]; count: number }>(res);
  },

  async admitParticipant(
    meetingCode: string,
    targetUserId: string
  ): Promise<{
    participant: MeetingParticipantInfo;
    activeParticipantCount: number;
    waitingList: MeetingParticipantInfo[];
  }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encoded}/waiting-room/${encodeURIComponent(targetUserId)}/admit`,
      { method: 'POST' }
    );
    return parseMeetingResponse(res);
  },

  async rejectParticipant(
    meetingCode: string,
    targetUserId: string,
    reason?: string
  ): Promise<{ waitingList: MeetingParticipantInfo[] }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encoded}/waiting-room/${encodeURIComponent(targetUserId)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      }
    );
    return parseMeetingResponse(res);
  },

  async removeParticipant(
    meetingCode: string,
    targetUserId: string,
    reason?: string
  ): Promise<{ activeParticipantCount: number }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encoded}/participants/${encodeURIComponent(targetUserId)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(reason ? { reason } : {}),
      }
    );
    return parseMeetingResponse(res);
  },

  async updateParticipantRole(
    meetingCode: string,
    targetUserId: string,
    role: 'co-host' | 'participant'
  ): Promise<{ participant: MeetingParticipantInfo }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encoded}/participants/${encodeURIComponent(targetUserId)}/role`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }
    );
    return parseMeetingResponse(res);
  },

  async lockMeeting(meetingCode: string): Promise<{ meeting: MeetingSummary }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/lock`, {
      method: 'POST',
    });
    return parseMeetingResponse(res);
  },

  async unlockMeeting(meetingCode: string): Promise<{ meeting: MeetingSummary }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/unlock`, {
      method: 'POST',
    });
    return parseMeetingResponse(res);
  },

  async updateSettings(
    meetingCode: string,
    payload: UpdateMeetingSettingsPayload
  ): Promise<{ meeting: MeetingSummary }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return parseMeetingResponse(res);
  },

  async endMeeting(meetingCode: string): Promise<{ meeting: MeetingSummary }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/end`, {
      method: 'POST',
    });
    return parseMeetingResponse(res);
  },

  async getLiveKitToken(meetingCode: string): Promise<LiveKitTokenResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/livekit-token`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return parseMeetingResponse<LiveKitTokenResponse>(res);
  },
};

export function getMeetingErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'INVALID_MEETING_CODE':
      return 'Invalid meeting code. Please enter a valid code like cly-789-qwa.';
    case 'MEETING_NOT_FOUND':
      return 'We could not find a meeting with that code. Double-check the link or code.';
    case 'MEETING_ENDED':
      return 'This meeting has already ended and can no longer be joined.';
    case 'MEETING_EXPIRED':
      return 'This meeting link has expired. Please ask the host to create a new room.';
    case 'MEETING_LOCKED':
      return 'This meeting is currently locked by the host. New participants cannot enter.';
    case 'MEETING_FULL':
      return 'This meeting has reached its maximum participant capacity.';
    case 'PARTICIPANT_REMOVED':
      return 'You were removed from this meeting by the host and cannot rejoin.';
    case 'FORBIDDEN':
      return 'You do not have permission to perform this action.';
    case 'LIVEKIT_NOT_CONFIGURED':
      return 'LiveKit media transport is not configured on the server yet.';
    case 'LIVEKIT_UNAVAILABLE':
      return 'Unable to reach the LiveKit media server right now. You can retry shortly.';
    case 'LIVEKIT_TOKEN_GENERATION_FAILED':
      return 'Unable to issue a secure media connection token. Please try reconnecting.';
    case 'LIVEKIT_ACCESS_DENIED':
      return 'Media connection access denied. You must be an admitted participant to connect.';
    case 'LIVEKIT_INVALID_TOKEN':
      return 'Your media session token is invalid or has expired. Reconnect to obtain a fresh token.';
    case 'LIVEKIT_CONNECTION_FAILED':
      return 'Could not establish a WebRTC/LiveKit connection. Check your network and retry.';
    case 'LIVEKIT_MEETING_ENDED':
      return 'This meeting has ended. LiveKit media connections are closed.';
    default:
      return fallback || 'Unable to complete the meeting request. Please try again.';
  }
}
