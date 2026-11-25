import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { MeetingParticipant, type ParticipantRole } from '../models/MeetingParticipant.model.js';
import { ChatMessage, toChatMessageDto, type ChatMessageDto } from '../models/ChatMessage.model.js';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { meetingService } from './meeting.service.js';
import { chatRedisService, ChatRedisService } from './chatRedis.service.js';
import { cryptoEngine } from '../utils/crypto.js';
import {
  type SendChatMessageInput,
  type GetChatHistoryQuery,
  type SendReactionInput,
  ALLOWED_REACTIONS,
} from '../schemas/chat.schema.js';
import {
  AppError,
  BadRequestError,
  ForbiddenError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface MeetingReactionDto {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderRole: ParticipantRole;
  senderAvatarUrl?: string | null;
  emoji: string;
  timestamp: string;
}

export interface ChatHistoryResult {
  messages: ChatMessageDto[];
  hasMore: boolean;
  nextCursor?: string | null;
  totalCount?: number;
}

// Canonical rate-limit parameters
export const CHAT_RATE_LIMIT_WINDOW_MS = 5_000;
export const CHAT_RATE_LIMIT_MAX_MESSAGES = 10;

export const REACTION_RATE_LIMIT_WINDOW_MS = 3_000;
export const REACTION_RATE_LIMIT_MAX_REACTIONS = 5;

export class ChatService {
  constructor(private readonly redisService: ChatRedisService = chatRedisService) {}

  public clearRateLimits(): void {
    this.redisService.clearLocalState();
  }

  /**
   * Sends a meeting chat message with server-side authentication, participant admission
   * verification, rate limiting, and idempotency protection.
   */
  public async sendMessage(
    rawCode: string,
    userId: string,
    input: SendChatMessageInput
  ): Promise<ChatMessageDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const trimmedContent = (input.content || '').trim();
    if (!trimmedContent) {
      throw new BadRequestError('Chat message cannot be empty.', 'EMPTY_MESSAGE');
    }
    if (trimmedContent.length > 1000) {
      throw new BadRequestError(
        'Chat message exceeds maximum allowed length of 1000 characters.',
        'MESSAGE_TOO_LONG'
      );
    }

    const meeting = await meetingService.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED') {
      throw new AppError(
        'This meeting has ended and cannot receive new chat messages.',
        410,
        'MEETING_ENDED'
      );
    }
    if (meeting.status === 'EXPIRED') {
      throw new AppError(
        'This meeting has expired and cannot receive new chat messages.',
        410,
        'MEETING_EXPIRED'
      );
    }

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant || participant.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError(
        participant?.admissionStatus === 'WAITING'
          ? 'Waiting-room participants cannot participate in meeting chat.'
          : participant?.admissionStatus === 'REMOVED'
            ? 'You were removed from this meeting and cannot send chat messages.'
            : 'You are not an active admitted participant in this meeting.',
        'CHAT_ACCESS_DENIED'
      );
    }

    // Idempotency check: if client provided a clientMessageId, check if already recorded
    const clientMessageId = input.clientMessageId?.trim() || null;
    if (clientMessageId) {
      const existing = await ChatMessage.findOne({
        meetingId: meeting._id,
        clientMessageId,
      });
      if (existing) {
        return toChatMessageDto(existing);
      }
    }

    // Atomic distributed rate limiting per user within meeting
    const rateLimitKey = `connectly:rl:chat:${meeting._id.toString()}:${userId}`;
    const allowed = await this.redisService.checkRateLimit(
      rateLimitKey,
      CHAT_RATE_LIMIT_WINDOW_MS,
      CHAT_RATE_LIMIT_MAX_MESSAGES
    );

    if (!allowed) {
      throw new AppError(
        'You are sending messages too quickly. Please wait a moment.',
        429,
        'RATE_LIMIT_EXCEEDED'
      );
    }

    try {
      // Phase 15: Application-level envelope encryption with entity-bound AAD (AES-256-GCM)
      const encryptedContent = cryptoEngine.encrypt(trimmedContent, {
        aad: `chat:${meeting._id.toString()}`,
      });

      const doc = await ChatMessage.create({
        meetingId: meeting._id,
        senderId: participant.userId,
        senderName: participant.displayName,
        senderRole: participant.role,
        senderAvatarUrl: participant.avatarUrl || null,
        content: encryptedContent,
        clientMessageId,
      });

      const dto = toChatMessageDto(doc);

      // Broadcast to all admitted participants in the meeting room
      meetingRealtime.emitChatMessage(meeting._id.toString(), dto);

      logger.info('[Chat] Message sent successfully', {
        metadata: {
          meetingId: meeting._id.toString(),
          senderId: userId,
          contentLength: trimmedContent.length,
          messageId: doc._id.toString(),
        },
      });

      return dto;
    } catch (err: any) {
      // If concurrent request race on clientMessageId hit unique constraint, return existing
      if (err?.code === 11000 && clientMessageId) {
        const existing = await ChatMessage.findOne({ meetingId: meeting._id, clientMessageId });
        if (existing) {
          return toChatMessageDto(existing);
        }
      }
      throw err;
    }
  }

  /**
   * Retrieves paginated chat history for an authorized meeting participant.
   * Employs deterministic keyset pagination sorting by createdAt descending and _id descending.
   */
  public async getChatHistory(
    rawCode: string,
    userId: string,
    query: GetChatHistoryQuery
  ): Promise<ChatHistoryResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const meeting = await meetingService.findMeetingAndEnforceExpiration(rawCode);
    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant || participant.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError(
        'You must be an admitted participant to view meeting chat history.',
        'CHAT_ACCESS_DENIED'
      );
    }

    const limit = Math.min(Math.max(query.limit || 50, 1), 100);
    const filter: Record<string, unknown> = { meetingId: meeting._id };

    if (query.before) {
      const trimmed = query.before.trim();
      let cursorCreatedAt: Date | null = null;
      let cursorId: Types.ObjectId | null = null;

      if (trimmed.includes('_')) {
        const [dateStr, idStr] = trimmed.split('_');
        const parsedDate = new Date(dateStr);
        if (!Number.isNaN(parsedDate.getTime()) && Types.ObjectId.isValid(idStr)) {
          cursorCreatedAt = parsedDate;
          cursorId = new Types.ObjectId(idStr);
        }
      } else if (Types.ObjectId.isValid(trimmed)) {
        cursorId = new Types.ObjectId(trimmed);
      } else {
        const parsedDate = new Date(trimmed);
        if (!Number.isNaN(parsedDate.getTime())) {
          cursorCreatedAt = parsedDate;
        }
      }

      if (query.beforeId && Types.ObjectId.isValid(query.beforeId)) {
        cursorId = new Types.ObjectId(query.beforeId);
      }

      if (cursorCreatedAt && cursorId) {
        filter.$or = [
          { createdAt: { $lt: cursorCreatedAt } },
          { createdAt: cursorCreatedAt, _id: { $lt: cursorId } },
        ];
      } else if (cursorCreatedAt) {
        filter.createdAt = { $lt: cursorCreatedAt };
      } else if (cursorId) {
        filter._id = { $lt: cursorId };
      }
    }

    const docs = await ChatMessage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const sliced = hasMore ? docs.slice(0, limit) : docs;
    const oldestDoc = sliced.length > 0 ? (sliced[sliced.length - 1] as any) : null;
    const nextCursor =
      hasMore && oldestDoc
        ? `${oldestDoc.createdAt instanceof Date ? oldestDoc.createdAt.toISOString() : new Date(oldestDoc.createdAt).toISOString()}_${oldestDoc._id.toString()}`
        : null;

    // Return in ascending chronological order for client display
    const chronological = sliced.reverse();
    const messages = chronological.map((d: any) => {
      let content = d.content;
      if (cryptoEngine.isEncrypted(content)) {
        content = cryptoEngine.decryptString(content, {
          aad: `chat:${d.meetingId.toString()}`,
        });
      }

      return {
        id: d._id.toString(),
        meetingId: d.meetingId.toString(),
        senderId: d.senderId.toString(),
        senderName: d.senderName,
        senderRole: d.senderRole,
        senderAvatarUrl: d.senderAvatarUrl || null,
        content,
        clientMessageId: d.clientMessageId || null,
        createdAt: d.createdAt.toISOString ? d.createdAt.toISOString() : new Date(d.createdAt).toISOString(),
      };
    });

    return { messages, hasMore, nextCursor };
  }

  /**
   * Sends an ephemeral real-time emoji reaction synchronized to all meeting participants.
   * Guarantees distributed idempotency via clientReactionId and atomic sliding-window rate limiting.
   */
  public async sendReaction(
    rawCode: string,
    userId: string,
    input: SendReactionInput
  ): Promise<MeetingReactionDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier.', 'INVALID_IDENTIFIER');
    }

    const emoji = (input.emoji || '').trim();
    if (!emoji || !(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
      throw new BadRequestError('Invalid or unsupported emoji reaction.', 'INVALID_EMOJI');
    }

    const clientReactionId = (input.clientReactionId || '').trim();
    if (!clientReactionId) {
      throw new BadRequestError('clientReactionId is required.', 'INVALID_REACTION_ID');
    }

    const meeting = await meetingService.findMeetingAndEnforceExpiration(rawCode);
    if (meeting.status === 'ENDED' || meeting.status === 'EXPIRED') {
      throw new AppError(
        'This meeting is no longer active.',
        410,
        meeting.status === 'EXPIRED' ? 'MEETING_EXPIRED' : 'MEETING_ENDED'
      );
    }

    const participant = await MeetingParticipant.findOne({
      meetingId: meeting._id,
      userId,
    });

    if (!participant || participant.admissionStatus !== 'ADMITTED') {
      throw new ForbiddenError(
        'Only admitted participants can send reactions.',
        'REACTION_ACCESS_DENIED'
      );
    }

    const meetingIdStr = meeting._id.toString();
    const reservationToken = crypto.randomUUID();

    const reactionDto: MeetingReactionDto = {
      id: clientReactionId,
      meetingId: meetingIdStr,
      senderId: participant.userId.toString(),
      senderName: participant.displayName,
      senderRole: participant.role,
      senderAvatarUrl: participant.avatarUrl || null,
      emoji,
      timestamp: new Date().toISOString(),
    };

    // DEF-12-01: Step 1 - Attempt to acquire ownership-safe reservation
    let reservationStatus = await this.redisService.acquireReactionReservation(
      meetingIdStr,
      userId,
      clientReactionId,
      reservationToken,
      30
    );

    // DEF-12-01: Step 2 - If another attempt is in-flight, poll briefly to resolve
    if (reservationStatus === 'in_progress') {
      const maxRetries = 6;
      const pollDelayMs = 50;
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
        reservationStatus = await this.redisService.acquireReactionReservation(
          meetingIdStr,
          userId,
          clientReactionId,
          reservationToken,
          30
        );
        if (reservationStatus !== 'in_progress') {
          break;
        }
      }
    }

    // DEF-12-01: Step 3 - If already completed, return acknowledgment without broadcasting
    // and without consuming rate-limit quota
    if (reservationStatus === 'completed') {
      logger.info('[Chat] Duplicate reaction submission suppressed (already completed)', {
        metadata: {
          meetingId: meetingIdStr,
          userId,
          clientReactionId,
        },
      });
      return reactionDto;
    }

    // DEF-12-01: Step 4 - If still in progress after polling: do NOT acknowledge false success!
    if (reservationStatus === 'in_progress') {
      throw new AppError(
        'A reaction with this ID is currently being processed. Please try again.',
        409,
        'REACTION_IN_PROGRESS'
      );
    }

    // DEF-12-01: Step 5 - Reservation acquired. Evaluate rate limit and broadcast.
    let didBroadcast = false;
    try {
      // Reaction spam rate limiting
      const rateLimitKey = `connectly:rl:reaction:${meetingIdStr}:${userId}`;
      const allowed = await this.redisService.checkRateLimit(
        rateLimitKey,
        REACTION_RATE_LIMIT_WINDOW_MS,
        REACTION_RATE_LIMIT_MAX_REACTIONS
      );

      if (!allowed) {
        throw new AppError(
          'You are reacting too quickly. Please slow down.',
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }

      // Broadcast reaction in real time across the shared Socket.IO adapter
      meetingRealtime.emitReaction(meetingIdStr, reactionDto);
      didBroadcast = true;

      // Atomically transition reservation to completed state
      await this.redisService.markReactionCompleted(
        meetingIdStr,
        userId,
        clientReactionId,
        reservationToken,
        30
      );

      return reactionDto;
    } catch (err) {
      // DEF-12-01: Step 6 - Ownership-safe atomic compare-and-delete release.
      // If broadcast did not happen (e.g. rate limit 429), safely release reservation
      // so subsequent retries after rate-limit reset can succeed.
      if (!didBroadcast) {
        await this.redisService.releaseReactionReservation(
          meetingIdStr,
          userId,
          clientReactionId,
          reservationToken
        );
      }
      throw err;
    }
  }
}

export const chatService = new ChatService();
