import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  LogOut,
  Settings,
  UserPen,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Loader2,
} from 'lucide-react';
import { getAvatarAccentClasses } from '@/lib/avatarAccent';
import { EditProfileModal } from './EditProfileModal';

export const AccountMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusEdgeRef = useRef<'first' | 'last' | null>(null);

  const getInitials = () => {
    if (!user) return 'U';
    const first = user.firstName?.[0] || '';
    const last = user.lastName?.[0] || '';
    const fallback = user.email?.[0] || 'U';
    return (first + last).toUpperCase() || fallback.toUpperCase();
  };

  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : user?.email || 'Account';

  const getMenuItems = useCallback((): HTMLElement[] => {
    if (!menuPanelRef.current) return [];
    return Array.from(
      menuPanelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
    );
  }, []);

  // Close on outside click (checking both trigger container and portaled menu)
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuPanelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Close on Escape key and focus requested edge item when opened via keyboard
  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      const edge = pendingFocusEdgeRef.current;
      pendingFocusEdgeRef.current = null;
      const items = getMenuItems();
      if (edge === 'last') {
        items[items.length - 1]?.focus();
      } else if (edge === 'first') {
        items[0]?.focus();
      }
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, getMenuItems]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      pendingFocusEdgeRef.current = 'first';
      setIsOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pendingFocusEdgeRef.current = 'last';
      setIsOpen(true);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex =
        currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('[AccountMenu] Logout error:', err);
    } finally {
      setIsLoggingOut(false);
      setIsOpen(false);
    }
  };

  const menuContent = isOpen ? (
    <div
      ref={menuPanelRef}
      role="menu"
      aria-orientation="vertical"
      aria-label="Account actions"
      onKeyDown={handleMenuKeyDown}
      className="fixed top-16 right-3 sm:right-5 xl:right-8 z-dropdown w-72 max-w-[calc(100vw-1.5rem)] rounded-xl shadow-cly-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none cly-animate-popover overflow-hidden"
    >
      {/* User Profile Header */}
      <div className="p-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619]">
        <div className="flex items-center gap-3 mb-2">
          <div
            className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center flex-shrink-0 ${getAvatarAccentClasses(
              user?.avatarColor
            )}`}
          >
            {getInitials()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
              {displayName}
            </p>
            {user?.jobTitle && (
              <p className="text-[11px] font-medium text-[#2F6F68] dark:text-[#5FA399] truncate">
                {user.jobTitle}
              </p>
            )}
            <p className="text-xs text-[#636B74] dark:text-[#A3AAB2] truncate flex items-center gap-1">
              <Mail className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{user?.email || 'Account'}</span>
            </p>
          </div>
        </div>

        {/* Email Verification Status Badge */}
        {user?.isEmailVerified === true ? (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 text-[11px] font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Verified Email</span>
          </div>
        ) : user?.isEmailVerified === false ? (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FAF3E4] dark:bg-[#262118] text-[#8F5819] dark:text-[#D49A4A] border border-[#B87323]/25 dark:border-[#8C6A2E]/40 text-[11px] font-semibold">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Email Unverified</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EAE8E1] dark:bg-[#24282E] text-[#555D66] dark:text-[#A3AAB2] text-[11px] font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
            <span>Session Active</span>
          </div>
        )}
      </div>

      {/* Action Links */}
      <div className="py-1.5" role="none">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setIsOpen(false);
            setIsEditProfileOpen(true);
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] focus-visible:outline-none focus-visible:bg-[#F3F2EE] dark:focus-visible:bg-[#24282E] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] transition-colors"
        >
          <UserPen className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
          <span>Edit Profile</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setIsOpen(false);
            navigate('/settings');
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] focus-visible:outline-none focus-visible:bg-[#F3F2EE] dark:focus-visible:bg-[#24282E] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] transition-colors"
        >
          <Settings className="w-4 h-4 text-[#636B74] dark:text-[#A3AAB2]" aria-hidden="true" />
          <span>Account Settings</span>
        </button>
      </div>

      {/* Logout Section */}
      <div className="p-2 border-t border-[#DDDAD0] dark:border-[#2B3038]" role="none">
        <button
          type="button"
          role="menuitem"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#C24D4D] dark:text-[#D46A6A] hover:bg-[#F6E6E6] dark:hover:bg-[#2B1B1D] focus-visible:outline-none focus-visible:bg-[#F6E6E6] dark:focus-visible:bg-[#2B1B1D] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C24D4D] dark:focus-visible:ring-[#D46A6A] rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoggingOut ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="w-4 h-4" aria-hidden="true" />
          )}
          <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          pendingFocusEdgeRef.current = null;
          setIsOpen((prev) => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`User account menu for ${displayName}`}
        className="h-10 inline-flex items-center gap-2 p-1.5 sm:pr-3 lg:pr-1.5 xl:pr-3 rounded-full bg-[#F3F2EE]/85 dark:bg-[#141619]/90 border border-[#DDDAD0] dark:border-[#2B3038] hover:border-[#C5C1B4] dark:hover:border-[#3A404A] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68]/30 dark:focus-visible:ring-[#5FA399]/30"
      >
        <div
          className={`w-7 h-7 rounded-full font-bold text-xs flex items-center justify-center flex-shrink-0 ${getAvatarAccentClasses(
            user?.avatarColor
          )}`}
        >
          {getInitials()}
        </div>
        <span className="hidden sm:inline-block lg:hidden xl:inline-block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] max-w-[128px] truncate">
          {displayName}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#636B74] dark:text-[#A3AAB2] transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#1F2428] dark:text-[#EAECEE]' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {menuContent &&
        (typeof document !== 'undefined'
          ? createPortal(menuContent, document.body)
          : menuContent)}

      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />
    </div>
  );
};
