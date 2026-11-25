import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, Maximize2, Minimize2, StopCircle } from 'lucide-react';
import type { ScreenShareStreamInfo } from '@/types/meeting';

interface ScreenShareViewProps {
  screenShare: ScreenShareStreamInfo;
  onStopSharing?: () => void;
  className?: string;
}

/**
 * Prominent presentation stage for an active screen-share stream.
 *
 * Guarantees:
 * - Attaches and detaches LiveKit video and optional audio tracks cleanly without leaks.
 * - Shows clear ownership banner: "[Name]'s screen" or "You are sharing your screen".
 * - For local sharer, provides an accessible one-click "Stop Sharing" button.
 * - Supports browser fullscreen toggle for viewer convenience.
 * - Renders with `object-contain` to preserve source aspect ratio and readability of text/code.
 */
export const ScreenShareView: React.FC<ScreenShareViewProps> = ({
  screenShare,
  onStopSharing,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Attach / Detach Video Track
  useEffect(() => {
    const videoEl = videoRef.current;
    const track = screenShare.videoTrack;
    if (!videoEl || !track) return;

    try {
      track.attach(videoEl);
    } catch {
      // ignore attach error
    }

    return () => {
      try {
        track.detach(videoEl);
      } catch {
        // ignore detach error
      }
    };
  }, [screenShare.videoTrack]);

  // Attach / Detach Remote Screen Audio Track (Never local to prevent acoustic loopback)
  useEffect(() => {
    const audioEl = audioRef.current;
    const audioTrack = screenShare.audioTrack;
    if (!audioEl || !audioTrack || screenShare.isLocal) return;

    try {
      audioTrack.attach(audioEl);
      audioEl.play().catch(() => {
        // Handled by room autoplay state
      });
    } catch {
      // ignore attach error
    }

    return () => {
      try {
        audioTrack.detach(audioEl);
      } catch {
        // ignore detach error
      }
    };
  }, [screenShare.audioTrack, screenShare.isLocal]);

  // Fullscreen toggle handler
  const handleToggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // ignore fullscreen API restrictions
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-screenshare-view="true"
      data-screenshare-stage="true"
      data-screenshare-owner={screenShare.participantIdentity}
      data-is-local={screenShare.isLocal ? 'true' : 'false'}
      data-is-local-share={screenShare.isLocal ? 'true' : 'false'}
      className={`relative w-full h-full flex flex-col items-center justify-center bg-[#0d131a] rounded-2xl overflow-hidden border border-white/10 shadow-2xl ${className}`}
    >
      {/* Top Banner: Sharer Identity + Controls */}
      <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#101820]/90 backdrop-blur-md border border-white/15 text-white shadow-lg text-xs font-medium">
          <Monitor className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          <span data-screenshare-owner-label="true" className="font-semibold text-white">
            {screenShare.isLocal ? 'You are sharing your screen' : `${screenShare.displayName}'s screen`}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-[#168B83]/30 text-[#7CE5DB] border border-[#168B83]/50">
            Live
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {screenShare.isLocal && onStopSharing && (
            <button
              type="button"
              data-action="stop-screenshare"
              data-control="stop-screenshare-banner"
              onClick={onStopSharing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#D94F4F] hover:bg-[#C13E3E] text-white shadow-lg border border-[#D94F4F]/50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#D94F4F]"
            >
              <StopCircle className="w-4 h-4" aria-hidden="true" />
              <span>Stop Sharing</span>
            </button>
          )}

          <button
            type="button"
            data-control="fullscreen-screenshare"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'View full screen'}
            title={isFullscreen ? 'Exit full screen' : 'View full screen'}
            className="p-2 rounded-xl bg-[#101820]/80 hover:bg-[#101820] text-white/80 hover:text-white border border-white/15 transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Screen Share Video Element */}
      <div className="w-full h-full flex items-center justify-center p-2 sm:p-4">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted // Local display does not play audio through video element
          className="max-w-full max-h-full object-contain rounded-lg shadow-inner bg-black"
        />
      </div>

      {/* Detached Remote Screen Audio Element (optional tab/system audio) */}
      {!screenShare.isLocal && screenShare.audioTrack && (
        <audio ref={audioRef} autoPlay data-remote-screen-audio={screenShare.participantIdentity} />
      )}
    </div>
  );
};
