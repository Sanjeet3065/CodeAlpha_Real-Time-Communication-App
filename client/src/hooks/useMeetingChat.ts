/**
 * CONNECTLY — Phase 12 useMeetingChat Hook
 * Real-time chat messaging, history synchronization, reconnection recovery,
 * idempotent retries, deterministic pagination, unread tracking,
 * and synchronized floating emoji reactions over Socket.IO.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ParticipantRole } from '@/types/meeting';
import type {
  ChatMessage,
  MeetingReaction,
  FloatingReactionItem,
  AllowedReaction,
} from '@/types/chat';
import { ALLOWED_REACTIONS } from '@/types/chat';
import { chatApi } from '@/services/chatApi';
import { sendSocketChatMessage, sendSocketReaction } from '@/services/meetingSocket';

interface UseMeetingChatOptions {
  meetingCode: string;
  socket: Socket | null;
  isAdmitted: boolean;
  currentUserId?: string;
  currentUserName?: string;
  currentUserRole?: ParticipantRole;
  isChatOpen: boolean;
}

export function useMeetingChat({
  meetingCode,
  socket,
  isAdmitted,
  currentUserId,
  currentUserName,
  currentUserRole = 'participant',
  isChatOpen,
}: UseMeetingChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [activeReactions, setActiveReactions] = useState<FloatingReactionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Client-side rate-limit / spam tracking (max 5 reactions / 3s)
  const reactionTimestampsRef = useRef<number[]>([]);
  const isChatOpenRef = useRef<boolean>(isChatOpen);
  isChatOpenRef.current = isChatOpen;

  // Reaction deduplication set (ISS-12-02)
  const seenReactionIdsRef = useRef<Set<string>>(new Set());

  // Connection lifecycle tracking for reconnection recovery (ISS-12-03)
  const isInitialLoadedRef = useRef<boolean>(false);
  const hasDisconnectedRef = useRef<boolean>(false);
  const isSyncingReconnectRef = useRef<boolean>(false);

  // Clear unread count when panel is opened
  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
    }
  }, [isChatOpen]);

  // Reconciles authoritative fetched messages with local state preserving optimistic & failed states
  const reconcileMessagesWithLocal = useCallback(
    (fetchedMessages: ChatMessage[], isReconnect = false) => {
      setMessages((prev) => {
        const existingById = new Map<string, ChatMessage>();
        const existingByClientId = new Map<string, ChatMessage>();

        for (const m of prev) {
          existingById.set(m.id, m);
          if (m.clientMessageId) {
            existingByClientId.set(m.clientMessageId, m);
          }
        }

        let newRemoteCount = 0;
        const merged = [...prev];

        for (const remote of fetchedMessages) {
          const remoteMarked: ChatMessage = {
            ...remote,
            deliveryStatus: 'delivered',
          };

          if (existingById.has(remote.id)) {
            // Already present by authoritative ID; update delivery status
            const idx = merged.findIndex((m) => m.id === remote.id);
            if (idx !== -1) {
              merged[idx] = { ...merged[idx], ...remoteMarked };
            }
          } else if (remote.clientMessageId && existingByClientId.has(remote.clientMessageId)) {
            // Match optimistic message by clientMessageId and upgrade to authoritative
            const idx = merged.findIndex((m) => m.clientMessageId === remote.clientMessageId);
            if (idx !== -1) {
              merged[idx] = remoteMarked;
            }
          } else {
            // Genuinely new message from remote participant
            merged.push(remoteMarked);
            if (remote.senderId !== currentUserId) {
              newRemoteCount++;
            }
          }
        }

        // Sort deterministically by createdAt ascending, tie-breaking by id ascending
        merged.sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        if (isReconnect && !isChatOpenRef.current && newRemoteCount > 0) {
          setUnreadCount((c) => c + newRemoteCount);
        }

        return merged;
      });
    },
    [currentUserId]
  );

  // Load initial chat history when admitted
  useEffect(() => {
    let isCancelled = false;

    if (!isAdmitted || !meetingCode) {
      setMessages([]);
      setUnreadCount(0);
      isInitialLoadedRef.current = false;
      return;
    }

    const fetchInitial = async () => {
      setIsLoadingHistory(true);
      setError(null);
      try {
        const history = await chatApi.getChatHistory(meetingCode, { limit: 50 });
        if (!isCancelled) {
          const marked = history.messages.map((m) => ({
            ...m,
            deliveryStatus: 'delivered' as const,
          }));
          setMessages(marked);
          setHasMore(history.hasMore);
          isInitialLoadedRef.current = true;
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          console.warn(
            '[useMeetingChat] Could not load initial chat history:',
            err instanceof Error ? err.message : String(err)
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    fetchInitial();

    return () => {
      isCancelled = true;
    };
  }, [isAdmitted, meetingCode]);

  // ISS-12-03: Reconnection Recovery handler
  const recoverHistoryAfterReconnect = useCallback(async () => {
    if (!meetingCode || !isAdmitted || isSyncingReconnectRef.current) return;

    isSyncingReconnectRef.current = true;
    try {
      const history = await chatApi.getChatHistory(meetingCode, { limit: 50 });
      reconcileMessagesWithLocal(history.messages, true);
      setHasMore(history.hasMore);
    } catch (err: unknown) {
      console.warn(
        '[useMeetingChat] Reconnection history synchronization failed:',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      isSyncingReconnectRef.current = false;
    }
  }, [meetingCode, isAdmitted, reconcileMessagesWithLocal]);

  // Socket event subscriptions for incoming messages, reactions, and connection lifecycle
  useEffect(() => {
    if (!socket || !isAdmitted) return;

    const handleConnect = () => {
      if (isInitialLoadedRef.current && hasDisconnectedRef.current) {
        hasDisconnectedRef.current = false;
        void recoverHistoryAfterReconnect();
      }
    };

    const handleDisconnect = () => {
      hasDisconnectedRef.current = true;
    };

    const handleMessageReceived = (incoming: ChatMessage) => {
      setMessages((prev) => {
        // Check for deduplication by id or clientMessageId
        const existingIdx = prev.findIndex(
          (m) =>
            m.id === incoming.id ||
            (incoming.clientMessageId && m.clientMessageId === incoming.clientMessageId)
        );

        if (existingIdx !== -1) {
          const copy = [...prev];
          copy[existingIdx] = {
            ...incoming,
            deliveryStatus: 'delivered',
          };
          return copy;
        }

        return [...prev, { ...incoming, deliveryStatus: 'delivered' }];
      });

      // Increment unread count if chat sidebar is closed and not sent by self
      if (!isChatOpenRef.current && incoming.senderId !== currentUserId) {
        setUnreadCount((c) => c + 1);
      }
    };

    // ISS-12-02: Client-side reaction deduplication using reaction.id
    const handleReactionReceived = (rx: MeetingReaction) => {
      const reactionId = rx.id;
      if (reactionId && seenReactionIdsRef.current.has(reactionId)) {
        // Ignore duplicate reaction broadcast
        return;
      }
      if (reactionId) {
        seenReactionIdsRef.current.add(reactionId);
      }

      // Position reaction horizontally across 20% to 80% to avoid screen edges
      const xPercent = Math.floor(Math.random() * 60) + 20;
      const instanceKey = reactionId || `rx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const floatingItem: FloatingReactionItem = {
        ...rx,
        instanceKey,
        xPercent,
      };

      setActiveReactions((prev) => [...prev, floatingItem]);

      // Remove floating bubble after animation finishes (3.5s) and release deduplication lock
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter((item) => item.instanceKey !== instanceKey));
        if (reactionId) {
          seenReactionIdsRef.current.delete(reactionId);
        }
      }, 3500);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('chat:message-received', handleMessageReceived);
    socket.on('reaction:received', handleReactionReceived);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('chat:message-received', handleMessageReceived);
      socket.off('reaction:received', handleReactionReceived);
    };
  }, [socket, isAdmitted, currentUserId, recoverHistoryAfterReconnect]);

  // ISS-12-04: Send message action with idempotent retry support
  const sendMessage = useCallback(
    async (rawContent: string, existingClientMessageId?: string): Promise<boolean> => {
      const content = rawContent.trim();
      if (!content) {
        setError('Message cannot be empty.');
        return false;
      }
      if (content.length > 1000) {
        setError('Message cannot exceed 1000 characters.');
        return false;
      }

      setError(null);
      // Reuse existing clientMessageId if retrying; otherwise allocate a new idempotency key
      const isRetry = Boolean(existingClientMessageId);
      const clientMessageId =
        existingClientMessageId || `cm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      if (isRetry) {
        // Upgrade existing failed message back to 'sending' (do not create a duplicate optimistic message)
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...m, content, deliveryStatus: 'sending' }
              : m
          )
        );
      } else {
        // Optimistic message for first submission
        const optimisticMsg: ChatMessage = {
          id: clientMessageId,
          meetingId: '',
          senderId: currentUserId || 'me',
          senderName: currentUserName || 'You',
          senderRole: currentUserRole,
          content,
          clientMessageId,
          createdAt: new Date().toISOString(),
          deliveryStatus: 'sending',
        };
        setMessages((prev) => [...prev, optimisticMsg]);
      }

      try {
        let deliveredMsg: ChatMessage | undefined;

        if (socket?.connected) {
          const ack = await sendSocketChatMessage(socket, meetingCode, content, clientMessageId);
          if (!ack.ok || !ack.message) {
            throw new Error(ack.error || 'Failed to deliver message via socket.');
          }
          deliveredMsg = ack.message;
        } else {
          // REST fallback reusing the same clientMessageId
          const res = await chatApi.sendChatMessage(meetingCode, { content, clientMessageId });
          deliveredMsg = res.message;
        }

        if (deliveredMsg) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId
                ? { ...deliveredMsg!, deliveryStatus: 'delivered' }
                : m
            )
          );
        }
        return true;
      } catch (err: unknown) {
        console.error('[useMeetingChat] Send failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message.');
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...m, deliveryStatus: 'failed' }
              : m
          )
        );
        return false;
      }
    },
    [socket, meetingCode, currentUserId, currentUserName, currentUserRole]
  );

  // ISS-12-04: Retry sending a previously failed message preserving original clientMessageId
  const retryMessage = useCallback(
    async (failedMsg: ChatMessage) => {
      if (!failedMsg.clientMessageId) return;
      await sendMessage(failedMsg.content, failedMsg.clientMessageId);
    },
    [sendMessage]
  );

  // Send reaction action with client-side throttle
  const sendReaction = useCallback(
    async (emoji: AllowedReaction): Promise<boolean> => {
      if (!ALLOWED_REACTIONS.includes(emoji)) {
        return false;
      }

      // Check client-side rate limit (max 5 reactions in 3 seconds)
      const now = Date.now();
      const recent = reactionTimestampsRef.current.filter((t) => now - t < 3000);
      if (recent.length >= 5) {
        setError('Please wait a moment before sending more reactions.');
        return false;
      }
      reactionTimestampsRef.current = [...recent, now];

      const clientReactionId = `rx_${now}_${Math.random().toString(36).substring(2, 9)}`;

      try {
        if (socket?.connected) {
          await sendSocketReaction(socket, meetingCode, emoji, clientReactionId);
        } else {
          await chatApi.sendReaction(meetingCode, { emoji, clientReactionId });
        }
        return true;
      } catch (err: unknown) {
        console.warn(
          '[useMeetingChat] Reaction delivery failed:',
          err instanceof Error ? err.message : String(err)
        );
        return false;
      }
    },
    [socket, meetingCode]
  );

  // ISS-12-05: Load older messages with composite cursor and deduplicated prepend
  const loadOlderMessages = useCallback(async () => {
    if (!hasMore || isLoadingHistory || messages.length === 0) return;

    const oldest = messages[0];
    if (!oldest?.createdAt) return;

    setIsLoadingHistory(true);
    try {
      // Pass composite cursor `${createdAt}_${id}` to guarantee identical millisecond timestamps are not skipped
      const compositeCursor = `${oldest.createdAt}_${oldest.id}`;
      const history = await chatApi.getChatHistory(meetingCode, {
        limit: 30,
        before: compositeCursor,
        beforeId: oldest.id,
      });

      const olderMarked = history.messages.map((m) => ({
        ...m,
        deliveryStatus: 'delivered' as const,
      }));

      setMessages((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const filteredNewOlder = olderMarked.filter((m) => !existingIds.has(m.id));
        const combined = [...filteredNewOlder, ...prev];

        // Ensure strictly ascending chronological display order
        combined.sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        return combined;
      });

      setHasMore(history.hasMore);
    } catch (err: unknown) {
      console.warn(
        '[useMeetingChat] Failed to load older messages:',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }, [hasMore, isLoadingHistory, messages, meetingCode]);

  const clearUnreadCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    messages,
    unreadCount,
    hasMore,
    isLoadingHistory,
    activeReactions,
    error,
    sendMessage,
    retryMessage,
    sendReaction,
    loadOlderMessages,
    clearUnreadCount,
    clearError: () => setError(null),
  };
}
