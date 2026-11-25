import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  SlidersHorizontal,
  Lock,
  Unlock,
  Users,
  Clock,
  Settings,
  LogOut,
  PhoneOff,
  Loader2,
  MessageSquare,
  Smile,
  FolderDown,
  PenTool,
  MoreHorizontal,
} from 'lucide-react';
import { ReactionPicker } from './ReactionPicker';
import type { AllowedReaction } from '@/types/chat';

interface MeetingToolbarProps {
  isLiveKitConnected: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isTogglingMic: boolean;
  isTogglingCamera: boolean;
  isTogglingScreenShare: boolean;
  isSwitchingDevice: boolean;
  isLocked: boolean;
  isTogglingLock: boolean;
  canToggleLock: boolean;
  canManageWaitingRoom: boolean;
  isHost: boolean;
  participantCount: number;
  waitingCount: number;
  // Phase 12 Chat & Reactions
  isChatOpen: boolean;
  unreadChatCount: number;
  isReactionsOpen: boolean;
  onToggleChat: () => void;
  onToggleReactions: () => void;
  onSelectReaction: (emoji: AllowedReaction) => void;
  // Phase 13 File Sharing
  isFilesOpen?: boolean;
  filesCount?: number;
  onToggleFiles?: () => void;
  // Phase 14 Collaborative Whiteboard
  isWhiteboardOpen?: boolean;
  onToggleWhiteboard?: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onOpenDevices: () => void;
  onToggleLock: () => void;
  onOpenMobileParticipants: () => void;
  onOpenMobileWaiting: () => void;
  onOpenRoomSettings: () => void;
  onRequestLeave: () => void;
  onRequestEndMeeting: () => void;
}

/**
 * Phase 12 Meeting Control Bar.
 * Media controls for Microphone, Camera, Screen Sharing, Device Selection,
 * Real-Time Chat & Emoji Reactions, and Room Governance.
 */
