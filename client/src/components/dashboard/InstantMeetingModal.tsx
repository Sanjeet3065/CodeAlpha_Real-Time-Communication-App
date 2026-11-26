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
}

export const InstantMeetingModal: React.FC<InstantMeetingModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [title, setTitle] = useState('');
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState(60);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMeeting, setCreatedMeeting] = useState<MeetingSummary | null>(null);
  const [copiedField, setCopiedField] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setTitle('');
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
  }, [isOpen]);

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
      // Fallback copy if clipboard API unavailable
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
        setError('Unable to create meeting right now. Please try again.');
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141619]/65 animate-in fade-in duration-150"
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
            <h2 id="instant-meeting-title" className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]">
              {createdMeeting ? 'Meeting Room Ready' : 'Start Instant Meeting'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instant meeting modal"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
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
                  Meeting Title <span className="font-normal text-[#7C848D] dark:text-[#A3AAB2]">(Optional)</span>
                </label>
                <input
                  ref={titleInputRef}
                  id="instant-meeting-name"
                  type="text"
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Product Architecture Sync"
                  className="w-full px-3.5 py-2.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder-[#7C848D] dark:placeholder-[#747C86]/70 focus:outline-none focus:bg-[#FAF9F6] dark:focus:bg-[#1C1F24] focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399] transition-all"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label
                      htmlFor="instant-waiting-room"
                      className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] cursor-pointer flex items-center gap-1.5"
                    >
                      <Shield className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                      <span>Enable Waiting Room</span>
                    </label>
                    <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] mt-0.5 leading-relaxed">
                      Require host or co-host approval before participants can enter the room.
                    </p>
                  </div>
                  <input
                    id="instant-waiting-room"
                    type="checkbox"
                    checked={waitingRoomEnabled}
                    onChange={(e) => setWaitingRoomEnabled(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-[#2F6F68] dark:text-[#5FA399] focus:ring-[#2F6F68] dark:focus:ring-[#5FA399] border-[#DDDAD0] dark:border-[#2B3038] cursor-pointer"
                  />
                </div>

                <div className="pt-2.5 border-t border-[#DDDAD0] dark:border-[#2B3038] flex items-center justify-between gap-3">
                  <label
                    htmlFor="instant-max-participants"
                    className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                    <span>Room Capacity</span>
                  </label>
                  <select
                    id="instant-max-participants"
                    value={maxParticipants}
                    onChange={(e) => setMaxParticipants(Number(e.target.value))}
                    className="px-2.5 py-1.5 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-lg text-xs font-medium text-[#1F2428] dark:text-[#EAECEE] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]"
                  >
                    <option value={10}>Up to 10 participants</option>
                    <option value={25}>Up to 25 participants</option>
                    <option value={60}>Up to 60 participants (Default)</option>
                  </select>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
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
                  {isCreating ? 'Creating Room...' : 'Create Meeting Room'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#E2ECE9]/60 dark:bg-[#1F302E]/60 border border-[#2F6F68]/25 dark:border-[#5FA399]/25 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2F6F68] dark:text-[#5FA399]">
                  Room Created — You Are Host
                </p>
                <h3 className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE] break-words">
                  {createdMeeting.title}
                </h3>
                <p className="text-xs text-[#555D66] dark:text-[#A3AAB2]">
                  {createdMeeting.settings.waitingRoomEnabled
                    ? 'Waiting room admission enabled'
                    : 'Direct admission enabled'}{' '}
                  · Capacity: {createdMeeting.maxParticipants}
                </p>
              </div>

              {/* Meeting Code */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold text-[#7C848D] dark:text-[#A3AAB2] uppercase tracking-wider">
                  Meeting Code
                </span>
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
                      <span className="flex items-center gap-1 text-emerald-700">
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Invitation Link */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold text-[#7C848D] dark:text-[#A3AAB2] uppercase tracking-wider">
                  Shareable Invitation Link
                </span>
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
                      <span className="flex items-center gap-1 text-emerald-700">
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

              <div className="flex items-center justify-end gap-2 pt-2">
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
                  Enter Pre-Join Lobby
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
