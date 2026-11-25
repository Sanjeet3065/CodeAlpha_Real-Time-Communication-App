import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionState, DisconnectReason, RoomEvent, Track } from 'livekit-client';
import {
  LiveKitRoomController,
  type LiveKitEventListener,
  type LiveKitLocalParticipantLike,
  type LiveKitParticipantLike,
  type LiveKitRoomLike,
  type LiveKitTrackPublicationLike,
} from './livekitClient.ts';
import type { AttachableMediaTrack, LiveKitTokenResponse } from '../types/meeting.ts';

function createStubTrack(sid: string, kind: 'audio' | 'video'): AttachableMediaTrack & {
  stopped: boolean;
  attachedCount: number;
  mediaStreamTrack?: {
    listeners: Map<string, Set<() => void>>;
    addEventListener(event: string, fn: () => void): void;
    removeEventListener(event: string, fn: () => void): void;
    emit(event: string): void;
  };
} {
  const streamTrackListeners = new Map<string, Set<() => void>>();
  const track = {
    sid,
    kind,
    stopped: false,
    attachedCount: 0,
    mediaStreamTrack: {
      listeners: streamTrackListeners,
      addEventListener(event: string, fn: () => void) {
        if (!streamTrackListeners.has(event)) {
          streamTrackListeners.set(event, new Set());
        }
        streamTrackListeners.get(event)!.add(fn);
      },
      removeEventListener(event: string, fn: () => void) {
        streamTrackListeners.get(event)?.delete(fn);
      },
      emit(event: string) {
        streamTrackListeners.get(event)?.forEach((fn) => fn());
      },
    },
    attach(el?: HTMLMediaElement): HTMLMediaElement {
      track.attachedCount += 1;
      return el ?? ({} as HTMLMediaElement);
    },
    detach(el?: HTMLMediaElement): HTMLMediaElement {
      track.attachedCount = Math.max(0, track.attachedCount - 1);
      return el ?? ({} as HTMLMediaElement);
    },
    stop() {
      track.stopped = true;
    },
  };
  return track;
}

class ControllableScreenShareRoom implements LiveKitRoomLike {
  public state: ConnectionState = ConnectionState.Disconnected;
  public remoteParticipants = new Map<string, LiveKitParticipantLike>();
  public canPlaybackAudio = true;
  public listeners = new Map<string, Set<LiveKitEventListener>>();

  public screenCalls: Array<{ enabled: boolean; audio?: boolean }> = [];
  public screenImpl?: (enabled: boolean, opts?: { audio?: boolean }) => Promise<void>;

  public micCalls: Array<{ enabled: boolean }> = [];
  public camCalls: Array<{ enabled: boolean }> = [];

  public localPubs = new Map<string, LiveKitTrackPublicationLike>();
  public localParticipant: LiveKitLocalParticipantLike;

