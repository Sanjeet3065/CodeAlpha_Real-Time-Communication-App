import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ParticipantVideoTile } from './ParticipantVideoTile';
import { ScreenShareView } from './ScreenShareView';
import { computeVideoGridLayout } from '@/utils/mediaDevices';
import type {
  MeetingParticipantInfo,
  ParticipantMediaState,
  ParticipantRole,
  ScreenShareStreamInfo,
} from '@/types/meeting';

interface VideoConferenceGridProps {
  /** Authoritative admitted participant roster from CONNECTLY Supabase/Socket.IO SSOT */
  admittedParticipants: MeetingParticipantInfo[];
  /** Live media track states observed from LiveKit SFU */
  livekitParticipants: ParticipantMediaState[];
  currentUserId: string;
  maxParticipants: number;
  isLiveKitConnected: boolean;
  /** Active screen shares in the meeting (Phase 11) */
  screenShares?: ScreenShareStreamInfo[];
  onStopSharing?: () => void;
}

interface MergedTileRecord {
  key: string;
  displayName: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  isLocal: boolean;
  isConnectedToSfu: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isSpeaking: boolean;
  videoTrack: ParticipantMediaState['videoTrack'];
}

export const VideoConferenceGrid: React.FC<VideoConferenceGridProps> = ({
  admittedParticipants,
  livekitParticipants,
  currentUserId,
  isLiveKitConnected,
  screenShares,
  onStopSharing,
}) => {
  const mergedTiles = useMemo<MergedTileRecord[]>(() => {
    const lkByUserId = new Map<string, ParticipantMediaState>();
    let localLk: ParticipantMediaState | undefined;

    for (const lp of livekitParticipants) {
      if (lp.isLocal) {
        localLk = lp;
      }
      if (lp.userId) {
        lkByUserId.set(lp.userId, lp);
      }
    }

    const tiles: MergedTileRecord[] = admittedParticipants.map((p) => {
      const isLocal = p.userId === currentUserId;
      const lk = lkByUserId.get(p.userId) ?? (isLocal ? localLk : undefined);

      return {
        key: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl || null,
        role: p.role,
        isLocal,
        isConnectedToSfu: isLocal ? isLiveKitConnected : Boolean(lk),
        isMicEnabled: lk ? lk.isMicEnabled : false,
        isCameraEnabled: lk ? lk.isCameraEnabled : false,
        isSpeaking: lk ? lk.isSpeaking : false,
        videoTrack: lk ? lk.videoTrack : null,
      };
    });

    // Place local participant first, followed by active speakers, hosts, then alphabetical
    tiles.sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1;
      if (a.role === 'host' && b.role !== 'host') return -1;
      if (b.role === 'host' && a.role !== 'host') return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return tiles;
  }, [admittedParticipants, livekitParticipants, currentUserId, isLiveKitConnected]);

  const [currentPage, setCurrentPage] = useState(0);
  const MAX_TILES_PER_PAGE = 12;

  const totalPages = Math.ceil(mergedTiles.length / MAX_TILES_PER_PAGE) || 1;
  const safePage = Math.min(currentPage, Math.max(0, totalPages - 1));

  const visibleTiles = useMemo(() => {
    if (mergedTiles.length <= MAX_TILES_PER_PAGE) return mergedTiles;
    const start = safePage * MAX_TILES_PER_PAGE;
    return mergedTiles.slice(start, start + MAX_TILES_PER_PAGE);
  }, [mergedTiles, safePage]);

  const activeShare = useMemo(() => {
    return screenShares && screenShares.length > 0 ? screenShares[0] : null;
  }, [screenShares]);

  const layout = useMemo(() => computeVideoGridLayout(visibleTiles.length), [visibleTiles.length]);

  return (
    <section
      aria-label="Meeting video conference grid"
      data-video-grid-tier={layout.tier}
      data-tile-count={mergedTiles.length}
      data-visible-tile-count={visibleTiles.length}
      data-screenshare-active={Boolean(activeShare)}
      className="space-y-3"
    >
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-medium">
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1 bg-[#1C1F24] rounded-lg p-0.5 border border-white/10">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous participant page"
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-slate-300 px-1 font-mono">
              {safePage * MAX_TILES_PER_PAGE + 1}-
              {Math.min((safePage + 1) * MAX_TILES_PER_PAGE, mergedTiles.length)} of {mergedTiles.length}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              aria-label="Next participant page"
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeShare ? (
        <div className="space-y-4" data-screenshare-active-container="true">
          {/* Prominent Screen Share Presentation View */}
          <div className="w-full aspect-[16/10] sm:aspect-video max-h-[60vh] min-h-[280px]">
            <ScreenShareView
              screenShare={activeShare}
              onStopSharing={onStopSharing}
              className="w-full h-full"
            />
          </div>

          {/* Participant Filmstrip: keeps all participant cameras, audio status, and active speakers visible */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Participants ({mergedTiles.length})</span>
              {totalPages > 1 && (
                <span className="text-[10px] text-slate-400 lowercase font-normal">
                  showing active speakers & current page
                </span>
              )}
            </h3>
            <div
              data-screenshare-filmstrip="true"
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3"
            >
              {visibleTiles.map((tile) => (
                <ParticipantVideoTile
                  key={tile.key}
                  participantKey={tile.key}
                  displayName={tile.displayName}
                  avatarUrl={tile.avatarUrl}
                  role={tile.role}
                  isLocal={tile.isLocal}
                  isConnectedToSfu={tile.isConnectedToSfu}
                  isMicEnabled={tile.isMicEnabled}
                  isCameraEnabled={tile.isCameraEnabled}
                  isSpeaking={tile.isSpeaking}
                  videoTrack={tile.videoTrack}
                  aspectClassName="aspect-video"
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={layout.maxContainerClassName}>
          <div data-video-grid="true" className={`grid gap-3 sm:gap-3.5 ${layout.gridClassName}`}>
            {visibleTiles.map((tile) => (
              <ParticipantVideoTile
                key={tile.key}
                participantKey={tile.key}
                displayName={tile.displayName}
                avatarUrl={tile.avatarUrl}
                role={tile.role}
                isLocal={tile.isLocal}
                isConnectedToSfu={tile.isConnectedToSfu}
                isMicEnabled={tile.isMicEnabled}
                isCameraEnabled={tile.isCameraEnabled}
                isSpeaking={tile.isSpeaking}
                videoTrack={tile.videoTrack}
                aspectClassName={layout.tileAspectClassName}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
