import React, { useState, useEffect, useRef } from 'react';
import { Calendar, AlertCircle, Loader2 } from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { zonedDateTimeToUtc } from '@/utils/timezone';
import { cn } from '@/lib/utils';
import {
  STUDIO_INPUT_CLASS,
  STUDIO_ALERT_DANGER_CLASS,
  STUDIO_ALERT_WARNING_CLASS,
} from '@/lib/studioTokens';
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

const PICKER_INPUT_CLASS = cn(
  STUDIO_INPUT_CLASS,
  'bg-white dark:bg-[#141619] text-[#1F2428] dark:text-[#EDEFF2] border-[#DDDAD0] dark:border-[#2A2F37] [color-scheme:light] dark:[color-scheme:dark]'
);

function getDefaultTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  isOpen,
  onClose,
  meeting,
  onRescheduled,
}) => {
  const dateInputRef = useRef<HTMLInputElement>(null);
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
      setTimeZone(meeting.scheduledTimeZone || 'UTC');
      setDurationMinutes(meeting.durationMinutes || 60);
      setNewDate(getDefaultTomorrowDate());
      setNewTime('14:00');
      setErrorMessage(null);
      setAmbiguousOptions(null);
      setDstOccurrence('earlier');
    }
  }, [isOpen, meeting]);

  const previousDateFormatted = meeting?.scheduledStartAt
    ? new Date(meeting.scheduledStartAt).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Not set';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meeting) return;
    setErrorMessage(null);

    if (!newDate || !newTime) {
      setErrorMessage('Provide both a date and time.');
      return;
    }

    try {
      setIsLoading(true);

      let parsedUtc: ReturnType<typeof zonedDateTimeToUtc>;
      try {
        parsedUtc = zonedDateTimeToUtc(newDate, newTime, timeZone, dstOccurrence);
      } catch {
        setErrorMessage('Invalid date or time value.');
        return;
      }

      if (parsedUtc.isAmbiguous && !ambiguousOptions) {
        setAmbiguousOptions(parsedUtc.ambiguousInstants || []);
        return;
      }

      if (!parsedUtc.isExact) {
        setErrorMessage(
          `${newTime} does not exist in "${timeZone}" due to a daylight saving time shift. Choose a different time.`
        );
        return;
      }

      if (parsedUtc.utcDate.getTime() < Date.now() - 60_000) {
        setErrorMessage('Cannot reschedule a meeting to a past time.');
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

  const dstOptions = ambiguousOptions
    ? ([
        {
          key: 'earlier',
          label: 'First occurrence',
          tzName: 'Daylight Time',
          utcTime: ambiguousOptions[0]?.slice(11, 16),
        },
        {
          key: 'later',
          label: 'Second occurrence',
          tzName: 'Standard Time',
          utcTime: ambiguousOptions[1]?.slice(11, 16),
        },
      ] as const)
    : [];

  return (
    <ModalShell
      isOpen={Boolean(isOpen && meeting)}
      onClose={onClose}
      title="Reschedule Meeting"
      titleId="reschedule-meeting-title"
      icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
      size="sm"
      className="max-w-md"
      closeLabel="Close reschedule dialog"
      disableClose={isLoading}
      initialFocusRef={dateInputRef}
    >
      {meeting && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMessage && (
            <div
              role="alert"
              className={cn('p-3 text-xs flex items-start gap-2', STUDIO_ALERT_DANGER_CLASS)}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Current Schedule Summary */}
          <div className="p-3.5 bg-[#F3F2EE] dark:bg-[#141619] rounded-xl border border-[#DDDAD0] dark:border-[#2A2F37] text-xs space-y-0.5">
            <span className="font-semibold text-[#555D66] dark:text-[#A3AAB2] block uppercase text-[10px] tracking-wider">
              Current Schedule
            </span>
            <p className="font-bold text-[#1F2428] dark:text-[#EAECEE]">{meeting.title}</p>
            <p className="text-[#555D66] dark:text-[#A3AAB2]">
              {previousDateFormatted} ({meeting.scheduledTimeZone || 'UTC'})
            </p>
          </div>

          {/* New Date and Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="reschedule-date"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                New Date *
              </label>
              <input
                ref={dateInputRef}
                id="reschedule-date"
                type="date"
                value={newDate}
                onChange={(e) => {
                  setNewDate(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                required
                className={PICKER_INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="reschedule-time"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                New Time *
              </label>
              <input
                id="reschedule-time"
                type="time"
                value={newTime}
                onChange={(e) => {
                  setNewTime(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                required
                className={PICKER_INPUT_CLASS}
              />
            </div>
          </div>

          {/* Ambiguous Daylight Saving Time Selection Notice (DEF-16-03) */}
          {ambiguousOptions && (
            <div
              role="region"
              aria-label="Daylight saving time occurrence"
              className={cn('p-3.5 text-xs space-y-2.5', STUDIO_ALERT_WARNING_CLASS)}
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">Daylight Saving Time Overlap</p>
                  <p className="mt-0.5 leading-relaxed opacity-90">
                    <strong>{newTime}</strong> occurs twice on {newDate} in{' '}
                    <strong>{timeZone}</strong>. Choose which occurrence to schedule:
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-6">
                {dstOptions.map((opt) => {
                  const selected = dstOccurrence === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setDstOccurrence(opt.key)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
                        selected
                          ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] border-[#2F6F68] dark:border-[#5FA399]'
                          : 'bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] border-[#DDDAD0] dark:border-[#2A2F37] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E]'
                      )}
                    >
                      {opt.label} ({opt.tzName} / {opt.utcTime} UTC)
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Duration & Time Zone Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="reschedule-duration"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Duration
              </label>
              <select
                id="reschedule-duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className={PICKER_INPUT_CLASS}
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
              <label
                htmlFor="reschedule-timezone"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Time Zone
              </label>
              <select
                id="reschedule-timezone"
                value={timeZone}
                onChange={(e) => {
                  setTimeZone(e.target.value);
                  setAmbiguousOptions(null);
                  setErrorMessage(null);
                }}
                className={PICKER_INPUT_CLASS}
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

          <div className="flex justify-end gap-2.5 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isLoading}
              leftIcon={
                isLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined
              }
            >
              {isLoading ? 'Rescheduling...' : 'Confirm New Time'}
            </Button>
          </div>
        </form>
      )}
    </ModalShell>
  );
};
