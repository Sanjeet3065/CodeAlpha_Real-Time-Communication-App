import { fetchWithAuth, ApiError } from './authApi.ts';
import type {
  IScheduledMeeting,
  IMeetingHistoryItem,
  IMeetingHistoryDetails,
  IMeetingInvitation,
  IInAppNotification,
  ScheduleMeetingPayload,
  UpdateScheduledMeetingPayload,
  RescheduleMeetingPayload,
} from '@/types/scheduling';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

async function parseResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError({
      status: body?.status || res.status,
      code: body?.error?.code || body?.code || 'API_ERROR',
      message: body?.error?.message || body?.message || `Request failed with status ${res.status}`,
      errors: body?.error?.details || body?.errors,
      timestamp: body?.timestamp || new Date().toISOString(),
    });
  }
  return (body?.data ?? body) as T;
}

export const schedulingApi = {
  async scheduleMeeting(payload: ScheduleMeetingPayload): Promise<{ meeting: IScheduledMeeting }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/scheduled`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return parseResponse<{ meeting: IScheduledMeeting }>(res);
  },

  async getScheduledMeeting(meetingId: string): Promise<{ meeting: IScheduledMeeting }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/scheduled/${encodeURIComponent(meetingId)}`, {
      method: 'GET',
    });
    return parseResponse<{ meeting: IScheduledMeeting }>(res);
  },

  async updateScheduledMeeting(
    meetingId: string,
    payload: UpdateScheduledMeetingPayload
  ): Promise<{ meeting: IScheduledMeeting }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/scheduled/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return parseResponse<{ meeting: IScheduledMeeting }>(res);
  },

  async rescheduleMeeting(
    meetingId: string,
    payload: RescheduleMeetingPayload
  ): Promise<{ meeting: IScheduledMeeting; previousStartAt: string | null; newStartAt: string }> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/scheduled/${encodeURIComponent(meetingId)}/reschedule`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return parseResponse(res);
  },

  async cancelScheduledMeeting(
    meetingId: string,
    reason?: string
  ): Promise<{ meeting: IScheduledMeeting }> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/scheduled/${encodeURIComponent(meetingId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      }
    );
    return parseResponse<{ meeting: IScheduledMeeting }>(res);
  },

  async cancelMeeting(
    meetingId: string,
    reason?: string
  ): Promise<{ meeting: IScheduledMeeting }> {
    return this.cancelScheduledMeeting(meetingId, reason);
  },

  async listUpcomingMeetings(params?: {
    page?: number;
    limit?: number;
    from?: string;
    to?: string;
  }): Promise<{
    meetings: IScheduledMeeting[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);

    const queryStr = searchParams.toString();
    const url = `${API_BASE_URL}/meetings/scheduled${queryStr ? `?${queryStr}` : ''}`;
    const res = await fetchWithAuth(url, { method: 'GET' });
    return parseResponse(res);
  },

  async listMeetingHistory(params?: {
    page?: number;
    limit?: number;
    role?: 'all' | 'host' | 'participant';
    status?: 'all' | 'ENDED' | 'CANCELLED';
    search?: string;
    from?: string;
    to?: string;
    sort?: 'desc' | 'asc';
  }): Promise<{
    meetings: IMeetingHistoryItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.role) searchParams.set('role', params.role);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.sort) searchParams.set('sort', params.sort);

    const queryStr = searchParams.toString();
    const url = `${API_BASE_URL}/meetings/history${queryStr ? `?${queryStr}` : ''}`;
    const res = await fetchWithAuth(url, { method: 'GET' });
    return parseResponse(res);
  },

  async getMeetingHistoryDetails(meetingId: string): Promise<IMeetingHistoryDetails> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/history/${encodeURIComponent(meetingId)}`,
      { method: 'GET' }
    );
    const data = await parseResponse<{ meeting: IMeetingHistoryDetails }>(res);
    return data.meeting;
  },

  async deleteMeetingHistoryEntry(
    meetingId: string
  ): Promise<{ deletedId: string; purged: boolean }> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/history/${encodeURIComponent(meetingId)}`,
      { method: 'DELETE' }
    );
    return parseResponse<{ deletedId: string; purged: boolean }>(res);
  },

  async deleteMeetingHistoryEntries(
    meetingIds: string[]
  ): Promise<{ deletedIds: string[]; deletedCount: number; purgedIds: string[] }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/history`, {
      method: 'DELETE',
      body: JSON.stringify({ meetingIds }),
    });
    return parseResponse<{ deletedIds: string[]; deletedCount: number; purgedIds: string[] }>(res);
  },

  async getMeetingInvitation(meetingCode: string): Promise<IMeetingInvitation> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/meetings/${encodeURIComponent(meetingCode)}/invitation`,
      { method: 'GET' }
    );
    return parseResponse<IMeetingInvitation>(res);
  },

  async listNotifications(params?: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<{
    notifications: IInAppNotification[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    unreadCount: number;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.unreadOnly) searchParams.set('unreadOnly', 'true');

    const queryStr = searchParams.toString();
    const url = `${API_BASE_URL}/users/me/notifications${queryStr ? `?${queryStr}` : ''}`;
    const res = await fetchWithAuth(url, { method: 'GET' });
    return parseResponse(res);
  },

  async markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
    const res = await fetchWithAuth(
      `${API_BASE_URL}/users/me/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'PATCH' }
    );
    return parseResponse(res);
  },

  async markAllNotificationsRead(): Promise<{ modifiedCount: number }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/users/me/notifications/read-all`, {
      method: 'POST',
    });
    return parseResponse(res);
  },
};
