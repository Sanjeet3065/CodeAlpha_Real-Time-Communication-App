import React, { useState, useEffect, useRef } from 'react';
import { Settings, Shield, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import type { MeetingSummary, UpdateMeetingSettingsPayload } from '@/types/meeting';

interface RoomSettingsModalProps {
  isOpen: boolean;
  meeting: MeetingSummary;
  isSaving: boolean;
  error: string | null;
  onSave: (payload: UpdateMeetingSettingsPayload) => Promise<void>;
  onClose: () => void;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  meeting,
  isSaving,
  error,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState(meeting.title);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(meeting.settings.waitingRoomEnabled);
  const [allowCoHostAdmit, setAllowCoHostAdmit] = useState(meeting.settings.allowCoHostAdmit);
  const [allowCoHostRemove, setAllowCoHostRemove] = useState(meeting.settings.allowCoHostRemove);
  const [allowCoHostLock, setAllowCoHostLock] = useState(meeting.settings.allowCoHostLock);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(meeting.title);
      setWaitingRoomEnabled(meeting.settings.waitingRoomEnabled);
      setAllowCoHostAdmit(meeting.settings.allowCoHostAdmit);
      setAllowCoHostRemove(meeting.settings.allowCoHostRemove);
      setAllowCoHostLock(meeting.settings.allowCoHostLock);
    }
  }, [isOpen, meeting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    await onSave({
      ...(trimmed ? { title: trimmed } : {}),
      waitingRoomEnabled,
      allowCoHostAdmit,
      allowCoHostRemove,
      allowCoHostLock,
    });
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Host Room Settings"
      titleId="room-settings-title"
      size="sm"
      variant="theater"
      closeLabel="Close room settings"
      disableClose={isSaving}
      initialFocusRef={titleInputRef}
      icon={
        <div className="w-8 h-8 rounded-lg bg-[#2F6F68]/20 text-[#5FA399] flex items-center justify-center">
          <Settings className="w-4 h-4" aria-hidden="true" />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="room-title-input" className="block text-xs font-semibold text-slate-200 mb-1.5">
              Meeting Title
            </label>
            <input
              ref={titleInputRef}
              id="room-title-input"
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-[#111316] border border-white/15 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#111316]/70 border border-white/10 space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#5FA399]">
              <Shield className="w-3.5 h-3.5" />
              <span>Admission & Co-Host Permissions</span>
            </div>

            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-white block">Waiting Room Admission</span>
                <span className="text-[11px] text-slate-400">
                  Hold new non-host participants until approved.
                </span>
              </div>
              <input
                type="checkbox"
                checked={waitingRoomEnabled}
                onChange={(e) => setWaitingRoomEnabled(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#5FA399] focus:ring-[#5FA399]"
              />
            </label>

            <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-white/10 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-white block">
                  Co-Hosts Can Manage Waiting Room
                </span>
                <span className="text-[11px] text-slate-400">
                  Allow co-hosts to admit and reject pending join requests.
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowCoHostAdmit}
                onChange={(e) => setAllowCoHostAdmit(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#5FA399] focus:ring-[#5FA399]"
              />
            </label>

            <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-white/10 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-white block">
                  Co-Hosts Can Remove Participants
                </span>
                <span className="text-[11px] text-slate-400">
                  Allow co-hosts to eject regular participants (never host or other co-hosts).
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowCoHostRemove}
                onChange={(e) => setAllowCoHostRemove(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#5FA399] focus:ring-[#5FA399]"
              />
            </label>

            <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-white/10 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-white block">
                  Co-Hosts Can Lock / Unlock Room
                </span>
                <span className="text-[11px] text-slate-400">
                  Delegate room lock toggling to promoted co-hosts.
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowCoHostLock}
                onChange={(e) => setAllowCoHostLock(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#5FA399] focus:ring-[#5FA399]"
              />
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/30 text-xs text-rose-200 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-200 bg-white/10 hover:bg-white/15 transition-colors"
            >
              Cancel
            </button>
            <Button type="submit" variant="primary" size="sm" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
    </ModalShell>
  );
};
