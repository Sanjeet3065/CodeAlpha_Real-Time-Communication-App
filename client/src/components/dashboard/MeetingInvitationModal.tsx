import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Copy, Check, Loader2, ArrowRight, Link as LinkIcon } from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { normalizeInvitationUrls } from '@/lib/meetingLink';
import { cn } from '@/lib/utils';
import { STUDIO_ALERT_DANGER_CLASS } from '@/lib/studioTokens';
import type { IMeetingInvitation } from '@/types/scheduling';

interface MeetingInvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingCode: string | null;
}

type CopiedField = 'link' | 'code' | 'invitation' | null;

export const MeetingInvitationModal: React.FC<MeetingInvitationModalProps> = ({
  isOpen,
  onClose,
  meetingCode,
}) => {
  const navigate = useNavigate();
  const copyTimerRef = useRef<number | null>(null);
  const [invitation, setInvitation] = useState<IMeetingInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<CopiedField>(null);

  useEffect(() => {
    if (!isOpen || !meetingCode) {
      setInvitation(null);
      setCopiedField(null);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setInvitation(null);
    setCopiedField(null);

    schedulingApi
      .getMeetingInvitation(meetingCode)
      .then((data) => {
        if (!cancelled) {
          setInvitation(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInvitation(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, meetingCode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const liveInvitation = invitation
    ? normalizeInvitationUrls(
        invitation.invitationText,
        invitation.joinUrl,
        invitation.meetingCode
      )
    : null;

  const handleCopyValue = async (text: string, field: Exclude<CopiedField, null>) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2500);
    } catch {
      setCopiedField(null);
    }
  };

  const handleOpenRoom = () => {
    const code = (invitation?.meetingCode || meetingCode || '').trim();
    if (!code) return;
    onClose();
    navigate(`/join/${code}`);
  };

  return (
    <ModalShell
      isOpen={Boolean(isOpen && meetingCode)}
      onClose={onClose}
      title="Meeting Invitation"
      titleId="meeting-invitation-title"
      icon={<Mail className="w-4 h-4" aria-hidden="true" />}
      size="md"
      className="max-w-lg"
      closeLabel="Close meeting invitation"
      disableClose={isLoading}
    >
      {isLoading ? (
        <div className="py-10 flex flex-col items-center justify-center space-y-2">
          <Loader2 className="w-6 h-6 text-[#2F6F68] dark:text-[#5FA399] animate-spin" aria-hidden="true" />
          <p className="text-xs text-[#555D66] dark:text-[#A3AAB2]">Loading invitation...</p>
        </div>
      ) : invitation && liveInvitation ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2A2F37] space-y-3">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#555D66] dark:text-[#A3AAB2]">
                Title
              </span>
              <p className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] mt-0.5 break-words">
                {invitation.title}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-[#DDDAD0] dark:border-[#2A2F37]">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#555D66] dark:text-[#A3AAB2]">
                  Date &amp; Time
                </span>
                <p className="text-xs font-medium text-[#1F2428] dark:text-[#EAECEE] mt-0.5">
                  {invitation.scheduledTimeFormatted}
                </p>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#555D66] dark:text-[#A3AAB2]">
                  Meeting Code
                </span>
                <code className="inline-block font-mono text-xs font-bold text-[#2F6F68] dark:text-[#5FA399] mt-0.5">
                  {invitation.meetingCode}
                </code>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[#DDDAD0] dark:border-[#2A2F37] flex items-center gap-2 min-w-0">
              <LinkIcon className="w-3.5 h-3.5 text-[#555D66] dark:text-[#A3AAB2] shrink-0" aria-hidden="true" />
              <span className="font-mono text-[11px] text-[#555D66] dark:text-[#A3AAB2] truncate">
                {liveInvitation.joinUrl}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopyValue(liveInvitation.joinUrl, 'link')}
                leftIcon={
                  copiedField === 'link' ? (
                    <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )
                }
              >
                {copiedField === 'link' ? 'Link Copied' : 'Copy Link'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopyValue(invitation.meetingCode, 'code')}
                leftIcon={
                  copiedField === 'code' ? (
                    <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )
                }
              >
                {copiedField === 'code' ? 'Code Copied' : 'Copy Code'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-copy="true"
                onClick={() => handleCopyValue(liveInvitation.invitationText, 'invitation')}
                leftIcon={
                  copiedField === 'invitation' ? (
                    <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )
                }
              >
                {copiedField === 'invitation' ? 'Copied Invitation' : 'Copy Invitation'}
              </Button>
            </div>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleOpenRoom}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
            >
              Open Room
            </Button>
          </div>
        </div>
      ) : (
        <div role="alert" className={cn('p-4 text-center text-xs', STUDIO_ALERT_DANGER_CLASS)}>
          Unable to load meeting invitation.
        </div>
      )}
    </ModalShell>
  );
};
