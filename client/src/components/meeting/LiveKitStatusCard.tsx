import React from 'react';
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  Shield,
  AlertTriangle,
  XCircle,
  Radio,
  Volume2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type {
  LiveKitConnectionSnapshot,
  LiveKitMediaSnapshot,
  ParticipantRole,
} from '@/types/meeting';

interface LiveKitStatusCardProps {
  livekit: LiveKitConnectionSnapshot;
  media: LiveKitMediaSnapshot;
  currentRole: ParticipantRole;
  onReconnect: () => void;
  onEnableAudio: () => void;
  onDismissMediaError: () => void;
}

function getStatusMeta(status: LiveKitConnectionSnapshot['status']) {
  switch (status) {
    case 'idle':
    case 'requesting_token':
      return {
        label: 'Preparing secure connection',
        badgeClass: 'bg-[#168B83]/20 text-[#7CE5DB] border-[#168B83]/35',
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />,
        description:
          'Verifying CONNECTLY admission and requesting a short-lived LiveKit room access token.',
      };
    case 'connecting':
      return {
        label: 'Connecting to meeting',
        badgeClass: 'bg-sky-500/20 text-sky-200 border-sky-400/35',
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />,
        description: 'Establishing authenticated WebRTC signaling and LiveKit SFU media session.',
      };
    case 'connected':
      return {
        label: 'Connected to LiveKit',
        badgeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/35',
        icon: <Wifi className="w-3.5 h-3.5" aria-hidden="true" />,
        description: 'LiveKit SFU signaling and multi-user audio/video transport are active.',
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/35',
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />,
        description:
          'LiveKit connection was interrupted. Waiting for automatic WebRTC reconnection.',
      };
    case 'disconnected':
      return {
        label: 'Connection interrupted',
        badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/35',
        icon: <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />,
        description:
          'LiveKit media transport is disconnected while your CONNECTLY room session remains open.',
      };
    case 'failed':
      return {
        label: 'Connection failed',
        badgeClass: 'bg-[#D94F4F]/20 text-[#F7A3A3] border-[#D94F4F]/35',
        icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
        description:
          'Could not establish a LiveKit SFU connection. CONNECTLY room governance remains active.',
      };
    case 'unauthorized':
      return {
        label: 'Access denied',
        badgeClass: 'bg-[#D94F4F]/20 text-[#F7A3A3] border-[#D94F4F]/35',
        icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />,
        description: 'LiveKit access is not permitted for your current room status.',
      };
    case 'meeting_ended':
      return {
        label: 'Meeting ended',
        badgeClass: 'bg-[#D94F4F]/20 text-[#F7A3A3] border-[#D94F4F]/35',
        icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />,
        description: 'This meeting has ended and LiveKit transport has been closed.',
      };
  }
}

export const LiveKitStatusCard: React.FC<LiveKitStatusCardProps> = ({
  livekit,
  media,
  currentRole,
  onReconnect,
  onEnableAudio,
  onDismissMediaError,
}) => {
  const meta = getStatusMeta(livekit.status);
  const canRetry = livekit.status === 'disconnected' || livekit.status === 'failed';
  const roleLabel =
    currentRole === 'host' ? 'Host' : currentRole === 'co-host' ? 'Co-Host' : 'Participant';

  return (
    <section
      aria-label="LiveKit WebRTC transport and media status"
      data-livekit-status={livekit.status}
      className="p-3.5 sm:p-4 rounded-2xl bg-[#253746]/80 border border-white/10 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <div className="w-8 h-8 rounded-xl bg-[#168B83]/25 text-[#7CE5DB] flex items-center justify-center flex-shrink-0">
            <Radio className="w-4 h-4" aria-hidden="true" />
          </div>
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${meta.badgeClass}`}
          >
            {meta.icon}
            <span>{meta.label}</span>
          </span>

          {/* Honest Media Readiness Indicators (Distinct from Signaling State) */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              media.localMicEnabled && media.localMicPublished
                ? 'bg-[#168B83]/20 text-[#9BF3EA] border-[#168B83]/35'
                : 'bg-[#101820]/60 text-slate-300 border-white/10'
            }`}
          >
            {media.localMicEnabled && media.localMicPublished ? (
              <Mic className="w-3 h-3" aria-hidden="true" />
            ) : (
              <MicOff className="w-3 h-3 text-slate-400" aria-hidden="true" />
            )}
            <span>
              {media.localMicEnabled && media.localMicPublished
                ? 'Mic Live'
                : media.micPermission === 'denied'
                  ? 'Mic Blocked'
                  : 'Mic Muted'}
            </span>
          </span>

          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              media.localCameraEnabled && media.localCameraPublished
                ? 'bg-[#168B83]/20 text-[#9BF3EA] border-[#168B83]/35'
                : 'bg-[#101820]/60 text-slate-300 border-white/10'
            }`}
          >
            {media.localCameraEnabled && media.localCameraPublished ? (
              <Video className="w-3 h-3" aria-hidden="true" />
            ) : (
              <VideoOff className="w-3 h-3 text-slate-400" aria-hidden="true" />
            )}
            <span>
              {media.localCameraEnabled && media.localCameraPublished
                ? 'Camera On'
                : media.cameraPermission === 'denied'
                  ? 'Camera Blocked'
                  : 'Camera Off'}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#101820]/70 border border-white/10 text-[11px] font-semibold text-[#7CE5DB]">
            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{roleLabel}</span>
          </span>

          {livekit.status === 'connected' && (
            <span className="font-mono text-[11px] text-slate-300 px-2 py-1 rounded-lg bg-[#101820]/60 border border-white/10">
              {livekit.remoteParticipantCount + 1} SFU peer(s)
            </span>
          )}

          {canRetry && (
            <button
              type="button"
              onClick={onReconnect}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] rounded-lg bg-[#168B83] hover:bg-[#11706A] text-xs font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* Signaling Error Message */}
      {livekit.errorMessage && livekit.status !== 'connected' && (
        <p className="text-xs text-amber-200 leading-relaxed">{livekit.errorMessage}</p>
      )}

      {/* Browser Autoplay Restriction Action Banner */}
      {media.audioPlaybackBlocked && livekit.status === 'connected' && (
        <div
          role="alert"
          data-autoplay-blocked="true"
          className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start sm:items-center gap-2 text-xs text-amber-100">
            <Volume2 className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              Your browser paused meeting audio playback. Click <strong>Enable Audio</strong> to hear
              other participants.
            </span>
          </div>
          <button
            type="button"
            data-control="enable-audio"
            onClick={onEnableAudio}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg bg-amber-500 hover:bg-amber-400 text-[#101820] text-xs font-bold transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Enable Audio</span>
          </button>
        </div>
      )}

      {/* Honest Media / Permission Error Alert */}
      {media.mediaError && (
        <div
          role="alert"
          data-media-error="true"
          className="p-3 rounded-xl bg-[#D94F4F]/20 border border-[#D94F4F]/40 text-xs text-rose-100 flex items-start justify-between gap-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F7A3A3] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{media.mediaError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissMediaError}
            aria-label="Dismiss media error"
            className="text-rose-200 hover:text-white flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
