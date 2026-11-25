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
  title = 'Roadmap Phase Boundary',
  targetPhase = 'Phase 05 — Authentication System',
  description = 'This feature is scheduled in the CONNECTLY engineering roadmap and will be operational once its designated phase is executed.',
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
      className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-6 bg-[#172B3A]/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={dialogRef} className="w-full max-w-lg">
        <Card variant="standard" className="relative p-6 sm:p-8 bg-white shadow-2xl border border-[#E3E1D9] rounded-2xl">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center shrink-0">
                <Info className="w-5 h-5" aria-hidden="true" />
              </span>
              <div>
                <Badge variant="host" className="mb-1">
                  Active: Phase 04 — Landing Page
                </Badge>
                <h3 id="phase-modal-title" className="text-xl font-bold font-display text-[#172B3A]">
                  {title}
                </h3>
              </div>
            </div>

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[#6B8092] hover:text-[#172B3A] hover:bg-[#F7F6F2] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#168B83] focus-visible:outline-none"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 text-sm text-[#3D5265] leading-relaxed">
            <p id="phase-modal-desc">{description}</p>

            <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#E3E1D9]/70 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#172B3A] uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
                <span>Next In Sequence: {targetPhase}</span>
              </div>
              <p className="text-xs text-[#6B8092]">
                CONNECTLY adheres to strict engineering boundaries. Features are enabled sequentially as their underlying services and security protocols are built and verified.
              </p>
              {detail && (
                <p className="text-xs font-mono text-[#168B83] bg-white p-2 rounded border border-[#E3E1D9]">
                  {detail}
                </p>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-4 border-t border-[#E3E1D9]">
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
