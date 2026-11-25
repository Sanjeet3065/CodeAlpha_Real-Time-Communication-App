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
} {
  const track = {
    sid,
    kind,
    stopped: false,
    attachedCount: 0,
    attach(el?: HTMLMediaElement): HTMLMediaElement {
      track.attachedCount += 1;
      return (el ?? ({} as HTMLMediaElement));
    },
    detach(el?: HTMLMediaElement): HTMLMediaElement {
      track.attachedCount = Math.max(0, track.attachedCount - 1);
      return (el ?? ({} as HTMLMediaElement));
    },
    stop() {
      track.stopped = true;
    },
  };
  return track;
}

class ControllableMediaRoom implements LiveKitRoomLike {
  public state: ConnectionState = ConnectionState.Disconnected;
  public remoteParticipants = new Map<string, LiveKitParticipantLike>();
  public canPlaybackAudio = true;
  public listeners = new Map<string, Set<LiveKitEventListener>>();
  public disconnectCalls = 0;
  public startAudioCalls = 0;
  public startAudioImpl?: () => Promise<void>;
  public switchDeviceCalls: Array<{ kind: string; deviceId: string }> = [];
  public switchDeviceImpl?: (kind: string, deviceId: string) => Promise<boolean | void>;

  public micCalls: Array<{ enabled: boolean; deviceId?: string }> = [];
  public camCalls: Array<{ enabled: boolean; deviceId?: string }> = [];
  public micImpl?: (enabled: boolean, opts?: { deviceId?: string }) => Promise<void>;
  public camImpl?: (enabled: boolean, opts?: { deviceId?: string }) => Promise<void>;

  public localPubs = new Map<string, LiveKitTrackPublicationLike>();
  public localParticipant: LiveKitLocalParticipantLike;

  constructor(localIdentity = 'usr_65f0a1b2c3d4e5f6a7b8c9e2', localName = 'Host User') {
    this.localParticipant = {
      identity: localIdentity,
      name: localName,
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      trackPublications: this.localPubs,
      getTrackPublication: (source) => {
        for (const pub of this.localPubs.values()) {
          if (pub.source === source) return pub;
        }
        return undefined;
      },
      setMicrophoneEnabled: async (enabled, opts) => {
        this.micCalls.push({ enabled, deviceId: opts?.deviceId });
        if (this.micImpl) {
          await this.micImpl(enabled, opts);
        }
        this.localParticipant.isMicrophoneEnabled = enabled;
        if (enabled) {
          const existing = this.localPubs.get('local_mic');
          if (existing) {
            existing.isMuted = false;
            this.emit(RoomEvent.TrackUnmuted, existing, this.localParticipant);
          } else {
            const track = createStubTrack(`mic_sid_${this.micCalls.length}`, 'audio');
            const pub: LiveKitTrackPublicationLike = {
              trackSid: track.sid,
              source: Track.Source.Microphone,
              kind: 'audio',
              isMuted: false,
              track,
            };
            this.localPubs.set('local_mic', pub);
            this.emit(RoomEvent.LocalTrackPublished, pub, this.localParticipant);
          }
        } else {
          const existing = this.localPubs.get('local_mic');
          if (existing) {
            existing.isMuted = true;
            this.emit(RoomEvent.TrackMuted, existing, this.localParticipant);
          }
        }
      },
      setCameraEnabled: async (enabled, opts) => {
        this.camCalls.push({ enabled, deviceId: opts?.deviceId });
        if (this.camImpl) {
          await this.camImpl(enabled, opts);
        }
        this.localParticipant.isCameraEnabled = enabled;
        if (enabled) {
          const track = createStubTrack(`cam_sid_${this.camCalls.length}`, 'video');
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
          if (existing?.track?.stop) existing.track.stop();
          this.localPubs.delete('local_cam');
          this.emit(RoomEvent.LocalTrackUnpublished, existing, this.localParticipant);
        }
      },
    };
  }

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
    for (const fn of Array.from(set)) fn(...args);
  }

  public totalListenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  public async connect(): Promise<void> {
    this.state = ConnectionState.Connected;
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.state = ConnectionState.Disconnected;
  }

  public async startAudio(): Promise<void> {
    this.startAudioCalls += 1;
    if (this.startAudioImpl) {
      await this.startAudioImpl();
    } else {
      this.canPlaybackAudio = true;
    }
  }

  public async switchActiveDevice(
    kind: 'audioinput' | 'videoinput' | 'audiooutput',
    deviceId: string
  ): Promise<boolean | void> {
    this.switchDeviceCalls.push({ kind, deviceId });
    if (this.switchDeviceImpl) {
      return this.switchDeviceImpl(kind, deviceId);
    }
    return true;
  }
}

