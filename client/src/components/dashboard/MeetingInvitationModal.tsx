import React, { useState, useEffect, useRef } from 'react';
import { X, Mail, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import type { IMeetingInvitation } from '@/types/scheduling';

interface MeetingInvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingCode: string | null;
}

export const MeetingInvitationModal: React.FC<MeetingInvitationModalProps> = ({
  isOpen,
  onClose,
  meetingCode,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [invitation, setInvitation] = useState<IMeetingInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        const copyBtn = modalRef.current?.querySelector<HTMLButtonElement>('button[data-copy="true"]');
        copyBtn?.focus();
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

  useEffect(() => {
    if (isOpen && meetingCode) {
      setIsLoading(true);
      setIsCopied(false);
      setIsLinkCopied(false);
      schedulingApi
        .getMeetingInvitation(meetingCode)
        .then((data) => setInvitation(data))
        .catch(() => setInvitation(null))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, meetingCode]);

  if (!isOpen || !meetingCode) return null;

  const handleCopy = () => {
    if (!invitation) return;
    navigator.clipboard.writeText(invitation.invitationText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleCopyLinkOnly = () => {
    if (!invitation) return;
    navigator.clipboard.writeText(invitation.joinUrl);
    setIsLinkCopied(true);
    setTimeout(() => setIsLinkCopied(false), 2500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-invitation-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B3A]/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[#E3E1D9] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E1D9] bg-[#F7F6F2]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#DCEDE8] text-[#168B83] flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
            <h2 id="meeting-invitation-title" className="font-display text-base font-bold text-[#172B3A]">
              Meeting Invitation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close meeting invitation"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-[#168B83]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2">
              <Loader2 className="w-6 h-6 text-[#168B83] animate-spin" />
              <p className="text-xs text-[#6B8092]">Generating secure invitation...</p>
            </div>
          ) : invitation ? (
            <div className="space-y-3">
              <p className="text-xs text-[#6B8092]">
                Copy and share this invitation with your participants via email or messaging:
              </p>

              <div
                tabIndex={0}
                aria-label="Invitation text"
                className="p-3 bg-[#F7F6F2] border border-[#E3E1D9] rounded-xl font-mono text-xs text-[#172B3A] whitespace-pre-wrap select-all max-h-56 overflow-y-auto leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#168B83]"
              >
                {invitation.invitationText}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-[11px] text-[#6B8092]">
                  Code: <strong className="text-[#172B3A]">{invitation.meetingCode}</strong>
                </span>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLinkOnly}
                    className="min-h-[44px]"
                  >
                    {isLinkCopied ? 'Link Copied!' : 'Copy Link Only'}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    data-copy="true"
                    onClick={handleCopy}
                    className="min-h-[44px]"
                    leftIcon={isCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  >
                    {isCopied ? 'Copied Invitation!' : 'Copy Invitation'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div role="alert" className="py-8 text-center text-xs text-rose-700">
              Unable to load meeting invitation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
