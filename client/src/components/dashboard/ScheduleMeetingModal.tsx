import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Loader2,
  Check,
  Copy,
  AlertCircle,
} from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { StudioSwitch } from '@/components/ui/StudioSwitch';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { zonedDateTimeToUtc } from '@/utils/timezone';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
import { cn } from '@/lib/utils';
import {
  STUDIO_INPUT_CLASS,
  STUDIO_ALERT_DANGER_CLASS,
  STUDIO_ALERT_WARNING_CLASS,
} from '@/lib/studioTokens';
import type { IScheduledMeeting } from '@/types/scheduling';

interface ScheduleMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMeetingScheduled?: (meeting: IScheduledMeeting) => void;
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

const REMINDER_OPTIONS = [
  { minutes: 15, label: '15 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '24 hours before' },
] as const;

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

export const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({
  isOpen,
  onClose,
  onMeetingScheduled,
}) => {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const copyJoinLinkBtnRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const successFocusTimerRef = useRef<number | null>(null);

  // Form State
  const [title, setTitle] = useState('Product Collaboration Session');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('14:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timeZone, setTimeZone] = useState('UTC');
  const [inviteeInput, setInviteeInput] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [reminders, setReminders] = useState<number[]>([15, 60]);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);

  // DST Disambiguation State (DEF-16-03)
  const [dstOccurrence, setDstOccurrence] = useState<'earlier' | 'later'>('earlier');
  const [ambiguousOptions, setAmbiguousOptions] = useState<string[] | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMeeting, setSuccessMeeting] = useState<IScheduledMeeting | null>(null);
  const [copiedJoinLink, setCopiedJoinLink] = useState(false);

  useEffect(() => {
    if (isOpen) {
      let detectedTz = 'UTC';
      try {
        detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        detectedTz = 'UTC';
      }
      setTitle('Product Collaboration Session');
      setDescription('');
      setTimeZone(detectedTz);
      setDate(getDefaultTomorrowDate());
      setTime('14:00');
      setDurationMinutes(60);
      setInviteeInput('');
      setInvitees([]);
      setReminders([15, 60]);
      setWaitingRoomEnabled(false);
      setDstOccurrence('earlier');
      setAmbiguousOptions(null);
      setErrorMessage(null);
      setSuccessMeeting(null);
      setCopiedJoinLink(false);
    } else {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      if (successFocusTimerRef.current !== null) {
        window.clearTimeout(successFocusTimerRef.current);
        successFocusTimerRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      if (successFocusTimerRef.current !== null) {
        window.clearTimeout(successFocusTimerRef.current);
      }
    };
  }, []);

  const handleAddInvitee = () => {
    const trimmed = inviteeInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (!invitees.includes(trimmed)) {
      setInvitees([...invitees, trimmed]);
    }
    setInviteeInput('');
    setErrorMessage(null);
  };

  const handleRemoveInvitee = (email: string) => {
    setInvitees(invitees.filter((item) => item !== email));
  };

  const toggleReminder = (minutes: number) => {
    if (reminders.includes(minutes)) {
      setReminders(reminders.filter((m) => m !== minutes));
    } else {
      setReminders([...reminders, minutes].sort((a, b) => a - b));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage('Provide a meeting title.');
      return;
    }
    if (!date || !time) {
      setErrorMessage('Specify both a date and start time.');
      return;
    }

    try {
      setIsLoading(true);

      let parsedUtc: ReturnType<typeof zonedDateTimeToUtc>;
      try {
        parsedUtc = zonedDateTimeToUtc(date, time, timeZone, dstOccurrence);
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
          `${time} does not exist in "${timeZone}" due to a daylight saving time shift. Choose a different time.`
        );
        return;
      }

      if (parsedUtc.utcDate.getTime() < Date.now() - 60_000) {
        setErrorMessage('Scheduled time cannot be in the past.');
        return;
      }

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledStartAt: parsedUtc.isoString,
        durationMinutes: Number(durationMinutes),
        scheduledTimeZone: timeZone,
        invitees: invitees.map((email) => ({ email })),
        reminderPreferences: reminders.length > 0 ? reminders : [15],
        settings: {
          waitingRoomEnabled,
        },
      };

      const result = await schedulingApi.scheduleMeeting(payload);
      setSuccessMeeting(result.meeting);
      onMeetingScheduled?.(result.meeting);

      if (successFocusTimerRef.current !== null) {
        window.clearTimeout(successFocusTimerRef.current);
      }
      successFocusTimerRef.current = window.setTimeout(() => {
        successFocusTimerRef.current = null;
        copyJoinLinkBtnRef.current?.focus();
      }, 0);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to schedule meeting. Try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyJoinLink = async () => {
    if (!successMeeting) return;
    try {
      await navigator.clipboard.writeText(
        buildMeetingJoinUrl(successMeeting.meetingCode, successMeeting.joinUrl)
      );
      setCopiedJoinLink(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopiedJoinLink(false);
      }, 2000);
    } catch {
      setCopiedJoinLink(false);
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
      isOpen={isOpen}
      onClose={onClose}
      title={successMeeting ? 'Meeting Scheduled' : 'Schedule Meeting'}
      titleId="schedule-modal-title"
      icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
      size="md"
      className="max-w-xl"
      closeLabel="Close scheduling modal"
      disableClose={isLoading}
      initialFocusRef={titleInputRef}
    >
      {successMeeting ? (
        <div className="text-center py-3 space-y-4">
          <div className="w-12 h-12 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mx-auto">
            <Check className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-[#1F2428] dark:text-[#EAECEE]">
              Created Link Ready
            </h3>
            <p className="text-xs text-[#555D66] dark:text-[#A3AAB2] max-w-md mx-auto leading-relaxed">
              &ldquo;{successMeeting.title}&rdquo; is scheduled with invitations and reminders ready.
            </p>
          </div>

          <div className="p-4 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2A2F37] rounded-xl text-left max-w-md mx-auto space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#555D66] dark:text-[#A3AAB2]">Meeting Code</span>
              <code className="text-[#2F6F68] dark:text-[#5FA399] font-mono font-bold">
                {successMeeting.meetingCode}
              </code>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#555D66] dark:text-[#A3AAB2]">Scheduled Time</span>
              <span className="text-[#1F2428] dark:text-[#EAECEE] text-right">
                {new Date(successMeeting.scheduledStartAt || '').toLocaleString([], {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                ({successMeeting.scheduledTimeZone})
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#555D66] dark:text-[#A3AAB2]">Duration</span>
              <span className="text-[#1F2428] dark:text-[#EAECEE]">
                {successMeeting.durationMinutes} minutes
              </span>
            </div>
            <div className="pt-2 border-t border-[#DDDAD0] dark:border-[#2A2F37] break-all">
              <span className="font-semibold text-[#555D66] dark:text-[#A3AAB2] block mb-0.5">
                Join Link
              </span>
              <span className="font-mono text-[11px] text-[#2F6F68] dark:text-[#5FA399]">
                {buildMeetingJoinUrl(successMeeting.meetingCode, successMeeting.joinUrl)}
              </span>
            </div>
          </div>

          <div className="flex justify-center gap-3 pt-1">
            <Button
              ref={copyJoinLinkBtnRef}
              type="button"
              variant="primary"
              size="sm"
              onClick={handleCopyJoinLink}
              leftIcon={
                copiedJoinLink ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )
              }
            >
              {copiedJoinLink ? 'Copied Join Link' : 'Copy Join Link'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
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

          {/* Title Input */}
          <div>
            <label
              htmlFor="schedule-title"
              className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
            >
              Meeting Title *
            </label>
            <input
              ref={titleInputRef}
              id="schedule-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              placeholder="e.g. Architecture Sync"
              className={STUDIO_INPUT_CLASS}
            />
          </div>

          {/* Description Input */}
          <div>
            <label
              htmlFor="schedule-description"
              className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
            >
              Agenda <span className="font-normal text-[#555D66] dark:text-[#A3AAB2]">(Optional)</span>
            </label>
            <textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Notes or topics for participants..."
              className={cn(STUDIO_INPUT_CLASS, 'h-auto py-2 text-xs resize-y')}
            />
          </div>

          {/* Date & Time Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="schedule-date"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Date *
              </label>
              <input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setAmbiguousOptions(null);
                }}
                required
                className={PICKER_INPUT_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor="schedule-time"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Start Time *
              </label>
              <input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setAmbiguousOptions(null);
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
                    <strong>{time}</strong> occurs twice on {date} in <strong>{timeZone}</strong>.
                    Choose which occurrence to schedule:
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
                htmlFor="schedule-duration"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Duration
              </label>
              <select
                id="schedule-duration"
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
                <option value={180}>3 hours</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="schedule-timezone"
                className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
              >
                Time Zone
              </label>
              <select
                id="schedule-timezone"
                value={timeZone}
                onChange={(e) => {
                  setTimeZone(e.target.value);
                  setAmbiguousOptions(null);
                }}
                className={PICKER_INPUT_CLASS}
              >
                {!COMMON_TIMEZONES.includes(timeZone) && (
                  <option value={timeZone}>{timeZone} (Local)</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Invitee Emails */}
          <div>
            <label
              htmlFor="schedule-invitee-email"
              className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
            >
              Invite Participants
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="schedule-invitee-email"
                type="email"
                value={inviteeInput}
                onChange={(e) => setInviteeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddInvitee();
                  }
                }}
                placeholder="teammate@company.com"
                className={cn(STUDIO_INPUT_CLASS, 'flex-1')}
              />
              <Button type="button" variant="outline" size="md" onClick={handleAddInvitee}>
                Add
              </Button>
            </div>

            {invitees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-[#F3F2EE] dark:bg-[#141619] rounded-xl border border-[#DDDAD0] dark:border-[#2A2F37]">
                {invitees.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2A2F37] text-[11px] font-medium text-[#1F2428] dark:text-[#EAECEE]"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveInvitee(email)}
                      aria-label={`Remove ${email}`}
                      className="text-[#555D66] dark:text-[#A3AAB2] hover:text-[#C24D4D] dark:hover:text-[#D46A6A] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Reminder Preferences */}
          <div>
            <span className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5">
              Reminders
            </span>
            <div className="flex flex-wrap gap-4 text-xs text-[#1F2428] dark:text-[#EAECEE]">
              {REMINDER_OPTIONS.map((opt) => (
                <label key={opt.minutes} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reminders.includes(opt.minutes)}
                    onChange={() => toggleReminder(opt.minutes)}
                    className="w-4 h-4 rounded border-[#DDDAD0] dark:border-[#2A2F37] bg-white dark:bg-[#141619] accent-[#2F6F68] dark:accent-[#5FA399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Waiting Room Security */}
          <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2A2F37]">
            <StudioSwitch
              id="schedule-waiting-room"
              mode="switch"
              checked={waitingRoomEnabled}
              onChange={setWaitingRoomEnabled}
              label="Waiting Room"
              description="Approve participants before entry"
            />
          </div>

          {/* Submit Buttons */}
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
              {isLoading ? 'Scheduling...' : 'Schedule Meeting'}
            </Button>
          </div>
        </form>
      )}
    </ModalShell>
  );
};
