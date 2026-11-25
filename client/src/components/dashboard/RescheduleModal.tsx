import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { zonedDateTimeToUtc } from '@/utils/timezone';
import type { IScheduledMeeting } from '@/types/scheduling';

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IScheduledMeeting | null;
  onRescheduled?: (meeting: IScheduledMeeting) => void;
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  isOpen,
  onClose,
  meeting,
  onRescheduled,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('14:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timeZone, setTimeZone] = useState('UTC');
  const [dstOccurrence, setDstOccurrence] = useState<'earlier' | 'later'>('earlier');
  const [ambiguousOptions, setAmbiguousOptions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && meeting) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      setTimeZone(meeting.scheduledTimeZone || 'UTC');
      setDurationMinutes(meeting.durationMinutes || 60);

      // Default date to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getDate()).padStart(2, '0');
      setNewDate(`${yyyy}-${mm}-${dd}`);
      setErrorMessage(null);
      setAmbiguousOptions(null);
      setDstOccurrence('earlier');

      const timer = setTimeout(() => {
        const firstInput = modalRef.current?.querySelector<HTMLInputElement>('input[type="date"]');
        firstInput?.focus();
      }, 40);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen, meeting]);

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

  const previousDateFormatted = meeting.scheduledStartAt
    ? new Date(meeting.scheduledStartAt).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Not set';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!newDate || !newTime) {
      setErrorMessage('Please provide both date and time.');
      return;
    }

    try {
      setIsLoading(true);

      // Construct UTC ISO string using date, time, and target timeZone without local browser bias (DEF-16-03)
      let parsedUtc: ReturnType<typeof zonedDateTimeToUtc>;
      try {
        parsedUtc = zonedDateTimeToUtc(newDate, newTime, timeZone, dstOccurrence);
      } catch {
        setErrorMessage('Invalid date or time value.');
        setIsLoading(false);
        return;
      }

      if (parsedUtc.isAmbiguous && !ambiguousOptions) {
        setAmbiguousOptions(parsedUtc.ambiguousInstants || []);
        setIsLoading(false);
        return;
      }

      if (!parsedUtc.isExact) {
        setErrorMessage(
          `The selected time does not exist in time zone "${timeZone}" due to a daylight saving time transition. Please choose a different time.`
        );
        setIsLoading(false);
        return;
      }

      if (parsedUtc.utcDate.getTime() < Date.now() - 60_000) {
        setErrorMessage('Cannot reschedule a meeting to a past time.');
        setIsLoading(false);
        return;
      }

      const res = await schedulingApi.rescheduleMeeting(meeting.id, {
        scheduledStartAt: parsedUtc.isoString,
        durationMinutes: Number(durationMinutes),
        scheduledTimeZone: timeZone,
      });

      onRescheduled?.(res.meeting);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to reschedule meeting.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-meeting-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B3A]/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E3E1D9] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E1D9] bg-[#F7F6F2]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#DCEDE8] text-[#168B83] flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h2 id="reschedule-meeting-title" className="font-display text-base font-bold text-[#172B3A]">
              Reschedule Meeting
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reschedule dialog"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Current Schedule Summary */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E3E1D9] text-xs">
            <span className="font-bold text-[#6B8092] block uppercase text-[10px] tracking-wider mb-0.5">
              Current Schedule
            </span>
            <p className="font-bold text-[#172B3A]">{meeting.title}</p>
            <p className="text-[#6B8092]">
              {previousDateFormatted} ({meeting.scheduledTimeZone || 'UTC'})
            </p>
          </div>

          {/* New Date and Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#172B3A] mb-1">
                New Date *
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => {
                  setNewDate(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                required
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#E3E1D9] focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#172B3A] mb-1">
                New Time *
              </label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => {
                  setNewTime(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                required
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#E3E1D9] focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
              />
            </div>
          </div>

          {/* Ambiguous Daylight Saving Time Selection Notice (DEF-16-03) */}
          {ambiguousOptions && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Daylight Saving Time Transition Notice</p>
                  <p className="mt-0.5 text-amber-800 leading-relaxed">
                    The wall-clock time <strong>{newTime}</strong> occurs twice on {newDate} in{' '}
                    <strong>{timeZone}</strong> because clocks fall back 1 hour. Please choose which
                    occurrence you want:
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 pl-6">
                <button
                  type="button"
                  onClick={() => setDstOccurrence('earlier')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    dstOccurrence === 'earlier'
                      ? 'bg-[#168B83] text-white border-[#168B83] shadow-sm'
                      : 'bg-white text-[#172B3A] border-[#E3E1D9] hover:bg-gray-50'
                  }`}
                >
                  First occurrence (Daylight Time / {ambiguousOptions[0]?.slice(11, 16)} UTC)
                </button>
                <button
                  type="button"
                  onClick={() => setDstOccurrence('later')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    dstOccurrence === 'later'
                      ? 'bg-[#168B83] text-white border-[#168B83] shadow-sm'
                      : 'bg-white text-[#172B3A] border-[#E3E1D9] hover:bg-gray-50'
                  }`}
                >
                  Second occurrence (Standard Time / {ambiguousOptions[1]?.slice(11, 16)} UTC)
                </button>
              </div>
            </div>
          )}

          {/* Duration & Time Zone Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#172B3A] mb-1">
                Duration
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#E3E1D9] bg-white focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#172B3A] mb-1">
                Time Zone (IANA)
              </label>
              <select
                value={timeZone}
                onChange={(e) => {
                  setTimeZone(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#E3E1D9] bg-white focus:outline-none focus:ring-2 focus:ring-[#168B83]/30 text-[#172B3A]"
              >
                {!COMMON_TIMEZONES.includes(timeZone) && (
                  <option value={timeZone}>{timeZone} (Original)</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isLoading}
              leftIcon={isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
            >
              {isLoading ? 'Rescheduling...' : 'Confirm New Time'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
