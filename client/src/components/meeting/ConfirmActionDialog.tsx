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

        <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-2.5 pt-1">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="outline"
            size="md"
            disabled={isLoading}
            onClick={onCancel}
            className="w-full sm:w-auto min-h-[42px] h-[42px] px-4 rounded-lg text-xs sm:text-sm font-semibold border-white/15 bg-white/10 text-slate-100 hover:bg-white/15 hover:text-white dark:border-white/15 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'destructive' : 'primary'}
            size="md"
            disabled={isLoading}
            onClick={onConfirm}
            className={
              variant === 'danger'
                ? 'w-full sm:w-auto min-h-[42px] h-[42px] px-4 rounded-lg text-xs sm:text-sm font-semibold !bg-[#C24D4D] hover:!bg-[#A63D3D] !text-[#FAF9F6] dark:!text-[#FAF9F6] border border-transparent'
                : 'w-full sm:w-auto min-h-[42px] h-[42px] px-4 rounded-lg text-xs sm:text-sm font-semibold !bg-[#2F6F68] hover:!bg-[#255A54] !text-[#FAF9F6] dark:!text-[#FAF9F6] border border-transparent'
            }
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};
