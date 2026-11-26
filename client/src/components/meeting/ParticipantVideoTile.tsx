import React, { useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  VideoOff,
  Crown,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import type { AttachableMediaTrack, ParticipantRole } from '@/types/meeting';

export interface ParticipantVideoTileProps {
  participantKey: string;
  displayName: string;
  avatarUrl?: string | null;
  role: ParticipantRole;
  isLocal: boolean;
  isConnectedToSfu: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isSpeaking: boolean;
  videoTrack: AttachableMediaTrack | null;
  aspectClassName: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const ParticipantVideoTileInner: React.FC<ParticipantVideoTileProps> = ({
  participantKey,
  displayName,
  avatarUrl,
  role,
  isLocal,
  isConnectedToSfu,
  isMicEnabled,
  isCameraEnabled,
  isSpeaking,
  videoTrack,
  aspectClassName,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const showLiveVideo = Boolean(isCameraEnabled && videoTrack);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack || !isCameraEnabled) {
      return;
    }

    videoTrack.attach(el);
    return () => {
      try {
        videoTrack.detach(el);
      } catch {
        // ignore detach error on unmounted element
      }
      el.srcObject = null;
    };
  }, [videoTrack, isCameraEnabled]);

  const roleBadge =
    role === 'host' ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#2F6F68]/90 text-white">
        <Crown className="w-2.5 h-2.5" aria-hidden="true" />
        <span>Host</span>
      </span>
    ) : role === 'co-host' ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-600/85 text-white">
        <ShieldCheck className="w-2.5 h-2.5" aria-hidden="true" />
        <span>Co-Host</span>
      </span>
    ) : null;

  return (
    <article
      data-participant-tile={participantKey}
      data-local-tile={isLocal ? 'true' : 'false'}
      data-speaking={isSpeaking ? 'true' : 'false'}
      data-camera-on={showLiveVideo ? 'true' : 'false'}
      data-mic-on={isMicEnabled ? 'true' : 'false'}
      aria-label={`${displayName}${isLocal ? ' (You)' : ''}, microphone ${isMicEnabled ? 'on' : 'muted'}, camera ${showLiveVideo ? 'on' : 'off'}${isSpeaking ? ', speaking' : ''}`}
      className={`relative overflow-hidden rounded-2xl bg-[#181B20] border-2 transition-[border-color,box-shadow] duration-200 select-none ${aspectClassName} ${
        isSpeaking
          ? 'border-[#5FA399] shadow-[0_0_0_2px_rgba(22,139,131,0.35)]'
          : isLocal
            ? 'border-white/20'
            : 'border-white/10'
      }`}
    >
      {/* Real LiveKit Video Track OR Clean Avatar Fallback (Never Frozen Frame) */}
      {showLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover bg-[#111316] ${isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#181B20] px-3 text-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 transition-colors ${
                isSpeaking ? 'border-[#5FA399]' : 'border-white/15'
              }`}
            />
          ) : (
            <div
              className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#111316]/90 border-2 text-[#5FA399] font-display font-bold text-lg sm:text-xl flex items-center justify-center transition-colors ${
                isSpeaking ? 'border-[#5FA399]' : 'border-[#5FA399]/45'
              }`}
            >
              {getInitials(displayName)}
            </div>
          )}
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#111316]/70 border border-white/10 text-[11px] text-slate-300">
            <VideoOff className="w-3 h-3 text-slate-400" aria-hidden="true" />
            <span>{isConnectedToSfu ? 'Camera off' : 'Joining media...'}</span>
          </div>
        </div>
      )}

      {/* Top Overlay: Active Speaker Indicator + Role */}
      <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 min-w-0">{roleBadge}</div>

        {isSpeaking && (
          <span
            role="status"
            aria-label={`${displayName} is speaking`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2F6F68] text-white text-[10px] font-semibold shadow-xs"
          >
            <Volume2 className="w-3 h-3" aria-hidden="true" />
            <span>Speaking</span>
          </span>
        )}
      </div>

      {/* Bottom Overlay: Nameplate + Accessible Non-Color-Only Mic/Camera State */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-[#111316]/90 via-[#111316]/55 to-transparent px-3 pt-6 pb-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5">
          <span className="font-display text-xs sm:text-sm font-semibold text-white truncate drop-shadow-xs">
            {displayName}
          </span>
          {isLocal && (
            <span className="px-1.5 py-0.5 rounded bg-white/15 text-[10px] font-semibold text-[#5FA399] flex-shrink-0">
              You
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!showLiveVideo && (
            <span
              title="Camera off"
              aria-label="Camera off"
              className="w-6 h-6 rounded-full bg-[#111316]/80 border border-white/15 text-slate-300 inline-flex items-center justify-center"
            >
              <VideoOff className="w-3 h-3" aria-hidden="true" />
            </span>
          )}
          <span
            title={isMicEnabled ? 'Microphone active' : 'Microphone muted'}
            aria-label={isMicEnabled ? 'Microphone active' : 'Microphone muted'}
            className={`w-6 h-6 rounded-full border inline-flex items-center justify-center ${
              isMicEnabled
                ? 'bg-[#2F6F68]/90 border-[#5FA399]/40 text-white'
                : 'bg-[#C24D4D]/90 border-rose-300/35 text-white'
            }`}
          >
            {isMicEnabled ? (
              <Mic className="w-3 h-3" aria-hidden="true" />
            ) : (
              <MicOff className="w-3 h-3" aria-hidden="true" />
            )}
          </span>
        </div>
      </div>
    </article>
  );
};

export const ParticipantVideoTile = React.memo(ParticipantVideoTileInner);
