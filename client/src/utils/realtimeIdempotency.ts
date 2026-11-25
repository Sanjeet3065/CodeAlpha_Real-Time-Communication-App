import type { MeetingParticipantInfo } from '../types/meeting.ts';

export interface RealtimeEventGuard {
  /**
   * Records `eventId` and returns `true` if this event should be processed,
   * or `false` if it was already processed or the consumer is locked in a terminal state.
   */
  shouldProcess: (eventId?: string) => boolean;
  /** Locks the consumer into terminal state (e.g., `meeting:ended` / `meeting:participant-removed`). */
  markTerminal: () => void;
  /** Returns whether the consumer has reached a terminal meeting state. */
  isTerminal: () => boolean;
  /** Current number of tracked event IDs (bounded by `maxEntries`). */
  size: () => number;
}

/**
 * Bounded, deterministic idempotency & terminal-state guard for at-least-once Socket.IO
 * outbox deliveries on the CONNECTLY frontend (`MeetingRoomPage` & `PreJoinLobbyPage`).
 */
export function createRealtimeEventGuard(maxEntries = 500): RealtimeEventGuard {
  const seenEventIds = new Set<string>();
  let terminal = false;

  return {
    shouldProcess: (eventId?: string): boolean => {
      if (terminal) return false;
      if (!eventId) return true;
      if (seenEventIds.has(eventId)) return false;
      seenEventIds.add(eventId);
      if (seenEventIds.size > maxEntries) {
        const oldest = seenEventIds.values().next().value;
        if (oldest) seenEventIds.delete(oldest);
      }
      return true;
    },
    markTerminal: (): void => {
      terminal = true;
    },
    isTerminal: (): boolean => terminal,
    size: (): number => seenEventIds.size,
  };
}

/**
 * Idempotently merges a `meeting:participant-joined` participant payload into the current
 * roster by `userId` (so even fallback payloads without `eventId` never duplicate entries).
 */
export function applyParticipantJoinedIdempotent(
  prev: MeetingParticipantInfo[],
  incoming: MeetingParticipantInfo
): MeetingParticipantInfo[] {
  const exists = prev.some((p) => p.userId === incoming.userId);
  if (exists) {
    return prev.map((p) => (p.userId === incoming.userId ? incoming : p));
  }
  return [...prev, incoming];
}
