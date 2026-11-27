import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  HelpCircle,
  Video,
  Hash,
  Calendar,
  CalendarClock,
  FolderDown,
  Settings,
  LayoutDashboard,
  ArrowRight,
  CornerDownLeft,
  History,
  X,
  Loader2,
} from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { NotificationsPopover } from './NotificationsPopover';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HelpModal } from './HelpModal';
import { JoinMeetingModal } from './JoinMeetingModal';
import { InstantMeetingModal } from './InstantMeetingModal';
import { ScheduleNoticeModal } from './ScheduleNoticeModal';
import { schedulingApi } from '@/services/schedulingApi';
import { useAuth } from '@/context/AuthContext';
import {
  buildHeaderSearchResults,
  detectShortcutHint,
  groupHeaderSearchResults,
  type HeaderMeetingCandidate,
  type HeaderSearchItem,
} from '@/lib/headerCommandSearch';

interface DashboardHeaderProps {
  onOpenMobileMenu: () => void;
  title?: string;
  subtitle?: string;
}

const SEARCH_CACHE_TTL_MS = 30_000;

function renderSearchItemIcon(item: HeaderSearchItem): React.ReactNode {
  if (item.kind === 'direct-join') {
    return <CornerDownLeft className="w-4 h-4" />;
  }
  if (item.kind === 'meeting') {
    return item.meetingKind === 'upcoming' ? (
      <CalendarClock className="w-4 h-4" />
    ) : (
      <History className="w-4 h-4" />
    );
  }

  switch (item.id) {
    case 'instant-meeting':
      return <Video className="w-4 h-4" />;
    case 'join-code':
      return <Hash className="w-4 h-4" />;
    case 'schedule-meeting':
    case 'nav-meetings':
      return <Calendar className="w-4 h-4" />;
    case 'nav-downloads':
      return <FolderDown className="w-4 h-4" />;
    case 'nav-settings':
      return <Settings className="w-4 h-4" />;
    case 'help-shortcuts':
      return <HelpCircle className="w-4 h-4" />;
    default:
      return <LayoutDashboard className="w-4 h-4" />;
  }
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  onOpenMobileMenu,
  title = 'Dashboard',
  subtitle = '',
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id;

  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isInstantOpen, setIsInstantOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [upcomingMeetings, setUpcomingMeetings] = useState<HeaderMeetingCandidate[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<HeaderMeetingCandidate[]>([]);
  const [isFetchingMeetings, setIsFetchingMeetings] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const suppressFocusOpenRef = useRef<boolean>(false);
  const keyboardNavRef = useRef<boolean>(false);
  const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastFetchedAtRef = useRef<number>(0);
  const fetchSeqRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  const shortcutHint = useMemo(() => detectShortcutHint(), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchSeqRef.current += 1;
    };
  }, []);

  // Reset cached meeting suggestions whenever the authenticated user changes
  useEffect(() => {
    lastFetchedAtRef.current = 0;
    setUpcomingMeetings([]);
    setRecentMeetings([]);
  }, [currentUserId]);

  const loadSearchMeetings = useCallback(async () => {
    const now = Date.now();
    if (lastFetchedAtRef.current > 0 && now - lastFetchedAtRef.current < SEARCH_CACHE_TTL_MS) {
      return;
    }

    const seq = ++fetchSeqRef.current;
    setIsFetchingMeetings(true);

    try {
      const [upcomingRes, recentRes] = await Promise.allSettled([
        schedulingApi.listUpcomingMeetings({ page: 1, limit: 8 }),
        schedulingApi.listMeetingHistory({ page: 1, limit: 6, sort: 'desc' }),
      ]);

      if (!mountedRef.current || fetchSeqRef.current !== seq) return;

      if (upcomingRes.status === 'fulfilled') {
        setUpcomingMeetings(
          upcomingRes.value.meetings.map((m) => ({
            id: m.id,
            meetingCode: m.meetingCode,
            title: m.title,
            startAt: m.scheduledStartAt || m.createdAt,
            status: m.status,
            isHost: Boolean(currentUserId && m.hostId === currentUserId),
            kind: 'upcoming',
          }))
        );
      }

      if (recentRes.status === 'fulfilled') {
        setRecentMeetings(
          recentRes.value.meetings.map((m) => ({
            id: m.id,
            meetingCode: m.meetingCode,
            title: m.title,
            startAt: m.endedAt || m.activatedAt || m.scheduledStartAt || m.createdAt,
            status: m.status,
            isHost: m.userRole === 'host',
            kind: 'recent',
          }))
        );
      }

      if (upcomingRes.status === 'fulfilled' && recentRes.status === 'fulfilled') {
        lastFetchedAtRef.current = Date.now();
      }
    } finally {
      if (mountedRef.current && fetchSeqRef.current === seq) {
        setIsFetchingMeetings(false);
      }
    }
  }, [currentUserId]);

  const openSearchPalette = useCallback(() => {
    setIsSearchOpen(true);
    void loadSearchMeetings();
  }, [loadSearchMeetings]);

  const dismissSearchOnEscape = useCallback(() => {
    setIsSearchOpen(false);
    const returnTarget = prevFocusRef.current;
    prevFocusRef.current = null;
    if (returnTarget && returnTarget.isConnected && returnTarget !== searchInputRef.current) {
      returnTarget.focus();
    } else {
      searchInputRef.current?.blur();
    }
  }, []);

  const filteredItems = useMemo(
    () =>
      buildHeaderSearchResults({
        query: searchQuery,
        upcomingMeetings,
        recentMeetings,
      }),
    [searchQuery, upcomingMeetings, recentMeetings]
  );

  const groupedSections = useMemo(
    () => groupHeaderSearchResults(filteredItems),
    [filteredItems]
  );

  const flatIndexById = useMemo(() => {
    const map = new Map<string, number>();
    filteredItems.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [filteredItems]);

  const activeHighlightIndex =
    filteredItems.length > 0 ? Math.min(highlightedIndex, filteredItems.length - 1) : -1;
  const activeOptionId =
    isSearchOpen && activeHighlightIndex >= 0 && filteredItems[activeHighlightIndex]
      ? `header-command-option-${filteredItems[activeHighlightIndex].id}`
      : undefined;

  useEffect(() => {
    if (!isSearchOpen || activeHighlightIndex < 0 || !keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const activeItem = filteredItems[activeHighlightIndex];
    if (!activeItem) return;
    const node = optionRefs.current.get(activeItem.id);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [isSearchOpen, activeHighlightIndex, filteredItems]);

  // Global Ctrl+K / Cmd+K shortcut guarded against background inputs, hidden mobile header, and active dialogs
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const container = searchContainerRef.current;
        if (!container || container.offsetParent === null) {
          return;
        }

        if (
          isHelpOpen ||
          isJoinOpen ||
          isInstantOpen ||
          isScheduleOpen ||
          document.querySelector('[role="dialog"][aria-modal="true"]')
        ) {
          return;
        }

        const activeEl = document.activeElement;
        const isTypingInOtherInput =
          activeEl &&
          activeEl !== searchInputRef.current &&
          (activeEl instanceof HTMLInputElement ||
            activeEl instanceof HTMLTextAreaElement ||
            (activeEl as HTMLElement).isContentEditable);

        if (isTypingInOtherInput) {
          return;
        }

        e.preventDefault();
        if (activeEl instanceof HTMLElement && activeEl !== searchInputRef.current) {
          prevFocusRef.current = activeEl;
        }
        suppressFocusOpenRef.current = false;
        searchInputRef.current?.focus();
        openSearchPalette();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isHelpOpen, isJoinOpen, isInstantOpen, isScheduleOpen, openSearchPalette]);

  // Close search on outside mousedown without pulling focus back into the input
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
        prevFocusRef.current = null;
      }
    };
    if (isSearchOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isSearchOpen]);

  const executeSearchItem = (item: HeaderSearchItem) => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setHighlightedIndex(0);
    prevFocusRef.current = null;

    if (item.route) {
      searchInputRef.current?.blur();
      navigate(item.route);
      return;
    }

    // Prevent modal close focus restoration from spuriously reopening the search palette
    suppressFocusOpenRef.current = true;
    searchInputRef.current?.blur();

    switch (item.actionId) {
      case 'instant-meeting':
        setIsInstantOpen(true);
        break;
      case 'join-code':
        setIsJoinOpen(true);
        break;
      case 'schedule-meeting':
        setIsScheduleOpen(true);
        break;
      case 'help-shortcuts':
        setIsHelpOpen(true);
        break;
      default:
        break;
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissSearchOnEscape();
      return;
    }

    if (!isSearchOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        openSearchPalette();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        keyboardNavRef.current = true;
        setHighlightedIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        keyboardNavRef.current = true;
        setHighlightedIndex((prev) => (prev <= 0 ? filteredItems.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeHighlightIndex >= 0 && filteredItems[activeHighlightIndex]) {
        executeSearchItem(filteredItems[activeHighlightIndex]);
      }
    }
  };

  return (
    <>
      <header className="h-16 bg-[#FAF9F6]/95 dark:bg-[#1C1F24]/95 backdrop-blur-md border-b border-[#DDDAD0] dark:border-[#2B3038] sticky top-0 z-30 px-3 sm:px-5 xl:px-8 flex items-center justify-between gap-2 sm:gap-3 xl:gap-5">
        {/* Left Zone: Mobile Menu Trigger & Workspace Title */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 lg:max-w-[175px] xl:max-w-[230px]">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open sidebar navigation"
            className="w-9 h-9 inline-flex items-center justify-center -ml-1 rounded-lg bg-[#F3F2EE]/85 dark:bg-[#141619]/90 border border-[#DDDAD0] dark:border-[#2B3038] text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] lg:hidden transition-colors flex-shrink-0"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex flex-col min-w-0">
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#1F2428] dark:text-[#EAECEE] leading-tight truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="hidden xl:block text-[11px] text-[#7C848D] dark:text-[#A3AAB2] leading-tight truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Center Zone: Spacious Studio Command & Meeting Search Bar */}
        <div
          className="hidden lg:flex flex-1 min-w-[250px] max-w-lg mx-auto relative"
          ref={searchContainerRef}
          onBlur={(e) => {
            if (!searchContainerRef.current?.contains(e.relatedTarget as Node)) {
              setIsSearchOpen(false);
              prevFocusRef.current = null;
            }
          }}
        >
          <div className="relative w-full h-10 rounded-lg bg-[#F3F2EE]/90 dark:bg-[#141619]/90 border border-[#DDDAD0] dark:border-[#2B3038] hover:border-[#C5C1B4] dark:hover:border-[#3A404A] focus-within:bg-[#FAF9F6] dark:focus-within:bg-[#1C1F24] focus-within:border-[#2F6F68]/60 dark:focus-within:border-[#5FA399]/60 focus-within:ring-2 focus-within:ring-[#2F6F68]/20 dark:focus-within:ring-[#5FA399]/20 transition-all shadow-cly-sm flex items-center">
            <div
              className={`pl-3 pr-2 flex items-center pointer-events-none transition-colors ${
                isSearchOpen
                  ? 'text-[#2F6F68] dark:text-[#5FA399]'
                  : 'text-[#7C848D] dark:text-[#8E96A0]'
              }`}
            >
              <Search className="w-4 h-4" />
            </div>

            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onMouseDown={() => {
                suppressFocusOpenRef.current = false;
                if (document.activeElement === searchInputRef.current && !isSearchOpen) {
                  openSearchPalette();
                }
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
                if (!isSearchOpen) openSearchPalette();
              }}
              onFocus={() => {
                if (suppressFocusOpenRef.current) {
                  suppressFocusOpenRef.current = false;
                  return;
                }
                openSearchPalette();
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search meetings, room code, or action..."
              aria-label="Search meetings and actions"
              aria-expanded={isSearchOpen}
              aria-haspopup="listbox"
              aria-controls="header-command-listbox"
              aria-activedescendant={activeOptionId}
              role="combobox"
              className="flex-1 min-w-0 h-full pr-2 bg-transparent text-xs sm:text-[13px] text-[#1F2428] dark:text-[#EAECEE] placeholder-[#7C848D] dark:placeholder-[#7E8791] focus:outline-none"
            />

            <div className="pr-2.5 flex items-center gap-1.5 flex-shrink-0">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    suppressFocusOpenRef.current = false;
                    setSearchQuery('');
                    setHighlightedIndex(0);
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="w-5 h-5 rounded-md inline-flex items-center justify-center text-[#7C848D] dark:text-[#8E96A0] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              <kbd
                aria-label={`Shortcut ${shortcutHint.readableLabel}`}
                className="hidden xl:inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-medium text-[#6B737C] dark:text-[#A3AAB2] bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-md select-none pointer-events-none"
              >
                {isSearchOpen && !searchQuery ? 'Esc' : shortcutHint.compactLabel}
              </kbd>
            </div>
          </div>

          {/* Grouped Command & Live Meeting Palette */}
          {isSearchOpen && (
            <div
              id="header-command-listbox"
              role="listbox"
              aria-label="Search suggestions"
              className="origin-top absolute top-full left-0 right-0 min-w-[340px] mt-2 bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-xl shadow-xl border border-[#DDDAD0] dark:border-[#2B3038] overflow-hidden z-50 transition-opacity duration-100 max-h-96 flex flex-col"
            >
              <div className="px-3.5 py-2 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE]/80 dark:bg-[#141619]/80 flex items-center justify-between text-[11px] text-[#7C848D] dark:text-[#A3AAB2] shrink-0">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-[#1F2428] dark:text-[#EAECEE] flex items-center gap-1.5">
                  <span>{searchQuery.trim() ? 'Matching Results' : 'Quick Command Bar'}</span>
                  {isFetchingMeetings && (
                    <Loader2 className="w-3 h-3 animate-spin text-[#2F6F68] dark:text-[#5FA399]" />
                  )}
                </span>
                <span>
                  {filteredItems.length} {filteredItems.length === 1 ? 'result' : 'results'}
                </span>
              </div>

              {filteredItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                  No meetings, room codes, or actions match &quot;{searchQuery}&quot;.
                </div>
              ) : (
                <div className="p-1.5 overflow-y-auto space-y-2">
                  {groupedSections.map((section, sectionIdx) => {
                    const groupHeadingId = `header-search-group-${sectionIdx}`;
                    return (
                      <div
                        key={section.group}
                        role="group"
                        aria-labelledby={groupHeadingId}
                        className="space-y-0.5"
                      >
                        <p
                          id={groupHeadingId}
                          className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#7C848D] dark:text-[#8E96A0]"
                        >
                          {section.group}
                        </p>

                        {section.items.map((item) => {
                          const itemIndex = flatIndexById.get(item.id) ?? 0;
                          const isHighlighted = itemIndex === activeHighlightIndex;

                          const iconBadgeClasses =
                            item.kind === 'direct-join'
                              ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
                              : item.kind === 'action' || item.meetingKind === 'upcoming'
                                ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]'
                                : 'bg-[#F3F2EE] dark:bg-[#141619] text-[#555D66] dark:text-[#A3AAB2]';

                          return (
                            <button
                              key={item.id}
                              id={`header-command-option-${item.id}`}
                              ref={(el) => {
                                if (el) {
                                  optionRefs.current.set(item.id, el);
                                } else {
                                  optionRefs.current.delete(item.id);
                                }
                              }}
                              type="button"
                              role="option"
                              tabIndex={-1}
                              aria-selected={isHighlighted}
                              onClick={() => executeSearchItem(item)}
                              onMouseEnter={() => {
                                keyboardNavRef.current = false;
                                setHighlightedIndex(itemIndex);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-left transition-colors ${
                                isHighlighted
                                  ? 'bg-[#E2ECE9]/80 dark:bg-[#1F302E]/85 text-[#1F2428] dark:text-[#EAECEE]'
                                  : 'hover:bg-[#F3F2EE] dark:hover:bg-[#24282E]'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${iconBadgeClasses}`}
                                >
                                  {renderSearchItemIcon(item)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
                                    {item.title}
                                  </p>
                                  <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] truncate">
                                    {item.subtitle}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                {item.badge && (
                                  <span
                                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm border ${
                                      item.kind === 'direct-join'
                                        ? 'bg-[#E2ECE9] dark:bg-[#1F302E] border-[#2F6F68]/30 dark:border-[#5FA399]/30 text-[#2F6F68] dark:text-[#5FA399]'
                                        : 'bg-[#FAF9F6] dark:bg-[#141619] border-[#DDDAD0] dark:border-[#2B3038] text-[#7C848D] dark:text-[#A3AAB2]'
                                    }`}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                                <ArrowRight
                                  className={`w-3 h-3 transition-transform ${
                                    isHighlighted
                                      ? 'text-[#2F6F68] dark:text-[#5FA399] translate-x-0.5'
                                      : 'text-[#7C848D] dark:text-[#A3AAB2]'
                                  }`}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Zone: Cohesive Studio Utility Dock & Profile Chip (Aligned h-10) */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
          <div
            role="group"
            aria-label="Workspace utilities"
            className="h-10 inline-flex items-center gap-0.5 p-1 rounded-lg bg-[#F3F2EE]/85 dark:bg-[#141619]/90 border border-[#DDDAD0] dark:border-[#2B3038]"
          >
            <ThemeToggle variant="dock" />

            <span className="h-4 w-px bg-[#DDDAD0] dark:bg-[#2B3038] mx-0.5" aria-hidden="true" />

            <button
              type="button"
              onClick={() => setIsHelpOpen(true)}
              title="Help & keyboard shortcuts"
              aria-label="Help and shortcuts"
              className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#FAF9F6] dark:hover:bg-[#24282E] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68]/40 dark:focus-visible:ring-[#5FA399]/40"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <NotificationsPopover triggerClassName="w-8 h-8 p-0 sm:p-0 inline-flex items-center justify-center rounded-md text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#FAF9F6] dark:hover:bg-[#24282E]" />
          </div>

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
