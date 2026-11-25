import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Hash, ArrowRight } from 'lucide-react';
import { validateMeetingCode } from '@/lib/meetingCode';

interface QuickCodeWidgetProps {
  onJoinCode: (code: string) => void;
}

export const QuickCodeWidget: React.FC<QuickCodeWidgetProps> = ({ onJoinCode }) => {
  const [inputCode, setInputCode] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateMeetingCode(inputCode);
    if (!result.isValid) {
      setInlineError(result.error || 'Invalid code format.');
      return;
    }
    setInlineError(null);
    onJoinCode(result.normalizedCode);
  };

  return (
    <Card className="p-4 sm:p-5 bg-white border-[#E3E1D9] shadow-xs rounded-2xl">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-[#DCEDE8] text-[#168B83] flex items-center justify-center flex-shrink-0">
          <Hash className="w-3.5 h-3.5" aria-hidden="true" />
        </div>
        <h3 className="font-display text-sm font-bold text-[#172B3A]">
          Quick Code Entry
        </h3>
      </div>
      <p className="text-xs text-[#6B8092] mb-3">
        Enter a 10-character code to join directly.
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputCode}
            onChange={(e) => {
              setInputCode(e.target.value);
              if (inlineError) setInlineError(null);
            }}
            placeholder="cly-xxx-xxx or invite link"
            aria-label="Meeting room code"
            className="min-w-0 flex-1 px-3 py-2 bg-[#F7F6F2] border border-[#E3E1D9] rounded-xl text-xs font-mono text-[#172B3A] placeholder-[#6B8092] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#168B83]/30 focus:border-[#168B83] transition-all"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="px-3 flex-shrink-0"
            aria-label="Verify and join meeting code"
          >
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
        {inlineError && (
          <p className="text-[11px] text-rose-600 font-medium">{inlineError}</p>
        )}
      </form>
    </Card>
  );
};
