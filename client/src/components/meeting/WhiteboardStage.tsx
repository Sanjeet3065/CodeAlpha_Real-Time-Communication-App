import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  PenTool,
  X,
  Users,
  AlertCircle,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { ParticipantVideoTile } from './ParticipantVideoTile';
import type { useWhiteboard } from '@/hooks/useWhiteboard';
import type {
  MeetingParticipantInfo,
  ParticipantMediaState,
  ParticipantRole,
} from '@/types/meeting';

export interface WhiteboardStageProps {
  meetingCode: string;
  whiteboard: ReturnType<typeof useWhiteboard>;
  admittedParticipants: MeetingParticipantInfo[];
  livekitParticipants: ParticipantMediaState[];
  currentUserId: string;
  currentUserName: string;
  isLiveKitConnected: boolean;
  onClose: () => void;
}

interface CompactTileRecord {
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

export const WhiteboardStage: React.FC<WhiteboardStageProps> = ({
  meetingCode,
  whiteboard,
  admittedParticipants,
  livekitParticipants,
  currentUserId,
  currentUserName,
  isLiveKitConnected,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVideoStripOpen, setIsVideoStripOpen] = useState(true);

  // Export Whiteboard as PNG
  const handleExportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `connectly-whiteboard-${meetingCode}-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export whiteboard PNG:', err);
    }
  }, [meetingCode]);

  // Merge participant video states for the compact top strip
  const compactTiles = useMemo<CompactTileRecord[]>(() => {
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

    const tiles: CompactTileRecord[] = admittedParticipants.map((p) => {
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

    tiles.sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return tiles;
  }, [admittedParticipants, livekitParticipants, currentUserId, isLiveKitConnected]);

  // Active collaborators: local user + remote cursor count
  const activeCollaboratorCount = 1 + whiteboard.remoteCursors.size;

  return (
    <section
      aria-label="Collaborative Whiteboard Stage"
      data-whiteboard-stage="true"
      className="flex-1 flex flex-col h-full w-full min-h-[500px] max-h-[calc(100vh-140px)] rounded-2xl bg-[#101820] border border-white/10 shadow-2xl overflow-hidden relative"
    >
      {/* Whiteboard Header */}
      <header className="flex items-center justify-between px-3.5 py-2.5 bg-[#172B3A]/80 border-b border-white/10 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[#168B83]/20 text-[#7CE5DB] border border-[#168B83]/40">
              <PenTool className="w-4 h-4" />
            </span>
            <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide">
              Whiteboard
            </h2>
          </div>

          {/* Version badge */}
          <span
            data-badge="whiteboard-version"
            className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-white/10 text-slate-300 border border-white/10"
          >
            v{whiteboard.version}
          </span>

          {/* Live Collaborators Count */}
          <span
            data-badge="collaborators-count"
            className="hidden xs:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#168B83]/25 text-[#9BF3EA] border border-[#168B83]/30"
          >
            <Users className="w-3 h-3" />
            <span>{activeCollaboratorCount} collaborating</span>
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Participant Video Strip */}
          <button
            type="button"
            data-action="toggle-video-strip"
            aria-label={isVideoStripOpen ? 'Hide participant video strip' : 'Show participant video strip'}
            title={isVideoStripOpen ? 'Hide video strip' : 'Show video strip'}
            onClick={() => setIsVideoStripOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 border border-white/10 transition-colors"
          >
            {isVideoStripOpen ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-[#7CE5DB]" />
                <span className="hidden sm:inline">Hide Video</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-[#7CE5DB]" />
                <span className="hidden sm:inline">Show Video</span>
              </>
            )}
          </button>

          {/* Close Whiteboard Stage */}
          <button
            type="button"
            data-action="close-whiteboard"
            aria-label="Close whiteboard"
            title="Close Whiteboard (W)"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Error Toast / Notification */}
      {whiteboard.error && (
        <div
          role="alert"
          className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs flex items-center justify-between gap-2 z-30"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{whiteboard.error}</span>
          </div>
          <button
            type="button"
            onClick={whiteboard.clearError}
            aria-label="Dismiss error"
            className="text-rose-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Compact Participant Video Strip (Top) */}
      {isVideoStripOpen && compactTiles.length > 0 && (
        <div
          aria-label="Active participants video strip"
          data-video-strip="compact"
          className="flex items-center gap-2 px-3 py-1.5 bg-[#172B3A]/50 border-b border-white/10 overflow-x-auto z-10 shrink-0 scrollbar-thin"
        >
          {compactTiles.map((tile) => (
            <div
              key={tile.key}
              className="w-32 sm:w-36 h-20 sm:h-24 shrink-0 rounded-lg overflow-hidden border border-white/10 bg-[#101820] shadow-sm relative"
            >
              <ParticipantVideoTile
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
                aspectClassName="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      {/* Canvas Area */}
      <div className="flex-1 relative w-full h-full overflow-hidden bg-[#0A1017]">
        <WhiteboardCanvas
          canvasRef={canvasRef}
          elements={whiteboard.elements}
          activeTool={whiteboard.activeTool}
          strokeColor={whiteboard.strokeColor}
          fillColor={whiteboard.fillColor}
          strokeWidth={whiteboard.strokeWidth}
          fontSize={whiteboard.fontSize}
          zoom={whiteboard.zoom}
          pan={whiteboard.pan}
          setPan={whiteboard.setPan}
          selectedElementId={whiteboard.selectedElementId}
          onSelectElement={whiteboard.setSelectedElementId}
          onAddElement={whiteboard.addElement}
          onUpdateElement={whiteboard.updateElement}
          onDeleteElement={whiteboard.deleteElement}
          onBroadcastCursor={whiteboard.broadcastCursor}
          remoteCursors={whiteboard.remoteCursors}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />

        {/* Floating Toolbar Dock */}
        <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-1.5rem)]">
          <WhiteboardToolbar
            activeTool={whiteboard.activeTool}
            onSelectTool={whiteboard.setActiveTool}
            strokeColor={whiteboard.strokeColor}
            onSelectStrokeColor={whiteboard.setStrokeColor}
            strokeWidth={whiteboard.strokeWidth}
            onSelectStrokeWidth={whiteboard.setStrokeWidth}
            zoom={whiteboard.zoom}
            onZoomIn={whiteboard.zoomIn}
            onZoomOut={whiteboard.zoomOut}
            onResetZoom={whiteboard.resetViewport}
            onUndo={whiteboard.undo}
            onRedo={whiteboard.redo}
            onClearBoard={whiteboard.clearBoard}
            canClearBoard={whiteboard.canClearBoard}
            onExportPng={handleExportPng}
          />
        </div>
      </div>
    </section>
  );
};
