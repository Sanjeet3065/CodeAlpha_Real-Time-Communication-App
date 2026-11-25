import React, { useState } from 'react';
import {
  Video,
  Copy,
  Check,
  Lock,
  Shield,
  Users,
  Link as LinkIcon,
  WifiOff,
  Clock,
} from 'lucide-react';
import type { MeetingSummary } from '@/types/meeting';

interface MeetingHeaderProps {
  meeting: MeetingSummary;
  participantCount: number;
  waitingCount: number;
  canManageWaitingRoom: boolean;
  isReconnecting: boolean;
  onToggleMobileSidebar: (tab: 'participants' | 'waiting') => void;
}

export const MeetingHeader: React.FC<MeetingHeaderProps> = ({
  meeting,
  participantCount,
  waitingCount,
  canManageWaitingRoom,
  isReconnecting,
  onToggleMobileSidebar,
}) => {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const invitationLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${meeting.meetingCode}`
      : meeting.joinUrl;

  const copyText = async (value: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 2500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-[#101820]/95 backdrop-blur-md border-b border-white/10 px-3 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand + Meeting Title + Code */}
        <div className="flex items-center gap-3 min-w-[175px] flex-1">
          <div className="w-8 h-8 rounded-lg bg-[#168B83] text-white flex items-center justify-center flex-shrink-0">
            <Video className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-sm sm:text-base font-bold text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                {meeting.title}
              </h1>
              {meeting.isLocked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#D94F4F]/20 text-[#F7A3A3] border border-[#D94F4F]/30">
                  <Lock className="w-3 h-3" aria-hidden="true" />
                  Locked
                </span>
              )}
              {meeting.settings.waitingRoomEnabled && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#168B83]/20 text-[#7CE5DB] border border-[#168B83]/30">
                  <Shield className="w-3 h-3" aria-hidden="true" />
                  Waiting Room On
                </span>
              )}
              {isReconnecting && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-400/30"
                >
                  <WifiOff className="w-3 h-3" aria-hidden="true" />
                  Reconnecting...
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <button
                type="button"
                onClick={() => copyText(meeting.meetingCode, 'code')}
                aria-label={`Copy meeting code ${meeting.meetingCode}`}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83] rounded whitespace-nowrap"
              >
                <span>{meeting.meetingCode}</span>
                {copied === 'code' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Host: {meeting.hostName}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Invite Copy + Status Pills + Mobile Panel Buttons */}
        <div className="flex items-center flex-wrap gap-2 flex-shrink-0">
          <span className="sr-only" aria-live="polite">
            {copied === 'code'
              ? 'Meeting code copied to clipboard.'
              : copied === 'link'
                ? 'Invitation link copied to clipboard.'
                : ''}
          </span>
          <button
            type="button"
            onClick={() => copyText(invitationLink, 'link')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-xs font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            {copied === 'link' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <LinkIcon className="w-3.5 h-3.5 text-[#7CE5DB]" />
                <span className="hidden sm:inline">Copy Invite Link</span>
                <span className="sm:hidden">Invite</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onToggleMobileSidebar('participants')}
            aria-label={`Participants (${participantCount})`}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#253746] hover:bg-[#2F4658] border border-white/10 text-xs font-semibold text-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <Users className="w-3.5 h-3.5 text-[#7CE5DB]" />
            <span className="font-mono">
              {participantCount}/{meeting.maxParticipants}
            </span>
          </button>

          {canManageWaitingRoom && waitingCount > 0 && (
            <button
              type="button"
              onClick={() => onToggleMobileSidebar('waiting')}
              aria-label={`Waiting room (${waitingCount} pending)`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-xs font-semibold text-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{waitingCount} Waiting</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