  constructor(localIdentity = 'usr_65f0a1b2c3d4e5f6a7b8c9e2', localName = 'Host User') {
    this.localParticipant = {
      identity: localIdentity,
      name: localName,
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      trackPublications: this.localPubs,
      getTrackPublication: (source) => {
        for (const pub of this.localPubs.values()) {
          if (pub.source === source) return pub;
        }
        return undefined;
      },
      setMicrophoneEnabled: async (enabled) => {
        this.micCalls.push({ enabled });
        this.localParticipant.isMicrophoneEnabled = enabled;
        const track = createStubTrack('mic_sid', 'audio');
        const pub: LiveKitTrackPublicationLike = {
          trackSid: track.sid,
          source: Track.Source.Microphone,
          kind: 'audio',
          isMuted: !enabled,
          track,
        };
        this.localPubs.set('local_mic', pub);
        this.emit(RoomEvent.LocalTrackPublished, pub, this.localParticipant);
      },
      setCameraEnabled: async (enabled) => {
        this.camCalls.push({ enabled });
        this.localParticipant.isCameraEnabled = enabled;
        if (enabled) {
          const track = createStubTrack('cam_sid', 'video');
          const pub: LiveKitTrackPublicationLike = {
            trackSid: track.sid,
            source: Track.Source.Camera,
            kind: 'video',
            isMuted: false,
            track,
          };
          this.localPubs.set('local_cam', pub);
          this.emit(RoomEvent.LocalTrackPublished, pub, this.localParticipant);
        } else {
          const existing = this.localPubs.get('local_cam');
          this.localPubs.delete('local_cam');
          if (existing) {
            this.emit(RoomEvent.LocalTrackUnpublished, existing, this.localParticipant);
          }
        }
      },
      setScreenShareEnabled: async (enabled, opts) => {
        this.screenCalls.push({ enabled, audio: opts?.audio });
        if (this.screenImpl) {
          await this.screenImpl(enabled, opts);
        }
        this.localParticipant.isScreenShareEnabled = enabled;
        if (enabled) {
          const track = createStubTrack(`screen_sid_${this.screenCalls.length}`, 'video');
          const pub: LiveKitTrackPublicationLike = {
            trackSid: track.sid,
            source: Track.Source.ScreenShare,
            kind: 'video',
            isMuted: false,
            track,
          };
          this.localPubs.set('local_screen', pub);
          this.emit(RoomEvent.LocalTrackPublished, pub, this.localParticipant);
        } else {
          const existing = this.localPubs.get('local_screen');
          this.localPubs.delete('local_screen');
          if (existing) {
            this.emit(RoomEvent.LocalTrackUnpublished, existing, this.localParticipant);
          }
        }
      },
    };
  }

  public async connect(): Promise<void> {
    this.state = ConnectionState.Connected;
    this.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
  }

  public async disconnect(): Promise<void> {
    this.state = ConnectionState.Disconnected;
    this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  }

  public on(event: string, listener: LiveKitEventListener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
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
      try {
        fn(...args);
      } catch {
        // ignore test error
      }
    }
  }
}

function makeTokenBundle(roomName = 'cly_room_65f0a1b2c3d4e5f6a7b8c9e1'): LiveKitTokenResponse {
  return {
    livekitUrl: 'ws://127.0.0.1:7880',
    token: 'jwt.screen.share.token.test',
    roomName,
    participantIdentity: 'usr_65f0a1b2c3d4e5f6a7b8c9e2',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    ttlSeconds: 600,
    role: 'host',
    permissions: {
      roomJoin: true,
      canPublish: true,
      canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
      canSubscribe: true,
      canPublishData: false,
    },
  };
}

