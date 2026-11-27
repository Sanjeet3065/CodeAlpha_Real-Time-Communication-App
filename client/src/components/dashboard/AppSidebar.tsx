import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { BrandMark } from '@/components/ui/BrandMark';
import { getAvatarAccentClasses } from '@/lib/avatarAccent';
import {
  LayoutDashboard,
  Calendar,
  FolderDown,
  Settings,
} from 'lucide-react';

interface AppSidebarProps {
  onCloseMobile?: () => void;
  className?: string;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
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

  const fullName = user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : 'Workspace Member';

  return (
    <aside
      className={`w-64 bg-[#FAF9F6] dark:bg-[#1C1F24] border-r border-[#DDDAD0] dark:border-[#2B3038] flex flex-col justify-between h-full select-none ${className}`}
      aria-label="Sidebar Navigation"
    >
      {/* Top Branding Section */}
      <div>
        <div className="h-16 px-5 flex items-center border-b border-[#DDDAD0] dark:border-[#2B3038]">
          <Link
            to="/dashboard"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
          >
            <BrandMark />
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-lg tracking-tight text-[#1F2428] dark:text-[#EAECEE] leading-none">
                CONNECTLY
              </span>
              <span className="text-[10px] font-medium text-[#646D77] dark:text-[#8E96A0] mt-0.5 leading-none">
                Video Workspace
              </span>
            </div>
          </Link>
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
                      ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold'
                      : 'text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 transition-colors ${
                          isActive ? 'text-[#2F6F68] dark:text-[#5FA399]' : 'text-[#7C848D] dark:text-[#A3AAB2]'
                        }`}
                      />
                      <span>{item.name}</span>
                    </div>
                    {isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#2F6F68] dark:bg-[#5FA399]"
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

      {/* Bottom Compact User Profile Link */}
      <div className="p-4 border-t border-[#DDDAD0] dark:border-[#2B3038]">
        <Link
          to="/settings"
          onClick={onCloseMobile}
          className="p-2.5 bg-[#F3F2EE] dark:bg-[#141619] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] rounded-xl border border-[#DDDAD0]/80 dark:border-[#2B3038] flex items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]"
        >
          <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center flex-shrink-0 ${getAvatarAccentClasses(user?.avatarColor)}`}>
            {getInitials()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
              {fullName}
            </p>
            <p className="text-[11px] text-[#7C848D] dark:text-[#8E96A0] truncate">
              {user?.email || 'Account Settings'}
            </p>
          </div>
        </Link>
      </div>
    </aside>
  );
};