const VALID_PHASE10_BUNDLE: LiveKitTokenResponse = {
  livekitUrl: 'ws://localhost:5000/livekit-signal',
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfNjVmMGExYjJjM2Q0ZTVmNmE3YjhjOWUyIn0.sig',
  roomName: 'cly_room_65f0a1b2c3d4e5f6a7b8c9d0',
  participantIdentity: 'usr_65f0a1b2c3d4e5f6a7b8c9e2',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ttlSeconds: 600,
  role: 'host',
  permissions: {
    roomJoin: true,
    canPublish: true,
    canPublishSources: ['camera', 'microphone'],
    canSubscribe: true,
    canPublishData: false,
  },
};

describe('Phase 10 Frontend LiveKit Media Track, Device & Active Speaker Suite', () => {
  it('1. Publishes local mic/camera per initialMedia, mutes/unmutes mic, and stops camera track on disable (no frozen frame)', async () => {
    const room = new ControllableMediaRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      initialMedia: {
        micEnabled: true,
        cameraEnabled: true,
        audioInputDeviceId: 'mic-1',
        videoInputDeviceId: 'cam-1',
      },
      speakerHoldMs: 0,
    });

    await controller.connect();

    // Initial local publishing occurred once per track with selected devices
    assert.strictEqual(room.micCalls.length, 1);
    assert.deepStrictEqual(room.micCalls[0], { enabled: true, deviceId: 'mic-1' });
    assert.strictEqual(room.camCalls.length, 1);
    assert.deepStrictEqual(room.camCalls[0], { enabled: true, deviceId: 'cam-1' });

    let media = controller.getMediaSnapshot();
    assert.strictEqual(media.localMicEnabled, true);
    assert.strictEqual(media.localMicPublished, true);
    assert.strictEqual(media.localCameraEnabled, true);
    assert.strictEqual(media.localCameraPublished, true);
    assert.strictEqual(media.micPermission, 'granted');
    assert.strictEqual(media.cameraPermission, 'granted');
    const localTile = media.participants.find((p) => p.isLocal);
    assert.ok(localTile?.videoTrack, 'Live video track must be present when camera is on');

    // Mute microphone actually disables transmission via LiveKit API
    await controller.setMicrophoneEnabled(false);
    assert.strictEqual(room.micCalls[1].enabled, false);
    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localMicEnabled, false);

    // Unmute microphone restores active state without duplicating tracks
    await controller.setMicrophoneEnabled(true);
    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localMicEnabled, true);
    assert.strictEqual(room.localPubs.size, 2);

    // Disable camera stops camera track and nulls videoTrack (no frozen frame)
    const camTrackBeforeOff = room.localPubs.get('local_cam')?.track as ReturnType<typeof createStubTrack>;
    await controller.setCameraEnabled(false);
    assert.strictEqual(camTrackBeforeOff.stopped, true, 'Camera track must be stopped when disabled');
    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localCameraEnabled, false);
    assert.strictEqual(media.localCameraPublished, false);
    assert.strictEqual(media.participants.find((p) => p.isLocal)?.videoTrack, null);

    // Re-enable camera restores live track cleanly
    await controller.setCameraEnabled(true);
    media = controller.getMediaSnapshot();
    assert.strictEqual(media.localCameraEnabled, true);
    assert.ok(media.participants.find((p) => p.isLocal)?.videoTrack);

    await controller.dispose();
    assert.strictEqual(room.totalListenerCount(), 0);
  });

  it('2. Tracks remote participant video & audio subscriptions, late publishing, mute sync, and cleanup on leave', async () => {
    const room = new ControllableMediaRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      initialMedia: { micEnabled: false, cameraEnabled: false },
      speakerHoldMs: 0,
    });

    await controller.connect();

    // Respect initial muted / camera-off policy (zero unwanted publish calls)
    assert.strictEqual(room.micCalls.length, 0);
    assert.strictEqual(room.camCalls.length, 0);

    // Remote participant joins with camera & mic initially off
    const remotePubs = new Map<string, LiveKitTrackPublicationLike>();
    const remotePeer: LiveKitParticipantLike = {
      identity: 'usr_65f0a1b2c3d4e5f6a7b8c9f9',
      name: 'Guest Peer',
      trackPublications: remotePubs,
      getTrackPublication: (src) => {
        for (const p of remotePubs.values()) {
          if (p.source === src) return p;
        }
        return undefined;
      },
    };
    room.remoteParticipants.set(remotePeer.identity, remotePeer);
    room.emit(RoomEvent.ParticipantConnected, remotePeer);

    let remoteState = controller.getMediaSnapshot().participants.find((p) => !p.isLocal);
    assert.ok(remoteState);
    assert.strictEqual(remoteState.userId, '65f0a1b2c3d4e5f6a7b8c9f9');
    assert.strictEqual(remoteState.isCameraEnabled, false);
    assert.strictEqual(remoteState.isMicEnabled, false);
    assert.strictEqual(remoteState.videoTrack, null);
    assert.strictEqual(remoteState.audioTrack, null);

    // Late publication + subscription of remote video and audio
    const remoteVideo = createStubTrack('rem_cam_1', 'video');
    const remoteAudio = createStubTrack('rem_mic_1', 'audio');
    remotePubs.set('cam', {
      trackSid: 'rem_cam_1',
      source: Track.Source.Camera,
      kind: 'video',
      isMuted: false,
      isSubscribed: true,
      track: remoteVideo,
    });
    remotePubs.set('mic', {
      trackSid: 'rem_mic_1',
      source: Track.Source.Microphone,
      kind: 'audio',
      isMuted: false,
      isSubscribed: true,
      track: remoteAudio,
    });
    room.emit(RoomEvent.TrackSubscribed, remoteVideo, remotePubs.get('cam'), remotePeer);
    room.emit(RoomEvent.TrackSubscribed, remoteAudio, remotePubs.get('mic'), remotePeer);

    remoteState = controller.getMediaSnapshot().participants.find((p) => !p.isLocal);
    assert.strictEqual(remoteState?.isCameraEnabled, true);
    assert.strictEqual(remoteState?.isMicEnabled, true);
    assert.strictEqual(remoteState?.videoTrack, remoteVideo);
    assert.strictEqual(remoteState?.audioTrack, remoteAudio);

    // Remote mutes mic -> reflects immediately
    remotePubs.get('mic')!.isMuted = true;
    room.emit(RoomEvent.TrackMuted, remotePubs.get('mic'), remotePeer);
    remoteState = controller.getMediaSnapshot().participants.find((p) => !p.isLocal);
    assert.strictEqual(remoteState?.isMicEnabled, false);

    // Remote unpublishes video -> videoTrack becomes null cleanly
    remotePubs.delete('cam');
    room.emit(RoomEvent.TrackUnsubscribed, remoteVideo, undefined, remotePeer);
    remoteState = controller.getMediaSnapshot().participants.find((p) => !p.isLocal);
    assert.strictEqual(remoteState?.videoTrack, null);
    assert.strictEqual(remoteState?.isCameraEnabled, false);

    // Remote leaves -> removed from participants snapshot
    room.remoteParticipants.delete(remotePeer.identity);
    room.emit(RoomEvent.ParticipantDisconnected, remotePeer);
    assert.strictEqual(
      controller.getMediaSnapshot().participants.filter((p) => !p.isLocal).length,
      0
    );

    await controller.dispose();
  });

  it('3. Tracks real ActiveSpeakersChanged for multiple speakers and clears stale speaker state on stop or disconnect', async () => {
    const room = new ControllableMediaRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      speakerHoldMs: 0,
    });

    await controller.connect();

    const remotePeer: LiveKitParticipantLike = {
      identity: 'usr_65f0a1b2c3d4e5f6a7b8c9f9',
      name: 'Speaker Two',
      trackPublications: new Map(),
    };
    room.remoteParticipants.set(remotePeer.identity, remotePeer);
    room.emit(RoomEvent.ParticipantConnected, remotePeer);

    // Multiple active speakers simultaneously
    room.emit(RoomEvent.ActiveSpeakersChanged, [room.localParticipant, remotePeer]);
    let media = controller.getMediaSnapshot();
    assert.deepStrictEqual(media.activeSpeakerIdentities.sort(), [
      room.localParticipant.identity,
      remotePeer.identity,
    ]);
    assert.strictEqual(media.participants.every((p) => p.isSpeaking), true);

    // Remote disconnects while speaking -> stale speaker removed immediately
    room.remoteParticipants.delete(remotePeer.identity);
    room.emit(RoomEvent.ParticipantDisconnected, remotePeer);
    media = controller.getMediaSnapshot();
    assert.deepStrictEqual(media.activeSpeakerIdentities, [room.localParticipant.identity]);

    // Local stops speaking
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    media = controller.getMediaSnapshot();
    assert.deepStrictEqual(media.activeSpeakerIdentities, []);
    assert.strictEqual(media.participants[0].isSpeaking, false);

    await controller.dispose();
  });

  it('4. Switches camera & microphone devices safely, rolls back on error, and handles active hardware disconnection', async () => {
    const room = new ControllableMediaRoom();
    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      initialMedia: {
        micEnabled: true,
        cameraEnabled: true,
        audioInputDeviceId: 'mic-1',
        videoInputDeviceId: 'cam-1',
      },
      speakerHoldMs: 0,
    });

    await controller.connect();

    // Switch microphone & camera cleanly
    const micSwitched = await controller.switchDevice('audioinput', 'mic-2');
    assert.strictEqual(micSwitched, true);
    assert.strictEqual(controller.getSelectedDeviceId('audioinput'), 'mic-2');

    const camSwitched = await controller.switchDevice('videoinput', 'cam-2');
    assert.strictEqual(camSwitched, true);
    assert.strictEqual(controller.getSelectedDeviceId('videoinput'), 'cam-2');

    // Failed camera switch rolls back to previous device ID and surfaces clear error
    room.switchDeviceImpl = async () => {
      throw Object.assign(new Error('Device in use'), { name: 'NotReadableError' });
    };
    const failedSwitch = await controller.switchDevice('videoinput', 'cam-broken');
    assert.strictEqual(failedSwitch, false);
    assert.strictEqual(controller.getSelectedDeviceId('videoinput'), 'cam-2');
    assert.match(controller.getMediaSnapshot().mediaError || '', /Failed to switch camera/i);

    // Audio output switching gracefully refuses on unsupported browser environments (Node / Safari)
    room.switchDeviceImpl = undefined;
    const spkRes = await controller.switchDevice('audiooutput', 'spk-2');
    assert.strictEqual(spkRes, false);
    assert.match(controller.getMediaSnapshot().mediaNotice || '', /not supported/i);

    // Hardware disconnect with fallback switches safely; without fallback disables track & reports error
    await controller.handleActiveDeviceDisconnected('audioinput', 'mic-fallback');
    assert.strictEqual(controller.getSelectedDeviceId('audioinput'), 'mic-fallback');

    await controller.handleActiveDeviceDisconnected('videoinput', undefined);
    assert.strictEqual(controller.getMediaSnapshot().localCameraEnabled, false);
    assert.strictEqual(controller.getMediaSnapshot().cameraPermission, 'unavailable');
    assert.match(controller.getMediaSnapshot().mediaError || '', /disconnected/i);

    await controller.dispose();
  });

  it('5. Handles permission denied, missing devices, autoplay restrictions, and track/listener cleanup on disconnect & reconnect', async () => {
    const room = new ControllableMediaRoom();
    room.micImpl = async () => {
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    };
    room.camImpl = async () => {
      throw Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
    };

    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      initialMedia: { micEnabled: true, cameraEnabled: true },
      speakerHoldMs: 0,
    });

    await controller.connect();
    const media = controller.getMediaSnapshot();
    assert.strictEqual(media.micPermission, 'denied');
    assert.strictEqual(media.cameraPermission, 'unavailable');
    assert.strictEqual(media.localMicEnabled, false);
    assert.strictEqual(media.localCameraEnabled, false);
    assert.ok(media.mediaError);

    // Autoplay restriction detected and unblocked via startAudioPlayback()
    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged);
    assert.strictEqual(controller.getMediaSnapshot().audioPlaybackBlocked, true);

    const unblocked = await controller.startAudioPlayback();
    assert.strictEqual(unblocked, true);
    assert.strictEqual(room.startAudioCalls, 1);
    assert.strictEqual(controller.getMediaSnapshot().audioPlaybackBlocked, false);

    // Now allow camera, enable it, reconnect, and confirm no duplicate tracks or listeners
    room.camImpl = undefined;
    await controller.setCameraEnabled(true);
    const listenersBeforeReconnect = room.totalListenerCount();
    const camTrack = room.localPubs.get('local_cam')?.track as ReturnType<typeof createStubTrack>;
    room.emit(RoomEvent.Reconnecting);
    room.emit(RoomEvent.Reconnected);
    assert.strictEqual(room.totalListenerCount(), listenersBeforeReconnect);
    assert.strictEqual(room.localPubs.size, 1);

    // Disconnect stops local tracks and removes all listeners
    room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
    assert.strictEqual(camTrack.stopped, true);
    assert.strictEqual(room.totalListenerCount(), 0);
    assert.strictEqual(controller.getMediaSnapshot().participants.length, 0);

    await controller.dispose();
  });

  it('6. Serializes concurrent mic/camera toggles and prevents duplicate publications on rapid clicks', async () => {
    const room = new ControllableMediaRoom();
    let releaseFirstMic!: () => void;
    let callNum = 0;
    room.micImpl = async () => {
      callNum += 1;
      if (callNum === 1) {
        await new Promise<void>((r) => {
          releaseFirstMic = r;
        });
      }
    };

    const controller = new LiveKitRoomController({
      meetingCode: 'cly-abc-123',
      fetchToken: async () => VALID_PHASE10_BUNDLE,
      createRoom: () => room,
      initialMedia: { micEnabled: false, cameraEnabled: false },
      speakerHoldMs: 0,
    });

    await controller.connect();

    const p1 = controller.setMicrophoneEnabled(true);
    const p2 = controller.setMicrophoneEnabled(false);
    releaseFirstMic();
    await Promise.all([p1, p2]);

    // Serialized cleanly: first enable ran, then disable ran, final state is muted with 1 pub
    assert.strictEqual(room.micCalls.length, 2);
    assert.strictEqual(room.micCalls[0].enabled, true);
    assert.strictEqual(room.micCalls[1].enabled, false);
    assert.strictEqual(controller.getMediaSnapshot().localMicEnabled, false);
    assert.strictEqual(room.localPubs.size, 1);

    await controller.dispose();
  });
});