describe('Phase 11 Frontend Screen-Sharing Track, Subscription & Lifecycle Suite', () => {
  it('1. Starts screen sharing, publishes screen track to SFU, updates snapshot, and stops cleanly without affecting camera/mic', async () => {
    const room = new ControllableScreenShareRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-p11-test',
      fetchToken: async () => makeTokenBundle(),
      createRoom: () => room,
      initialMedia: { micEnabled: true, cameraEnabled: true },
    });

    await controller.connect();
    let media = controller.getMediaSnapshot();
    assert.strictEqual(media.localMicEnabled, true);
    assert.strictEqual(media.localCameraEnabled, true);
    assert.strictEqual(media.localScreenShareEnabled, false);
    assert.strictEqual(media.screenShares.length, 0);

    // 1. Enable Screen Sharing
    const sharePromise = controller.setScreenShareEnabled(true, { audio: true });
    assert.strictEqual(controller.getMediaSnapshot().isTogglingScreenShare, true);
    const success = await sharePromise;
    assert.strictEqual(success, true);

    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localScreenShareEnabled, true);
    assert.strictEqual(media.localScreenSharePublished, true);
    assert.strictEqual(media.screenSharePermission, 'granted');
    assert.strictEqual(media.screenShares.length, 1);
    assert.strictEqual(media.screenShares[0].isLocal, true);
    assert.strictEqual(media.screenShares[0].displayName, 'Host User');
    assert.ok(media.screenShares[0].videoTrack);

    // CRITICAL: Camera & microphone remain active while sharing screen
    assert.strictEqual(media.localMicEnabled, true);
    assert.strictEqual(media.localCameraEnabled, true);

    // 2. Stop Screen Sharing
    const stopSuccess = await controller.setScreenShareEnabled(false);
    assert.strictEqual(stopSuccess, true);

    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localScreenShareEnabled, false);
    assert.strictEqual(media.localScreenSharePublished, false);
    assert.strictEqual(media.screenShares.length, 0);

    // CRITICAL: Camera and mic are NOT stopped when screen sharing stops
    assert.strictEqual(media.localMicEnabled, true);
    assert.strictEqual(media.localCameraEnabled, true);
  });

  it('2. Subscribes to remote participant screen shares, surfaces owner details, and unmounts cleanly on remote stop or leave', async () => {
    const room = new ControllableScreenShareRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-p11-test',
      fetchToken: async () => makeTokenBundle(),
      createRoom: () => room,
    });

    await controller.connect();

    // Remote peer joins
    const remotePubs = new Map<string, LiveKitTrackPublicationLike>();
    const remotePeer: LiveKitParticipantLike = {
      identity: 'usr_65f0a1b2c3d4e5f6a7b8c9e3',
      name: 'Maya Presenter',
      trackPublications: remotePubs,
      getTrackPublication: (source) => {
        for (const pub of remotePubs.values()) {
          if (pub.source === source) return pub;
        }
        return undefined;
      },
    };
    room.remoteParticipants.set(remotePeer.identity, remotePeer);
    room.emit(RoomEvent.ParticipantConnected, remotePeer);

    let media = controller.getMediaSnapshot();
    assert.strictEqual(media.screenShares.length, 0);

    // Remote peer publishes screen share
    const remoteScreenTrack = createStubTrack('remote_screen_sid', 'video');
    const remoteScreenAudio = createStubTrack('remote_screen_audio_sid', 'audio');
    const screenPub: LiveKitTrackPublicationLike = {
      trackSid: remoteScreenTrack.sid,
      source: Track.Source.ScreenShare,
      kind: 'video',
      isMuted: false,
      isSubscribed: true,
      track: remoteScreenTrack,
    };
    const screenAudioPub: LiveKitTrackPublicationLike = {
      trackSid: remoteScreenAudio.sid,
      source: Track.Source.ScreenShareAudio,
      kind: 'audio',
      isMuted: false,
      isSubscribed: true,
      track: remoteScreenAudio,
    };
    remotePubs.set('remote_screen', screenPub);
    remotePubs.set('remote_screen_audio', screenAudioPub);

    room.emit(RoomEvent.TrackSubscribed, remoteScreenTrack, screenPub, remotePeer);

    media = controller.getMediaSnapshot();
    assert.strictEqual(media.screenShares.length, 1);
    assert.strictEqual(media.screenShares[0].isLocal, false);
    assert.strictEqual(media.screenShares[0].displayName, 'Maya Presenter');
    assert.strictEqual(media.screenShares[0].participantIdentity, remotePeer.identity);
    assert.ok(media.screenShares[0].videoTrack);
    assert.ok(media.screenShares[0].audioTrack);

    // Remote peer stops sharing (unpublishes track)
    remotePubs.delete('remote_screen');
    remotePubs.delete('remote_screen_audio');
    room.emit(RoomEvent.TrackUnpublished, screenPub, remotePeer);

    media = controller.getMediaSnapshot();
    assert.strictEqual(media.screenShares.length, 0);

    // Remote peer republishes screen and then disconnects completely
    remotePubs.set('remote_screen', screenPub);
    room.emit(RoomEvent.TrackSubscribed, remoteScreenTrack, screenPub, remotePeer);
    assert.strictEqual(controller.getMediaSnapshot().screenShares.length, 1);

    room.remoteParticipants.delete(remotePeer.identity);
    room.emit(RoomEvent.ParticipantDisconnected, remotePeer);

    assert.strictEqual(controller.getMediaSnapshot().screenShares.length, 0);
  });

  it('3. Browser native stop-sharing (track ended event) updates CONNECTLY state and unpublishes track cleanly', async () => {
    const room = new ControllableScreenShareRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-p11-test',
      fetchToken: async () => makeTokenBundle(),
      createRoom: () => room,
    });

    await controller.connect();
    await controller.setScreenShareEnabled(true);
    assert.strictEqual(controller.getMediaSnapshot().localScreenShareEnabled, true);

    const screenPub = room.localPubs.get('local_screen');
    assert.ok(screenPub?.track);
    const stubTrack = screenPub.track as unknown as {
      mediaStreamTrack: { emit(event: string): void };
    };

    // Simulate browser-native "Stop sharing" button click firing mediaStreamTrack ended event
    stubTrack.mediaStreamTrack.emit('ended');

    // Wait a brief tick for async handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    const media = controller.getMediaSnapshot();
    assert.strictEqual(media.localScreenShareEnabled, false);
    assert.strictEqual(media.screenShares.length, 0);
  });

  it('4. Handles user cancellation (AbortError) and permission denial (NotAllowedError) gracefully', async () => {
    const room = new ControllableScreenShareRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-p11-test',
      fetchToken: async () => makeTokenBundle(),
      createRoom: () => room,
    });

    await controller.connect();

    // 1. User cancels screen picker (AbortError)
    room.screenImpl = async () => {
      const err = new Error('Permission dismissed');
      err.name = 'AbortError';
      throw err;
    };

    const cancelledOk = await controller.setScreenShareEnabled(true);
    assert.strictEqual(cancelledOk, false);
    let media = controller.getMediaSnapshot();
    assert.strictEqual(media.localScreenShareEnabled, false);
    assert.strictEqual(media.screenSharePermission, 'prompt');
    assert.match(media.screenShareError || '', /cancelled/i);

    // 2. Permission Denied (NotAllowedError)
    room.screenImpl = async () => {
      const err = new Error('Permission denied by system');
      err.name = 'NotAllowedError';
      throw err;
    };

    const deniedOk = await controller.setScreenShareEnabled(true);
    assert.strictEqual(deniedOk, false);
    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localScreenShareEnabled, false);
    assert.strictEqual(media.screenSharePermission, 'denied');
    assert.match(media.screenShareError || '', /permission was denied/i);
  });

  it('5. Serializes concurrent screen-share toggles and cleans up on room disconnect', async () => {
    const room = new ControllableScreenShareRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-p11-test',
      fetchToken: async () => makeTokenBundle(),
      createRoom: () => room,
    });

    await controller.connect();

    // Rapid double-click
    const p1 = controller.setScreenShareEnabled(true);
    const p2 = controller.setScreenShareEnabled(false);
    const [res1, res2] = await Promise.all([p1, p2]);

    assert.strictEqual(res1, true);
    assert.strictEqual(res2, true);
    assert.strictEqual(controller.getMediaSnapshot().localScreenShareEnabled, false);

    // Enable sharing, then disconnect room
    await controller.setScreenShareEnabled(true);
    assert.strictEqual(controller.getMediaSnapshot().localScreenShareEnabled, true);

    await controller.disconnect();
    const mediaAfterDisc = controller.getMediaSnapshot();
    assert.strictEqual(mediaAfterDisc.localScreenShareEnabled, false);
    assert.strictEqual(mediaAfterDisc.localScreenSharePublished, false);
    assert.strictEqual(mediaAfterDisc.screenShares.length, 0);
  });
});
