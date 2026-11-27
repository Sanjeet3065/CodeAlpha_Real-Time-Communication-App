import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { zonedDateTimeToUtc } from '@/utils/timezone';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
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

export const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({
  isOpen,
  onClose,
  onMeetingScheduled,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

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

  // Auto-detect local time zone & set default date to tomorrow
  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';

      const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setTimeZone(detectedTz);

      // Default date to tomorrow at 14:00
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getDate()).padStart(2, '0');
      setDate(`${yyyy}-${mm}-${dd}`);

      setErrorMessage(null);
      setSuccessMeeting(null);
      setCopiedJoinLink(false);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen]);

  // Keyboard accessibility: Escape to close & Tab trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl?.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddInvitee = () => {
    const trimmed = inviteeInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!invitees.includes(trimmed)) {
      setInvitees([...invitees, trimmed]);
    }
    setInviteeInput('');
    setErrorMessage(null);
  };

  const handleRemoveInvitee = (email: string) => {
    setInvitees(invitees.filter((e) => e !== email));
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
      setErrorMessage('Please provide a meeting title.');
      return;
    }
    if (!date || !time) {
      setErrorMessage('Please specify both a scheduled date and time.');
      return;
    }

    try {
      setIsLoading(true);

      // Construct UTC ISO string using date, time, and target timeZone without local browser bias (DEF-16-03)
      let parsedUtc: ReturnType<typeof zonedDateTimeToUtc>;
      try {
        parsedUtc = zonedDateTimeToUtc(date, time, timeZone, dstOccurrence);
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
        setErrorMessage('Scheduled time cannot be in the past.');
        setIsLoading(false);
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
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to schedule meeting. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141619]/65 animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl shadow-xl border border-[#DDDAD0] dark:border-[#2B3038] overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <h2 id="schedule-modal-title" className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]">
              Schedule Collaboration Session
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scheduling modal"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {successMeeting ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mx-auto">
                <Check className="w-6 h-6" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#1F2428] dark:text-[#EAECEE]">
                Meeting Successfully Scheduled!
              </h3>
              <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] max-w-md mx-auto leading-relaxed">
                Your collaboration session <strong>"{successMeeting.title}"</strong> has been created.
                Invitations and automated reminders are configured.
              </p>
              <div className="p-3 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl text-left max-w-md mx-auto space-y-1.5 text-xs">
                <p>
                  <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">Meeting Code: </span>
                  <code className="text-[#2F6F68] dark:text-[#5FA399] font-bold">{successMeeting.meetingCode}</code>
                </p>
                <p>
                  <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">Scheduled Time: </span>
                  <span>
                    {new Date(successMeeting.scheduledStartAt || '').toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    ({successMeeting.scheduledTimeZone})
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">Duration: </span>
                  <span>{successMeeting.durationMinutes} minutes</span>
                </p>
                <p className="break-all">
                  <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">Join Link: </span>
                  <span className="font-mono text-[11px] text-[#2F6F68]">
                    {buildMeetingJoinUrl(successMeeting.meetingCode, successMeeting.joinUrl)}
                  </span>
                </p>
              </div>

              <div className="flex justify-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      buildMeetingJoinUrl(successMeeting.meetingCode, successMeeting.joinUrl)
                    );
                    setCopiedJoinLink(true);
                    setTimeout(() => setCopiedJoinLink(false), 2000);
                  }}
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
                <div className="p-3 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#D46A6A]/40 text-xs text-[#C24D4D] dark:text-[#D46A6A] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Title Input */}
              <div>
                <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                  Meeting Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="e.g. Architecture Sync"
                  className="w-full h-10 px-3 text-xs rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                />
              </div>

              {/* Description Input */}
              <div>
                <label className="block text-xs font-medium text-[#7C848D] dark:text-[#A3AAB2] mb-1">
                  Agenda (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Optional meeting notes..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                />
              </div>

              {/* Date & Time Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                    Date *
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setAmbiguousOptions(null);
                      }}
                      required
                      className="w-full h-10 px-3 text-xs rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                    Start Time *
                  </label>
                  <div className="relative">
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => {
                        setTime(e.target.value);
                        setAmbiguousOptions(null);
                      }}
                      required
                      className="w-full h-10 px-3 text-xs rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                    />
                  </div>
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
                        The wall-clock time <strong>{time}</strong> occurs twice on {date} in{' '}
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
                          ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] border-[#2F6F68] dark:border-[#5FA399] shadow-sm'
                          : 'bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] border-[#DDDAD0] dark:border-[#2B3038] hover:bg-gray-50'
                      }`}
                    >
                      First occurrence (Daylight Time / {ambiguousOptions[0]?.slice(11, 16)} UTC)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDstOccurrence('later')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        dstOccurrence === 'later'
                          ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] border-[#2F6F68] dark:border-[#5FA399] shadow-sm'
                          : 'bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] border-[#DDDAD0] dark:border-[#2B3038] hover:bg-gray-50'
                      }`}
                    >
                      Second occurrence (Standard Time / {ambiguousOptions[1]?.slice(11, 16)} UTC)
                    </button>
                  </div>
                </div>
              )}

              {/* Duration & Time Zone Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                    Expected Duration
                  </label>
                  <select
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE] bg-[#FAF9F6] dark:bg-[#1C1F24]"
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
                  <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                    Time Zone (IANA)
                  </label>
                  <select
                    value={timeZone}
                    onChange={(e) => {
                      setTimeZone(e.target.value);
                      setAmbiguousOptions(null);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE] bg-[#FAF9F6] dark:bg-[#1C1F24]"
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
                <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                  Invite Participants
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="email"
                    value={inviteeInput}
                    onChange={(e) => setInviteeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddInvitee();
                      }
                    }}
                    placeholder="Enter teammate email and press Add"
                    className="flex-1 h-9 px-3 text-xs rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 text-[#1F2428] dark:text-[#EAECEE]"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleAddInvitee}>
                    Add
                  </Button>
                </div>

                {invitees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2 bg-[#F3F2EE] dark:bg-[#141619] rounded-xl border border-[#DDDAD0] dark:border-[#2B3038]">
                    {invitees.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-[11px] font-medium text-[#1F2428] dark:text-[#EAECEE]"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => handleRemoveInvitee(email)}
                          className="hover:text-rose-600 focus:outline-none"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Reminder Preferences */}
              <div>
                <label className="block text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] mb-1.5">
                  Notification Reminders
                </label>
                <div className="flex flex-wrap gap-4 text-xs text-[#1F2428] dark:text-[#EAECEE]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reminders.includes(15)}
                      onChange={() => toggleReminder(15)}
                      className="rounded border-[#DDDAD0] dark:border-[#2B3038] text-[#2F6F68] dark:text-[#5FA399] focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                    />
                    <span>15 minutes before</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reminders.includes(60)}
                      onChange={() => toggleReminder(60)}
                      className="rounded border-[#DDDAD0] dark:border-[#2B3038] text-[#2F6F68] dark:text-[#5FA399] focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                    />
                    <span>1 hour before</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reminders.includes(1440)}
                      onChange={() => toggleReminder(1440)}
                      className="rounded border-[#DDDAD0] dark:border-[#2B3038] text-[#2F6F68] dark:text-[#5FA399] focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                    />
                    <span>24 hours before</span>
                  </label>
                </div>
              </div>

              {/* Waiting Room Security */}
              <div className="pt-2 border-t border-[#DDDAD0] dark:border-[#2B3038]">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] block">
                      Waiting Room
                    </span>
                    <span className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2]">
                      Approve participants before entry
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={waitingRoomEnabled}
                    onChange={(e) => setWaitingRoomEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-[#DDDAD0] dark:border-[#2B3038] text-[#2F6F68] dark:text-[#5FA399] focus:ring-[#2F6F68] dark:focus:ring-[#5FA399]"
                  />
                </label>
              </div>

              {/* Submit Buttons */}
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
                  {isLoading ? 'Scheduling Session...' : 'Schedule Meeting'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
