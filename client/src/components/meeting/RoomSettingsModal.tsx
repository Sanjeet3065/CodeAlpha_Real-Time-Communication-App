import React, { useState, useEffect, useRef } from 'react';
import { X, Settings, Shield, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
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
  const dialogRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!isOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => titleInputRef.current?.focus(), 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prevFocus?.focus?.();
    };
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-[#253746] border border-white/15 shadow-2xl overflow-hidden text-white max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#168B83]/20 text-[#7CE5DB] flex items-center justify-center">
              <Settings className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="room-settings-title" className="font-display text-base font-bold text-white">
              Host Room Settings
            </h2>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Close room settings"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
              className="w-full px-3.5 py-2 rounded-xl bg-[#101820] border border-white/15 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#168B83]"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#101820]/70 border border-white/10 space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7CE5DB]">
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
                className="mt-1 w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83]"
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
                className="mt-1 w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83]"
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
                className="mt-1 w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83]"
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
                className="mt-1 w-4 h-4 rounded text-[#168B83] focus:ring-[#168B83]"
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
      </div>
    </div>
  );
};
