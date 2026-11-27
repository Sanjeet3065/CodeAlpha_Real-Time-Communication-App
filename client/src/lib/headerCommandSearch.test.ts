import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectShortcutHint,
  extractMeetingCodeFromSearch,
  buildHeaderSearchResults,
  groupHeaderSearchResults,
  type HeaderMeetingCandidate,
} from './headerCommandSearch.ts';

describe('Header Command Search Utilities', () => {
  it('1. detects macOS Command vs Windows/Linux Ctrl shortcut hints safely', () => {
    const mac = detectShortcutHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    assert.strictEqual(mac.modifier, '⌘');
    assert.strictEqual(mac.compactLabel, '⌘ K');

    const win = detectShortcutHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    assert.strictEqual(win.modifier, 'Ctrl');
    assert.strictEqual(win.compactLabel, 'Ctrl K');

    const linux = detectShortcutHint('Mozilla/5.0 (X11; Linux x86_64)');
    assert.strictEqual(linux.compactLabel, 'Ctrl K');
  });

  it('2. extracts canonical room codes only from explicit room patterns or join/lobby URLs', () => {
    assert.strictEqual(extractMeetingCodeFromSearch('CLY-789-QWA'), 'cly-789-qwa');
    assert.strictEqual(extractMeetingCodeFromSearch('clyabc123'), 'cly-abc-123');
    assert.strictEqual(
      extractMeetingCodeFromSearch('https://connectly-meet.vercel.app/join/cly-789-qwa?ref=mail'),
      'cly-789-qwa'
    );
    assert.strictEqual(extractMeetingCodeFromSearch('/lobby/CLY-123-XYZ'), 'cly-123-xyz');

    // Ordinary 6-char words & unrelated paths must never masquerade as direct-join room codes
    for (const nonCode of ['design', 'review', 'shared', 'recent', 'launch', 'weekly', 'studio']) {
      assert.strictEqual(extractMeetingCodeFromSearch(nonCode), null);
    }
    assert.strictEqual(
      extractMeetingCodeFromSearch('https://connectly-meet.vercel.app/signup'),
      null
    );
    assert.strictEqual(extractMeetingCodeFromSearch('architecture'), null);
    assert.strictEqual(extractMeetingCodeFromSearch('javascript:alert(1)'), null);
    assert.strictEqual(extractMeetingCodeFromSearch(''), null);
  });

  it('3. surfaces direct Join Room entry when query contains a room code or invite link', () => {
    const results = buildHeaderSearchResults({
      query: 'https://connectly-meet.vercel.app/lobby/CLY-abc-999',
      upcomingMeetings: [],
      recentMeetings: [],
    });

    assert.strictEqual(results[0]?.group, 'Join Room');
    assert.strictEqual(results[0]?.kind, 'direct-join');
    assert.strictEqual(results[0]?.meetingCode, 'cly-abc-999');
  });

  it('4. filters live upcoming & recent meetings cleanly and deduplicates overlapping codes in favor of upcoming', () => {
    const upcoming: HeaderMeetingCandidate[] = [
      {
        id: 'm1',
        meetingCode: 'cly-aaa-111',
        title: 'Product Architecture Sync',
        startAt: '2026-11-28T10:00:00.000Z',
        status: 'SCHEDULED',
        isHost: true,
        kind: 'upcoming',
      },
      {
        id: 'm2',
        meetingCode: 'cly-bbb-222',
        title: 'Design Review',
        startAt: '2026-11-28T14:00:00.000Z',
        status: 'SCHEDULED',
        isHost: false,
        kind: 'upcoming',
      },
    ];
    const recent: HeaderMeetingCandidate[] = [
      {
        id: 'm1-dup',
        meetingCode: 'CLY-AAA-111',
        title: 'Product Architecture Sync',
        startAt: '2026-11-27T09:00:00.000Z',
        status: 'ENDED',
        isHost: true,
        kind: 'recent',
      },
      {
        id: 'm3',
        meetingCode: 'cly-ccc-333',
        title: 'Sprint Retro',
        startAt: '2026-11-26T16:00:00.000Z',
        status: 'ENDED',
        isHost: false,
        kind: 'recent',
      },
    ];

    const matching = buildHeaderSearchResults({
      query: 'architecture',
      upcomingMeetings: upcoming,
      recentMeetings: recent,
    });
    const meetingMatches = matching.filter((item) => item.kind === 'meeting');
    assert.strictEqual(meetingMatches.length, 1);
    assert.strictEqual(meetingMatches[0].meetingCode, 'cly-aaa-111');
    assert.strictEqual(meetingMatches[0].meetingKind, 'upcoming');

    const defaultOpen = buildHeaderSearchResults({
      query: '',
      upcomingMeetings: upcoming,
      recentMeetings: recent,
    });
    const defaultMeetings = defaultOpen.filter((item) => item.kind === 'meeting');
    assert.strictEqual(defaultMeetings.length, 3);
    assert.strictEqual(
      defaultMeetings.find((item) => item.meetingCode === 'cly-ccc-333')?.route,
      '/meetings/history'
    );
    assert.ok(defaultOpen.some((item) => item.actionId === 'instant-meeting'));
    assert.ok(defaultOpen.some((item) => item.route === '/meetings'));
  });

  it('5. groups search results in canonical display order without empty groups', () => {
    const items = buildHeaderSearchResults({
      query: 'cly-555-777',
      upcomingMeetings: [],
      recentMeetings: [],
    });
    const grouped = groupHeaderSearchResults(items);
    assert.deepStrictEqual(
      grouped.map((g) => g.group),
      ['Join Room']
    );

    const groupedDefault = groupHeaderSearchResults(
      buildHeaderSearchResults({
        query: '',
        upcomingMeetings: [
          {
            id: 'm9',
            meetingCode: 'cly-999-888',
            title: 'Weekly Standup',
            startAt: '2026-11-28T09:00:00.000Z',
            status: 'SCHEDULED',
            isHost: true,
            kind: 'upcoming',
          },
        ],
        recentMeetings: [],
      })
    );
    assert.deepStrictEqual(
      groupedDefault.map((g) => g.group),
      ['Meetings', 'Actions', 'Navigation']
    );
  });

  it('6. labels cancelled and expired recent meetings accurately instead of Attended', () => {
    const recent: HeaderMeetingCandidate[] = [
      {
        id: 'c1',
        meetingCode: 'cly-can-001',
        title: 'Cancelled Sync',
        startAt: '2026-11-26T10:00:00.000Z',
        status: 'CANCELLED',
        isHost: false,
        kind: 'recent',
      },
      {
        id: 'e1',
        meetingCode: 'cly-exp-002',
        title: 'Expired Room',
        startAt: '2026-11-26T12:00:00.000Z',
        status: 'EXPIRED',
        isHost: false,
        kind: 'recent',
      },
    ];

    const results = buildHeaderSearchResults({
      query: '',
      upcomingMeetings: [],
      recentMeetings: recent,
    });

    const cancelled = results.find((r) => r.meetingCode === 'cly-can-001');
    const expired = results.find((r) => r.meetingCode === 'cly-exp-002');
    assert.ok(cancelled?.subtitle.includes('Cancelled'));
    assert.ok(!cancelled?.subtitle.includes('Attended'));
    assert.ok(expired?.subtitle.includes('Expired'));
    assert.ok(!expired?.subtitle.includes('Attended'));
  });
});
