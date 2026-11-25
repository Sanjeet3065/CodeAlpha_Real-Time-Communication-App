import React, { useEffect, useRef } from 'react';
import { AppSidebar } from './AppSidebar';
import { X } from 'lucide-react';

interface MobileNavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileNavigationDrawer: React.FC<MobileNavigationDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        const closeBtn = drawerRef.current?.querySelector<HTMLButtonElement>('button[data-drawer-close="true"]');
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

      if (e.key === 'Tab' && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
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
      aria-label="Mobile Navigation Menu"
      className="fixed inset-0 z-50 lg:hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#172B3A]/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed inset-y-0 left-0 w-72 bg-white shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200"
      >
        <div className="absolute top-4 right-3 z-10">
          <button
            type="button"
            data-drawer-close="true"
            onClick={onClose}
            aria-label="Close navigation"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-[#F7F6F2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <AppSidebar onCloseMobile={onClose} className="w-full border-r-0" />
      </div>
    </div>
  );
};
