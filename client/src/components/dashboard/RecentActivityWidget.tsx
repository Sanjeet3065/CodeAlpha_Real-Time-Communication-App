import React from 'react';
import { Card } from '@/components/ui/Card';
import { Activity, Clock } from 'lucide-react';
import type { IActivityEvent } from '@/types/dashboard';

interface RecentActivityWidgetProps {
  activities?: IActivityEvent[];
}

export const RecentActivityWidget: React.FC<RecentActivityWidgetProps> = ({
  activities = [],
}) => {
  return (
    <Card className="p-5 bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038] shadow-xs rounded-2xl">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#DDDAD0]/80 dark:border-[#2B3038]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center">
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#1F2428] dark:text-[#EAECEE]">
            Recent Activity
          </h3>
        </div>
        <span className="text-[11px] font-semibold text-[#7C848D] dark:text-[#A3AAB2]">History</span>
      </div>

      {activities.length === 0 ? (
        <div className="py-6 px-2 text-center">
          <Clock className="w-8 h-8 text-[#7C848D] dark:text-[#747C86] mx-auto mb-2 opacity-60" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1">
            No Recent Meeting Activity
          </p>
          <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
            Attendance records, session durations, and collaboration summaries will appear here after meetings conclude.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activities.map((act) => (
            <div key={act.id} className="p-2.5 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] text-xs">
              <p className="font-semibold text-[#1F2428] dark:text-[#EAECEE]">{act.title}</p>
              <div className="flex items-center justify-between text-[11px] text-[#7C848D] dark:text-[#A3AAB2] mt-1">
                <span>{new Date(act.timestamp).toLocaleDateString()}</span>
                {act.durationMinutes && <span>{act.durationMinutes} mins</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
