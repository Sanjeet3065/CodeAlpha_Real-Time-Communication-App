import React, { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';

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
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      titleId="confirm-action-title"
      size="sm"
      variant="theater"
      closeLabel="Close confirmation dialog"
      disableClose={isLoading}
      initialFocusRef={cancelBtnRef}
      dialogProps={{ 'aria-describedby': 'confirm-action-desc' }}
      icon={
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            variant === 'danger'
              ? 'bg-[#C24D4D]/20 text-[#D46A6A]'
              : 'bg-[#2F6F68]/20 text-[#5FA399]'
          }`}
        >
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        </div>
      }
    >
      <div className="space-y-5">
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
    </ModalShell>
  );
};
