import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Activity, ArrowRight, Clock } from 'lucide-react';
import { schedulingApi } from '@/services/schedulingApi';
import type { IActivityEvent } from '@/types/dashboard';

interface RecentActivityWidgetProps {
  activities?: IActivityEvent[];
  refreshKey?: number;
}

export const RecentActivityWidget: React.FC<RecentActivityWidgetProps> = ({
  activities: initialActivities,
  refreshKey = 0,
}) => {
  const [activities, setActivities] = useState<IActivityEvent[]>(initialActivities || []);

  useEffect(() => {
    if (initialActivities) {
      setActivities(initialActivities);
      return;
    }

    let mounted = true;
    void (async () => {
      try {
        const res = await schedulingApi.listMeetingHistory({ page: 1, limit: 3, sort: 'desc' });
        if (!mounted) return;
        const mapped: IActivityEvent[] = res.meetings.map((item) => ({
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
        // Handled silently so empty state remains clean
      }
    })();

    return () => {
      mounted = false;
    };
  }, [initialActivities, refreshKey]);

  return (
    <Card className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl flex flex-col">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
            Recent Activity
          </h3>
        </div>
        <Link
          to="/meetings"
          className="text-xs font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] inline-flex items-center gap-1 transition-colors"
        >
          <span>History</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {activities.length === 0 ? (
        <div className="py-5 px-2 text-center flex flex-col items-center justify-center">
          <Clock className="w-7 h-7 text-[#7C848D] dark:text-[#747C86] mb-2 opacity-65" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-0.5">
            No recent meetings
          </p>
          <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0]">
            Completed sessions appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activities.map((act) => (
            <Link
              key={act.id}
              to="/meetings"
              className="block p-2.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0]/70 dark:border-[#2B3038] hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40 transition-colors"
            >
              <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
                {act.title}
              </p>
              <div className="flex items-center justify-between text-[11px] text-[#7C848D] dark:text-[#A3AAB2] mt-1">
                <span>
                  {new Date(act.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
                {act.durationMinutes ? <span>{act.durationMinutes} min</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
};
