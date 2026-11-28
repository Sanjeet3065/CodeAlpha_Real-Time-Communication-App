import React from 'react';
import { HelpCircle, Keyboard, Video, ShieldCheck } from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Help & Shortcuts"
      titleId="help-modal-title"
      icon={<HelpCircle className="w-4 h-4" aria-hidden="true" />}
      size="md"
      closeLabel="Close help modal"
      footer={
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            data-close="true"
          >
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm text-[#555D66] dark:text-[#A3AAB2]">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-2">
            <Video className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
            <span>Joining Rooms</span>
          </h3>
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] text-xs">
            <span>Room code or full invite URL</span>
            <code className="px-2 py-0.5 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded font-mono text-[11px] text-[#1F2428] dark:text-[#EAECEE]">
              cly-xxx-xxx
            </code>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
            <span>Keyboard Shortcuts</span>
          </h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]">
              <span>Quick Search &amp; Actions</span>
              <kbd className="px-2 py-0.5 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded shadow-cly-sm font-mono text-[11px] text-[#1F2428] dark:text-[#EAECEE]">
                ⌘K / Ctrl+K
              </kbd>
            </div>
            <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]">
              <span>Close Active Dialog or Menu</span>
              <kbd className="px-2 py-0.5 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded shadow-cly-sm font-mono text-[11px] text-[#1F2428] dark:text-[#EAECEE]">
                Esc
              </kbd>
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 flex items-start gap-2.5">
          <ShieldCheck
            className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] mt-0.5 flex-shrink-0"
            aria-hidden="true"
          />
          <p className="text-xs text-[#1F2428] dark:text-[#EAECEE] leading-relaxed">
            <span className="font-semibold">Private Sessions:</span> Credentials are never stored in browser storage, and sessions use secure HttpOnly tokens.
          </p>
        </div>
      </div>
    </ModalShell>
  );
};
