import React, { useEffect, useRef } from 'react';
import { X, HelpCircle, Keyboard, Video, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>('button[data-close="true"]');
        closeBtn?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstEl = focusableElements[0];
        const lastEl = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl?.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B3A]/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[#E3E1D9] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E1D9] bg-[#F7F6F2]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#DCEDE8] text-[#168B83] flex items-center justify-center">
              <HelpCircle className="w-4 h-4" />
            </div>
            <h2 id="help-modal-title" className="font-display text-base font-bold text-[#172B3A]">
              Connectly Help & Shortcuts
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help modal"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5 text-sm text-[#3D5265]">
          <div>
            <h3 className="font-semibold text-[#172B3A] mb-1.5 flex items-center gap-2">
              <Video className="w-4 h-4 text-[#168B83]" />
              Meeting Formats & Joining
            </h3>
            <p className="text-xs text-[#6B8092] leading-relaxed">
              Meeting room codes follow the canonical format <code className="px-1.5 py-0.5 bg-[#F7F6F2] rounded text-[#172B3A] font-mono text-xs">cly-xxx-xxx</code>. Enter any 10-character code into the Join modal or paste a full room link to verify format structure.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[#172B3A] mb-1.5 flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-[#168B83]" />
              Keyboard Shortcuts
            </h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-[#F7F6F2]">
                <span>Quick Search / Command Palette</span>
                <kbd className="px-2 py-0.5 bg-white border border-[#E3E1D9] rounded shadow-xs font-mono text-[11px]">⌘K / Ctrl+K</kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-[#F7F6F2]">
                <span>Close Active Modal or Menu</span>
                <kbd className="px-2 py-0.5 bg-white border border-[#E3E1D9] rounded shadow-xs font-mono text-[11px]">Esc</kbd>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-emerald-900 leading-relaxed">
              <span className="font-semibold">Security Architecture:</span> Connectly enforces Argon2id hashing and HttpOnly dual-token sessions. Plaintext credentials are never retained in browser storage or client state.
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#F7F6F2] border-t border-[#E3E1D9] flex justify-end">
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
      </div>
    </div>
  );
};
