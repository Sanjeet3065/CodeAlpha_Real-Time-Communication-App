import React, { useState } from 'react';
import { Video, Hash, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { validateMeetingCode } from '@/lib/meetingCode';

interface QuickActionBarProps {
  onInstantMeeting: () => void;
  onJoinMeeting: (prefilledCode?: string) => void;
  onScheduleMeeting: () => void;
}

export const QuickActionBar: React.FC<QuickActionBarProps> = ({
  onInstantMeeting,
  onJoinMeeting,
  onScheduleMeeting,
}) => {
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = joinInput.trim();
    if (!trimmed) {
      setJoinError(null);
      onJoinMeeting('');
      return;
    }

    const result = validateMeetingCode(trimmed);
    if (!result.isValid) {
      setJoinError(result.error || 'Enter a valid code (cly-xxx-xxx).');
      return;
    }

    setJoinError(null);
    setJoinInput('');
    onJoinMeeting(result.normalizedCode);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mb-6 items-stretch">
      {/* 1. Instant Meeting Card */}
      <div className="bg-[#2F6F68] dark:bg-[#1F302E] border border-[#255A54] dark:border-[#5FA399]/35 text-[#FAF9F6] dark:text-[#EAECEE] rounded-2xl p-5 shadow-cly-sm flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-[#FAF9F6] shrink-0">
              <Video className="w-4 h-4" aria-hidden="true" />
            </div>
            <h3 className="font-display text-base font-bold tracking-tight text-[#FAF9F6]">
              Instant Meeting
            </h3>
          </div>
          <p className="text-xs text-[#E2ECE9]/90 leading-relaxed">
            Launch a room immediately and share an invite link.
          </p>
        </div>

        <div className="pt-4">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onInstantMeeting}
            className="w-full h-10 bg-[#FAF9F6] text-[#1F2428] hover:bg-[#EAE8E1] dark:bg-[#5FA399] dark:text-[#141619] dark:hover:bg-[#6EB2A8] font-semibold shadow-cly-sm justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Start Instant Room
          </Button>
        </div>
      </div>

      {/* 2. Join with Code Card (Direct Input + Modal Trigger) */}
      <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-5 shadow-cly-sm flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
              <Hash className="w-4 h-4" aria-hidden="true" />
            </div>
            <h3 className="font-display text-base font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              Join with Code
            </h3>
          </div>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
            Enter a room code (<span className="font-mono">cly-xxx-xxx</span>) or invite link.
          </p>
        </div>

        <form onSubmit={handleJoinSubmit} className="pt-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={joinInput}
              onChange={(e) => {
                setJoinInput(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="cly-xxx-xxx"
              aria-label="Meeting room code"
              className="min-w-0 flex-1 h-10 px-3 bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] rounded-lg text-xs font-mono text-[#1F2428] dark:text-[#EAECEE] placeholder-[#7C848D] dark:placeholder-[#747C86] focus:outline-none focus:bg-[#FFFFFF] dark:focus:bg-[#191D22] focus:ring-2 focus:ring-[#2F6F68]/25 dark:focus:ring-[#5FA399]/25 focus:border-[#2F6F68] dark:focus:border-[#5FA399] transition-colors"
            />
            <Button
              type="submit"
              variant="outline"
              size="md"
              className="h-10 px-3.5 shrink-0 border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] hover:border-[#2F6F68] dark:hover:border-[#5FA399] font-semibold whitespace-nowrap"
              rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            >
              Join Room
            </Button>
          </div>
          {joinError && (
            <p role="alert" className="mt-1.5 text-[11px] font-medium text-[#C24D4D] dark:text-[#D46A6A]">
              {joinError}
            </p>
          )}
        </form>
      </div>

      {/* 3. Schedule Meeting Card */}
      <div className="bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl p-5 shadow-cly-sm flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] text-[#1F2428] dark:text-[#EAECEE] border border-[#DDDAD0]/70 dark:border-[#2B3038] flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </div>
            <h3 className="font-display text-base font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              Schedule Meeting
            </h3>
          </div>
          <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed">
            Plan ahead with waiting room & calendar invites.
          </p>
        </div>

        <div className="pt-4">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onScheduleMeeting}
            className="w-full h-10 border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] hover:border-[#2F6F68] dark:hover:border-[#5FA399] font-semibold justify-center"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
};
