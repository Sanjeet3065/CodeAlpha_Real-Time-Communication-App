import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Zap,
  Copy,
  Check,
  ArrowRight,
  Shield,
  Users,
  Link as LinkIcon,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { meetingApi, getMeetingErrorMessage } from '@/services/meetingApi';
import { ApiError } from '@/services/authApi';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
import type { MeetingSummary } from '@/types/meeting';

interface InstantMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTitle?: string;
}

const CAPACITY_OPTIONS = [10, 25, 60] as const;

export const InstantMeetingModal: React.FC<InstantMeetingModalProps> = ({
  isOpen,
  onClose,
  initialTitle = '',
}) => {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [title, setTitle] = useState(initialTitle);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState<number>(60);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMeeting, setCreatedMeeting] = useState<MeetingSummary | null>(null);
  const [copiedField, setCopiedField] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setTitle(initialTitle);
      setWaitingRoomEnabled(false);
      setMaxParticipants(60);
      setError(null);
      setCreatedMeeting(null);
      setCopiedField(null);
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen, initialTitle]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstEl = focusableElements[0];
        const lastEl = focusableElements[focusableElements.length - 1];

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

  if (!isOpen) return null;

  const getInvitationLink = (meeting: MeetingSummary): string => {
    return buildMeetingJoinUrl(meeting.meetingCode, meeting.joinUrl);
  };

  const handleCopy = async (text: string, field: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2500);
    } catch {
      setCopiedField(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const { meeting } = await meetingApi.createMeeting({
        ...(title.trim() ? { title: title.trim() } : {}),
        maxParticipants,
        settings: {
          waitingRoomEnabled,
        },
      });
      setCreatedMeeting(meeting);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(getMeetingErrorMessage(err.code, err.message));
      } else {
        setError('Unable to create room right now. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleEnterRoom = () => {
    if (!createdMeeting) return;
    const code = createdMeeting.meetingCode;
    onClose();
    navigate(`/join/${code}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="instant-meeting-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141619]/70 animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl shadow-xl border border-[#DDDAD0] dark:border-[#2B3038] overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center">
              <Zap className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2
              id="instant-meeting-title"
              className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]"
            >
              {createdMeeting ? 'Room Ready' : 'New Instant Meeting'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instant meeting modal"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {!createdMeeting ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label
                  htmlFor="instant-meeting-name"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  Meeting Name{' '}
                  <span className="font-normal text-[#7C848D] dark:text-[#8E96A0]">(Optional)</span>
                </label>
                <input
                  ref={titleInputRef}
                  id="instant-meeting-name"
                  type="text"
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Weekly Design Review"
                  className="w-full h-10 px-3.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder-[#7C848D] dark:placeholder-[#747C86] focus:outline-none focus:bg-[#FAF9F6] dark:focus:bg-[#1C1F24] focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399] transition-all"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-3.5">
                {/* Waiting Room Toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                      <span>Waiting Room</span>
                    </span>
                    <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0] mt-0.5">
                      Approve guests before entry
                    </p>
                  </div>

                  <button
                    id="instant-waiting-room"
                    type="button"
                    role="switch"
                    aria-checked={waitingRoomEnabled}
                    aria-label="Waiting Room"
                    onClick={() => setWaitingRoomEnabled((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 ${
                      waitingRoomEnabled
                        ? 'bg-[#2F6F68] dark:bg-[#5FA399] border-transparent'
                        : 'bg-[#DDDAD0] dark:bg-[#2B3038] border-transparent'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-[#FAF9F6] dark:bg-[#141619] transition-transform ${
                        waitingRoomEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Room Capacity Segmented Pills */}
                <div className="pt-3 border-t border-[#DDDAD0] dark:border-[#2B3038] flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                    <span>Capacity</span>
                  </span>

                  <div className="inline-flex rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-0.5">
                    {CAPACITY_OPTIONS.map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => setMaxParticipants(cap)}
                        aria-pressed={maxParticipants === cap}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                          maxParticipants === cap
                            ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
                            : 'text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
                        }`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#D46A6A]/40 flex items-start gap-2 text-xs text-[#C24D4D] dark:text-[#D46A6A]"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isCreating}
                  data-primary="true"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {isCreating ? 'Creating...' : 'Create Room'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#E2ECE9]/60 dark:bg-[#1F302E]/60 border border-[#2F6F68]/25 dark:border-[#5FA399]/25">
                <h3 className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE] break-words">
                  {createdMeeting.title}
                </h3>
                <p className="text-xs text-[#555D66] dark:text-[#A3AAB2] mt-1">
                  {createdMeeting.settings.waitingRoomEnabled ? 'Waiting room on' : 'Open entry'} · Up to {createdMeeting.maxParticipants} participants
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3.5 py-2.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl font-mono text-sm font-semibold text-[#1F2428] dark:text-[#EAECEE] tracking-wider">
                    {createdMeeting.meetingCode}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(createdMeeting.meetingCode, 'code')}
                    aria-label="Copy meeting code"
                  >
                    {copiedField === 'code' ? (
                      <span className="flex items-center gap-1 text-[#2F6F68] dark:text-[#5FA399]">
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" />
                        Code
                      </span>
                    )}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 px-3 py-2.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl flex items-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5 text-[#7C848D] dark:text-[#A3AAB2] flex-shrink-0" />
                    <span className="font-mono text-xs text-[#1F2428] dark:text-[#EAECEE] truncate">
                      {getInvitationLink(createdMeeting)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(getInvitationLink(createdMeeting), 'link')}
                    aria-label="Copy invitation link"
                  >
                    {copiedField === 'link' ? (
                      <span className="flex items-center gap-1 text-[#2F6F68] dark:text-[#5FA399]">
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" />
                        Link
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleEnterRoom}
                  data-primary="true"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Join Lobby
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
