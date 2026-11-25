/**
 * CONNECTLY — Phase 12 Chat & Reactions REST API Client
 */

import { fetchWithAuth, ApiError } from './authApi.ts';
import type {
  ChatMessage,
  MeetingReaction,
  ChatHistoryQuery,
  ChatHistoryResponse,
  SendChatMessagePayload,
  SendReactionPayload,
} from '@/types/chat';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string) || '/api/v1';

async function parseChatResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError({
      status: body?.status || res.status,
      code: body?.code || 'CHAT_API_ERROR',
      message: body?.message || `Request failed with status ${res.status}`,
      errors: body?.errors,
      timestamp: body?.timestamp || new Date().toISOString(),
    });
  }
  return (body?.data ?? body) as T;
}

export const chatApi = {
  /**
   * Fetch paginated chat history for an admitted meeting participant
   */
  async getChatHistory(
    meetingCode: string,
    query: ChatHistoryQuery = {}
  ): Promise<ChatHistoryResponse> {
    const encoded = encodeURIComponent(meetingCode);
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.before) params.set('before', query.before);
    if (query.beforeId) params.set('beforeId', query.beforeId);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/chat${queryString}`, {
      method: 'GET',
    });
    return parseChatResponse<ChatHistoryResponse>(res);
  },

  /**
   * Send a chat message via REST endpoint (fallback or alternative to socket)
   */
  async sendChatMessage(
    meetingCode: string,
    payload: SendChatMessagePayload
  ): Promise<{ message: ChatMessage }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/chat`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return parseChatResponse<{ message: ChatMessage }>(res);
  },

  /**
   * Send an emoji reaction via REST endpoint
   */
  async sendReaction(
    meetingCode: string,
    payload: SendReactionPayload
  ): Promise<{ reaction: MeetingReaction }> {
    const encoded = encodeURIComponent(meetingCode);
    const res = await fetchWithAuth(`${API_BASE_URL}/meetings/${encoded}/reactions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return parseChatResponse<{ reaction: MeetingReaction }>(res);
  },
};
