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
      {/* 1. Instant Meeting Card (Primary Teal Accent) */}
      <div className="bg-gradient-to-br from-[#168B83] to-[#11706A] text-white rounded-2xl p-6 shadow-md shadow-[#168B83]/10 flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5">
        <div>
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white mb-4">
            <Video className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-white mb-1">
            Instant Meeting
          </h3>
          <p className="text-xs text-white/80 leading-relaxed">
            Launch a zero-latency collaboration room and invite team members.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onInstantMeeting}
            className="w-full bg-white text-[#168B83] hover:bg-[#F7F6F2] font-semibold shadow-xs justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Start Instant Room
          </Button>
        </div>
      </div>

      {/* 2. Join Meeting with Code (Ivory / Border Card) */}
      <div className="bg-white border border-[#E3E1D9] rounded-2xl p-6 shadow-xs flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#168B83]/40">
        <div>
          <div className="w-10 h-10 rounded-xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center mb-4">
            <Hash className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-[#172B3A] mb-1">
            Join with Code
          </h3>
          <p className="text-xs text-[#6B8092] leading-relaxed">
            Enter a 10-character code (<span className="font-mono">cly-xxx-xxx</span>) to enter a room.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onJoinMeeting}
            className="w-full border-[#E3E1D9] text-[#172B3A] hover:bg-[#F7F6F2] hover:border-[#168B83] font-semibold justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Join Room
          </Button>
        </div>
      </div>

      {/* 3. Schedule Meeting Card (Ivory / Border Card) */}
      <div className="bg-white border border-[#E3E1D9] rounded-2xl p-6 shadow-xs flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#168B83]/40">
        <div>
          <div className="w-10 h-10 rounded-xl bg-[#F7F6F2] text-[#172B3A] flex items-center justify-center mb-4">
            <Calendar className="w-5 h-5" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-bold tracking-tight text-[#172B3A] mb-1">
            Schedule Meeting
          </h3>
          <p className="text-xs text-[#6B8092] leading-relaxed">
            Plan ahead with waiting room admittance rules and calendar invites.
          </p>
        </div>

        <div className="pt-6">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onScheduleMeeting}
            className="w-full border-[#E3E1D9] text-[#172B3A] hover:bg-[#F7F6F2] hover:border-[#168B83] font-semibold justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
};
