import { validateMeetingCode } from './meetingCode.ts';

export type HeaderSearchGroup = 'Join Room' | 'Meetings' | 'Actions' | 'Navigation';
export type HeaderActionId =
  | 'instant-meeting'
  | 'join-code'
  | 'schedule-meeting'
  | 'help-shortcuts';

export interface HeaderMeetingCandidate {
  id: string;
  meetingCode: string;
  title: string;
  startAt: string;
  status: string;
  isHost?: boolean;
  kind: 'upcoming' | 'recent';
}

export interface HeaderSearchItem {
  id: string;
  group: HeaderSearchGroup;
  title: string;
  subtitle: string;
  badge?: string;
  kind: 'direct-join' | 'meeting' | 'action' | 'navigation';
  meetingCode?: string;
  meetingKind?: 'upcoming' | 'recent';
  route?: string;
  actionId?: HeaderActionId;
  keywords: string[];
}

export interface ShortcutHint {
  modifier: '⌘' | 'Ctrl';
  compactLabel: string;
  readableLabel: string;
}

const GROUP_ORDER: HeaderSearchGroup[] = ['Join Room', 'Meetings', 'Actions', 'Navigation'];
const MAX_DEFAULT_MEETINGS = 3;
const MAX_QUERY_MEETINGS = 6;

const BASE_COMMAND_ITEMS: Omit<HeaderSearchItem, 'badge'>[] = [
  {
    id: 'instant-meeting',
    group: 'Actions',
    title: 'Start Instant Meeting',
    subtitle: 'Launch a room now and copy the invite link',
    kind: 'action',
    actionId: 'instant-meeting',
    keywords: ['instant', 'room', 'start', 'call', 'video', 'launch', 'now'],
  },
  {
    id: 'join-code',
    group: 'Actions',
    title: 'Join with Room Code',
    subtitle: 'Enter a cly-xxx-xxx room code or invite link',
    kind: 'action',
    actionId: 'join-code',
    keywords: ['join', 'code', 'room', 'enter', 'cly', 'link'],
  },
  {
    id: 'schedule-meeting',
    group: 'Actions',
    title: 'Schedule Meeting',
    subtitle: 'Plan a future session with waiting room defaults',
    kind: 'action',
    actionId: 'schedule-meeting',
    keywords: ['schedule', 'calendar', 'plan', 'invite', 'future'],
  },
  {
    id: 'help-shortcuts',
    group: 'Actions',
    title: 'Help & Keyboard Shortcuts',
    subtitle: 'Room code format, shortcuts, and security overview',
    kind: 'action',
    actionId: 'help-shortcuts',
    keywords: ['help', 'shortcuts', 'keyboard', 'support', 'ctrl+k'],
  },
  {
    id: 'nav-overview',
    group: 'Navigation',
    title: 'Dashboard Overview',
    subtitle: 'Pre-call studio, upcoming rooms, and recent calls',
    kind: 'navigation',
    route: '/dashboard',
    keywords: ['dashboard', 'overview', 'home', 'studio', 'main'],
  },
  {
    id: 'nav-meetings',
    group: 'Navigation',
    title: 'Meetings & History',
    subtitle: 'Upcoming sessions and last 48h attendance logs',
    kind: 'navigation',
    route: '/meetings',
    keywords: ['meetings', 'history', 'calendar', 'sessions', 'recent'],
  },
  {
    id: 'nav-downloads',
    group: 'Navigation',
    title: 'Downloads & Shared Files',
    subtitle: 'Files exchanged inside collaboration rooms',
    kind: 'navigation',
    route: '/downloads',
    keywords: ['downloads', 'files', 'documents', 'shared'],
  },
  {
    id: 'nav-settings',
    group: 'Navigation',
    title: 'Account & Hardware Settings',
    subtitle: 'Default mic, camera, theme, and profile preferences',
    kind: 'navigation',
    route: '/settings',
    keywords: ['settings', 'preferences', 'audio', 'video', 'account', 'profile', 'theme'],
  },
];

/**
 * Returns OS-appropriate keyboard shortcut labels for the search trigger pill.
 */
export function detectShortcutHint(userAgent?: string): ShortcutHint {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' ? `${navigator.platform || ''} ${navigator.userAgent || ''}` : '');
  const isApple = /(Mac|iPhone|iPad|iPod)/i.test(ua);

  if (isApple) {
    return {
      modifier: '⌘',
      compactLabel: '⌘ K',
      readableLabel: 'Command+K',
    };
  }

  return {
    modifier: 'Ctrl',
    compactLabel: 'Ctrl K',
    readableLabel: 'Ctrl+K',
  };
}

