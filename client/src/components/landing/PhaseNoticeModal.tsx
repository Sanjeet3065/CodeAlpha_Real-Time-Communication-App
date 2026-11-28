import React from 'react';
import { Info, ArrowRight, ShieldCheck } from 'lucide-react';
import { ModalShell } from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export interface PhaseNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  targetPhase?: string;
  description?: string;
  detail?: string;
}

export const PhaseNoticeModal: React.FC<PhaseNoticeModalProps> = ({
  isOpen,
  onClose,
  title = 'Platform Architecture Information',
  targetPhase = 'Security & Operations',
  description = 'CONNECTLY operates on open WebRTC standards with isolated Supabase persistence and encrypted storage.',
  detail,
}) => {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      titleId="phase-modal-title"
      subtitle="Connectly Platform"
      icon={<Info className="w-4 h-4" aria-hidden="true" />}
      size="sm"
      closeLabel="Close dialog"
      dialogProps={{ 'aria-describedby': 'phase-modal-desc' }}
      footer={
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onClose}
            className="w-full sm:w-auto"
            rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
          >
            Understood
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
        <p id="phase-modal-desc">{description}</p>

        <div className="p-3.5 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
              <span>{targetPhase}</span>
            </div>
            <Badge variant="host" showDot={false}>
              Active
            </Badge>
          </div>
          <p className="text-xs text-[#636B74] dark:text-[#A3AAB2]">
            Built for isolated room admission, encrypted transport, and cross-browser accessibility.
          </p>
          {detail && (
            <p className="text-xs font-mono text-[#2F6F68] dark:text-[#5FA399] bg-[#FAF9F6] dark:bg-[#1C1F24] p-2.5 rounded-lg border border-[#DDDAD0] dark:border-[#2B3038]">
              {detail}
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

export default PhaseNoticeModal;
