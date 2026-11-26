import React from 'react';
import { Crown, ShieldCheck, UserMinus, ArrowUpCircle, ArrowDownCircle, Users } from 'lucide-react';
import type { MeetingParticipantInfo, MeetingSummary, ParticipantRole } from '@/types/meeting';

interface ParticipantsPanelProps {
  meeting: MeetingSummary;
  participants: MeetingParticipantInfo[];
  currentUserId: string;
  currentUserRole: ParticipantRole;
  busyUserId: string | null;
  onPromoteCoHost: (participant: MeetingParticipantInfo) => void;
  onRevokeCoHost: (participant: MeetingParticipantInfo) => void;
  onRequestRemove: (participant: MeetingParticipantInfo) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  meeting,
  participants,
  currentUserId,
  currentUserRole,
  busyUserId,
  onPromoteCoHost,
  onRevokeCoHost,
  onRequestRemove,
}) => {
  const isHost = currentUserRole === 'host';
  const isCoHost = currentUserRole === 'co-host';

  const canRemoveTarget = (target: MeetingParticipantInfo): boolean => {
    if (target.userId === currentUserId) return false;
    if (target.role === 'host') return false;
    if (isHost) return true;
    if (isCoHost && meeting.settings.allowCoHostRemove && target.role === 'participant') {
      return true;
    }
    return false;
  };

  if (participants.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 text-xs space-y-2">
        <Users className="w-7 h-7 mx-auto text-slate-500" aria-hidden="true" />
        <p>No active participants yet.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/10" aria-label="Active meeting participants">
      {participants.map((p) => {
        const isSelf = p.userId === currentUserId;
        const isBusy = busyUserId === p.userId;
        const canPromote = isHost && !isSelf && p.role === 'participant';
        const canRevoke = isHost && !isSelf && p.role === 'co-host';
        const canRemove = canRemoveTarget(p);

        return (
          <li key={p.userId} className="p-3.5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-[#2F6F68]/25 border border-[#5FA399]/40 text-[#5FA399] font-display font-bold text-xs flex items-center justify-center">
                  {getInitials(p.displayName)}
                </div>
                <span
                  title={p.presenceStatus === 'ONLINE' ? 'Connected' : 'Reconnecting / Offline'}
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#1C1F24] ${
                    p.presenceStatus === 'ONLINE' ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-white truncate max-w-[140px]">
                    {p.displayName}
                  </span>
                  {isSelf && (
                    <span className="text-[10px] font-mono text-slate-400">(You)</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-1">
                  {p.role === 'host' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#2F6F68]/25 text-[#5FA399]">
                      <Crown className="w-2.5 h-2.5" aria-hidden="true" />
                      Host
                    </span>
                  )}
                  {p.role === 'co-host' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-300">
                      <ShieldCheck className="w-2.5 h-2.5" aria-hidden="true" />
                      Co-Host
                    </span>
                  )}
                  {p.role === 'participant' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-slate-300">
                      Participant
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400">
                    {p.presenceStatus === 'ONLINE' ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            {(canPromote || canRevoke || canRemove) && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {canPromote && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onPromoteCoHost(p)}
                    title="Promote to Co-Host"
                    aria-label={`Promote ${p.displayName} to Co-Host`}
                    className="min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] inline-flex items-center justify-center rounded-lg text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                  </button>
                )}
                {canRevoke && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRevokeCoHost(p)}
                    title="Revoke Co-Host"
                    aria-label={`Revoke Co-Host from ${p.displayName}`}
                    className="min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] inline-flex items-center justify-center rounded-lg text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <ArrowDownCircle className="w-4 h-4" />
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRequestRemove(p)}
                    title="Remove Participant"
                    aria-label={`Remove ${p.displayName} from meeting`}
                    className="min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] inline-flex items-center justify-center rounded-lg text-[#D46A6A] hover:bg-[#C24D4D]/20 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#C24D4D]"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
