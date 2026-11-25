import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  ArrowLeft,
  ArrowRight,
  Copy,
  Check,
  Shield,
  Lock,
  Users,
  Clock,
  AlertCircle,
  RefreshCw,
  XCircle,
  Link as LinkIcon,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { usePreJoinMediaPreview } from '@/hooks/usePreJoinMediaPreview';
import { validateMeetingCode } from '@/lib/meetingCode';
import { meetingApi, getMeetingErrorMessage } from '@/services/meetingApi';
import { createMeetingSocket, subscribeToMeeting } from '@/services/meetingSocket';
import { createRealtimeEventGuard } from '@/utils/realtimeIdempotency';
import { ApiError } from '@/services/authApi';
import type { MeetingMetadataResponse } from '@/types/meeting';
import type { Socket } from 'socket.io-client';

function getInitials(firstName?: string, lastName?: string, fallback?: string): string {
  const full = `${firstName || ''} ${lastName || ''}`.trim() || fallback || 'U';
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const PreJoinLobbyPage: React.FC = () => {
  const { meetingCode: rawParam } = useParams<{ meetingCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [metadata, setMetadata] = useState<MeetingMetadataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [waitingState, setWaitingState] = useState<'none' | 'waiting' | 'rejected' | 'ended'>('none');
  const [waitingNotice, setWaitingNotice] = useState<string | null>(null);
  const [isCancellingWait, setIsCancellingWait] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const preview = usePreJoinMediaPreview();
  const previewChoiceRef = useRef(preview.getMediaChoice);
  const previewInitializingRef = useRef(preview.isInitializing);
  const releasePreviewRef = useRef(preview.releaseAllPreviewTracks);

  useEffect(() => {
    previewChoiceRef.current = preview.getMediaChoice;
    previewInitializingRef.current = preview.isInitializing;
    releasePreviewRef.current = preview.releaseAllPreviewTracks;
  }, [preview.getMediaChoice, preview.isInitializing, preview.releaseAllPreviewTracks]);

  // Attach/detach real local preview track (never published to LiveKit room in PreJoin)
  useEffect(() => {
    const el = previewVideoRef.current;
    const track = preview.videoTrack;
    if (!el || !track || !preview.cameraEnabled) {
      return;
    }

    track.attach(el);
    return () => {
      try {
        track.detach(el);
      } catch {
        // ignore detach error on cleanup
      }
      el.srcObject = null;
    };
  }, [preview.videoTrack, preview.cameraEnabled]);

  const validation = validateMeetingCode(rawParam);
  const normalizedCode = validation.isValid ? validation.normalizedCode : '';

  const enterMeetingRoom = useCallback(
    (code: string) => {
      const choice = previewChoiceRef.current();
      releasePreviewRef.current();
      navigate(`/meeting/${code}`, {
        replace: true,
        state: { preJoinMedia: choice },
      });
    },
    [navigate]
  );

  const loadMetadata = useCallback(async () => {
    if (!validation.isValid || !normalizedCode) {
      setLoadError(validation.error || 'Invalid meeting code.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const data = await meetingApi.getMeetingMetadata(normalizedCode);
      setMetadata(data);

      if (data.callerStatus === 'WAITING') {
        setWaitingState('waiting');
      } else if (data.meeting.status === 'ENDED') {
        setWaitingState('ended');
      } else {
        setWaitingState('none');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setLoadError(getMeetingErrorMessage(err.code, err.message));
      } else {
        setLoadError('Unable to reach the meeting service. Please retry.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [normalizedCode, validation.isValid, validation.error]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  // Real-time Socket.IO subscription + fallback polling while user is in WAITING state
  useEffect(() => {
    if (waitingState !== 'waiting' || !normalizedCode) {
      return;
    }

    let isMounted = true;
    const socket = createMeetingSocket();
    socketRef.current = socket;

    const handleConnect = async () => {
      await subscribeToMeeting(socket, normalizedCode);
    };

    socket.on('connect', () => {
      void handleConnect();
    });

    const eventGuard = createRealtimeEventGuard(200);

    socket.on('meeting:admission-approved', (payload?: { eventId?: string }) => {
      if (!isMounted || !eventGuard.shouldProcess(payload?.eventId)) return;
      enterMeetingRoom(normalizedCode);
    });

    socket.on('meeting:admission-rejected', (payload: { reason?: string }) => {
      if (!isMounted) return;
      eventGuard.markTerminal();
      releasePreviewRef.current();
      setWaitingState('rejected');
      setWaitingNotice(
        payload?.reason || 'Your request to join this meeting was declined by the host.'
      );
    });

    socket.on('meeting:ended', (payload: { reason?: string }) => {
      if (!isMounted) return;
      eventGuard.markTerminal();
      releasePreviewRef.current();
      setWaitingState('ended');
      setWaitingNotice(payload?.reason || 'The host ended this meeting.');
    });

    // Resilient fallback poll every 5s in case WebSocket upgrade is interrupted
    const pollInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const state = await meetingApi.getMeetingState(normalizedCode);
        if (!isMounted) return;
        if (state.meeting.status === 'ENDED' || state.meeting.status === 'EXPIRED') {
          releasePreviewRef.current();
          setWaitingState('ended');
          setWaitingNotice('This meeting has ended.');
        } else if (state.self.admissionStatus === 'ADMITTED') {
          enterMeetingRoom(normalizedCode);
        } else if (state.self.admissionStatus === 'REJECTED') {
          releasePreviewRef.current();
          setWaitingState('rejected');
          setWaitingNotice('Your request to join this meeting was declined by the host.');
        }
      } catch {
        // Transient network hiccup; keep polling cleanly
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [waitingState, normalizedCode, enterMeetingRoom]);

  const handleJoin = async () => {
    if (!normalizedCode) return;
    setIsJoining(true);
    setJoinError(null);

    try {
      const displayName = user
        ? `${user.firstName} ${user.lastName}`.trim()
        : undefined;
      const result = await meetingApi.joinMeeting(normalizedCode, {
        ...(displayName ? { displayName } : {}),
      });

      if (result.joinResult === 'ADMITTED' || result.joinResult === 'ALREADY_ADMITTED') {
        enterMeetingRoom(result.meeting.meetingCode);
      } else if (result.joinResult === 'WAITING') {
        setWaitingState('waiting');
        setWaitingNotice(null);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setJoinError(getMeetingErrorMessage(err.code, err.message));
      } else {
        setJoinError('Network error while joining meeting. Please try again.');
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleCancelWaiting = async () => {
    releasePreviewRef.current();
    if (!normalizedCode) {
      navigate('/dashboard');
      return;
    }
    setIsCancellingWait(true);
    try {
      await meetingApi.leaveMeeting(normalizedCode);
    } catch {
      // Even if server already ended the meeting, navigate safely back
    } finally {
      setIsCancellingWait(false);
      navigate('/dashboard');
    }
  };

  const copyValue = async (val: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(kind);
      setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 2500);
    } catch {
      setCopied(null);
    }
  };

  const invitationLink =
    typeof window !== 'undefined' && metadata
      ? `${window.location.origin}/join/${metadata.meeting.meetingCode}`
      : metadata?.meeting.joinUrl || '';

  const userDisplayName = user
    ? `${user.firstName} ${user.lastName}`.trim()
    : 'Authenticated User';

  const hasPermissionDenied =
    preview.cameraPermission === 'denied' || preview.micPermission === 'denied';
  const combinedMediaError = preview.cameraError || preview.micError;

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#172B3A] flex flex-col">
      {/* Top Brand Header */}
      <header className="bg-white border-b border-[#E3E1D9] px-4 sm:px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link
            to="/dashboard"
            onClick={() => preview.releaseAllPreviewTracks()}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-8 h-8 rounded-lg bg-[#168B83] text-white flex items-center justify-center">
              <Video className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <span className="font-display font-bold text-sm tracking-tight text-[#172B3A] block leading-none">
                CONNECTLY
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-[#168B83] uppercase">
                Pre-Join Lobby
              </span>
            </div>
          </Link>

          <Link
            to="/dashboard"
            onClick={() => preview.releaseAllPreviewTracks()}
            className="text-xs font-semibold text-[#3D5265] hover:text-[#168B83] inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          {isLoading ? (
            <div className="bg-white border border-[#E3E1D9] rounded-2xl p-10 text-center space-y-3 shadow-xs">
              <div className="w-8 h-8 border-2 border-[#168B83] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-semibold text-[#172B3A]">Loading meeting room details...</p>
              <p className="text-xs text-[#6B8092]">Verifying room availability and admission rules.</p>
            </div>
          ) : loadError || !metadata ? (
            <div className="bg-white border border-[#E3E1D9] rounded-2xl p-8 max-w-lg mx-auto text-center space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-lg font-bold text-[#172B3A]">
                  Cannot Join Meeting
                </h1>
                <p className="text-sm text-[#6B8092] leading-relaxed">
                  {loadError || 'This meeting could not be loaded.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => void loadMetadata()}>
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </span>
                </Button>
                <Link to="/dashboard">
                  <Button variant="primary" size="sm">
                    Return to Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          ) : waitingState === 'waiting' ? (
            <div className="bg-white border border-[#E3E1D9] rounded-2xl p-6 sm:p-8 max-w-lg mx-auto text-center space-y-5 shadow-xs">
              <div className="w-14 h-14 rounded-2xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center mx-auto">
                <Clock className="w-7 h-7" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                  Waiting Room — Admission Pending
                </span>
                <h1 className="font-display text-xl font-bold text-[#172B3A]">
                  {metadata.meeting.title}
                </h1>
                <p className="text-xs sm:text-sm text-[#6B8092] leading-relaxed">
                  You are in the waiting room as{' '}
                  <strong className="text-[#172B3A]">{userDisplayName}</strong>. Please wait while{' '}
                  <strong className="text-[#172B3A]">{metadata.meeting.hostName}</strong> reviews
                  your admission request. Your media is not shared until you are admitted.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#F7F6F2] border border-[#E3E1D9] flex items-center justify-center gap-2 font-mono text-xs text-[#3D5265]">
                <span>Room Code:</span>
                <strong className="text-[#172B3A]">{metadata.meeting.meetingCode}</strong>
              </div>

              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isCancellingWait}
                  onClick={handleCancelWaiting}
                >
                  {isCancellingWait ? 'Cancelling...' : 'Cancel Request & Leave'}
                </Button>
              </div>
            </div>
          ) : waitingState === 'rejected' || waitingState === 'ended' ? (
            <div className="bg-white border border-[#E3E1D9] rounded-2xl p-6 sm:p-8 max-w-lg mx-auto text-center space-y-4 shadow-xs">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-[#D94F4F] flex items-center justify-center mx-auto">
                <XCircle className="w-7 h-7" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-xl font-bold text-[#172B3A]">
                  {waitingState === 'rejected' ? 'Admission Declined' : 'Meeting Has Ended'}
                </h1>
                <p className="text-sm text-[#6B8092] leading-relaxed">
                  {waitingNotice ||
                    (waitingState === 'rejected'
                      ? 'The host declined your request to join this meeting.'
                      : 'This meeting has ended and is no longer accepting participants.')}
                </p>
              </div>
              <div className="pt-2">
                <Link to="/dashboard">
                  <Button variant="primary" size="sm">
                    Return to Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left Card: Real Local Pre-Join Camera & Microphone Preview (Unpublished) */}
              <div className="lg:col-span-7 bg-[#101820] text-white rounded-2xl border border-[#253746] p-5 sm:p-6 flex flex-col justify-between gap-4 shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#253746] text-[#7CE5DB]">
                    <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                    Local Preview Only
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {metadata.meeting.meetingCode}
                  </span>
                </div>

                {/* Live Camera Preview Stage OR Honest Avatar Fallback */}
                <div
                  data-prejoin-preview="true"
                  data-camera-active={preview.cameraEnabled && Boolean(preview.videoTrack) ? 'true' : 'false'}
                  data-mic-active={preview.micEnabled ? 'true' : 'false'}
                  className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#182530] border border-white/10 flex items-center justify-center"
                >
                  {preview.cameraEnabled && preview.videoTrack ? (
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover -scale-x-100 bg-[#101820]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center px-4 space-y-2.5">
                      <div className="w-20 h-20 rounded-full bg-[#168B83]/25 border-2 border-[#168B83] text-[#7CE5DB] font-display text-2xl font-bold flex items-center justify-center">
                        {getInitials(user?.firstName, user?.lastName, user?.email)}
                      </div>
                      <div>
                        <p className="font-display text-base font-bold text-white">
                          {userDisplayName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {preview.isInitializing
                            ? 'Checking camera & microphone...'
                            : preview.cameraPermission === 'denied'
                              ? 'Camera permission blocked'
                              : preview.cameraPermission === 'unavailable'
                                ? 'No camera available'
                                : 'Camera is off'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Bottom Preview Overlay Controls */}
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-[#101820]/80 border border-white/10 text-xs font-semibold text-white truncate">
                      {userDisplayName} {metadata.isHost ? '(Host)' : ''}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-prejoin-control="toggle-mic"
                        aria-pressed={preview.micEnabled}
                        aria-label={preview.micEnabled ? 'Mute microphone' : 'Enable microphone'}
                        disabled={preview.isBusyMic}
                        onClick={() => void preview.toggleMic()}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50 ${
                          preview.micEnabled
                            ? 'bg-[#101820]/85 border-white/20 text-white hover:bg-[#253746]'
                            : 'bg-[#D94F4F]/90 border-rose-300/40 text-white hover:bg-[#C13E3E]'
                        }`}
                      >
                        {preview.isBusyMic ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : preview.micEnabled ? (
                          <Mic className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
                        ) : (
                          <MicOff className="w-4 h-4" aria-hidden="true" />
                        )}
                        <span>{preview.micEnabled ? 'Mic On' : 'Mic Muted'}</span>
                      </button>

                      <button
                        type="button"
                        data-prejoin-control="toggle-camera"
                        aria-pressed={preview.cameraEnabled}
                        aria-label={preview.cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                        disabled={preview.isBusyCamera}
                        onClick={() => void preview.toggleCamera()}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50 ${
                          preview.cameraEnabled
                            ? 'bg-[#101820]/85 border-white/20 text-white hover:bg-[#253746]'
                            : 'bg-[#D94F4F]/90 border-rose-300/40 text-white hover:bg-[#C13E3E]'
                        }`}
                      >
                        {preview.isBusyCamera ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : preview.cameraEnabled ? (
                          <Video className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
                        ) : (
                          <VideoOff className="w-4 h-4" aria-hidden="true" />
                        )}
                        <span>{preview.cameraEnabled ? 'Cam On' : 'Cam Off'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Permission Denied / Device Error Banner with Retry */}
                {combinedMediaError && (
                  <div
                    role="alert"
                    data-prejoin-media-error="true"
                    className="p-3 rounded-xl bg-[#D94F4F]/20 border border-[#D94F4F]/45 text-xs text-rose-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-[#F7A3A3] flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{combinedMediaError}</span>
                    </div>
                    {hasPermissionDenied && (
                      <button
                        type="button"
                        data-prejoin-control="retry-permissions"
                        onClick={() => void preview.retryPermissions()}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-[#168B83]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry Permission</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Device Selectors (Microphone & Camera) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="prejoin-mic-select"
                      className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5"
                    >
                      <Mic className="w-3 h-3 text-[#7CE5DB]" aria-hidden="true" />
                      <span>Microphone</span>
                    </label>
                    <select
                      id="prejoin-mic-select"
                      value={preview.devices.selectedAudioInputId}
                      disabled={preview.devices.audioInputs.length === 0}
                      onChange={(e) => void preview.selectMicDevice(e.target.value)}
                      className="w-full rounded-xl bg-[#253746] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50"
                    >
                      {preview.devices.audioInputs.length === 0 ? (
                        <option value="">No microphone found</option>
                      ) : (
                        preview.devices.audioInputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="prejoin-camera-select"
                      className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5"
                    >
                      <Video className="w-3 h-3 text-[#7CE5DB]" aria-hidden="true" />
                      <span>Camera</span>
                    </label>
                    <select
                      id="prejoin-camera-select"
                      value={preview.devices.selectedVideoInputId}
                      disabled={preview.devices.videoInputs.length === 0}
                      onChange={(e) => void preview.selectCameraDevice(e.target.value)}
                      className="w-full rounded-xl bg-[#253746] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50"
                    >
                      {preview.devices.videoInputs.length === 0 ? (
                        <option value="">No camera found</option>
                      ) : (
                        preview.devices.videoInputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </div>

              {/* Right Card: Meeting Details & Join Controls */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E3E1D9] p-6 flex flex-col justify-between gap-5 shadow-xs">
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#168B83]">
                      Ready to Join
                    </p>
                    <h1 className="font-display text-xl font-bold text-[#172B3A] mt-1 break-words">
                      {metadata.meeting.title}
                    </h1>
                    <p className="text-xs text-[#6B8092] mt-1">
                      Hosted by{' '}
                      <span className="font-semibold text-[#172B3A]">
                        {metadata.meeting.hostName}
                      </span>
                    </p>
                  </div>

                  {/* Metadata Chips */}
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F7F6F2] border border-[#E3E1D9] text-xs font-medium text-[#172B3A]">
                      <Users className="w-3.5 h-3.5 text-[#168B83]" />
                      {metadata.meeting.activeParticipantCount} / {metadata.meeting.maxParticipants}{' '}
                      active
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F7F6F2] border border-[#E3E1D9] text-xs font-medium text-[#172B3A]">
                      Status: <strong className="font-mono">{metadata.meeting.status}</strong>
                    </span>
                    {metadata.meeting.isLocked && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                        <Lock className="w-3.5 h-3.5" />
                        Locked
                      </span>
                    )}
                  </div>

                  {/* Copy Code & Invitation Link */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyValue(metadata.meeting.meetingCode, 'code')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#F7F6F2] hover:bg-[#DCEDE8]/60 border border-[#E3E1D9] text-xs font-semibold text-[#172B3A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
                    >
                      {copied === 'code' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Code Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#168B83]" />
                          <span className="font-mono">{metadata.meeting.meetingCode}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyValue(invitationLink, 'link')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#F7F6F2] hover:bg-[#DCEDE8]/60 border border-[#E3E1D9] text-xs font-semibold text-[#172B3A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
                    >
                      {copied === 'link' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Link Copied</span>
                        </>
                      ) : (
                        <>
                          <LinkIcon className="w-3.5 h-3.5 text-[#168B83]" />
                          <span>Copy Invite Link</span>
                        </>
                      )}
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {copied === 'code'
                        ? 'Meeting code copied to clipboard.'
                        : copied === 'link'
                          ? 'Invitation link copied to clipboard.'
                          : ''}
                    </span>
                  </div>

                  {/* Room Governance Summary */}
                  <div className="p-3.5 rounded-xl bg-[#F7F6F2] border border-[#E3E1D9] space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#6B8092]">Entry Policy</span>
                      <span className="font-semibold text-[#172B3A]">
                        {metadata.meeting.settings.waitingRoomEnabled
                          ? 'Waiting Room Enabled'
                          : 'Direct Entry'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E3E1D9]/80">
                      <span className="text-[#6B8092]">Room Access</span>
                      <span className="font-semibold text-[#172B3A]">
                        {metadata.meeting.isLocked ? 'Locked by Host' : 'Open to Invited Users'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E3E1D9]/80">
                      <span className="text-[#6B8092]">Your Room Role</span>
                      <span className="font-semibold text-[#168B83]">
                        {metadata.isHost ? 'Host (Full Controls)' : 'Participant'}
                      </span>
                    </div>
                  </div>

                  {/* Waiting Room Explanation or Block Notice */}
                  {!metadata.joinable ? (
                    <div
                      role="alert"
                      className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2"
                    >
                      <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
                      <p className="leading-relaxed">
                        {getMeetingErrorMessage(metadata.joinBlockReason || undefined)}
                      </p>
                    </div>
                  ) : metadata.meeting.settings.waitingRoomEnabled && !metadata.isHost ? (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                      <Clock className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                      <p className="leading-relaxed">
                        <strong>Waiting Room Enabled:</strong> You will enter the waiting room and
                        must be admitted by the host or an authorized co-host before joining.
                      </p>
                    </div>
                  ) : null}

                  {joinError && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{joinError}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-2.5 pt-3 border-t border-[#E3E1D9]">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    disabled={!metadata.joinable || isJoining}
                    onClick={handleJoin}
                    className="w-full justify-center"
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    {isJoining
                      ? 'Connecting...'
                      : metadata.meeting.settings.waitingRoomEnabled && !metadata.isHost
                        ? 'Request to Join Meeting'
                        : 'Join Meeting Now'}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      preview.releaseAllPreviewTracks();
                      navigate('/dashboard');
                    }}
                    className="w-full justify-center"
                  >
                    Cancel & Return to Dashboard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default PreJoinLobbyPage;
