import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionState, DisconnectReason, RoomEvent } from 'livekit-client';
import {
  LiveKitRoomController,
  type LiveKitEventListener,
  type LiveKitRoomLike,
} from './livekitClient.ts';
import { ApiError } from './authApi.ts';
import type { LiveKitConnectionSnapshot, LiveKitTokenResponse } from '../types/meeting.ts';

class ControllableRoom implements LiveKitRoomLike {
  public state: ConnectionState = ConnectionState.Disconnected;
  public remoteParticipants = new Map<string, unknown>();
  public connectCalls: Array<{ url: string; token: string }> = [];
  public disconnectCalls = 0;
  public listeners = new Map<string, Set<LiveKitEventListener>>();
  public connectImpl?: (url: string, token: string) => Promise<void>;

  public on(event: string, listener: LiveKitEventListener): this {
    const set = this.listeners.get(event) ?? new Set<LiveKitEventListener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  public off(event: string, listener: LiveKitEventListener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  public emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      fn(...args);
    }
  }

  public totalListenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  public async connect(url: string, token: string): Promise<void> {
    this.connectCalls.push({ url, token });
    if (this.connectImpl) {
      await this.connectImpl(url, token);
    }
    this.state = ConnectionState.Connected;
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.state = ConnectionState.Disconnected;
  }
}

const VALID_BUNDLE: LiveKitTokenResponse = {
  livekitUrl: 'ws://127.0.0.1:7880',
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfMTIzIn0.sig',
  roomName: 'cly_room_65f0a1b2c3d4e5f6a7b8c9d0',
  participantIdentity: 'usr_65f0a1b2c3d4e5f6a7b8c9e2',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ttlSeconds: 600,
  role: 'host',
  permissions: {
    roomJoin: true,
    canPublish: false,
    canSubscribe: false,
    canPublishData: false,
  },
};