const EXPLICIT_CLY_PATTERN = /^cly-?[a-z0-9]{3}-?[a-z0-9]{3}$/i;
const MEETING_PATH_PATTERN = /^\/(?:join|lobby|meeting)\/([^/?#]+)\/?$/i;

/**
 * Extracts a canonical room code (`cly-xxx-xxx`) when the user enters an explicit `cly` room code or meeting link.
 */
export function extractMeetingCodeFromSearch(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  let candidate = '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const pathMatch = parsed.pathname.match(MEETING_PATH_PATTERN);
      if (!pathMatch?.[1] || !EXPLICIT_CLY_PATTERN.test(pathMatch[1])) {
        return null;
      }
      candidate = pathMatch[1];
    } catch {
      return null;
    }
  } else if (trimmed.startsWith('/')) {
    const cleanPath = trimmed.split('?')[0].split('#')[0];
    const pathMatch = cleanPath.match(MEETING_PATH_PATTERN);
    if (!pathMatch?.[1] || !EXPLICIT_CLY_PATTERN.test(pathMatch[1])) {
      return null;
    }
    candidate = pathMatch[1];
  } else if (EXPLICIT_CLY_PATTERN.test(trimmed)) {
    candidate = trimmed;
  } else {
    return null;
  }

  const validated = validateMeetingCode(candidate);
  return validated.isValid ? validated.normalizedCode : null;
}

function formatMeetingWhen(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function deduplicateMeetings(
  upcomingMeetings: HeaderMeetingCandidate[],
  recentMeetings: HeaderMeetingCandidate[]
): HeaderMeetingCandidate[] {
  const seenCodes = new Set<string>();
  const combined: HeaderMeetingCandidate[] = [];

  for (const candidate of [...upcomingMeetings, ...recentMeetings]) {
    const normalized = candidate.meetingCode.trim().toLowerCase();
    if (!normalized || seenCodes.has(normalized)) continue;
    seenCodes.add(normalized);
    combined.push({ ...candidate, meetingCode: normalized });
  }

  return combined;
}

function toMeetingSearchItem(meeting: HeaderMeetingCandidate): HeaderSearchItem {
  const formattedTime = formatMeetingWhen(meeting.startAt);
  const statusUpper = (meeting.status || '').toUpperCase();
  const roleLabel =
    statusUpper === 'CANCELLED'
      ? 'Cancelled'
      : statusUpper === 'EXPIRED'
        ? 'Expired'
        : meeting.isHost
          ? 'Host'
          : meeting.kind === 'upcoming'
            ? 'Scheduled'
            : 'Attended';
  const subtitleParts = [meeting.meetingCode, formattedTime, roleLabel].filter(Boolean);

  return {
    id: `meeting-${meeting.kind}-${meeting.meetingCode}`,
    group: 'Meetings',
    title: meeting.title?.trim() || 'Untitled Meeting',
    subtitle: subtitleParts.join(' · '),
    badge: meeting.kind === 'upcoming' ? 'Join Lobby' : 'View Log',
    kind: 'meeting',
    meetingCode: meeting.meetingCode,
    meetingKind: meeting.kind,
    route: meeting.kind === 'upcoming' ? `/lobby/${meeting.meetingCode}` : '/meetings',
    keywords: [
      meeting.title || '',
      meeting.meetingCode,
      meeting.kind,
      statusUpper.toLowerCase(),
      meeting.isHost ? 'host' : 'participant',
    ],
  };
}

function matchesQuery(item: Pick<HeaderSearchItem, 'title' | 'subtitle' | 'keywords'>, queryLower: string): boolean {
  return (
    item.title.toLowerCase().includes(queryLower) ||
    item.subtitle.toLowerCase().includes(queryLower) ||
    item.keywords.some((kw) => kw.toLowerCase().includes(queryLower))
  );
}

/**
 * Builds ranked command-palette results combining direct room-code joins, live meetings, actions, and routes.
 */
export function buildHeaderSearchResults({
  query,
  upcomingMeetings = [],
  recentMeetings = [],
}: {
  query: string;
  upcomingMeetings?: HeaderMeetingCandidate[];
  recentMeetings?: HeaderMeetingCandidate[];
}): HeaderSearchItem[] {
  const trimmed = query.trim();
  const queryLower = trimmed.toLowerCase();
  const results: HeaderSearchItem[] = [];

  const directCode = extractMeetingCodeFromSearch(trimmed);
  if (directCode) {
    results.push({
      id: `direct-join-${directCode}`,
      group: 'Join Room',
      title: `Join room ${directCode}`,
      subtitle: 'Open pre-join lobby directly',
      badge: 'Enter ↵',
      kind: 'direct-join',
      meetingCode: directCode,
      route: `/lobby/${directCode}`,
      keywords: [directCode, 'join', 'lobby'],
    });
  }

  const dedupedMeetings = deduplicateMeetings(upcomingMeetings, recentMeetings).map(toMeetingSearchItem);
  const matchingMeetings = queryLower
    ? dedupedMeetings.filter((item) => matchesQuery(item, queryLower)).slice(0, MAX_QUERY_MEETINGS)
    : dedupedMeetings.slice(0, MAX_DEFAULT_MEETINGS);
  results.push(...matchingMeetings);

  const staticItems: HeaderSearchItem[] = BASE_COMMAND_ITEMS.map((item) => ({
    ...item,
    badge: item.group === 'Actions' ? 'Action' : 'Go',
  }));
  const matchingStatic = queryLower
    ? staticItems.filter((item) => matchesQuery(item, queryLower))
    : staticItems;
  results.push(...matchingStatic);

  return results;
}

/**
 * Groups flattened search items in canonical presentation order while omitting empty sections.
 */
export function groupHeaderSearchResults(
  items: HeaderSearchItem[]
): { group: HeaderSearchGroup; items: HeaderSearchItem[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);
}
