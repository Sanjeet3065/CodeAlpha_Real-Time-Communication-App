import {
  Room,
  RoomEvent,
  ConnectionState,
  DisconnectReason,
  Track,
  VideoPresets,
} from 'livekit-client';
import { ApiError } from './authApi.ts';
import { getMeetingErrorMessage } from './meetingApi.ts';
import {
  classifyMediaDeviceError,
  isAudioOutputSelectionSupported,
  isScreenShareSupported,
  parseLiveKitUserId,
} from '../utils/mediaDevices.ts';
import type {
  AttachableMediaTrack,
  LiveKitConnectionSnapshot,
  LiveKitConnectionStatus,
  LiveKitMediaSnapshot,
  LiveKitTokenResponse,
  ParticipantMediaState,
  PreJoinMediaChoice,
  ScreenShareStreamInfo,
} from '@/types/meeting';

export type LiveKitEventListener = (...args: unknown[]) => void;

export interface LiveKitTrackPublicationLike {
  trackSid?: string;
  source?: string;
  kind?: string;
  isMuted?: boolean;
  isSubscribed?: boolean;
  track?: AttachableMediaTrack | null;
}

export interface LiveKitParticipantLike {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
  audioLevel?: number;
  isMicrophoneEnabled?: boolean;
  isCameraEnabled?: boolean;
  isScreenShareEnabled?: boolean;
  trackPublications?: Map<string, LiveKitTrackPublicationLike>;
  getTrackPublication?: (source: Track.Source | string) => LiveKitTrackPublicationLike | undefined;
}

export interface LiveKitLocalParticipantLike extends LiveKitParticipantLike {
  setMicrophoneEnabled?: (
    enabled: boolean,
    captureOptions?: { deviceId?: string }
  ) => Promise<unknown>;
  setCameraEnabled?: (
    enabled: boolean,
    captureOptions?: { deviceId?: string; resolution?: unknown }
  ) => Promise<unknown>;
  setScreenShareEnabled?: (
    enabled: boolean,
    captureOptions?: { audio?: boolean }
  ) => Promise<unknown>;
}

export interface LiveKitRoomLike {
  state: ConnectionState;
  remoteParticipants: Map<string, LiveKitParticipantLike | unknown>;
  localParticipant?: LiveKitLocalParticipantLike;
  activeSpeakers?: LiveKitParticipantLike[];
  canPlaybackAudio?: boolean;
  connect(url: string, token: string): Promise<void>;
  disconnect(stopTracks?: boolean): Promise<void>;
  startAudio?: () => Promise<void>;
  switchActiveDevice?: (
    kind: 'audioinput' | 'videoinput' | 'audiooutput',
    deviceId: string,
    exact?: boolean
  ) => Promise<boolean | void>;
  on(event: string, listener: LiveKitEventListener): unknown;
  off(event: string, listener: LiveKitEventListener): unknown;
}

export interface LiveKitControllerOptions {
  meetingCode: string;
  fetchToken: (meetingCode: string) => Promise<LiveKitTokenResponse>;
  verifyAuthoritativeState?: () => Promise<boolean>;
  createRoom?: () => LiveKitRoomLike;
  fallbackUrl?: string;
  initialMedia?: PreJoinMediaChoice;
  speakerHoldMs?: number;
  onStateChange?: (snapshot: LiveKitConnectionSnapshot) => void;
  onMediaChange?: (media: LiveKitMediaSnapshot) => void;
}

export function createInitialLiveKitSnapshot(): LiveKitConnectionSnapshot {
  return {
    status: 'idle',
    roomName: null,
    participantIdentity: null,
    livekitUrl: null,
    remoteParticipantCount: 0,
    connectedAt: null,
    errorCode: null,
    errorMessage: null,
    attemptId: 0,
  };
}

export function createInitialLiveKitMediaSnapshot(
  initialMedia?: PreJoinMediaChoice
): LiveKitMediaSnapshot {
  return {
    localMicEnabled: Boolean(initialMedia?.micEnabled),
    localCameraEnabled: Boolean(initialMedia?.cameraEnabled),
    localScreenShareEnabled: false,
    localMicPublished: false,
    localCameraPublished: false,
    localScreenSharePublished: false,
    isTogglingMic: false,
    isTogglingCamera: false,
    isTogglingScreenShare: false,
    isSwitchingDevice: false,
    micPermission: 'prompt',
    cameraPermission: 'prompt',
    screenSharePermission: 'prompt',
    audioPlaybackBlocked: false,
    activeSpeakerIdentities: [],
    mediaError: null,
    mediaNotice: null,
    screenShareError: null,
    participants: [],
    screenShares: [],
  };
}

function isAllowedWsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