export const MeetingToolbar: React.FC<MeetingToolbarProps> = ({
  isLiveKitConnected,
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isTogglingMic,
  isTogglingCamera,
  isTogglingScreenShare,
  isSwitchingDevice,
  isLocked,
  isTogglingLock,
  canToggleLock,
  canManageWaitingRoom,
  isHost,
  participantCount,
  waitingCount,
  isChatOpen,
  unreadChatCount,
  isReactionsOpen,
  onToggleChat,
  onToggleReactions,
  onSelectReaction,
  isFilesOpen = false,
  filesCount = 0,
  onToggleFiles,
  isWhiteboardOpen = false,
  onToggleWhiteboard,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onOpenDevices,
  onToggleLock,
  onOpenMobileParticipants,
  onOpenMobileWaiting,
  onOpenRoomSettings,
  onRequestLeave,
  onRequestEndMeeting,
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen]);

  return (
    <footer
      aria-label="Meeting controls"
      className="fixed bottom-0 inset-x-0 z-30 px-2.5 sm:px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] bg-[#101820]/95 backdrop-blur-md border-t border-white/10"
    >
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {/* Microphone Mute / Unmute */}
        <button
          type="button"
          data-control="toggle-mic"
          aria-pressed={isMicEnabled}
          aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
          title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
          disabled={!isLiveKitConnected || isTogglingMic}
          onClick={onToggleMic}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50 disabled:cursor-not-allowed ${
            isMicEnabled
              ? 'bg-[#253746] border-white/15 text-white hover:bg-[#2F4658]'
              : 'bg-[#D94F4F]/25 border-[#D94F4F]/50 text-[#F7A3A3] hover:bg-[#D94F4F]/35'
          }`}
        >
          {isTogglingMic ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : isMicEnabled ? (
            <Mic className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          ) : (
            <MicOff className="w-4 h-4 text-[#F7A3A3]" aria-hidden="true" />
          )}
          <span>{isMicEnabled ? 'Mute' : 'Unmute'}</span>
        </button>

        {/* Camera On / Off */}
        <button
          type="button"
          data-control="toggle-camera"
          aria-pressed={isCameraEnabled}
          aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          disabled={!isLiveKitConnected || isTogglingCamera}
          onClick={onToggleCamera}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50 disabled:cursor-not-allowed ${
            isCameraEnabled
              ? 'bg-[#253746] border-white/15 text-white hover:bg-[#2F4658]'
              : 'bg-[#D94F4F]/25 border-[#D94F4F]/50 text-[#F7A3A3] hover:bg-[#D94F4F]/35'
          }`}
        >
          {isTogglingCamera ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : isCameraEnabled ? (
            <Video className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          ) : (
            <VideoOff className="w-4 h-4 text-[#F7A3A3]" aria-hidden="true" />
          )}
          <span>{isCameraEnabled ? 'Stop Video' : 'Start Video'}</span>
        </button>

        {/* Screen Share Start / Stop (Desktop & Tablet) */}
        <button
          type="button"
          data-control="toggle-screenshare"
          data-active={isScreenSharing ? 'true' : 'false'}
          aria-pressed={isScreenSharing}
          aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          disabled={!isLiveKitConnected || isTogglingScreenShare}
          onClick={onToggleScreenShare}
          className={`hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] disabled:opacity-50 disabled:cursor-not-allowed ${
            isScreenSharing
              ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white hover:bg-[#137770]'
              : 'bg-[#253746] border-white/15 text-white hover:bg-[#2F4658]'
          }`}
        >
          {isTogglingScreenShare ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#7CE5DB]" aria-hidden="true" />
          ) : isScreenSharing ? (
            <MonitorOff className="w-4 h-4 text-white" aria-hidden="true" />
          ) : (
            <Monitor className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          )}
          <span>{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
        </button>

        {/* Audio / Video Devices (Desktop & Tablet) */}
        <button
          type="button"
          data-control="open-devices"
          aria-label="Audio and video device settings"
          title="Select microphone, camera, and speaker"
          onClick={onOpenDevices}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
        >
          {isSwitchingDevice ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#7CE5DB]" aria-hidden="true" />
          ) : (
            <SlidersHorizontal className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          )}
          <span className="hidden xs:inline sm:inline">Devices</span>
        </button>

        {/* Phase 14 — Whiteboard Toggle Button (Desktop & Tablet) */}
        {onToggleWhiteboard && (
          <button
            type="button"
            data-control="toggle-whiteboard"
            aria-label={isWhiteboardOpen ? 'Close whiteboard (W)' : 'Open whiteboard (W)'}
            title={isWhiteboardOpen ? 'Close Whiteboard (W)' : 'Open Whiteboard (W)'}
            aria-pressed={isWhiteboardOpen}
            onClick={onToggleWhiteboard}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
              isWhiteboardOpen
                ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white hover:bg-[#137770]'
                : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
            }`}
          >
            <PenTool className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">Whiteboard</span>
          </button>
        )}

        {/* Phase 12 — Chat Toggle Button */}
        <button
          type="button"
          data-control="toggle-chat"
          aria-label={isChatOpen ? 'Close chat' : 'Open chat'}
          title={isChatOpen ? 'Close chat' : 'Open chat'}
          aria-pressed={isChatOpen}
          onClick={onToggleChat}
          className={`relative inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
            isChatOpen
              ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white hover:bg-[#137770]'
              : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
          }`}
        >
          <MessageSquare className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          <span className="hidden xs:inline sm:inline">Chat</span>
          {!isChatOpen && unreadChatCount > 0 && (
            <span
              data-badge="unread-chat"
              className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-[#D94F4F] rounded-full shadow-sm animate-pulse"
            >
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </button>

        {/* Phase 13 — Files Toggle Button (Desktop & Tablet) */}
        {onToggleFiles && (
          <button
            type="button"
            data-control="toggle-files"
            aria-label={isFilesOpen ? 'Close files' : 'Open files'}
            title={isFilesOpen ? 'Close files' : 'Open files'}
            aria-pressed={isFilesOpen}
            onClick={onToggleFiles}
            className={`hidden sm:inline-flex relative items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
              isFilesOpen
                ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white hover:bg-[#137770]'
                : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
            }`}
          >
            <FolderDown className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">Files</span>
            {filesCount > 0 && (
              <span
                data-badge="files-count"
                className="px-1.5 py-0.2 text-[10px] font-bold text-white bg-[#168B83] rounded-full border border-white/20"
              >
                {filesCount}
              </span>
            )}
          </button>
        )}

        {/* Phase 12 — Emoji Reactions Trigger & Popover (Desktop & Tablet) */}
        <div className="relative hidden sm:inline-block">
          <button
            type="button"
            data-control="trigger-reactions"
            aria-label="Send reaction"
            title="Send reaction"
            aria-pressed={isReactionsOpen}
            onClick={onToggleReactions}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
              isReactionsOpen
                ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white hover:bg-[#137770]'
                : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
            }`}
          >
            <Smile className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">React</span>
          </button>
          <ReactionPicker
            isOpen={isReactionsOpen}
            onClose={onToggleReactions}
            onSelectReaction={onSelectReaction}
          />
        </div>

        {/* Mobile More Actions Menu (DEF-17-03) */}
        <div ref={moreMenuRef} className="relative sm:hidden">
          <button
            type="button"
            data-control="mobile-more-actions"
            aria-haspopup="true"
            aria-expanded={isMoreMenuOpen}
            aria-label="More meeting actions"
            onClick={() => setIsMoreMenuOpen((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
              isMoreMenuOpen
                ? 'bg-[#168B83] border-[#7CE5DB]/40 text-white'
                : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
            }`}
          >
            <MoreHorizontal className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
            <span>More</span>
          </button>

          {isMoreMenuOpen && (
            <div
              role="menu"
              aria-label="Additional meeting controls"
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-2 bg-[#172B3A] border border-white/15 rounded-2xl shadow-2xl space-y-1 z-50 text-white animate-in fade-in zoom-in-95 duration-100"
            >
              <button
                type="button"
                role="menuitem"
                data-control="mobile-screenshare"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onToggleScreenShare();
                }}
                disabled={!isLiveKitConnected || isTogglingScreenShare}
                className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50 text-left"
              >
                <span className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-[#7CE5DB]" />
                  <span>{isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}</span>
                </span>
                {isScreenSharing && <span className="w-2 h-2 rounded-full bg-[#168B83]" />}
              </button>

              {onToggleWhiteboard && (
                <button
                  type="button"
                  role="menuitem"
                  data-control="mobile-whiteboard"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleWhiteboard();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
                >
                  <span className="flex items-center gap-2">
                    <PenTool className="w-4 h-4 text-[#7CE5DB]" />
                    <span>Whiteboard</span>
                  </span>
                  {isWhiteboardOpen && <span className="w-2 h-2 rounded-full bg-[#168B83]" />}
                </button>
              )}

              {onToggleFiles && (
                <button
                  type="button"
                  role="menuitem"
                  data-control="mobile-files"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleFiles();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
                >
                  <span className="flex items-center gap-2">
                    <FolderDown className="w-4 h-4 text-[#7CE5DB]" />
                    <span>Files</span>
                  </span>
                  {filesCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#168B83] text-white">
                      {filesCount}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                data-control="mobile-reactions"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onToggleReactions();
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <Smile className="w-4 h-4 text-[#7CE5DB]" />
                  <span>Reactions</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                data-control="mobile-devices"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenDevices();
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-[#7CE5DB]" />
                  <span>Audio & Video Devices</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                data-control="mobile-people"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenMobileParticipants();
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#7CE5DB]" />
                  <span>People</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {participantCount}
                </span>
              </button>

              {canManageWaitingRoom && (
                <button
                  type="button"
                  role="menuitem"
                  data-control="mobile-waiting"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenMobileWaiting();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-amber-300 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>Waiting Room</span>
                  </span>
                  <span className="text-[11px] font-mono">
                    {waitingCount}
                  </span>
                </button>
              )}

              {canToggleLock && (
                <button
                  type="button"
                  role="menuitem"
                  data-control="mobile-lock"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleLock();
                  }}
                  disabled={isTogglingLock}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
                >
                  <span className="flex items-center gap-2">
                    {isLocked ? <Unlock className="w-4 h-4 text-[#F7A3A3]" /> : <Lock className="w-4 h-4 text-[#7CE5DB]" />}
                    <span>{isLocked ? 'Unlock Meeting' : 'Lock Meeting'}</span>
                  </span>
                </button>
              )}

              {isHost && (
                <button
                  type="button"
                  role="menuitem"
                  data-control="mobile-room-settings"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenRoomSettings();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium hover:bg-white/10 transition-colors text-left"
                >
                  <span className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-[#7CE5DB]" />
                    <span>Room Settings</span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        <span className="hidden sm:inline-block h-6 w-px bg-white/10 mx-0.5" aria-hidden="true" />

        {/* Host / Co-Host Lock Toggle (Desktop & Tablet) */}
        {canToggleLock && (
          <button
            type="button"
            disabled={isTogglingLock}
            onClick={onToggleLock}
            title={isLocked ? 'Unlock meeting' : 'Lock meeting'}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] ${
              isLocked
                ? 'bg-[#D94F4F]/20 border-[#D94F4F]/40 text-[#F7A3A3] hover:bg-[#D94F4F]/30'
                : 'bg-[#253746] border-white/10 text-white hover:bg-[#2F4658]'
            }`}
          >
            {isLocked ? <Unlock className="w-4 h-4" aria-hidden="true" /> : <Lock className="w-4 h-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{isLocked ? 'Unlock' : 'Lock'}</span>
          </button>
        )}

        {/* Mobile Participants Drawer Trigger (Tablet only) */}
        <button
          type="button"
          onClick={onOpenMobileParticipants}
          className="hidden sm:inline-flex lg:hidden items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
        >
          <Users className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
          <span>People ({participantCount})</span>
        </button>

        {/* Mobile Waiting Room Drawer Trigger (Tablet only) */}
        {canManageWaitingRoom && (
          <button
            type="button"
            onClick={onOpenMobileWaiting}
            className="hidden sm:inline-flex lg:hidden items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <Clock className="w-4 h-4 text-amber-300" aria-hidden="true" />
            <span>Waiting ({waitingCount})</span>
          </button>
        )}

        {/* Host Room Settings (Desktop & Tablet) */}
        {isHost && (
          <button
            type="button"
            onClick={onOpenRoomSettings}
            title="Host room settings"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <Settings className="w-4 h-4 text-[#7CE5DB]" aria-hidden="true" />
            <span className="hidden md:inline">Room Settings</span>
          </button>
        )}

        {/* Leave Meeting */}
        <button
          type="button"
          data-control="leave-meeting"
          onClick={onRequestLeave}
          title="Leave meeting"
          className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>Leave</span>
        </button>

        {/* Host End Meeting for All */}
        {isHost && (
          <button
            type="button"
            data-control="end-meeting"
            onClick={onRequestEndMeeting}
            title="End meeting for all participants"
            className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-[#D94F4F] hover:bg-[#C13E3E] text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#D94F4F]"
          >
            <PhoneOff className="w-4 h-4" aria-hidden="true" />
            <span>End for All</span>
          </button>
        )}
      </div>
    </footer>
  );
};
