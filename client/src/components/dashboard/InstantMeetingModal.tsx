import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  Copy,
  Check,
  ArrowRight,
  Users,
  Link as LinkIcon,
  AlertCircle,
} from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { StudioSwitch } from '@/components/ui/StudioSwitch';
import { Button } from '@/components/ui/Button';
import { meetingApi, getMeetingErrorMessage } from '@/services/meetingApi';
import { ApiError } from '@/services/authApi';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
import { STUDIO_ALERT_DANGER_CLASS } from '@/lib/studioTokens';
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
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initialTitle);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState<number>(60);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMeeting, setCreatedMeeting] = useState<MeetingSummary | null>(null);
  const [copiedField, setCopiedField] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setWaitingRoomEnabled(false);
      setMaxParticipants(60);
      setError(null);
      setCreatedMeeting(null);
      setCopiedField(null);
    }
  }, [isOpen, initialTitle]);

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
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={createdMeeting ? 'Room Ready' : 'New Instant Meeting'}
      titleId="instant-meeting-title"
      icon={<Zap className="w-4 h-4" aria-hidden="true" />}
      size="sm"
      closeLabel="Close instant meeting modal"
      initialFocusRef={!createdMeeting ? titleInputRef : undefined}
    >
      {!createdMeeting ? (
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label
              htmlFor="instant-meeting-name"
              className="block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1.5"
            >
              Meeting Name{' '}
              <span className="font-normal text-[#636B74] dark:text-[#8E96A0]">(Optional)</span>
            </label>
            <input
              ref={titleInputRef}
              id="instant-meeting-name"
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly Design Review"
              className="w-full h-10 px-3.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder-[#636B74] dark:placeholder-[#747C86] focus:outline-none focus:bg-[#FAF9F6] dark:focus:bg-[#1C1F24] focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30 focus:border-[#2F6F68] dark:focus:border-[#5FA399] transition-all"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-3">
            <StudioSwitch
              id="instant-waiting-room"
              mode="switch"
              checked={waitingRoomEnabled}
              onChange={setWaitingRoomEnabled}
              label="Waiting Room"
              description="Approve guests before entry"
            />

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
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] ${
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
              className={`p-3 flex items-start gap-2 text-xs ${STUDIO_ALERT_DANGER_CLASS}`}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
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
              rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
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
              {createdMeeting.settings.waitingRoomEnabled ? 'Waiting room on' : 'Open entry'} · Up to{' '}
              {createdMeeting.maxParticipants} participants
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
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Code
                  </span>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 px-3 py-2.5 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-xl flex items-center gap-2">
                <LinkIcon className="w-3.5 h-3.5 text-[#636B74] dark:text-[#A3AAB2] flex-shrink-0" aria-hidden="true" />
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
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
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
              rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            >
              Join Lobby
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};
