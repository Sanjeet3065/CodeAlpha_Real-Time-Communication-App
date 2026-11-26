import React from 'react';
import { Clock, Check, X, RefreshCw, AlertCircle } from 'lucide-react';
import type { MeetingParticipantInfo } from '@/types/meeting';

interface WaitingRoomPanelProps {
  waitingList: MeetingParticipantInfo[];
  isLoading: boolean;
  error: string | null;
  busyUserId: string | null;
  onAdmit: (userId: string) => void;
  onReject: (userId: string) => void;
  onRetry: () => void;
}

export const WaitingRoomPanel: React.FC<WaitingRoomPanelProps> = ({
  waitingList,
  isLoading,
  error,
  busyUserId,
  onAdmit,
  onReject,
  onRetry,
}) => {
  if (isLoading) {
    return (
      <div className="p-6 text-center text-xs text-slate-400 space-y-2">
        <div className="w-5 h-5 border-2 border-[#5FA399] border-t-transparent rounded-full animate-spin mx-auto" />
        <p>Loading waiting room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 m-3 rounded-xl bg-rose-500/15 border border-rose-400/30 text-xs text-rose-200 space-y-2.5">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (waitingList.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 text-xs space-y-2">
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
          <Clock className="w-5 h-5 text-slate-400" aria-hidden="true" />
        </div>
        <p className="font-semibold text-slate-200">No one in the waiting room</p>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          When waiting room admission is enabled, join requests will appear here for approval.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/10" aria-label="Pending waiting room requests">
      {waitingList.map((entry) => {
        const isBusy = busyUserId === entry.userId;
        const requestedTime = entry.requestedAt
          ? new Date(entry.requestedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

        return (
          <li key={entry.userId} className="p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{entry.displayName}</p>
                <p className="text-[11px] text-slate-400">
                  Requested admission {requestedTime ? `at ${requestedTime}` : ''}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-200 flex-shrink-0">
                Waiting
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onAdmit(entry.userId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F6F68] hover:bg-[#255A54] disabled:opacity-50 text-xs font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isBusy ? 'Working...' : 'Admit'}</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onReject(entry.userId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-[#C24D4D]/25 hover:text-[#D46A6A] disabled:opacity-50 text-xs font-semibold text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-[#C24D4D]"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
