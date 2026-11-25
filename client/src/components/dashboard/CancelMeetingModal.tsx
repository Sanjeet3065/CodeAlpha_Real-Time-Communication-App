import React, { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import type { IScheduledMeeting } from '@/types/scheduling';

interface CancelMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IScheduledMeeting | null;
  onCancelled?: (meeting: IScheduledMeeting) => void;
}

export const CancelMeetingModal: React.FC<CancelMeetingModalProps> = ({
  isOpen,
  onClose,
  meeting,
  onCancelled,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        const keepBtn = modalRef.current?.querySelector<HTMLButtonElement>('button[data-keep="true"]');
        keepBtn?.focus();
      }, 40);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen || !meeting) return null;

  const handleConfirmCancel = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await schedulingApi.cancelScheduledMeeting(meeting.id, reason.trim() || undefined);
      onCancelled?.(res.meeting);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to cancel meeting.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-meeting-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B3A]/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E3E1D9] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E1D9] bg-rose-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h2 id="cancel-meeting-title" className="font-display text-base font-bold text-rose-950">
              Cancel Scheduled Session
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cancellation dialog"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {errorMessage}
            </div>
          )}

          <p className="text-xs text-[#6B8092] leading-relaxed">
            Are you sure you want to cancel <strong>"{meeting.title}"</strong>?
            All invited participants will be notified and this room will no longer be joinable.
            Historical records will remain preserved.
          </p>

          <div>
            <label htmlFor="cancel-reason-input" className="block text-xs font-medium text-[#172B3A] mb-1">
              Cancellation Reason (Optional)
            </label>
            <textarea
              id="cancel-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={240}
              rows={2}
              placeholder="e.g. Rescheduling for next sprint, project milestone met early"
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#E3E1D9] focus:outline-none focus:ring-2 focus:ring-rose-500/30 text-[#172B3A]"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-keep="true"
              onClick={onClose}
              disabled={isLoading}
              className="min-h-[44px]"
            >
              Keep Meeting
            </Button>
            <button
              type="button"
              onClick={handleConfirmCancel}
              disabled={isLoading}
              className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors focus:ring-2 focus:ring-rose-500/40 disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isLoading ? 'Cancelling...' : 'Confirm Cancellation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
