import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  LogOut,
  Settings,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Loader2,
} from 'lucide-react';

export const AccountMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
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
        className="flex items-center gap-2 p-1.5 pl-2 rounded-full hover:bg-[#F7F6F2] transition-colors border border-transparent hover:border-[#E3E1D9] focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
      >
        <div className="w-8 h-8 rounded-full bg-[#DCEDE8] text-[#168B83] font-bold text-xs flex items-center justify-center flex-shrink-0">
          {getInitials()}
        </div>
        <span className="hidden sm:inline-block text-xs font-semibold text-[#172B3A] max-w-[130px] truncate">
          {displayName}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#6B8092] transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#172B3A]' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="origin-top-right absolute right-0 mt-2 w-72 rounded-xl shadow-lg bg-white border border-[#E3E1D9] focus:outline-none z-50 animate-in fade-in-50 zoom-in-95 duration-100"
        >
          {/* User Profile Header */}
          <div className="p-4 border-b border-[#E3E1D9] bg-[#F7F6F2]/50 rounded-t-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-[#DCEDE8] text-[#168B83] font-bold text-sm flex items-center justify-center flex-shrink-0">
                {getInitials()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#172B3A] truncate">{displayName}</p>
                <p className="text-xs text-[#6B8092] truncate flex items-center gap-1">
                  <Mail className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{user?.email || 'Authenticated Account'}</span>
                </p>
              </div>
            </div>

            {/* Email Verification Status Badge (Grounded in Genuine Backend State) */}
            {user?.isEmailVerified === true ? (
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Email</span>
              </div>
            ) : user?.isEmailVerified === false ? (
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Email Unverified</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-[#6B8092] text-[11px] font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-[#168B83]" />
                <span>Session Active</span>
              </div>
            )}
          </div>

          {/* Action Links */}
          <div className="py-2" role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                navigate('/settings');
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#3D5265] hover:text-[#172B3A] hover:bg-[#F7F6F2] transition-colors"
            >
              <Settings className="w-4 h-4 text-[#6B8092]" />
              <span>Account Settings & Preferences</span>
            </button>
          </div>

          {/* Logout Section */}
          <div className="p-2 border-t border-[#E3E1D9]" role="none">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                {isLoggingOut ? (
                  <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
              </div>
              <span className="text-[10px] text-rose-400 font-normal">End Session</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
