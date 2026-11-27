import React, { useState, useRef, useEffect } from 'react';
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
  const buttonRef = useRef<HTMLButtonElement>(null);

  const getInitials = () => {
    if (!user) return 'U';
    const first = user.firstName?.[0] || '';
    const last = user.lastName?.[0] || '';
    return (first + last).toUpperCase() || 'U';
  };

  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : 'Authenticated User';

  // Close on Outside Click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  // Close on Escape Key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

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

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`User account menu for ${displayName}`}
        className="flex items-center gap-2 p-1.5 pl-2 rounded-full hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] transition-colors border border-transparent hover:border-[#DDDAD0] dark:hover:border-[#3A404A] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30"
      >
        <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center flex-shrink-0 ${getAvatarAccentClasses(user?.avatarColor)}`}>
          {getInitials()}
        </div>
        <span className="hidden sm:inline-block text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] max-w-[130px] truncate">
          {displayName}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#7C848D] dark:text-[#A3AAB2] transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#1F2428] dark:text-[#EAECEE]' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="origin-top-right absolute right-0 mt-2 w-72 rounded-xl shadow-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none z-50 animate-in fade-in-50 zoom-in-95 duration-100"
        >
          {/* User Profile Header */}
          <div className="p-4 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE]/70 dark:bg-[#141619]/70 rounded-t-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center flex-shrink-0 ${getAvatarAccentClasses(user?.avatarColor)}`}>
                {getInitials()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">{displayName}</p>
                {user?.jobTitle && (
                  <p className="text-[11px] font-medium text-[#2F6F68] dark:text-[#5FA399] truncate">
                    {user.jobTitle}
                  </p>
                )}
                <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2] truncate flex items-center gap-1">
                  <Mail className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{user?.email || 'Authenticated Account'}</span>
                </p>
              </div>
            </div>

            {/* Email Verification Status Badge (Grounded in Genuine Backend State) */}
            {user?.isEmailVerified === true ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-[11px] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Email</span>
              </div>
            ) : user?.isEmailVerified === false ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 text-[11px] font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Email Unverified</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EAE8E1] dark:bg-[#24282E] text-[#555D66] dark:text-[#A3AAB2] text-[11px] font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]" />
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
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] transition-colors"
            >
              <UserPen className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" />
              <span>Edit Profile</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                navigate('/settings');
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] transition-colors"
            >
              <Settings className="w-4 h-4 text-[#7C848D] dark:text-[#A3AAB2]" />
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
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#C24D4D] dark:text-[#D46A6A] hover:bg-[#F6E6E6] dark:hover:bg-[#342023] rounded-lg transition-colors disabled:opacity-50"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      )}

      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />
    </div>
  );
};
