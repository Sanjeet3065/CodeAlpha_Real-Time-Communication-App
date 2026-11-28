import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { cn } from '@/lib/utils';
import { STUDIO_ALERT_DANGER_CLASS } from '@/lib/studioTokens';
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
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setErrorMessage(null);
    }
  }, [isOpen, meeting?.id]);

  const handleConfirmCancel = async () => {
    if (!meeting) return;
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
    <ModalShell
      variant="danger"
      isOpen={Boolean(isOpen && meeting)}
      onClose={onClose}
      title="Cancel Meeting"
      titleId="cancel-meeting-title"
      icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
      size="sm"
      className="max-w-md"
      closeLabel="Close cancellation dialog"
      disableClose={isLoading}
      initialFocusRef={keepButtonRef}
    >
      {meeting && (
        <div className="space-y-4">
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className={cn('p-3 text-xs', STUDIO_ALERT_DANGER_CLASS)}
            >
              {errorMessage}
            </div>
          )}

          <div className={cn('p-3.5 text-xs leading-relaxed', STUDIO_ALERT_DANGER_CLASS)}>
            Cancel <strong>&ldquo;{meeting.title}&rdquo;</strong>? Invited participants will be
            notified and this room will close. Past records stay preserved.
          </div>

          <div>
            <label
              htmlFor="cancel-reason-input"
              className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
            >
              Reason <span className="font-normal text-[#555D66] dark:text-[#A3AAB2]">(Optional)</span>
            </label>
            <textarea
              id="cancel-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={240}
              rows={2}
              placeholder="Optional note for participants..."
              className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2A2F37] text-[#1F2428] dark:text-[#EDEFF2] placeholder:text-[#636B74] dark:placeholder:text-[#8A929B] focus:outline-none focus:ring-2 focus:ring-[#C24D4D]/40 dark:focus:ring-[#D46A6A]/40 focus:border-[#C24D4D] dark:focus:border-[#D46A6A] transition-colors"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-1">
            <Button
              ref={keepButtonRef}
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
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancel}
              disabled={isLoading}
              className="min-h-[44px]"
              leftIcon={
                isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : undefined
              }
            >
              {isLoading ? 'Cancelling...' : 'Cancel Meeting'}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};