function classifyConnectError(err: unknown): {
  status: LiveKitConnectionStatus;
  code: string;
  message: string;
} {
  if (err instanceof ApiError) {
    if (
      err.code === 'LIVEKIT_MEETING_ENDED' ||
      err.code === 'MEETING_ENDED' ||
      err.code === 'MEETING_EXPIRED'
    ) {
      return {
        status: 'meeting_ended',
        code: 'LIVEKIT_MEETING_ENDED',
        message: getMeetingErrorMessage('LIVEKIT_MEETING_ENDED', err.message),
      };
    }
    if (
      err.status === 401 ||
      err.status === 403 ||
      err.code === 'LIVEKIT_ACCESS_DENIED' ||
      err.code === 'PARTICIPANT_REMOVED' ||
      err.code === 'MEETING_LOCKED'
    ) {
      return {
        status: 'unauthorized',
        code: err.code || 'LIVEKIT_ACCESS_DENIED',
        message: getMeetingErrorMessage(err.code, err.message),
      };
    }
    if (err.code === 'LIVEKIT_NOT_CONFIGURED' || err.code === 'LIVEKIT_UNAVAILABLE') {
      return {
        status: 'failed',
        code: err.code,
        message: getMeetingErrorMessage(err.code, err.message),
      };
    }
    return {
      status: 'failed',
      code: err.code || 'LIVEKIT_TOKEN_GENERATION_FAILED',
      message: getMeetingErrorMessage(err.code, err.message),
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const lower = rawMsg.toLowerCase();

  if (
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('revoked') ||
    lower.includes('removed from this meeting')
  ) {
    return {
      status: 'unauthorized',
      code: lower.includes('removed') ? 'PARTICIPANT_REMOVED' : 'LIVEKIT_ACCESS_DENIED',
      message: getMeetingErrorMessage(
        lower.includes('removed') ? 'PARTICIPANT_REMOVED' : 'LIVEKIT_ACCESS_DENIED'
      ),
    };
  }

  if (
    lower.includes('invalid token') ||
    lower.includes('expired') ||
    lower.includes('401') ||
    lower.includes('unauthorized')
  ) {
    return {
      status: 'failed',
      code: 'LIVEKIT_INVALID_TOKEN',
      message: getMeetingErrorMessage('LIVEKIT_INVALID_TOKEN'),
    };
  }

  if (lower.includes('room deleted') || lower.includes('meeting ended')) {
    return {
      status: 'meeting_ended',
      code: 'LIVEKIT_MEETING_ENDED',
      message: getMeetingErrorMessage('LIVEKIT_MEETING_ENDED'),
    };
  }

  return {
    status: 'failed',
    code: 'LIVEKIT_CONNECTION_FAILED',
    message: getMeetingErrorMessage('LIVEKIT_CONNECTION_FAILED'),
  };
}

function findTrackPublication(
  participant: LiveKitParticipantLike,
  source: Track.Source | string
): LiveKitTrackPublicationLike | undefined {
  if (typeof participant.getTrackPublication === 'function') {
    const direct = participant.getTrackPublication(source as Track.Source);
    if (direct) return direct;
  }
  if (participant.trackPublications && typeof participant.trackPublications.values === 'function') {
    for (const pub of participant.trackPublications.values()) {
      if (pub.source === source || pub.source === String(source)) return pub;
      if (
        (source === Track.Source.ScreenShare || source === 'screen_share') &&
        (pub.source === Track.Source.ScreenShare || pub.source === 'screen_share')
      ) {
        return pub;
      }
      if (
        (source === Track.Source.ScreenShareAudio || source === 'screen_share_audio') &&
        (pub.source === Track.Source.ScreenShareAudio || pub.source === 'screen_share_audio')
      ) {
        return pub;
      }
      if (
        (source === Track.Source.Camera || source === 'camera') &&
        pub.kind === 'video' &&
        pub.source !== Track.Source.ScreenShare &&
        pub.source !== 'screen_share'
      ) {
        return pub;
      }
      if (
        (source === Track.Source.Microphone || source === 'microphone') &&
        pub.kind === 'audio' &&
        pub.source !== Track.Source.ScreenShareAudio &&
        pub.source !== 'screen_share_audio'
      ) {
        return pub;
      }
    }
  }
  return undefined;
}

/**
 * Single-room LiveKit SFU connection & media track controller (Phases 09–10).
 *
 * Guarantees:
 * - Tokens stay strictly in transient call memory (never persisted to storage).
 * - At most ONE active LiveKit Room instance exists per meeting component tree.
 * - Monotonic attemptId prevents React StrictMode double-mounts or stale async token
 *   resolutions from leaking duplicate connections, tracks, or listeners.
 * - Real local microphone/camera publishing, mute/unmute, device switching, remote
 *   audio/video subscription state, active speaker detection, and browser autoplay handling.
 * - Every RoomEvent listener and local media track is explicitly cleaned up on teardown.
 */
export class LiveKitRoomController {
  private readonly options: LiveKitControllerOptions;
  private readonly speakerHoldMs: number;
  private snapshot: LiveKitConnectionSnapshot = createInitialLiveKitSnapshot();
  private mediaSnapshot: LiveKitMediaSnapshot;
  private activeRoom: LiveKitRoomLike | null = null;
  private boundListeners: Array<{ event: string; handler: LiveKitEventListener }> = [];
  private attemptCounter = 0;
  private isDisposed = false;
  private isTerminal = false;
  private isConnecting = false;

  // Intended local media state & device selections (preserved across safe reconnects)
  private intendedMicEnabled: boolean;
  private intendedCameraEnabled: boolean;
  private activeDeviceIds: Record<'audioinput' | 'videoinput' | 'audiooutput', string>;

  // Serialization guards to prevent duplicate tracks on rapid clicks / reconnect races
  private micTogglePromise: Promise<boolean> | null = null;
  private cameraTogglePromise: Promise<boolean> | null = null;
  private screenShareTogglePromise: Promise<boolean> | null = null;
  private deviceSwitchPromise: Promise<boolean> | null = null;

  // Anti-flicker active-speaker smoothing driven strictly by RoomEvent.ActiveSpeakersChanged
  private readonly smoothedSpeakerIdentities = new Set<string>();
  private readonly speakerReleaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: LiveKitControllerOptions) {
    this.options = options;
    this.speakerHoldMs = options.speakerHoldMs ?? 350;
    this.intendedMicEnabled = Boolean(options.initialMedia?.micEnabled);
    this.intendedCameraEnabled = Boolean(options.initialMedia?.cameraEnabled);
    this.activeDeviceIds = {
      audioinput: options.initialMedia?.audioInputDeviceId || '',
      videoinput: options.initialMedia?.videoInputDeviceId || '',
      audiooutput: options.initialMedia?.audioOutputDeviceId || '',
    };
    this.mediaSnapshot = createInitialLiveKitMediaSnapshot(options.initialMedia);
  }

  public getSnapshot(): LiveKitConnectionSnapshot {
    return { ...this.snapshot };
  }

  public getMediaSnapshot(): LiveKitMediaSnapshot {
    return {
      ...this.mediaSnapshot,
      activeSpeakerIdentities: [...this.mediaSnapshot.activeSpeakerIdentities],
      participants: this.mediaSnapshot.participants.map((p) => ({ ...p })),
      screenShares: this.mediaSnapshot.screenShares.map((s) => ({ ...s })),
    };
  }

  public getActiveRoom(): LiveKitRoomLike | null {
    return this.activeRoom;
  }

  public getSelectedDeviceId(kind: 'audioinput' | 'videoinput' | 'audiooutput'): string {
    return this.activeDeviceIds[kind];
  }

  private updateSnapshot(patch: Partial<LiveKitConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.options.onStateChange?.(this.getSnapshot());
  }

  private updateMediaSnapshot(patch: Partial<LiveKitMediaSnapshot>): void {
    this.mediaSnapshot = { ...this.mediaSnapshot, ...patch };
    this.options.onMediaChange?.(this.getMediaSnapshot());
  }

  public clearMediaFeedback(): void {
    if (this.mediaSnapshot.mediaError || this.mediaSnapshot.mediaNotice) {
      this.updateMediaSnapshot({ mediaError: null, mediaNotice: null });
    }
  }

  private clearSpeakerTimers(): void {
    for (const timer of this.speakerReleaseTimers.values()) {
      clearTimeout(timer);
    }
    this.speakerReleaseTimers.clear();
    this.smoothedSpeakerIdentities.clear();
  }

  private detachListeners(room: LiveKitRoomLike | null): void {
    if (!room) return;
    for (const { event, handler } of this.boundListeners) {
      try {
        room.off(event, handler);
      } catch {
        // ignore listener cleanup errors
      }
    }
    this.boundListeners = [];
  }

  private stopLocalRoomTracks(room: LiveKitRoomLike | null): void {
    const local = room?.localParticipant;
    if (!local?.trackPublications) return;
    for (const pub of local.trackPublications.values()) {
      try {
        pub.track?.stop?.();
      } catch {
        // ignore track stop errors during teardown
      }
    }
  }

  private async cleanupActiveRoom(): Promise<void> {
    const room = this.activeRoom;
    this.activeRoom = null;
    this.clearSpeakerTimers();
    if (!room) return;
    this.detachListeners(room);
    this.stopLocalRoomTracks(room);
    try {
      await room.disconnect(true);
    } catch {
      // ignore disconnect errors during teardown
    }
    if (!this.isDisposed) {
      this.updateMediaSnapshot({
        localMicPublished: false,
        localCameraPublished: false,
        localScreenSharePublished: false,
        localScreenShareEnabled: false,
        isTogglingMic: false,
        isTogglingCamera: false,
        isTogglingScreenShare: false,
        isSwitchingDevice: false,
        audioPlaybackBlocked: false,
        activeSpeakerIdentities: [],
        participants: [],
        screenShares: [],
      });
    }
  }

  private buildParticipantState(
    participant: LiveKitParticipantLike,
    isLocal: boolean
  ): ParticipantMediaState {
    const camPub = findTrackPublication(participant, Track.Source.Camera);
    const micPub = findTrackPublication(participant, Track.Source.Microphone);
    const screenPub = findTrackPublication(participant, Track.Source.ScreenShare);
    const screenAudioPub = findTrackPublication(participant, Track.Source.ScreenShareAudio);

    const rawVideoTrack =
      camPub && camPub.track && !camPub.isMuted && (isLocal || camPub.isSubscribed !== false)
        ? camPub.track
        : null;

    const rawAudioTrack =
      micPub && micPub.track && (isLocal || micPub.isSubscribed !== false) ? micPub.track : null;

    const rawScreenTrack =
      screenPub && screenPub.track && !screenPub.isMuted && (isLocal || screenPub.isSubscribed !== false)
        ? screenPub.track
        : null;

    const rawScreenAudioTrack =
      screenAudioPub && screenAudioPub.track && (isLocal || screenAudioPub.isSubscribed !== false)
        ? screenAudioPub.track
        : null;

    const isCameraEnabled = isLocal
      ? Boolean(rawVideoTrack) && participant.isCameraEnabled !== false
      : Boolean(rawVideoTrack);

    const isMicEnabled = isLocal
      ? Boolean(micPub && micPub.track && !micPub.isMuted && participant.isMicrophoneEnabled !== false)
      : Boolean(
          micPub &&
            !micPub.isMuted &&
            (Boolean(micPub.track) || Boolean(micPub.trackSid) || participant.isMicrophoneEnabled)
        );

    const isScreenSharing = Boolean(rawScreenTrack) || (isLocal && participant.isScreenShareEnabled === true);

    const isSpeaking = this.smoothedSpeakerIdentities.has(participant.identity);

    return {
      identity: participant.identity,
      userId: parseLiveKitUserId(participant.identity),
      name: participant.name || participant.identity,
      isLocal,
      isSpeaking,
      audioLevel: typeof participant.audioLevel === 'number' ? participant.audioLevel : 0,
      isMicEnabled,
      isCameraEnabled,
      isScreenSharing,
      hasAudioTrack: Boolean(rawAudioTrack),
      hasVideoTrack: Boolean(rawVideoTrack),
      videoTrack: isCameraEnabled ? rawVideoTrack : null,
      audioTrack: rawAudioTrack,
      screenShareTrack: rawScreenTrack,
      screenShareAudioTrack: rawScreenAudioTrack,
    };
  }

  private syncMediaFromRoom(room: LiveKitRoomLike | null, attemptId: number): void {
    if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room || !room) {
      return;
    }

    const participants: ParticipantMediaState[] = [];
    const screenShares: ScreenShareStreamInfo[] = [];
    let localMicPublished = false;
    let localCameraPublished = false;
    let localScreenSharePublished = false;
    let localMicEnabled = this.intendedMicEnabled;
    let localCameraEnabled = this.intendedCameraEnabled;
    let localScreenShareEnabled = false;

    if (room.localParticipant && room.localParticipant.identity) {
      const localState = this.buildParticipantState(room.localParticipant, true);
      participants.push(localState);
      const micPub = findTrackPublication(room.localParticipant, Track.Source.Microphone);
      const camPub = findTrackPublication(room.localParticipant, Track.Source.Camera);
      const screenPub = findTrackPublication(room.localParticipant, Track.Source.ScreenShare);
      localMicPublished = Boolean(micPub?.track);
      localCameraPublished = Boolean(camPub?.track);
      localScreenSharePublished = Boolean(screenPub?.track);
      localMicEnabled = localState.isMicEnabled;
      localCameraEnabled = localState.isCameraEnabled;
      localScreenShareEnabled = localState.isScreenSharing;

      if (localState.screenShareTrack) {
        screenShares.push({
          participantIdentity: localState.identity,
          userId: localState.userId,
          displayName: localState.name || 'You',
          isLocal: true,
          videoTrack: localState.screenShareTrack,
          audioTrack: localState.screenShareAudioTrack,
        });
      }
    }

    if (room.remoteParticipants && typeof room.remoteParticipants.values === 'function') {
      for (const rawRemote of room.remoteParticipants.values()) {
        const remote = rawRemote as LiveKitParticipantLike | null;
        if (!remote || typeof remote.identity !== 'string' || !remote.identity) continue;
        const remoteState = this.buildParticipantState(remote, false);
        participants.push(remoteState);
        if (remoteState.screenShareTrack) {
          screenShares.push({
            participantIdentity: remoteState.identity,
            userId: remoteState.userId,
            displayName: remoteState.name,
            isLocal: false,
            videoTrack: remoteState.screenShareTrack,
            audioTrack: remoteState.screenShareAudioTrack,
          });
        }
      }
    }

    const remoteCount = room.remoteParticipants?.size ?? 0;
    if (remoteCount !== this.snapshot.remoteParticipantCount) {
      this.updateSnapshot({ remoteParticipantCount: remoteCount });
    }

    this.updateMediaSnapshot({
      localMicEnabled,
      localCameraEnabled,
      localScreenShareEnabled,
      localMicPublished,
      localCameraPublished,
      localScreenSharePublished,
      audioPlaybackBlocked: room.canPlaybackAudio === false,
      activeSpeakerIdentities: Array.from(this.smoothedSpeakerIdentities),
      participants,
      screenShares,
    });
  }

  private handleActiveSpeakersChanged(
    room: LiveKitRoomLike,
    attemptId: number,
    speakersRaw: unknown
  ): void {
    if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;

    const currentSet = new Set<string>();
    if (Array.isArray(speakersRaw)) {
      for (const s of speakersRaw) {
        const id = (s as { identity?: unknown })?.identity;
        if (typeof id === 'string' && id) {
          currentSet.add(id);
        }
      }
    }

    // Immediate highlight activation for newly active speakers
    for (const id of currentSet) {
      const existingTimer = this.speakerReleaseTimers.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.speakerReleaseTimers.delete(id);
      }
      this.smoothedSpeakerIdentities.add(id);
    }

    // Smooth debounced release to prevent flickering between syllables
    for (const id of Array.from(this.smoothedSpeakerIdentities)) {
      if (currentSet.has(id)) continue;
      if (this.speakerHoldMs <= 0) {
        this.smoothedSpeakerIdentities.delete(id);
      } else if (!this.speakerReleaseTimers.has(id)) {
        const timer = setTimeout(() => {
          this.speakerReleaseTimers.delete(id);
          if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) {
            return;
          }
          this.smoothedSpeakerIdentities.delete(id);
          this.syncMediaFromRoom(room, attemptId);
        }, this.speakerHoldMs);
        this.speakerReleaseTimers.set(id, timer);
      }
    }

    this.syncMediaFromRoom(room, attemptId);
  }

  private attachRoomListeners(room: LiveKitRoomLike, attemptId: number): void {
    const bind = (event: string, handler: LiveKitEventListener) => {
      room.on(event, handler);
      this.boundListeners.push({ event, handler });
    };

    const sync = () => {
      this.syncMediaFromRoom(room, attemptId);
    };

    bind(RoomEvent.ConnectionStateChanged, (rawState: unknown) => {
      const state = rawState as ConnectionState;
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      if (state === ConnectionState.Connected) {
        this.updateSnapshot({
          status: 'connected',
          remoteParticipantCount: room.remoteParticipants?.size ?? 0,
          connectedAt: this.snapshot.connectedAt || new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
        });
        sync();
      } else if (
        state === ConnectionState.Reconnecting ||
        state === ConnectionState.SignalReconnecting
      ) {
        this.updateSnapshot({
          status: 'reconnecting',
          errorCode: null,
          errorMessage: 'Connection interrupted. LiveKit is reconnecting...',
        });
      }
    });

    bind(RoomEvent.Reconnecting, () => {
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      this.updateSnapshot({
        status: 'reconnecting',
        errorCode: null,
        errorMessage: 'Network interruption detected. Attempting LiveKit reconnect...',
      });
    });

    bind(RoomEvent.Reconnected, () => {
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      this.updateSnapshot({
        status: 'connected',
        remoteParticipantCount: room.remoteParticipants?.size ?? 0,
        errorCode: null,
        errorMessage: null,
      });
      sync();
      void this.reconcileLocalMediaOnReconnect(room, attemptId);
    });

    bind(RoomEvent.ParticipantConnected, sync);
    bind(RoomEvent.ParticipantDisconnected, (participantRaw?: unknown) => {
      const pId = (participantRaw as { identity?: string } | undefined)?.identity;
      if (pId) {
        const timer = this.speakerReleaseTimers.get(pId);
        if (timer) {
          clearTimeout(timer);
          this.speakerReleaseTimers.delete(pId);
        }
        this.smoothedSpeakerIdentities.delete(pId);
      }
      sync();
    });

    bind(RoomEvent.TrackPublished, sync);
    bind(RoomEvent.TrackUnpublished, sync);
    bind(RoomEvent.TrackSubscribed, sync);
    bind(RoomEvent.TrackUnsubscribed, sync);
    bind(RoomEvent.TrackMuted, sync);
    bind(RoomEvent.TrackUnmuted, sync);
    bind(RoomEvent.LocalTrackPublished, sync);
    bind(RoomEvent.LocalTrackUnpublished, sync);

    bind(RoomEvent.ActiveSpeakersChanged, (speakersRaw: unknown) => {
      this.handleActiveSpeakersChanged(room, attemptId, speakersRaw);
    });

    bind(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      this.updateMediaSnapshot({
        audioPlaybackBlocked: room.canPlaybackAudio === false,
      });
    });

    bind(RoomEvent.TrackSubscriptionFailed, (_trackSid: unknown, participantRaw?: unknown) => {
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      const pName =
        (participantRaw as { name?: string; identity?: string } | undefined)?.name ||
        'a participant';
      this.updateMediaSnapshot({
        mediaError: `Unable to subscribe to media from ${pName}. Reconnection will retry automatically.`,
      });
    });

    bind(RoomEvent.MediaDevicesError, (err: unknown) => {
      if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) return;
      const classified = classifyMediaDeviceError(err, 'camera');
      this.updateMediaSnapshot({
        mediaError: classified.message,
      });
    });

    bind(RoomEvent.Disconnected, (rawReason?: unknown) => {
      const reason = rawReason as DisconnectReason | undefined;
      if (this.isDisposed || attemptId !== this.attemptCounter) return;
      this.clearSpeakerTimers();
      if (this.activeRoom === room) {
        this.detachListeners(room);
        this.stopLocalRoomTracks(room);
        this.activeRoom = null;
      }

      this.updateMediaSnapshot({
        localMicPublished: false,
        localCameraPublished: false,
        localScreenSharePublished: false,
        localScreenShareEnabled: false,
        isTogglingMic: false,
        isTogglingCamera: false,
        isTogglingScreenShare: false,
        isSwitchingDevice: false,
        audioPlaybackBlocked: false,
        activeSpeakerIdentities: [],
        participants: [],
        screenShares: [],
      });

      if (reason === DisconnectReason.ROOM_DELETED) {
        this.isTerminal = true;
        this.updateSnapshot({
          status: 'meeting_ended',
          remoteParticipantCount: 0,
          errorCode: 'LIVEKIT_MEETING_ENDED',
          errorMessage: getMeetingErrorMessage('LIVEKIT_MEETING_ENDED'),
        });
        return;
      }

      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        this.isTerminal = true;
        this.updateSnapshot({
          status: 'unauthorized',
          remoteParticipantCount: 0,
          errorCode: 'PARTICIPANT_REMOVED',
          errorMessage: getMeetingErrorMessage('PARTICIPANT_REMOVED'),
        });
        return;
      }

      if (this.isTerminal) return;

      const isClientInitiated = reason === DisconnectReason.CLIENT_INITIATED;
      this.updateSnapshot({
        status: 'disconnected',
        remoteParticipantCount: 0,
        errorCode: isClientInitiated ? null : 'LIVEKIT_CONNECTION_FAILED',
        errorMessage: isClientInitiated
          ? 'Disconnected from LiveKit media room.'
          : 'LiveKit connection was interrupted. Click Reconnect to verify room state and rejoin.',
      });
    });
  }

  private async applyInitialMediaAfterConnect(
    room: LiveKitRoomLike,
    attemptId: number
  ): Promise<void> {
    if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter || this.activeRoom !== room) {
      return;
    }

    if (
      this.activeDeviceIds.audiooutput &&
      isAudioOutputSelectionSupported() &&
      typeof room.switchActiveDevice === 'function'
    ) {
      try {
        await room.switchActiveDevice('audiooutput', this.activeDeviceIds.audiooutput);
      } catch {
        // Non-fatal: continue with default system audio output
      }
    }

    if (this.intendedMicEnabled) {
      await this.setMicrophoneEnabled(true, this.activeDeviceIds.audioinput || undefined);
    }
    if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter || this.activeRoom !== room) {
      return;
    }
    if (this.intendedCameraEnabled) {
      await this.setCameraEnabled(true, this.activeDeviceIds.videoinput || undefined);
    }

    this.syncMediaFromRoom(room, attemptId);
  }

  private async reconcileLocalMediaOnReconnect(
    room: LiveKitRoomLike,
    attemptId: number
  ): Promise<void> {
    if (
      this.isDisposed ||
      this.isTerminal ||
      attemptId !== this.attemptCounter ||
      this.activeRoom !== room ||
      !room.localParticipant
    ) {
      return;
    }

    // Only republish if the user intended the track on AND no active track is currently published
    const micPub = findTrackPublication(room.localParticipant, Track.Source.Microphone);
    if (this.intendedMicEnabled && (!micPub?.track || micPub.isMuted)) {
      await this.setMicrophoneEnabled(true, this.activeDeviceIds.audioinput || undefined);
    }

    if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter || this.activeRoom !== room) {
      return;
    }

    const camPub = findTrackPublication(room.localParticipant, Track.Source.Camera);
    if (this.intendedCameraEnabled && (!camPub?.track || camPub.isMuted)) {
      await this.setCameraEnabled(true, this.activeDeviceIds.videoinput || undefined);
    }
  }

  /**
   * Enables or disables the local microphone via LiveKit's real LocalParticipant API.
   * Serialized against concurrent toggles so rapid clicks never publish duplicate tracks.
   */
  public async setMicrophoneEnabled(enabled: boolean, deviceId?: string): Promise<boolean> {
    if (this.micTogglePromise) {
      await this.micTogglePromise.catch(() => false);
    }

    const run = async (): Promise<boolean> => {
      const room = this.activeRoom;
      const attemptId = this.attemptCounter;

      if (this.isDisposed || this.isTerminal || !room || this.snapshot.status !== 'connected') {
        this.intendedMicEnabled = enabled;
        this.updateMediaSnapshot({ localMicEnabled: enabled });
        return false;
      }

      if (!room.localParticipant?.setMicrophoneEnabled) {
        return false;
      }

      this.updateMediaSnapshot({ isTogglingMic: true, mediaError: null });
      const targetDeviceId = deviceId ?? (this.activeDeviceIds.audioinput || undefined);

      try {
        await room.localParticipant.setMicrophoneEnabled(
          enabled,
          enabled && targetDeviceId ? { deviceId: targetDeviceId } : undefined
        );
        if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) {
          return false;
        }
        this.intendedMicEnabled = enabled;
        if (targetDeviceId) {
          this.activeDeviceIds.audioinput = targetDeviceId;
        }
        this.updateMediaSnapshot({
          localMicEnabled: enabled,
          isTogglingMic: false,
          ...(enabled ? { micPermission: 'granted' as const } : {}),
        });
        this.syncMediaFromRoom(room, attemptId);
        return true;
      } catch (err) {
        if (this.isDisposed || attemptId !== this.attemptCounter) return false;
        const classified = classifyMediaDeviceError(err, 'microphone');
        this.intendedMicEnabled = false;
        this.updateMediaSnapshot({
          localMicEnabled: false,
          isTogglingMic: false,
          micPermission: classified.permission,
          mediaError: classified.message,
        });
        this.syncMediaFromRoom(room, attemptId);
        return false;
      }
    };

    const p = run().finally(() => {
      if (this.micTogglePromise === p) {
        this.micTogglePromise = null;
      }
    });
    this.micTogglePromise = p;
    return p;
  }

  /**
   * Enables or disables the local camera via LiveKit's real LocalParticipant API.
   * Turning off actually stops camera capture & transmission (no frozen frames).
   */
  public async setCameraEnabled(enabled: boolean, deviceId?: string): Promise<boolean> {
    if (this.cameraTogglePromise) {
      await this.cameraTogglePromise.catch(() => false);
    }

    const run = async (): Promise<boolean> => {
      const room = this.activeRoom;
      const attemptId = this.attemptCounter;

      if (this.isDisposed || this.isTerminal || !room || this.snapshot.status !== 'connected') {
        this.intendedCameraEnabled = enabled;
        this.updateMediaSnapshot({ localCameraEnabled: enabled });
        return false;
      }

      if (!room.localParticipant?.setCameraEnabled) {
        return false;
      }

      this.updateMediaSnapshot({ isTogglingCamera: true, mediaError: null });
      const targetDeviceId = deviceId ?? (this.activeDeviceIds.videoinput || undefined);

      try {
        await room.localParticipant.setCameraEnabled(
          enabled,
          enabled
            ? {
                ...(targetDeviceId ? { deviceId: targetDeviceId } : {}),
                resolution: VideoPresets.h720.resolution,
              }
            : undefined
        );
        if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) {
          return false;
        }
        this.intendedCameraEnabled = enabled;
        if (targetDeviceId) {
          this.activeDeviceIds.videoinput = targetDeviceId;
        }
        this.updateMediaSnapshot({
          localCameraEnabled: enabled,
          isTogglingCamera: false,
          ...(enabled ? { cameraPermission: 'granted' as const } : {}),
        });
        this.syncMediaFromRoom(room, attemptId);
        return true;
      } catch (err) {
        if (this.isDisposed || attemptId !== this.attemptCounter) return false;
        const classified = classifyMediaDeviceError(err, 'camera');
        this.intendedCameraEnabled = false;
        this.updateMediaSnapshot({
          localCameraEnabled: false,
          isTogglingCamera: false,
          cameraPermission: classified.permission,
          mediaError: classified.message,
        });
        this.syncMediaFromRoom(room, attemptId);
        return false;
      }
    };

    const p = run().finally(() => {
      if (this.cameraTogglePromise === p) {
        this.cameraTogglePromise = null;
      }
    });
    this.cameraTogglePromise = p;
    return p;
  }

  /**
   * Enables or disables screen sharing via LiveKit's real LocalParticipant API.
   * Serialized against concurrent toggles so rapid clicks never publish duplicate tracks.
   * Preserves camera and microphone tracks completely independently.
   * Handles user cancellation, permission denial, unsupported environments, and native browser track stop.
   */
  public async setScreenShareEnabled(
    enabled: boolean,
    options?: { audio?: boolean }
  ): Promise<boolean> {
    if (this.screenShareTogglePromise) {
      await this.screenShareTogglePromise.catch(() => false);
    }

    const run = async (): Promise<boolean> => {
      const room = this.activeRoom;
      const attemptId = this.attemptCounter;

      if (this.isDisposed || this.isTerminal || !room || this.snapshot.status !== 'connected') {
        this.updateMediaSnapshot({
          localScreenShareEnabled: enabled,
          isTogglingScreenShare: false,
        });
        return false;
      }

      if (!room.localParticipant?.setScreenShareEnabled) {
        this.updateMediaSnapshot({
          localScreenShareEnabled: false,
          isTogglingScreenShare: false,
          screenSharePermission: 'unavailable',
          screenShareError: 'Screen sharing is not supported by your current browser environment.',
        });
        return false;
      }

      if (enabled && typeof window !== 'undefined' && !isScreenShareSupported()) {
        this.updateMediaSnapshot({
          localScreenShareEnabled: false,
          isTogglingScreenShare: false,
          screenSharePermission: 'unavailable',
          screenShareError: 'Screen sharing is not supported by your current browser environment.',
        });
        return false;
      }

      this.updateMediaSnapshot({ isTogglingScreenShare: true, screenShareError: null });

      try {
        await room.localParticipant.setScreenShareEnabled(
          enabled,
          enabled ? { audio: options?.audio ?? true } : undefined
        );

        if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) {
          return false;
        }

        // Attach listener for native browser stop-sharing event
        if (enabled) {
          const screenPub = findTrackPublication(room.localParticipant, Track.Source.ScreenShare);
          const rawTrack = screenPub?.track;
          if (rawTrack) {
            const mediaStreamTrack = (rawTrack as unknown as { mediaStreamTrack?: MediaStreamTrack })
              ?.mediaStreamTrack;
            if (mediaStreamTrack && typeof mediaStreamTrack.addEventListener === 'function') {
              const onNativeEnded = () => {
                mediaStreamTrack.removeEventListener('ended', onNativeEnded);
                void this.setScreenShareEnabled(false);
              };
              mediaStreamTrack.addEventListener('ended', onNativeEnded);
            }
          }
        }

        this.updateMediaSnapshot({
          localScreenShareEnabled: enabled,
          isTogglingScreenShare: false,
          ...(enabled ? { screenSharePermission: 'granted' as const } : {}),
        });

        this.syncMediaFromRoom(room, attemptId);
        return true;
      } catch (err) {
        if (this.isDisposed || attemptId !== this.attemptCounter) return false;
        const classified = classifyMediaDeviceError(err, 'screen');
        this.updateMediaSnapshot({
          localScreenShareEnabled: false,
          isTogglingScreenShare: false,
          screenSharePermission: classified.permission,
          screenShareError: classified.message,
        });
        this.syncMediaFromRoom(room, attemptId);
        return false;
      }
    };

    const p = run().finally(() => {
      if (this.screenShareTogglePromise === p) {
        this.screenShareTogglePromise = null;
      }
    });
    this.screenShareTogglePromise = p;
    return p;
  }

  /**
   * Switches active microphone, camera, or audio output device cleanly while
   * preserving current mute/camera-off state and rolling back on error.
   */
  public async switchDevice(
    kind: 'audioinput' | 'videoinput' | 'audiooutput',
    deviceId: string
  ): Promise<boolean> {
    if (this.deviceSwitchPromise) {
      await this.deviceSwitchPromise.catch(() => false);
    }

    const run = async (): Promise<boolean> => {
      const room = this.activeRoom;
      const attemptId = this.attemptCounter;
      const prevDeviceId = this.activeDeviceIds[kind];

      if (kind === 'audiooutput' && !isAudioOutputSelectionSupported()) {
        this.updateMediaSnapshot({
          mediaNotice: 'Speaker output selection is not supported by this browser.',
        });
        return false;
      }

      if (this.isDisposed || this.isTerminal) return false;

      if (!room || this.snapshot.status !== 'connected') {
        this.activeDeviceIds[kind] = deviceId;
        return true;
      }

      if (typeof room.switchActiveDevice !== 'function') {
        this.activeDeviceIds[kind] = deviceId;
        return true;
      }

      this.updateMediaSnapshot({ isSwitchingDevice: true, mediaError: null, mediaNotice: null });

      try {
        await room.switchActiveDevice(kind, deviceId);
        if (this.isDisposed || attemptId !== this.attemptCounter || this.activeRoom !== room) {
          return false;
        }
        this.activeDeviceIds[kind] = deviceId;
        const label =
          kind === 'audioinput'
            ? 'Microphone'
            : kind === 'videoinput'
              ? 'Camera'
              : 'Speaker output';
        this.updateMediaSnapshot({
          isSwitchingDevice: false,
          mediaNotice: `${label} switched successfully.`,
        });
        this.syncMediaFromRoom(room, attemptId);
        return true;
      } catch (err) {
        if (this.isDisposed || attemptId !== this.attemptCounter) return false;
        this.activeDeviceIds[kind] = prevDeviceId;
        const label =
          kind === 'audioinput'
            ? 'microphone'
            : kind === 'videoinput'
              ? 'camera'
              : 'audio output';
        const classified = classifyMediaDeviceError(err, label);
        this.updateMediaSnapshot({
          isSwitchingDevice: false,
          mediaError: `Failed to switch ${label}: ${classified.message}`,
        });
        this.syncMediaFromRoom(room, attemptId);
        return false;
      }
    };

    const p = run().finally(() => {
      if (this.deviceSwitchPromise === p) {
        this.deviceSwitchPromise = null;
      }
    });
    this.deviceSwitchPromise = p;
    return p;
  }

  /**
   * Handles hardware disconnection of the currently active microphone or camera
   * (invoked on browser `devicechange`), falling back safely or disabling the track.
   */
  public async handleActiveDeviceDisconnected(
    kind: 'audioinput' | 'videoinput',
    fallbackDeviceId?: string
  ): Promise<void> {
    if (this.isDisposed || this.isTerminal) return;
    const label = kind === 'audioinput' ? 'microphone' : 'camera';

    if (fallbackDeviceId) {
      const switched = await this.switchDevice(kind, fallbackDeviceId);
      if (switched) {
        this.updateMediaSnapshot({
          mediaNotice: `Previous ${label} was disconnected. Switched to an available ${label}.`,
        });
        return;
      }
    }

    this.activeDeviceIds[kind] = '';
    if (kind === 'audioinput' && this.intendedMicEnabled) {
      await this.setMicrophoneEnabled(false);
    } else if (kind === 'videoinput' && this.intendedCameraEnabled) {
      await this.setCameraEnabled(false);
    }

    this.updateMediaSnapshot({
      ...(kind === 'audioinput' ? { micPermission: 'unavailable' as const } : { cameraPermission: 'unavailable' as const }),
      mediaError: `Your active ${label} was disconnected. Connect a ${label} to resume.`,
    });
  }

  /**
   * Unblocks browser autoplay restrictions for remote participant audio playback.
   */
  public async startAudioPlayback(): Promise<boolean> {
    const room = this.activeRoom;
    if (!room || this.isDisposed) return false;
    if (typeof room.startAudio !== 'function') {
      this.updateMediaSnapshot({ audioPlaybackBlocked: false });
      return true;
    }

    try {
      await room.startAudio();
      if (this.isDisposed || this.activeRoom !== room) return false;
      const stillBlocked = room.canPlaybackAudio === false;
      this.updateMediaSnapshot({
        audioPlaybackBlocked: stillBlocked,
        mediaError: stillBlocked
          ? 'Browser still requires interaction to play meeting audio. Please click Enable Audio again.'
          : null,
      });
      return !stillBlocked;
    } catch {
      if (!this.isDisposed) {
        this.updateMediaSnapshot({
          audioPlaybackBlocked: true,
          mediaError: 'Browser blocked audio playback. Click Enable Audio to unmute meeting sound.',
        });
      }
      return false;
    }
  }

  /**
   * Executes the full secure connection sequence:
   * 1. Request short-lived token from CONNECTLY backend (in-memory only).
   * 2. Validate authoritative LiveKit signaling URL.
   * 3. Connect a single Room instance with genuine RoomEvent & media tracking.
   * 4. Publish intended local camera/microphone tracks safely.
   */
  public async connect(options?: { verifyFirst?: boolean }): Promise<void> {
    if (this.isDisposed || this.isTerminal) return;
    if (this.isConnecting || this.snapshot.status === 'connected') return;

    this.isConnecting = true;
    const attemptId = ++this.attemptCounter;

    try {
      await this.cleanupActiveRoom();
      if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter) return;

      if (options?.verifyFirst && this.options.verifyAuthoritativeState) {
        this.updateSnapshot({
          status: 'requesting_token',
          attemptId,
          errorCode: null,
          errorMessage: null,
        });
        const stillAuthorized = await this.options.verifyAuthoritativeState();
        if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter) return;
        if (!stillAuthorized) {
          this.updateSnapshot({
            status: 'unauthorized',
            errorCode: 'LIVEKIT_ACCESS_DENIED',
            errorMessage: getMeetingErrorMessage('LIVEKIT_ACCESS_DENIED'),
          });
          return;
        }
      }

      this.updateSnapshot({
        status: 'requesting_token',
        attemptId,
        errorCode: null,
        errorMessage: null,
      });

      const bundle = await this.options.fetchToken(this.options.meetingCode);
      if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter) {
        return;
      }

      // Strictly require authoritative livekitUrl from CONNECTLY backend
      const targetUrl = (bundle.livekitUrl || '').trim();
      if (!targetUrl || !isAllowedWsUrl(targetUrl)) {
        this.updateSnapshot({
          status: 'failed',
          errorCode: 'LIVEKIT_CONNECTION_FAILED',
          errorMessage: 'Invalid LiveKit signaling URL configured.',
        });
        return;
      }

      if (!bundle.token || typeof bundle.token !== 'string') {
        this.updateSnapshot({
          status: 'failed',
          errorCode: 'LIVEKIT_INVALID_TOKEN',
          errorMessage: getMeetingErrorMessage('LIVEKIT_INVALID_TOKEN'),
        });
        return;
      }

      this.updateSnapshot({
        status: 'connecting',
        roomName: bundle.roomName,
        participantIdentity: bundle.participantIdentity,
        livekitUrl: targetUrl,
        errorCode: null,
        errorMessage: null,
      });

      const room = this.options.createRoom
        ? this.options.createRoom()
        : (new Room({
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: {
              videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
              videoEncoding: VideoPresets.h720.encoding,
            },
            videoCaptureDefaults: {
              resolution: VideoPresets.h720.resolution,
            },
            audioCaptureDefaults: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }) as unknown as LiveKitRoomLike);

      this.activeRoom = room;
      this.attachRoomListeners(room, attemptId);

      // Token exists only in this transient call stack — never persisted to Web Storage
      await room.connect(targetUrl, bundle.token);

      if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter) {
        this.detachListeners(room);
        this.stopLocalRoomTracks(room);
        if (this.activeRoom === room) this.activeRoom = null;
        await room.disconnect(true).catch(() => undefined);
        return;
      }

      this.updateSnapshot({
        status: 'connected',
        roomName: bundle.roomName,
        participantIdentity: bundle.participantIdentity,
        livekitUrl: targetUrl,
        remoteParticipantCount: room.remoteParticipants?.size ?? 0,
        connectedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });

      this.syncMediaFromRoom(room, attemptId);
      await this.applyInitialMediaAfterConnect(room, attemptId);
    } catch (err) {
      console.warn('[LiveKitRoomController] connect error:', (err as Error)?.message || err);
      await this.cleanupActiveRoom();
      if (this.isDisposed || this.isTerminal || attemptId !== this.attemptCounter) return;
      const classified = classifyConnectError(err);
      if (classified.status === 'meeting_ended' || classified.status === 'unauthorized') {
        this.isTerminal = true;
      }
      this.updateSnapshot({
        status: classified.status,
        remoteParticipantCount: 0,
        errorCode: classified.code,
        errorMessage: classified.message,
      });
    } finally {
      if (attemptId === this.attemptCounter) {
        this.isConnecting = false;
      }
    }
  }

  public async reconnect(): Promise<void> {
    if (this.isDisposed || this.isTerminal) return;
    await this.cleanupActiveRoom();
    this.isConnecting = false;
    this.updateSnapshot({ status: 'idle', errorCode: null, errorMessage: null });
    await this.connect({ verifyFirst: true });
  }

  public async disconnect(
    reasonStatus: 'disconnected' | 'meeting_ended' | 'unauthorized' = 'disconnected'
  ): Promise<void> {
    this.attemptCounter += 1;
    this.isConnecting = false;
    if (reasonStatus === 'meeting_ended' || reasonStatus === 'unauthorized') {
      this.isTerminal = true;
    }
    await this.cleanupActiveRoom();
    if (!this.isDisposed) {
      this.updateSnapshot({
        status: reasonStatus,
        remoteParticipantCount: 0,
        errorCode:
          reasonStatus === 'meeting_ended'
            ? 'LIVEKIT_MEETING_ENDED'
            : reasonStatus === 'unauthorized'
              ? 'LIVEKIT_ACCESS_DENIED'
              : null,
        errorMessage:
          reasonStatus === 'meeting_ended'
            ? getMeetingErrorMessage('LIVEKIT_MEETING_ENDED')
            : reasonStatus === 'unauthorized'
              ? getMeetingErrorMessage('LIVEKIT_ACCESS_DENIED')
              : null,
      });
    }
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true;
    this.attemptCounter += 1;
    this.isConnecting = false;
    await this.cleanupActiveRoom();
  }
}
