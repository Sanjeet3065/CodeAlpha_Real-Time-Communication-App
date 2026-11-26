import React from 'react';
import { Video, Hash, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface QuickActionBarProps {
  onInstantMeeting: () => void;
  onJoinMeeting: () => void;
  onScheduleMeeting: () => void;
}

export const QuickActionBar: React.FC<QuickActionBarProps> = ({
  onInstantMeeting,
  onJoinMeeting,
  onScheduleMeeting,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
      {/* 1. Instant Meeting Card (Matte Mineral Pine Accent) */}
      <div className="bg-[#2F6F68] dark:bg-[#1F302E] border border-[#255A54] dark:border-[#5FA399]/35 text-[#FAF9F6] dark:text-[#EAECEE] rounded-2xl p-6 shadow-cly-sm flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5">
        <div>
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-[#FAF9F6] mb-4">
            <Video className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-[#FAF9F6] mb-1">
            Instant Meeting
          </h3>
          <p className="text-xs text-[#E2ECE9]/90 leading-relaxed">
            Launch a zero-latency collaboration room and share a live invite link.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onInstantMeeting}
            className="w-full bg-[#FAF9F6] text-[#1F2428] hover:bg-[#EAE8E1] dark:bg-[#5FA399] dark:text-[#141619] dark:hover:bg-[#6EB2A8] font-semibold shadow-cly-sm justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Start Instant Room
          </Button>
        </div>
      </div>

      {/* 2. Join Meeting with Code (Ivory / Border Card) */}
      <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-6 shadow-xs flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40">
        <div>
          <div className="w-10 h-10 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mb-4">
            <Hash className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE] mb-1">
            Join with Code
          </h3>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
            Enter a 10-character code (<span className="font-mono">cly-xxx-xxx</span>) to enter a room.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onJoinMeeting}
            className="w-full border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] hover:border-[#2F6F68] dark:hover:border-[#5FA399] font-semibold justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Join Room
          </Button>
        </div>
      </div>

      {/* 3. Schedule Meeting Card (Ivory / Border Card) */}
      <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-6 shadow-xs flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40">
        <div>
          <div className="w-10 h-10 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] flex items-center justify-center mb-4">
            <Calendar className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE] mb-1">
            Schedule Meeting
          </h3>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
            Plan ahead with waiting room admittance rules and calendar invites.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onScheduleMeeting}
            className="w-full border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] hover:border-[#2F6F68] dark:hover:border-[#5FA399] font-semibold justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
};
