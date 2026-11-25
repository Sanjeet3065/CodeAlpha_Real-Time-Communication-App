export type MeetingLifecycleStatus = 'CREATED' | 'ACTIVE' | 'ENDED' | 'EXPIRED';

export type ParticipantRole = 'host' | 'co-host' | 'participant';

export type AdmissionStatus =
  | 'WAITING'
  | 'ADMITTED'
  | 'REJECTED'
  | 'LEFT'
  | 'REMOVED'
  | 'CANCELLED';

export type PresenceStatus = 'ONLINE' | 'OFFLINE';

export interface MeetingSettings {
  waitingRoomEnabled: boolean;
  allowCoHostAdmit: boolean;
  allowCoHostRemove: boolean;
  allowCoHostLock: boolean;
}

export interface MeetingSummary {
  id: string;
  meetingCode: string;
  title: string;
  joinUrl: string;
  hostId: string;
  hostName: string;
  status: MeetingLifecycleStatus;
  isLocked: boolean;
  maxParticipants: number;
  activeParticipantCount: number;
  settings: MeetingSettings;
  activatedAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface MeetingParticipantInfo {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  admissionStatus: AdmissionStatus;
  presenceStatus: PresenceStatus;
  requestedAt: string;
  admittedAt: string | null;
  joinedAt: string | null;
}

export interface CreateMeetingPayload {
  title?: string;
  maxParticipants?: number;
  settings?: Partial<MeetingSettings>;
}

export interface MeetingMetadataResponse {
  meeting: MeetingSummary;
  isHost: boolean;
  joinable: boolean;
  joinBlockReason: string | null;
  callerStatus: AdmissionStatus | null;
  callerRole: ParticipantRole | null;
}

export interface JoinMeetingResponse {
  joinResult: 'ADMITTED' | 'ALREADY_ADMITTED' | 'WAITING';
  meeting: MeetingSummary;
  participant: MeetingParticipantInfo;
  participants?: MeetingParticipantInfo[];
  waitingList?: MeetingParticipantInfo[];
}

export interface MeetingStateResponse {
  meeting: MeetingSummary;
  self: MeetingParticipantInfo;
  participants: MeetingParticipantInfo[];
  waitingList?: MeetingParticipantInfo[];
}

export interface LeaveMeetingResponse {
  left: true;
  meetingEnded: boolean;
  newHostId: string | null;
}

export interface UpdateMeetingSettingsPayload {
  title?: string;
  waitingRoomEnabled?: boolean;
  allowCoHostAdmit?: boolean;
  allowCoHostRemove?: boolean;
  allowCoHostLock?: boolean;
}

// ============================================================================
// Phase 09 — WebRTC + LiveKit SFU Integration Types
// ============================================================================

export type LiveKitPublishableSource =
  | 'camera'
  | 'microphone'
  | 'screen_share'
  | 'screen_share_audio';

export interface LiveKitTokenPermissions {
  roomJoin: boolean;
  canPublish: boolean;
  canPublishSources?: LiveKitPublishableSource[];
  canSubscribe: boolean;
  canPublishData: boolean;
}

export interface LiveKitTokenResponse {
  livekitUrl: string;
  token: string;
  roomName: string;
  participantIdentity: string;
  expiresAt: string;
  ttlSeconds: number;
  role: ParticipantRole;
  permissions: LiveKitTokenPermissions;
}

export type LiveKitConnectionStatus =
  | 'idle'
  | 'requesting_token'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'
  | 'unauthorized'
  | 'meeting_ended';

export interface LiveKitConnectionSnapshot {
  status: LiveKitConnectionStatus;
  roomName: string | null;
  participantIdentity: string | null;
  livekitUrl: string | null;
  remoteParticipantCount: number;
  connectedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptId: number;
}

// ============================================================================
// Phase 10 — Multi-User Audio & Video Media / Device Types
// ============================================================================

export type MediaPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'videoinput' | 'audiooutput';
}

export interface DeviceInventorySnapshot {
  audioInputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  selectedAudioInputId: string;
  selectedVideoInputId: string;
  selectedAudioOutputId: string;
  canSelectAudioOutput: boolean;
  isEnumerating: boolean;
  error: string | null;
}

export interface PreJoinMediaChoice {
  micEnabled: boolean;
  cameraEnabled: boolean;
  audioInputDeviceId?: string;
  videoInputDeviceId?: string;
  audioOutputDeviceId?: string;
}

export interface AttachableMediaTrack {
  sid?: string;
  kind?: string;
  source?: string;
  isMuted?: boolean;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[];
  stop?: () => void;
}

export interface ParticipantMediaState {
  identity: string;
  userId: string | null;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  hasAudioTrack: boolean;
  hasVideoTrack: boolean;
  videoTrack: AttachableMediaTrack | null;
  audioTrack: AttachableMediaTrack | null;
  screenShareTrack: AttachableMediaTrack | null;
  screenShareAudioTrack: AttachableMediaTrack | null;
}

export interface ScreenShareStreamInfo {
  participantIdentity: string;
  userId: string | null;
  displayName: string;
  isLocal: boolean;
  videoTrack: AttachableMediaTrack | null;
  audioTrack: AttachableMediaTrack | null;
}

export interface LiveKitMediaSnapshot {
  localMicEnabled: boolean;
  localCameraEnabled: boolean;
  localScreenShareEnabled: boolean;
  localMicPublished: boolean;
  localCameraPublished: boolean;
  localScreenSharePublished: boolean;
  isTogglingMic: boolean;
  isTogglingCamera: boolean;
  isTogglingScreenShare: boolean;
  isSwitchingDevice: boolean;
  micPermission: MediaPermissionState;
  cameraPermission: MediaPermissionState;
  screenSharePermission: MediaPermissionState;
  audioPlaybackBlocked: boolean;
  activeSpeakerIdentities: string[];
  mediaError: string | null;
  mediaNotice: string | null;
  screenShareError: string | null;
  participants: ParticipantMediaState[];
  screenShares: ScreenShareStreamInfo[];
}
