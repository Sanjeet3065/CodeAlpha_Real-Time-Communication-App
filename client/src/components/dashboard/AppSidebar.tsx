import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard,
  Calendar,
  FolderDown,
  Settings,
  Video,
  ShieldCheck,
} from 'lucide-react';

interface AppSidebarProps {
  onCloseMobile?: () => void;
  className?: string;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navigationItems: NavItem[] = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Meetings', href: '/meetings', icon: Calendar },
  { name: 'Downloads', href: '/downloads', icon: FolderDown },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export const AppSidebar: React.FC<AppSidebarProps> = ({ onCloseMobile, className = '' }) => {
  const { user } = useAuth();

  const getInitials = () => {
    if (!user) return 'U';
    const first = user.firstName?.[0] || '';
    const last = user.lastName?.[0] || '';
    return (first + last).toUpperCase() || 'U';
  };

  return (
    <aside
      className={`w-64 bg-white border-r border-[#E3E1D9] flex flex-col justify-between h-full select-none ${className}`}
      aria-label="Sidebar Navigation"
    >
      {/* Top Branding Section */}
      <div>
        <div className="h-16 px-6 flex items-center gap-3 border-b border-[#E3E1D9]">
          <div className="w-9 h-9 rounded-xl bg-[#168B83] flex items-center justify-center text-white shadow-sm flex-shrink-0">
            <Video className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="font-display font-extrabold text-lg tracking-tight text-[#172B3A] leading-tight">
              CONNECTLY
            </span>
            <span className="text-[10px] uppercase font-semibold text-[#168B83] tracking-wider">
              Collaboration
            </span>
          </div>
        </div>

        {/* Primary Navigation Links */}
        <nav className="p-4 space-y-1.5" aria-label="Main Navigation">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={onCloseMobile}
                end={item.href === '/dashboard'}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#DCEDE8] text-[#168B83] font-semibold'
                      : 'text-[#3D5265] hover:text-[#172B3A] hover:bg-[#F7F6F2]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 transition-colors ${
                          isActive ? 'text-[#168B83]' : 'text-[#6B8092]'
                        }`}
                      />
                      <span>{item.name}</span>
                    </div>
                    {isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#168B83]"
                        aria-hidden="true"
                      />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Bottom User Area & Session Telemetry */}
      <div className="p-4 border-t border-[#E3E1D9]">
        <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E3E1D9]/70 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#DCEDE8] text-[#168B83] font-bold text-xs flex items-center justify-center flex-shrink-0">
            {getInitials()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#172B3A] truncate">
              {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Active User'}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] text-[#6B8092] truncate flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-[#168B83]" />
                Session Active
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
