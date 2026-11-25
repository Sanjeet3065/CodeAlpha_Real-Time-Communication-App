import { authStorage, ApiError } from './authApi.ts';
import type {
  WhiteboardStateDto,
  WhiteboardOperation,
} from '@/types/whiteboard';

const API_BASE_URL = '/api/v1';

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = authStorage.getAccessToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Include CSRF headers
  headers.set('X-Requested-With', 'XMLHttpRequest');
  headers.set('X-CSRF-Protection', '1');

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  return res;
}

async function parseResponse<T>(res: Response): Promise<T> {
  let data: {
    status?: number;
    code?: string;
    message?: string;
    errors?: Array<{ field: string; message: string }>;
    data?: unknown;
    error?: { code?: string; message?: string; errors?: Array<{ field: string; message: string }> };
    timestamp?: string;
  };
  try {
    data = await res.json();
  } catch {
    throw new ApiError({
      status: res.status,
      code: 'PARSE_ERROR',
      message: 'Failed to parse server response.',
      timestamp: new Date().toISOString(),
    });
  }

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: data?.code || data?.error?.code || 'UNKNOWN_ERROR',
      message: data?.message || data?.error?.message || `Request failed with status ${res.status}`,
      errors: data?.errors || data?.error?.errors,
      timestamp: data?.timestamp || new Date().toISOString(),
    });
  }

  return (data?.data !== undefined ? data.data : data) as T;
}

export const whiteboardApi = {
  /**
   * Fetches the current authoritative whiteboard state for a meeting.
   */
  async getWhiteboardState(meetingCode: string): Promise<WhiteboardStateDto> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/whiteboard`, {
      method: 'GET',
    });
    return parseResponse<WhiteboardStateDto>(res);
  },

  /**
   * Submits a batch of drawing operations (add, update, delete) via REST fallback.
   */
  async submitOperations(
    meetingCode: string,
    operations: WhiteboardOperation[]
  ): Promise<{ version: number; appliedCount: number }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/whiteboard/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    return parseResponse<{ version: number; appliedCount: number }>(res);
  },

  /**
   * Undoes the user's latest active whiteboard operation.
   */
  async undoOperation(
    meetingCode: string
  ): Promise<{ ok: boolean; version?: number; elementId?: string }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/whiteboard/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return parseResponse<{ ok: boolean; version?: number; elementId?: string }>(res);
  },

  /**
   * Redoes the user's latest undone whiteboard operation.
   */
  async redoOperation(
    meetingCode: string
  ): Promise<{ ok: boolean; version?: number; elementId?: string }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/whiteboard/redo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return parseResponse<{ ok: boolean; version?: number; elementId?: string }>(res);
  },

  /**
   * Clears all active elements from the whiteboard (Host/Co-host only).
   */
  async clearWhiteboard(
    meetingCode: string
  ): Promise<{ ok: boolean; version: number; clearedAt: string }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/whiteboard/clear`, {
      method: 'DELETE',
    });
    return parseResponse<{ ok: boolean; version: number; clearedAt: string }>(res);
  },
};
