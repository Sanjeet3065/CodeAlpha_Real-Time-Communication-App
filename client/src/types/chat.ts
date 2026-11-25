/**
 * CONNECTLY — Phase 12 Real-Time Chat & Reactions Types
 */

import type { ParticipantRole } from './meeting';

export const ALLOWED_REACTIONS = ['👍', '❤️', '👏', '🎉', '😂', '😮', '🔥', '🚀'] as const;

export type AllowedReaction = typeof ALLOWED_REACTIONS[number];

export type MessageDeliveryStatus = 'sending' | 'delivered' | 'failed';

export interface ChatMessage {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  senderAvatarUrl?: string | null;
  content: string;
  clientMessageId?: string;
  createdAt: string;
  deliveryStatus?: MessageDeliveryStatus;
}

export interface MeetingReaction {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  senderAvatarUrl?: string | null;
  emoji: string;
  clientReactionId?: string;
  createdAt: string;
}

export interface FloatingReactionItem extends MeetingReaction {
  instanceKey: string;
  xPercent: number;
}

export interface SendChatMessagePayload {
  content: string;
  clientMessageId?: string;
}

export interface SendReactionPayload {
  emoji: string;
  clientReactionId: string;
}

export interface ChatHistoryQuery {
  limit?: number;
  before?: string;
  beforeId?: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string | null;
}
