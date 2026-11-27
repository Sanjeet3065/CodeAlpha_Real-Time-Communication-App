import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Activity, ArrowRight, Check, Clock, Copy, RotateCcw } from 'lucide-react';
import { schedulingApi } from '@/services/schedulingApi';
import type { IActivityEvent } from '@/types/dashboard';

interface RecentActivityWidgetProps {
  activities?: IActivityEvent[];
  refreshKey?: number;
  onMeetAgain?: (title: string) => void;
}

export const RecentActivityWidget: React.FC<RecentActivityWidgetProps> = ({
  activities: initialActivities,
  refreshKey = 0,
  onMeetAgain,
}) => {
  const [activities, setActivities] = useState<IActivityEvent[]>(
    initialActivities ? initialActivities.slice(0, 2) : []
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [localRefreshTick, setLocalRefreshTick] = useState(0);

  useEffect(() => {
    const handleHistoryUpdated = () => setLocalRefreshTick((t) => t + 1);
    window.addEventListener('connectly:history-updated', handleHistoryUpdated);
    return () => window.removeEventListener('connectly:history-updated', handleHistoryUpdated);
  }, []);

  useEffect(() => {
    if (initialActivities) {
      setActivities(initialActivities.slice(0, 2));
      return;
    }

    let mounted = true;
    void (async () => {
      try {
        const res = await schedulingApi.listMeetingHistory({ page: 1, limit: 2, sort: 'desc' });
        if (!mounted) return;
        const mapped: IActivityEvent[] = res.meetings.slice(0, 2).map((item) => ({
          id: item.id,
          type: item.userRole === 'host' ? 'meeting_hosted' : 'meeting_attended',
          title: item.title,
          timestamp: item.endedAt || item.scheduledStartAt || item.createdAt,
          durationMinutes: item.actualDurationSeconds
            ? Math.max(1, Math.round(item.actualDurationSeconds / 60))
            : undefined,
          participantCount: item.participantCount,
          meetingCode: item.meetingCode,
        }));
        setActivities(mapped);
      } catch {
        // Keep clean empty state on transient failures
      }
    })();

    return () => {
      mounted = false;
    };
  }, [initialActivities, refreshKey, localRefreshTick]);

  const handleCopyCode = async (id: string, code?: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <Card className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl flex flex-col flex-1">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
            Recent Calls
          </h3>
          <span
            title="Calls older than 2 days are removed automatically"
            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-[#7C848D] dark:text-[#8E96A0]"
          >
            Last 48h
          </span>
        </div>
        <Link
          to="/meetings/history"
          className="text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] inline-flex items-center gap-1 transition-colors"
        >
          <span>History</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {activities.length === 0 ? (
        <div className="flex-1 py-5 px-2 text-center flex flex-col items-center justify-center">
          <Clock className="w-7 h-7 text-[#7C848D] dark:text-[#747C86] mb-2 opacity-65" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-0.5">
            No recent calls
          </p>
          <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0]">
            Completed meetings stay here for 48 hours.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 flex-1">
          {activities.map((act) => (
            <div
              key={act.id}
              className="p-2.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038] flex items-center justify-between gap-2.5"
            >
              <Link to="/meetings/history" className="min-w-0 flex-1 group">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] group-hover:text-[#2F6F68] dark:group-hover:text-[#5FA399] truncate transition-colors">
                    {act.title}
                  </p>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0]/70 dark:border-[#2B3038] text-[#646D77] dark:text-[#A3AAB2] shrink-0">
                    {act.type === 'meeting_hosted' ? 'Host' : 'Attended'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#7C848D] dark:text-[#8E96A0] mt-1">
                  <span>
                    {new Date(act.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                  {act.durationMinutes ? <span>· {act.durationMinutes}m</span> : null}
                  {act.meetingCode ? <span className="font-mono">· {act.meetingCode}</span> : null}
                </div>
              </Link>

              <div className="flex items-center gap-1 shrink-0">
                {act.meetingCode && (
                  <button
                    type="button"
                    onClick={() => void handleCopyCode(act.id, act.meetingCode)}
                    aria-label={`Copy room code ${act.meetingCode}`}
                    className="p-1.5 rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#FAF9F6] dark:hover:bg-[#1C1F24] transition-colors"
                  >
                    {copiedId === act.id ? (
                      <Check className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {onMeetAgain && (
                  <button
                    type="button"
                    onClick={() => onMeetAgain(act.title)}
                    aria-label={`Meet again: ${act.title}`}
                    className="px-2 py-1 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] hover:opacity-90 text-[11px] font-semibold inline-flex items-center gap-1 transition-opacity"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Again</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