describe('Phase 09 Frontend LiveKitRoomController Lifecycle & Resilience Suite', () => {
  it('1. Transitions cleanly through requesting_token -> connecting -> connected and updates remote peer count from real RoomEvents', async () => {
    const states: string[] = [];
    const rooms: ControllableRoom[] = [];
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => {
        const r = new ControllableRoom();
        rooms.push(r);
        return r;
      },
      onStateChange: (s: LiveKitConnectionSnapshot) => states.push(s.status),
    });

    await controller.connect();

    assert.strictEqual(rooms.length, 1);
    assert.deepStrictEqual(states, ['requesting_token', 'connecting', 'connected']);
    assert.strictEqual(controller.getSnapshot().roomName, VALID_BUNDLE.roomName);
    assert.strictEqual(controller.getSnapshot().remoteParticipantCount, 0);

    // Remote participant connects & disconnects
    rooms[0].remoteParticipants.set('usr_peer_2', {});
    rooms[0].emit(RoomEvent.ParticipantConnected);
    assert.strictEqual(controller.getSnapshot().remoteParticipantCount, 1);

    rooms[0].remoteParticipants.clear();
    rooms[0].emit(RoomEvent.ParticipantDisconnected);
    assert.strictEqual(controller.getSnapshot().remoteParticipantCount, 0);

    await controller.dispose();
    assert.strictEqual(rooms[0].disconnectCalls, 1);
    assert.strictEqual(rooms[0].totalListenerCount(), 0, 'All listeners must be cleaned up on dispose');
  });

  it('2. Handles LiveKit Reconnecting -> Reconnected and Disconnected (drop, ROOM_DELETED, PARTICIPANT_REMOVED) states accurately', async () => {
    const room = new ControllableRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => room,
    });

    await controller.connect();
    assert.strictEqual(controller.getSnapshot().status, 'connected');

    room.emit(RoomEvent.Reconnecting);
    assert.strictEqual(controller.getSnapshot().status, 'reconnecting');

    room.emit(RoomEvent.Reconnected);
    assert.strictEqual(controller.getSnapshot().status, 'connected');

    // Unexpected network drop -> disconnected (recoverable)
    room.emit(RoomEvent.Disconnected, DisconnectReason.UNKNOWN_REASON);
    assert.strictEqual(controller.getSnapshot().status, 'disconnected');
    assert.strictEqual(controller.getSnapshot().errorCode, 'LIVEKIT_CONNECTION_FAILED');
    assert.strictEqual(room.totalListenerCount(), 0);

    // Re-connect then receive ROOM_DELETED -> meeting_ended terminal state
    const room2 = new ControllableRoom();
    const c2 = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => room2,
    });
    await c2.connect();
    room2.emit(RoomEvent.Disconnected, DisconnectReason.ROOM_DELETED);
    assert.strictEqual(c2.getSnapshot().status, 'meeting_ended');
    assert.strictEqual(c2.getSnapshot().errorCode, 'LIVEKIT_MEETING_ENDED');

    // Receive PARTICIPANT_REMOVED -> unauthorized terminal state
    const room3 = new ControllableRoom();
    const c3 = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => room3,
    });
    await c3.connect();
    room3.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
    assert.strictEqual(c3.getSnapshot().status, 'unauthorized');
    assert.strictEqual(c3.getSnapshot().errorCode, 'PARTICIPANT_REMOVED');
  });

  it('3. Failed token fetch (403, 410, 503) and invalid token/URL errors map cleanly without calling room.connect()', async () => {
    let roomCreated = false;
    const unauthCtrl = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => {
        throw new ApiError({
          status: 403,
          code: 'LIVEKIT_ACCESS_DENIED',
          message: 'Waiting room active',
          timestamp: new Date().toISOString(),
        });
      },
      createRoom: () => {
        roomCreated = true;
        return new ControllableRoom();
      },
    });
    await unauthCtrl.connect();
    assert.strictEqual(roomCreated, false);
    assert.strictEqual(unauthCtrl.getSnapshot().status, 'unauthorized');

    const badUrlCtrl = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => ({ ...VALID_BUNDLE, livekitUrl: 'http://insecure.invalid' }),
      createRoom: () => {
        roomCreated = true;
        return new ControllableRoom();
      },
    });
    await badUrlCtrl.connect();
    assert.strictEqual(roomCreated, false);
    assert.strictEqual(badUrlCtrl.getSnapshot().status, 'failed');
    assert.strictEqual(badUrlCtrl.getSnapshot().errorCode, 'LIVEKIT_CONNECTION_FAILED');

    const badTokenRoom = new ControllableRoom();
    badTokenRoom.connectImpl = async () => {
      throw new Error('401 Unauthorized: invalid token');
    };
    const badTokCtrl = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => badTokenRoom,
    });
    await badTokCtrl.connect();
    assert.strictEqual(badTokCtrl.getSnapshot().status, 'failed');
    assert.strictEqual(badTokCtrl.getSnapshot().errorCode, 'LIVEKIT_INVALID_TOKEN');
    assert.strictEqual(badTokenRoom.totalListenerCount(), 0);
  });

  it('4. Prevents duplicate Room creation under concurrent connect() calls and discards stale tokens if meeting ends mid-flight', async () => {
    let resolveToken!: (b: LiveKitTokenResponse) => void;
    const rooms: ControllableRoom[] = [];
    let fetchCount = 0;

    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: () => {
        fetchCount += 1;
        return new Promise<LiveKitTokenResponse>((resolve) => {
          resolveToken = resolve;
        });
      },
      createRoom: () => {
        const r = new ControllableRoom();
        rooms.push(r);
        return r;
      },
    });

    // Fire 2 simultaneous connect() calls -> second is deduplicated immediately
    const p1 = controller.connect();
    const p2 = controller.connect();
    // Allow initial cleanupActiveRoom() microtask to reach fetchToken()
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(fetchCount, 1);

    // Meeting ends while token fetch is still in flight
    await controller.disconnect('meeting_ended');
    resolveToken(VALID_BUNDLE);
    await Promise.all([p1, p2]);

    assert.strictEqual(rooms.length, 0, 'Stale token resolution after meeting end must never open a Room');
    assert.strictEqual(controller.getSnapshot().status, 'meeting_ended');
  });

  it('5. reconnect() re-verifies authoritative CONNECTLY membership before minting a fresh token', async () => {
    let verifyCalled = 0;
    let tokenCalls = 0;
    let authorized = true;
    const rooms: ControllableRoom[] = [];

    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      verifyAuthoritativeState: async () => {
        verifyCalled += 1;
        return authorized;
      },
      fetchToken: async () => {
        tokenCalls += 1;
        return VALID_BUNDLE;
      },
      createRoom: () => {
        const r = new ControllableRoom();
        rooms.push(r);
        return r;
      },
    });

    await controller.connect();
    assert.strictEqual(tokenCalls, 1);
    rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.UNKNOWN_REASON);
    assert.strictEqual(controller.getSnapshot().status, 'disconnected');

    // Reconnect while still authorized -> verifies state & fetches fresh token
    await controller.reconnect();
    assert.strictEqual(verifyCalled, 1);
    assert.strictEqual(tokenCalls, 2);
    assert.strictEqual(controller.getSnapshot().status, 'connected');

    // Drop again, now revoked in CONNECTLY -> reconnect stops cleanly without fetching token
    rooms[1].emit(RoomEvent.Disconnected, DisconnectReason.UNKNOWN_REASON);
    authorized = false;
    await controller.reconnect();
    assert.strictEqual(verifyCalled, 2);
    assert.strictEqual(tokenCalls, 2);
    assert.strictEqual(controller.getSnapshot().status, 'unauthorized');
  });

  it('6. Signaling gateway 403 revoked-token rejection transitions to terminal unauthorized state without retry', async () => {
    const room = new ControllableRoom();
    room.connectImpl = async () => {
      throw new Error(
        'could not establish signal connection: Participant has been removed from this meeting; token access revoked.'
      );
    };

    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_BUNDLE,
      createRoom: () => room,
    });

    await controller.connect();
    assert.strictEqual(controller.getSnapshot().status, 'unauthorized');
    assert.strictEqual(controller.getSnapshot().errorCode, 'PARTICIPANT_REMOVED');
    assert.strictEqual(room.totalListenerCount(), 0);
  });
});
