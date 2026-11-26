import React, { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Info, X, ArrowRight, ShieldCheck } from 'lucide-react';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Capture activeElement before modal opens and restore on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle Escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Tab trap
      if (event.key === 'Tab' && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    // Set initial focus to close button
    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phase-modal-title"
      aria-describedby="phase-modal-desc"
      className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-6 bg-[#141619]/65"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={dialogRef} className="w-full max-w-lg">
        <Card variant="standard" className="relative p-6 sm:p-8 bg-[#FAF9F6] dark:bg-[#1C1F24] shadow-cly-lg border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
                <Info className="w-5 h-5" aria-hidden="true" />
              </span>
              <div>
                <Badge variant="host" className="mb-1">
                  Connectly Platform
                </Badge>
                <h3 id="phase-modal-title" className="text-xl font-bold font-display text-[#1F2428] dark:text-[#EAECEE]">
                  {title}
                </h3>
              </div>
            </div>

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] focus-visible:outline-none"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            <p id="phase-modal-desc">{description}</p>

            <div className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                <span>{targetPhase}</span>
              </div>
              <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                Built for strict security isolation, encrypted room admission, and accessible collaboration across browsers.
              </p>
              {detail && (
                <p className="text-xs font-mono text-[#2F6F68] dark:text-[#5FA399] bg-[#FAF9F6] dark:bg-[#1C1F24] p-2 rounded border border-[#DDDAD0] dark:border-[#2B3038]">
                  {detail}
                </p>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-4 border-t border-[#DDDAD0] dark:border-[#2B3038]">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onClose}
              className="w-full sm:w-auto"
              rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            >
              Understood
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default PhaseNoticeModal;
