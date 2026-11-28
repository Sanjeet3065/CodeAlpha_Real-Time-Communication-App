import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Clock, Copy, Video } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { schedulingApi } from '@/services/schedulingApi';
import { meetingSocket } from '@/services/meetingSocket';
import { buildMeetingJoinUrl } from '@/lib/meetingLink';
import type { IScheduledMeeting } from '@/types/scheduling';

interface UpNextBannerProps {
  refreshKey?: number;
}

function formatCountdown(meeting: IScheduledMeeting, nowMs: number): { label: string; isUrgent: boolean } {
  if (meeting.status === 'ACTIVE') {
    return { label: 'Live Now', isUrgent: true };
  }
  if (!meeting.scheduledStartAt) {
    return { label: 'Upcoming', isUrgent: false };
  }

  const startMs = new Date(meeting.scheduledStartAt).getTime();
  const diffMin = Math.round((startMs - nowMs) / 60_000);

  if (diffMin <= 2) {
    return { label: 'Starting now', isUrgent: true };
  }
  if (diffMin < 60) {
    return { label: `In ${diffMin} min`, isUrgent: diffMin <= 20 };
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    const remMin = diffMin % 60;
    return {
      label: remMin > 0 ? `In ${diffHours}h ${remMin}m` : `In ${diffHours}h`,
      isUrgent: false,
    };
  }

  return {
    label: new Date(meeting.scheduledStartAt).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    }),
    isUrgent: false,
  };
}

export const UpNextBanner: React.FC<UpNextBannerProps> = ({ refreshKey = 0 }) => {
  const navigate = useNavigate();
  const [nextMeeting, setNextMeeting] = useState<IScheduledMeeting | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const loadNext = useCallback(async () => {
    try {
      const res = await schedulingApi.listUpcomingMeetings({ page: 1, limit: 1 });
      setNextMeeting(res.meetings[0] ?? null);
    } catch {
      // Fail silently so dashboard stays clean on transient errors
    }
  }, []);

  useEffect(() => {
    void loadNext();

    const socket = meetingSocket.getSocket();
    if (!socket) return;

    const handleSync = () => {
      void loadNext();
    };
    socket.on('meeting:scheduled', handleSync);
    socket.on('meeting:rescheduled', handleSync);
    socket.on('meeting:cancelled', handleSync);
    socket.on('meeting:updated', handleSync);

    return () => {
      socket.off('meeting:scheduled', handleSync);
      socket.off('meeting:rescheduled', handleSync);
      socket.off('meeting:cancelled', handleSync);
      socket.off('meeting:updated', handleSync);
    };
  }, [loadNext, refreshKey]);

  useEffect(() => {
    if (!nextMeeting) return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [nextMeeting]);

  if (!nextMeeting) {
    return null;
  }

  const countdown = formatCountdown(nextMeeting, nowMs);
  const startLabel = nextMeeting.scheduledStartAt
    ? new Date(nextMeeting.scheduledStartAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Now';

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(buildMeetingJoinUrl(nextMeeting.meetingCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mb-5 p-4 rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-cly-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            countdown.isUrgent
              ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
              : 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
          }`}
        >
          <Video className="w-4 h-4" aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                countdown.isUrgent
                  ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
                  : 'bg-[#F3F2EE] dark:bg-[#141619] text-[#555D66] dark:text-[#A3AAB2]'
              }`}
            >
              <Clock className="w-3 h-3" aria-hidden="true" />
              <span>Up Next · {countdown.label}</span>
            </span>
            <span className="text-[11px] text-[#7C848D] dark:text-[#8E96A0]">
              {startLabel} · <span className="font-mono">{nextMeeting.meetingCode}</span>
            </span>
          </div>
          <p className="text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] truncate mt-0.5">
            {nextMeeting.title}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button type="button" variant="outline" size="sm" onClick={handleCopyInvite}>
          {copied ? (
            <span className="inline-flex items-center gap-1 text-[#2F6F68] dark:text-[#5FA399]">
              <Check className="w-3.5 h-3.5" />
              <span>Copied</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Link</span>
            </span>
          )}
        </Button>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => navigate(`/join/${nextMeeting.meetingCode}`)}
          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
        >
          Join Now
        </Button>
      </div>
    </div>
  );
};
