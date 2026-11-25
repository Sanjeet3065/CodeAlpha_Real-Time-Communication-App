import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  HelpCircle,
  Video,
  Hash,
  Calendar,
  FolderDown,
  Settings,
  LayoutDashboard,
  ArrowRight,
} from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { NotificationsPopover } from './NotificationsPopover';
import { HelpModal } from './HelpModal';
import { JoinMeetingModal } from './JoinMeetingModal';
import { InstantMeetingModal } from './InstantMeetingModal';
import { ScheduleNoticeModal } from './ScheduleNoticeModal';

interface DashboardHeaderProps {
  onOpenMobileMenu: () => void;
  title?: string;
  subtitle?: string;
}

interface SearchItem {
  id: string;
  title: string;
  description: string;
  category: 'Action' | 'Navigation';
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  keywords: string[];
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  onOpenMobileMenu,
  title = 'Dashboard',
  subtitle = 'Welcome to your real-time collaboration workspace',
}) => {
  const navigate = useNavigate();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isInstantOpen, setIsInstantOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Available Phase 06 Searchable Content & Actions (Strictly Phase 06 scope only)
  const searchItems: SearchItem[] = [
    {
      id: 'instant-meeting',
      title: 'Start Instant Meeting',
      description: 'Launch an ephemeral zero-latency collaboration room',
      category: 'Action',
      icon: Video,
      action: () => setIsInstantOpen(true),
      keywords: ['instant', 'room', 'start', 'call', 'video', 'launch'],
    },
    {
      id: 'join-code',
      title: 'Join Meeting with Code',
      description: 'Enter a 10-character code (cly-xxx-xxx) to enter a room',
      category: 'Action',
      icon: Hash,
      action: () => setIsJoinOpen(true),
      keywords: ['join', 'code', 'room', 'enter', 'cly'],
    },
    {
      id: 'schedule-meeting',
      title: 'Schedule Meeting',
      description: 'Plan upcoming sessions and calendar integration',
      category: 'Action',
      icon: Calendar,
      action: () => setIsScheduleOpen(true),
      keywords: ['schedule', 'calendar', 'plan', 'invite'],
    },
    {
      id: 'nav-overview',
      title: 'Dashboard Overview',
      description: 'View collaboration schedule and quick widgets',
      category: 'Navigation',
      icon: LayoutDashboard,
      action: () => navigate('/dashboard'),
      keywords: ['dashboard', 'overview', 'home', 'main'],
    },
    {
      id: 'nav-meetings',
      title: 'Meetings & History',
      description: 'View scheduled rooms and past attendance logs',
      category: 'Navigation',
      icon: Calendar,
      action: () => navigate('/meetings'),
      keywords: ['meetings', 'history', 'calendar', 'sessions'],
    },
    {
      id: 'nav-downloads',
      title: 'Downloads & Shared Files',
      description: 'Access files and media exchanged during meetings',
      category: 'Navigation',
      icon: FolderDown,
      action: () => navigate('/downloads'),
      keywords: ['downloads', 'files', 'documents', 'repository', 'shared'],
    },
    {
      id: 'nav-settings',
      title: 'Account Settings & Preferences',
      description: 'Configure hardware join defaults and identity',
      category: 'Navigation',
      icon: Settings,
      action: () => navigate('/settings'),
      keywords: ['settings', 'preferences', 'audio', 'video', 'account', 'profile'],
    },
    {
      id: 'help-shortcuts',
      title: 'Help & Keyboard Shortcuts',
      description: 'Review room code formats, shortcuts, and security',
      category: 'Action',
      icon: HelpCircle,
      action: () => setIsHelpOpen(true),
      keywords: ['help', 'shortcuts', 'keyboard', 'support', 'docs'],
    },
  ];

  // Filter items in real time
  const filteredItems = searchQuery.trim()
    ? searchItems.filter((item) => {
        const query = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.keywords.some((kw) => kw.includes(query))
        );
      })
    : searchItems;

  // Global ⌘K (macOS) / Ctrl+K (Windows/Linux) keyboard shortcut
  // Does not interfere when typing inside other inputs or textareas
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const activeEl = document.activeElement;
        const isTypingInOtherInput =
          activeEl &&
          activeEl !== searchInputRef.current &&
          (activeEl instanceof HTMLInputElement ||
            activeEl instanceof HTMLTextAreaElement ||
            (activeEl as HTMLElement).isContentEditable);

        if (isTypingInOtherInput) {
          // Do not interfere with user typing inside form inputs
          return;
        }

        e.preventDefault();
        if (!isSearchOpen) {
          prevFocusRef.current = activeEl as HTMLElement | null;
        }
        searchInputRef.current?.focus();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSearchOpen]);

  // Close search on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        closeSearchPalette();
      }
    };
    if (isSearchOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isSearchOpen]);

  const closeSearchPalette = () => {
    setIsSearchOpen(false);
    if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
      prevFocusRef.current.focus();
    }
  };

  // Handle Search Input Keyboard Navigation
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPalette();
      return;
    }

    if (!isSearchOpen) {
      setIsSearchOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev <= 0 ? (filteredItems.length || 1) - 1 : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[highlightedIndex]) {
        executeSearchItem(filteredItems[highlightedIndex]);
      }
    }
  };

  const executeSearchItem = (item: SearchItem) => {
    setIsSearchOpen(false);
    setSearchQuery('');
    if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
      prevFocusRef.current.focus();
    }
    item.action();
  };

  return (
    <>
      <header className="h-16 bg-white border-b border-[#E3E1D9] sticky top-0 z-30 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Side: Mobile Menu Button & Page Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open sidebar navigation"
            className="p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-[#F7F6F2] lg:hidden transition-colors flex-shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex flex-col min-w-0">
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#172B3A] leading-tight truncate">
              {title}
            </h1>
            <p className="hidden xl:block text-[11px] text-[#6B8092] leading-tight truncate">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Center: Functional Search Input (Visible on Laptop & Desktop 1024px+) */}
        <div className="hidden lg:flex flex-1 max-w-md mx-4 relative" ref={searchContainerRef}>
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B8092]">
              <Search className="w-4 h-4" />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
                setIsSearchOpen(true);
              }}
              onFocus={() => {
                if (!isSearchOpen) {
                  prevFocusRef.current = document.activeElement as HTMLElement | null;
                }
                setIsSearchOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search meetings, files, and actions..."
              aria-label="Search meetings and actions"
              aria-expanded={isSearchOpen}
              aria-haspopup="listbox"
              role="combobox"
              className="w-full pl-9 pr-16 py-1.5 bg-[#F7F6F2] border border-[#E3E1D9] rounded-lg text-xs text-[#172B3A] placeholder-[#6B8092] focus:outline-none focus:ring-2 focus:ring-[#168B83]/30 focus:bg-white transition-all"
            />
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium text-[#6B8092] bg-white border border-[#E3E1D9] rounded shadow-xs">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Quick Search Dropdown Palette */}
          {isSearchOpen && (
            <div
              role="listbox"
              aria-label="Search suggestions"
              className="origin-top absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-[#E3E1D9] overflow-hidden z-50 animate-in fade-in-50 zoom-in-95 duration-100 max-h-80 overflow-y-auto"
            >
              <div className="p-2 border-b border-[#E3E1D9] bg-[#F7F6F2]/50 flex items-center justify-between text-[11px] text-[#6B8092]">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-[#172B3A]">
                  {searchQuery.trim() ? 'Matching Results' : 'Quick Actions & Sections'}
                </span>
                <span>{filteredItems.length} found</span>
              </div>

              {filteredItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#6B8092]">
                  No matching actions or destinations found for &quot;{searchQuery}&quot;.
                </div>
              ) : (
                <div className="p-1 divide-y divide-[#E3E1D9]/40">
                  {filteredItems.map((item, index) => {
                    const Icon = item.icon;
                    const isHighlighted = index === highlightedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onClick={() => executeSearchItem(item)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-colors ${
                          isHighlighted ? 'bg-[#DCEDE8]/70 text-[#172B3A]' : 'hover:bg-[#F7F6F2]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              item.category === 'Action'
                                ? 'bg-[#DCEDE8] text-[#168B83]'
                                : 'bg-[#F7F6F2] text-[#3D5265]'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#172B3A] truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-[#6B8092] truncate">
                              {item.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-[#E3E1D9] text-[#6B8092]">
                            {item.category}
                          </span>
                          <ArrowRight className="w-3 h-3 text-[#6B8092]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Help, Notifications, Account Menu */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {/* Help Button */}
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            aria-label="Help and shortcuts"
            className="p-1.5 sm:p-2 rounded-lg text-[#6B8092] hover:text-[#172B3A] hover:bg-[#F7F6F2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#168B83]/30"
          >
            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Notifications Popover */}
          <NotificationsPopover />

          <div className="h-5 w-px bg-[#E3E1D9] mx-0.5 sm:mx-1" aria-hidden="true" />

          {/* User Account Menu */}
          <AccountMenu />
        </div>
      </header>

      {/* Global Interactive Modals triggered from Header / Search */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <JoinMeetingModal isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
      <InstantMeetingModal isOpen={isInstantOpen} onClose={() => setIsInstantOpen(false)} />
      <ScheduleNoticeModal isOpen={isScheduleOpen} onClose={() => setIsScheduleOpen(false)} />
    </>
  );
};
