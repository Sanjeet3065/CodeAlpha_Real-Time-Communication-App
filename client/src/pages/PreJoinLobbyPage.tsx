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
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/ui/BrandMark';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { usePreJoinMediaPreview } from '@/hooks/usePreJoinMediaPreview';
import { validateMeetingCode } from '@/lib/meetingCode';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
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

  const invitationLink = metadata
    ? buildMeetingJoinUrl(metadata.meeting.meetingCode, metadata.meeting.joinUrl)
    : '';

  const userDisplayName = user
    ? `${user.firstName} ${user.lastName}`.trim() || user.email || 'You'
    : 'Guest';

  const hasPermissionDenied =
    preview.cameraPermission === 'denied' || preview.micPermission === 'denied';
  const combinedMediaError = preview.cameraError || preview.micError;

  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] flex flex-col">
      {/* Top Brand Header */}
      <header className="bg-[#FAF9F6] dark:bg-[#1C1F24] border-b border-[#DDDAD0] dark:border-[#2B3038] px-4 sm:px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link
            to="/dashboard"
            onClick={() => preview.releaseAllPreviewTracks()}
            className="flex items-center gap-2.5 group rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
          >
            <BrandMark />
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-base tracking-tight text-[#1F2428] dark:text-[#EAECEE] leading-none">
                CONNECTLY
              </span>
              <span className="text-[10px] font-medium text-[#646D77] dark:text-[#8E96A0] mt-0.5 leading-none">
                Green Room
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle variant="compact" />
            <Link
              to="/dashboard"
              onClick={() => preview.releaseAllPreviewTracks()}
              className="text-xs font-semibold text-[#555D66] dark:text-[#A3AAB2] hover:text-[#2F6F68] dark:hover:text-[#5FA399] inline-flex items-center gap-1.5 transition-colors"
            >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          {isLoading ? (
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-10 text-center space-y-3 shadow-cly-sm">
              <div className="w-8 h-8 border-2 border-[#2F6F68] dark:border-[#5FA399] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-semibold text-[#1F2428] dark:text-[#EAECEE]">Loading meeting room details...</p>
              <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">Verifying room availability and admission rules.</p>
            </div>
          ) : loadError || !metadata ? (
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-8 max-w-lg mx-auto text-center space-y-4 shadow-cly-sm">
              <div className="w-12 h-12 rounded-2xl bg-[#F6E6E6] dark:bg-[#342023] text-[#C24D4D] dark:text-[#D46A6A] flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-lg font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  Cannot Join Meeting
                </h1>
                <p className="text-sm text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
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
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-6 sm:p-8 max-w-lg mx-auto text-center space-y-5 shadow-cly-sm">
              <div className="w-14 h-14 rounded-2xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mx-auto">
                <Clock className="w-7 h-7" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FAF3E4] dark:bg-[#262118] text-[#92600A] dark:text-[#D4A850]">
                  Waiting Room — Admission Pending
                </span>
                <h1 className="font-display text-xl font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  {metadata.meeting.title}
                </h1>
                <p className="text-xs sm:text-sm text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
                  You are in the waiting room as{' '}
                  <strong className="text-[#1F2428] dark:text-[#EAECEE]">{userDisplayName}</strong>. Please wait while{' '}
                  <strong className="text-[#1F2428] dark:text-[#EAECEE]">{metadata.meeting.hostName}</strong> reviews
                  your admission request. Your media is not shared until you are admitted.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] flex items-center justify-center gap-2 font-mono text-xs text-[#555D66] dark:text-[#A3AAB2]">
                <span>Room Code:</span>
                <strong className="text-[#1F2428] dark:text-[#EAECEE]">{metadata.meeting.meetingCode}</strong>
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
            <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-6 sm:p-8 max-w-lg mx-auto text-center space-y-4 shadow-cly-sm">
              <div className="w-14 h-14 rounded-2xl bg-[#F6E6E6] dark:bg-[#342023] text-[#C24D4D] dark:text-[#D46A6A] flex items-center justify-center mx-auto">
                <XCircle className="w-7 h-7" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-xl font-bold text-[#1F2428] dark:text-[#EAECEE]">
                  {waitingState === 'rejected' ? 'Admission Declined' : 'Meeting Has Ended'}
                </h1>
                <p className="text-sm text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Card: Real Local Pre-Join Camera & Microphone Preview (Unpublished) */}
              <div className="lg:col-span-7 bg-[#111316] text-white rounded-2xl border border-[#2B3038] p-4 sm:p-5 flex flex-col gap-4 shadow-cly-md">
                {/* Live Camera Preview Stage OR Honest Avatar Fallback */}
                <div
                  data-prejoin-preview="true"
                  data-camera-active={preview.cameraEnabled && Boolean(preview.videoTrack) ? 'true' : 'false'}
                  data-mic-active={preview.micEnabled ? 'true' : 'false'}
                  className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#181B20] border border-white/10 flex items-center justify-center"
                >
                  {preview.cameraEnabled && preview.videoTrack ? (
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover -scale-x-100 bg-[#111316]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center px-4 space-y-2.5">
                      <div className="w-20 h-20 rounded-full bg-[#2F6F68]/25 border-2 border-[#5FA399] text-[#5FA399] font-display text-2xl font-bold flex items-center justify-center">
                        {getInitials(user?.firstName, user?.lastName, user?.email)}
                      </div>
                      <div>
                        <p className="font-display text-base font-bold text-white">
                          {userDisplayName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {preview.isInitializing
                            ? 'Checking devices...'
                            : preview.cameraPermission === 'denied'
                              ? 'Camera permission blocked'
                              : preview.cameraPermission === 'unavailable'
                                ? 'No camera detected'
                                : 'Camera off'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Subtle Bottom Preview Overlay Bar */}
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-[#111316]/80 border border-white/10 text-xs font-medium text-white truncate">
                      {userDisplayName}
                      {metadata.isHost ? ' · Host' : ''}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-prejoin-control="toggle-mic"
                        aria-pressed={preview.micEnabled}
                        aria-label={preview.micEnabled ? 'Mute microphone' : 'Enable microphone'}
                        disabled={preview.isBusyMic}
                        onClick={() => void preview.toggleMic()}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50 ${
                          preview.micEnabled
                            ? 'bg-[#111316]/85 border-white/15 text-white hover:bg-[#1C1F24]'
                            : 'bg-[#C24D4D]/90 border-rose-300/40 text-white hover:bg-[#A63D3D]'
                        }`}
                      >
                        {preview.isBusyMic ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : preview.micEnabled ? (
                          <Mic className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
                        ) : (
                          <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{preview.micEnabled ? 'Mic On' : 'Muted'}</span>
                      </button>

                      <button
                        type="button"
                        data-prejoin-control="toggle-camera"
                        aria-pressed={preview.cameraEnabled}
                        aria-label={preview.cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                        disabled={preview.isBusyCamera}
                        onClick={() => void preview.toggleCamera()}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50 ${
                          preview.cameraEnabled
                            ? 'bg-[#111316]/85 border-white/15 text-white hover:bg-[#1C1F24]'
                            : 'bg-[#C24D4D]/90 border-rose-300/40 text-white hover:bg-[#A63D3D]'
                        }`}
                      >
                        {preview.isBusyCamera ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : preview.cameraEnabled ? (
                          <Video className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
                        ) : (
                          <VideoOff className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{preview.cameraEnabled ? 'Cam On' : 'Cam Off'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Mic Level Meter */}
                {preview.micEnabled && (
                  <div className="flex items-center gap-2.5 px-1">
                    <Mic className="w-3.5 h-3.5 text-[#5FA399] shrink-0" aria-hidden="true" />
                    <div
                      role="progressbar"
                      aria-label="Live microphone input level"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={preview.micLevel}
                      className="flex-1 h-1.5 rounded-full bg-[#1C1F24] overflow-hidden"
                    >
                      <div
                        className="h-full bg-[#5FA399] transition-all duration-75 rounded-full"
                        style={{ width: `${Math.max(4, preview.micLevel)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Permission Denied / Device Error Banner with Retry */}
                {combinedMediaError && (
                  <div
                    role="alert"
                    data-prejoin-media-error="true"
                    className="p-3 rounded-xl bg-[#C24D4D]/20 border border-[#C24D4D]/45 text-xs text-rose-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-[#D46A6A] flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{combinedMediaError}</span>
                    </div>
                    {hasPermissionDenied && (
                      <button
                        type="button"
                        data-prejoin-control="retry-permissions"
                        onClick={() => void preview.retryPermissions()}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Retry Permission</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Device Selectors (Microphone, Camera & Speaker) */}
                <div
                  className={`grid grid-cols-1 gap-3 ${
                    preview.devices.audioOutputs.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                  }`}
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="prejoin-mic-select"
                      className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5"
                    >
                      <Mic className="w-3 h-3 text-[#5FA399]" aria-hidden="true" />
                      <span>Microphone</span>
                    </label>
                    <select
                      id="prejoin-mic-select"
                      value={preview.devices.selectedAudioInputId}
                      disabled={preview.devices.audioInputs.length === 0}
                      onChange={(e) => void preview.selectMicDevice(e.target.value)}
                      className="w-full h-9 rounded-lg bg-[#1C1F24] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
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
                      <Video className="w-3 h-3 text-[#5FA399]" aria-hidden="true" />
                      <span>Camera</span>
                    </label>
                    <select
                      id="prejoin-camera-select"
                      value={preview.devices.selectedVideoInputId}
                      disabled={preview.devices.videoInputs.length === 0}
                      onChange={(e) => void preview.selectCameraDevice(e.target.value)}
                      className="w-full h-9 rounded-lg bg-[#1C1F24] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
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

                  {preview.devices.audioOutputs.length > 0 && (
                    <div className="space-y-1">
                      <label
                        htmlFor="prejoin-speaker-select"
                        className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5"
                      >
                        <Volume2 className="w-3 h-3 text-[#5FA399]" aria-hidden="true" />
                        <span>Speaker</span>
                      </label>
                      <select
                        id="prejoin-speaker-select"
                        value={preview.devices.selectedAudioOutputId}
                        onChange={(e) => void preview.selectSpeakerDevice(e.target.value)}
                        className="w-full h-9 rounded-lg bg-[#1C1F24] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
                      >
                        {preview.devices.audioOutputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Card: Clean Join Card */}
              <div className="lg:col-span-5 bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] p-6 flex flex-col justify-between gap-6 shadow-cly-sm">
                <div className="space-y-4">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-[#1F2428] dark:text-[#EAECEE] break-words">
                      {metadata.meeting.title}
                    </h1>
                    <p className="text-xs text-[#646D77] dark:text-[#A3AAB2] mt-1">
                      Host:{' '}
                      <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">
                        {metadata.meeting.hostName}
                      </span>
                    </p>
                  </div>

                  {/* Concise Room Pills */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-xs font-medium text-[#1F2428] dark:text-[#EAECEE]">
                      <Users className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                      <span>
                        {metadata.meeting.activeParticipantCount}/{metadata.meeting.maxParticipants} in room
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399]">
                      <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {metadata.meeting.settings.waitingRoomEnabled
                          ? 'Waiting Room'
                          : 'Direct Entry'}
                      </span>
                    </span>
                    {metadata.meeting.isLocked && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F6E6E6] dark:bg-[#342023] border border-[#E8B4B4] dark:border-[#5A2C2C] text-xs font-semibold text-[#7A2B2B] dark:text-[#D46A6A]">
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Locked</span>
                      </span>
                    )}
                  </div>

                  {/* Copy Code & Invitation Link */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => copyValue(metadata.meeting.meetingCode, 'code')}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] hover:bg-[#D2E1DC] dark:hover:bg-[#273C39] border border-[#DDDAD0] dark:border-[#2B3038] text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                    >
                      {copied === 'code' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
                          <span>Code Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
                          <span className="font-mono truncate">{metadata.meeting.meetingCode}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyValue(invitationLink, 'link')}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] hover:bg-[#D2E1DC] dark:hover:bg-[#273C39] border border-[#DDDAD0] dark:border-[#2B3038] text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                    >
                      {copied === 'link' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
                          <span>Link Copied</span>
                        </>
                      ) : (
                        <>
                          <LinkIcon className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
                          <span>Copy Invite</span>
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

                  {/* Waiting Room Explanation or Block Notice */}
                  {!metadata.joinable ? (
                    <div
                      role="alert"
                      className="p-3.5 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#E8B4B4] dark:border-[#5A2C2C] text-xs text-[#7A2B2B] dark:text-[#D46A6A] flex items-start gap-2"
                    >
                      <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#C24D4D] dark:text-[#D46A6A]" />
                      <p className="leading-relaxed">
                        {getMeetingErrorMessage(metadata.joinBlockReason || undefined)}
                      </p>
                    </div>
                  ) : metadata.meeting.settings.waitingRoomEnabled && !metadata.isHost ? (
                    <div className="p-3.5 rounded-xl bg-[#FAF3E4] dark:bg-[#262118] border border-[#E8C97A] dark:border-[#4A3A18] text-xs text-[#6B4A0A] dark:text-[#D4A850] flex items-start gap-2">
                      <Clock className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                      <p className="leading-relaxed">
                        Waiting room is active — the host will admit you shortly.
                      </p>
                    </div>
                  ) : null}

                  {joinError && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#E8B4B4] dark:border-[#5A2C2C] text-xs text-[#7A2B2B] dark:text-[#D46A6A] flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{joinError}</span>
                    </div>
                  )}
                </div>

                {/* Primary Join CTA */}
                <div className="pt-3 border-t border-[#DDDAD0] dark:border-[#2B3038]">
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
                        ? 'Request to Join'
                        : 'Join Meeting Now'}
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
