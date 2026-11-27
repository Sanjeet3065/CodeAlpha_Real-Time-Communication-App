import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Hash,
  ArrowRight,
  ShieldCheck,
  Lock,
  Users,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { validateMeetingCode } from '@/lib/meetingCode';
import { meetingApi, getMeetingErrorMessage } from '@/services/meetingApi';
import { ApiError } from '@/services/authApi';
import type { MeetingMetadataResponse } from '@/types/meeting';

interface JoinMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCode?: string;
}

export const JoinMeetingModal: React.FC<JoinMeetingModalProps> = ({
  isOpen,
  onClose,
  initialCode = '',
}) => {
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [metadata, setMetadata] = useState<MeetingMetadataResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setCode(initialCode);
      setError(null);
      setMetadata(null);
      setIsVerifying(false);
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen, initialCode]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateMeetingCode(code);
    if (!validation.isValid) {
      setError(validation.error || 'Please enter a valid meeting code.');
      setMetadata(null);
      return;
    }

    setIsVerifying(true);
    setError(null);
    setMetadata(null);

    try {
      const result = await meetingApi.validateMeetingCode(validation.normalizedCode);
      setMetadata(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(getMeetingErrorMessage(err.code, err.message));
      } else {
        setError('Unable to reach meeting server. Please check your connection and try again.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleContinueToLobby = () => {
    if (!metadata) return;
    const normalized = metadata.meeting.meetingCode;
    onClose();
    navigate(`/join/${normalized}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-modal-title"
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
              <Hash className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="join-modal-title" className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE]">
              Join Meeting
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close join meeting dialog"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {!metadata ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="join-meeting-code-input"
                  className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
                >
                  Enter Room Code or Invitation URL
                </label>
                <input
                  ref={inputRef}
                  id="join-meeting-code-input"
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="cly-789-qwa or paste invite link"
                  aria-describedby={error ? 'join-code-error' : 'join-code-hint'}
                  aria-invalid={Boolean(error)}
                  className={`w-full px-4 py-2.5 bg-[#F3F2EE] dark:bg-[#141619] border rounded-xl font-mono text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder-[#7C848D] dark:placeholder-[#747C86]/60 focus:outline-none focus:bg-[#FAF9F6] dark:focus:bg-[#1C1F24] transition-all ${
                    error
                      ? 'border-[#C24D4D] dark:border-[#D46A6A] ring-2 ring-[#C24D4D]/20 dark:ring-[#D46A6A]/20'
                      : 'border-[#DDDAD0] dark:border-[#2B3038] focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399]'
                  }`}
                />

                {error ? (
                  <p
                    id="join-code-error"
                    role="alert"
                    className="mt-2 text-xs text-[#C24D4D] dark:text-[#D46A6A] font-medium flex items-start gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </p>
                ) : (
                  <p id="join-code-hint" className="mt-1.5 text-[11px] text-[#7C848D] dark:text-[#A3AAB2]">
                    Supports canonical codes (<span className="font-mono">cly-xxx-xxx</span>) or full invitation URLs.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isVerifying}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {isVerifying ? 'Checking Room...' : 'Find Meeting'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] bg-[#E2ECE9] dark:bg-[#1F302E] px-2 py-0.5 rounded-md">
                    {metadata.meeting.meetingCode}
                  </span>
                  <span className="text-[11px] font-semibold text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {metadata.meeting.activeParticipantCount}/{metadata.meeting.maxParticipants}
                  </span>
                </div>
                <h3 className="font-display text-base font-bold text-[#1F2428] dark:text-[#EAECEE] break-words">
                  {metadata.meeting.title}
                </h3>
                <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                  Hosted by <span className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">{metadata.meeting.hostName}</span>
                </p>
              </div>

              {!metadata.joinable ? (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-[#F6E6E6] dark:bg-[#342023] border border-[#D46A6A]/40 flex items-start gap-2.5 text-xs text-[#C24D4D] dark:text-[#D46A6A]"
                >
                  <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    {getMeetingErrorMessage(metadata.joinBlockReason || undefined)}
                  </p>
                </div>
              ) : metadata.meeting.settings.waitingRoomEnabled && !metadata.isHost ? (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Waiting room is active. Host will admit you shortly.
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 flex items-start gap-2.5 text-xs text-[#2F6F68] dark:text-[#5FA399]">
                  <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Room verified and ready to join.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMetadata(null);
                    setError(null);
                  }}
                >
                  Try Another Code
                </Button>
                {metadata.joinable && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleContinueToLobby}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    Continue to Lobby
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
