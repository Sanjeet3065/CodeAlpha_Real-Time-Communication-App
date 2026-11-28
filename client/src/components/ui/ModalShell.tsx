import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { acquireModalLock, isTopModal, releaseModalLock } from './modalStack';

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'danger' | 'theater';
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  disableClose?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  dialogProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, string | undefined>;
  children: React.ReactNode;
}

type ModalSize = NonNullable<ModalShellProps['size']>;
type ModalVariant = NonNullable<ModalShellProps['variant']>;

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const VARIANT_CLASSES: Record<
  ModalVariant,
  {
    card: string;
    header: string;
    footer: string;
    iconWrap: string;
    title: string;
    subtitle: string;
    closeBtn: string;
  }
> = {
  default: {
    card: 'bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] text-[#1F2428] dark:text-[#EAECEE] shadow-cly-lg',
    header: 'bg-[#F3F2EE] dark:bg-[#141619] border-b border-[#DDDAD0] dark:border-[#2B3038]',
    footer: 'bg-[#F3F2EE] dark:bg-[#141619] border-t border-[#DDDAD0] dark:border-[#2B3038]',
    iconWrap: 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]',
    title: 'text-[#1F2428] dark:text-[#EAECEE]',
    subtitle: 'text-[#555D66] dark:text-[#A3AAB2]',
    closeBtn:
      'text-[#636B74] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
  },
  danger: {
    card: 'bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#C24D4D]/35 dark:border-[#D46A6A]/35 text-[#1F2428] dark:text-[#EAECEE] shadow-cly-lg',
    header: 'bg-[#F6E6E6] dark:bg-[#2B1B1D] border-b border-[#C24D4D]/25 dark:border-[#D46A6A]/25',
    footer: 'bg-[#F3F2EE] dark:bg-[#141619] border-t border-[#DDDAD0] dark:border-[#2B3038]',
    iconWrap: 'bg-[#C24D4D]/15 dark:bg-[#D46A6A]/20 text-[#C24D4D] dark:text-[#D46A6A]',
    title: 'text-[#1F2428] dark:text-[#EAECEE]',
    subtitle: 'text-[#555D66] dark:text-[#A3AAB2]',
    closeBtn:
      'text-[#636B74] dark:text-[#A3AAB2] hover:text-[#C24D4D] dark:hover:text-[#D46A6A] hover:bg-[#C24D4D]/10 dark:hover:bg-[#D46A6A]/15 focus-visible:ring-[#C24D4D] dark:focus-visible:ring-[#D46A6A]',
  },
  theater: {
    card: 'bg-[#1C1F24] border border-white/15 text-[#EAECEE] shadow-cly-theater',
    header: 'bg-[#181B20] border-b border-white/10',
    footer: 'bg-[#181B20] border-t border-white/10',
    iconWrap: 'bg-[#2F6F68]/20 text-[#5FA399]',
    title: 'text-[#EAECEE]',
    subtitle: 'text-[#8D959E]',
    closeBtn: 'text-[#A3AAB2] hover:text-[#EAECEE] hover:bg-white/10 focus-visible:ring-[#5FA399]',
  },
};

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Portaled, stack-aware matte modal shell with focus trap, Escape handling,
 * and automatic focus restoration on close.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  title,
  titleId,
  subtitle,
  icon,
  size = 'md',
  variant = 'default',
  closeLabel = 'Close dialog',
  closeOnBackdrop = true,
  closeOnEscape = true,
  disableClose = false,
  initialFocusRef,
  headerActions,
  footer,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  dialogProps,
  children,
}) => {
  const modalId = useId();
  const subtitleId = `${titleId}-subtitle`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Stack lock + initial focus + focus restoration on close/unmount
  useEffect(() => {
    if (!isOpen) return;

    wasOpenRef.current = true;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acquireModalLock(modalId);

    const timer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ??
        getFocusableElements(dialogRef.current)[0] ??
        closeBtnRef.current ??
        dialogRef.current;
      target?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      releaseModalLock(modalId);

      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const prev = previousFocusRef.current;
        previousFocusRef.current = null;
        if (prev && typeof prev.focus === 'function' && prev.isConnected !== false) {
          prev.focus();
        }
      }
    };
  }, [isOpen, modalId, initialFocusRef]);

  // Top-of-stack Escape & Tab/Shift+Tab focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopModal(modalId)) return;

      if (e.key === 'Escape') {
        if (closeOnEscape && !disableClose) {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, modalId, closeOnEscape, disableClose, onClose]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  const styles = VARIANT_CLASSES[variant];
  const { className: dialogClassName, ...restDialogProps } = dialogProps ?? {};
  const describedBy =
    restDialogProps['aria-describedby'] ?? (subtitle ? subtitleId : undefined);

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop && !disableClose) {
          onClose();
        }
      }}
      className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-[#141619]/60 dark:bg-black/75 cly-animate-fade"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        {...restDialogProps}
        aria-describedby={describedBy}
        className={cn(
          'w-full rounded-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] outline-none cly-animate-modal',
          SIZE_CLASSES[size],
          styles.card,
          className,
          dialogClassName
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-6 py-4 shrink-0',
            styles.header,
            headerClassName
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  styles.iconWrap
                )}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2
                id={titleId}
                className={cn('font-display text-base font-bold truncate', styles.title)}
              >
                {title}
              </h2>
              {subtitle && (
                <p id={subtitleId} className={cn('text-xs mt-0.5 truncate', styles.subtitle)}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {headerActions}
            <button
              ref={closeBtnRef}
              type="button"
              disabled={disableClose}
              onClick={onClose}
              aria-label={closeLabel}
              className={cn(
                'min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-45 disabled:pointer-events-none',
                styles.closeBtn
              )}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className={cn('flex-1 overflow-y-auto cly-scrollbar p-6', bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className={cn('px-6 py-3.5 shrink-0', styles.footer, footerClassName)}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ModalShell;
