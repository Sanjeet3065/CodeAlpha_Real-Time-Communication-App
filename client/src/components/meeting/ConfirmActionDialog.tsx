import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ConfirmActionDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => cancelBtnRef.current?.focus(), 40);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      prevFocus?.focus?.();
    };
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
      aria-describedby="confirm-action-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 "
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-[#1C1F24] border border-white/15 shadow-2xl overflow-hidden text-white"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                variant === 'danger'
                  ? 'bg-[#C24D4D]/20 text-[#D46A6A]'
                  : 'bg-[#2F6F68]/20 text-[#5FA399]'
              }`}
            >
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="confirm-action-title" className="font-display text-base font-bold text-white">
              {title}
            </h2>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p id="confirm-action-desc" className="text-sm text-slate-300 leading-relaxed">
            {description}
          </p>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              ref={cancelBtnRef}
              type="button"
              disabled={isLoading}
              onClick={onCancel}
              className="px-4 py-2 min-h-[44px] inline-flex items-center justify-center rounded-xl text-xs font-semibold text-slate-200 bg-white/10 hover:bg-white/15 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
            >
              {cancelLabel}
            </button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isLoading}
              onClick={onConfirm}
              className={
                variant === 'danger'
                  ? '!bg-[#C24D4D] hover:!bg-[#A63D3D] text-white border-transparent'
                  : ''
              }
            >
              {isLoading ? 'Processing...' : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
