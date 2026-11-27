# Studio Header & Command Search Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `DashboardHeader` into a balanced, cohesive `h-10` studio top bar with live meeting/room-code search and matched right-side utility controls.

**Architecture:** Extract pure command/meeting search filtering, URL/room-code detection (`validateMeetingCode`), deduplication, and OS shortcut formatting into `client/src/lib/headerCommandSearch.ts` with `node:test` coverage first (TDD). Then update `ThemeToggle`, `NotificationsPopover`, `HelpModal`, `AccountMenu`, and `DashboardHeader` to share uniform `h-10` dock geometry, responsive alignment, dark-mode contrast, and cached `schedulingApi` lookups.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide icons, `node:test`, Vite.

**Spec:** `docs/superpowers/specs/2026-11-27-studio-header-command-bar-design.md`

## Global Constraints
- Preserve accessible labels (`Search meetings and actions`, `Help and shortcuts`, `Switch theme mode (...)`, `View notifications (...)`, `User account menu for ...`) and `combobox`/`listbox` ARIA roles.
- Keep `ThemeToggle` existing `compact` (AuthGateway/PreJoinLobby) and `segmented` (Settings) visuals unchanged; add `variant="dock"` specifically for header grouping.
- Zero external API calls on initial header mount beyond existing `NotificationsPopover` fetch; fetch scheduled/history meetings only when search opens, cached for 30 seconds.

## Review Focus
- Typing or pasting a full invite URL (`https://connectly-meet.vercel.app/join/cly-abc-123`) extracts canonical lowercase `cly-abc-123` as a `Direct Join` result without throwing or opening unsafe URLs.
- Duplicate `meetingCode` between upcoming and recent meetings deduplicates in favor of `upcoming` and never renders duplicate React keys.
- `Ctrl+K` / `Cmd+K` shortcut still ignores keystrokes when focus is inside another `<input>`, `<textarea>`, or `contentEditable`, and clearing search with `×` returns focus to the search input cleanly.
- Unmounting or rapidly closing `DashboardHeader` mid-fetch cancels stale async state updates.
- Narrow (`1024px`) laptop viewport maintains balanced alignment without text clipping or control wrapping.

---

### Task 1: Pure Smart Command Search Helper (`headerCommandSearch.ts`)

**Files:**
- Create: `client/src/lib/headerCommandSearch.ts`
- Test: `client/src/lib/headerCommandSearch.test.ts`

**Interfaces:**
- Consumes: `validateMeetingCode` from `./meetingCode`
- Produces:
  - `detectShortcutHint(userAgent?: string): { modifier: '⌘' | 'Ctrl'; compactLabel: string; readableLabel: string }`
  - `extractMeetingCodeFromSearch(query: string): string | null`
  - `buildHeaderSearchResults(input: { query: string; upcomingMeetings?: HeaderMeetingCandidate[]; recentMeetings?: HeaderMeetingCandidate[] }): HeaderSearchItem[]`
  - `groupHeaderSearchResults(items: HeaderSearchItem[]): { group: HeaderSearchGroup; items: HeaderSearchItem[] }[]`

- [ ] **Step 1: Write failing tests in `client/src/lib/headerCommandSearch.test.ts`**
  Cover:
  1. Direct `cly-xxx-xxx` code and full URL extraction (`extractMeetingCodeFromSearch`), rejecting XSS/invalid strings.
  2. OS shortcut detection (`detectShortcutHint`) returning `⌘` on macOS and `Ctrl` on Windows/Linux.
  3. Live meeting matching + deduplication (`upcoming` wins over `recent` for identical code, default open state caps cleanly at 3 meetings + static actions/navigation).
  4. Grouped output order (`Join Room` -> `Meetings` -> `Actions` -> `Navigation`) and empty query search fallback.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test client/src/lib/headerCommandSearch.test.ts`
  Expected: FAIL (`Cannot find module './headerCommandSearch.ts'`)

- [ ] **Step 3: Implement `client/src/lib/headerCommandSearch.ts`**
  Implement pure, zero-side-effect helpers using `validateMeetingCode`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test client/src/lib/headerCommandSearch.test.ts`
  Expected: PASS (`pass 5, fail 0` or exact count)

- [ ] **Step 5: Commit**
  `git add client/src/lib/headerCommandSearch.ts client/src/lib/headerCommandSearch.test.ts docs/superpowers/specs/2026-11-27-studio-header-command-bar-design.md docs/superpowers/plans/2026-11-27-studio-header-command-bar.md && git commit -m "feat(header): add smart command search helper and header spec"`

---

### Task 2: Cohesive `h-10` Utility Bar, Command Header & Dark-Mode Polish

**Files:**
- Modify: `client/src/components/ui/ThemeToggle.tsx`
- Modify: `client/src/components/dashboard/NotificationsPopover.tsx`
- Modify: `client/src/components/dashboard/AccountMenu.tsx`
- Modify: `client/src/components/dashboard/HelpModal.tsx`
- Modify: `client/src/components/dashboard/DashboardHeader.tsx`
- Modify: `client/src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `buildHeaderSearchResults`, `groupHeaderSearchResults`, `detectShortcutHint` from `@/lib/headerCommandSearch`; `schedulingApi.listUpcomingMeetings`, `schedulingApi.listMeetingHistory` from `@/services/schedulingApi`
- Produces: Updated header UI preserving all existing props on `DashboardHeader`, `NotificationsPopover` (+ optional `triggerClassName`), `AccountMenu` (+ optional `triggerClassName`), and `ThemeToggle` (+ `'dock'` variant).

- [ ] **Step 1: Add contract assertions in `client/src/lib/dashboard.test.ts` verifying the cohesive studio header**
  Assert:
  1. `DashboardHeader` imports and uses `buildHeaderSearchResults` and `detectShortcutHint` instead of stale `"Search meetings, files, and actions..."`.
  2. `ThemeToggle` supports `variant === 'dock'` and `HelpModal` includes dark-mode security banner styling (`dark:bg-emerald-950`).
  3. `NotificationsPopover` uses dark-compatible unread ring styling.

- [ ] **Step 2: Run `client/src/lib/dashboard.test.ts` to confirm RED**
  Run: `node --test client/src/lib/dashboard.test.ts`
  Expected: FAIL on missing new header contracts.

- [ ] **Step 3: Update `ThemeToggle.tsx`, `NotificationsPopover.tsx`, `AccountMenu.tsx`, `HelpModal.tsx`, and `DashboardHeader.tsx`**
  - `ThemeToggle`: add `'dock'` variant (`h-8 px-2.5 rounded-lg` borderless matte trigger that blends seamlessly inside the `h-10` utility pill with clear hover highlight).
  - `NotificationsPopover`: accept `triggerClassName`, change badge ring to `ring-[#FAF9F6] dark:ring-[#141619]` and `New` badge to dark-mode friendly `dark:bg-rose-950/70 dark:text-rose-300`.
  - `AccountMenu`: align trigger pill height to `h-10 pl-1.5 pr-2.5 rounded-full bg-[#F3F2EE]/80 dark:bg-[#141619]/80 border border-[#DDDAD0] dark:border-[#2B3038] hover:border-[#C5C1B4] dark:hover:border-[#3A404A]`, avatar `w-7 h-7`.
  - `HelpModal`: add `dark:bg-emerald-950/50 dark:border-emerald-500/30 dark:text-emerald-200` on security note and `data-close="true"` preserved cleanly.
  - `DashboardHeader`:
    - Centered `max-w-lg` search command bar (`h-10`, `rounded-xl`) with OS-aware `Ctrl K`/`⌘K` chip, Clear (`×`) button, `"Search meetings, room code, or action..."` placeholder.
    - Cached lazy load (30s TTL + stale-request sequence/mount guard) of upcoming & recent (48h) meetings on focus/shortcut open.
    - Grouped clean command palette (`Join Room`, `Meetings`, `Actions`, `Navigation`) with keyboard `ArrowUp`/`ArrowDown`/`Enter`/`Escape` indexing across flattened visible items.
    - Unified `h-10` utility dock (`p-1 rounded-xl bg-[#F3F2EE]/85 dark:bg-[#141619]/90 border border-[#DDDAD0] dark:border-[#2B3038]`) grouping `ThemeToggle (dock)`, subtle vertical hairlines, `Help`, and `Notifications`.

- [ ] **Step 4: Run tests, lint, typecheck, and Vite build**
  Run: `npm run lint --workspace=client && npm run typecheck --workspace=client && npm test --workspace=client && npm run build --workspace=client`
  Expected: 0 lint/TS errors, all client tests pass, build green.

- [ ] **Step 5: Commit**
  `git add client/src/components/ui/ThemeToggle.tsx client/src/components/dashboard/NotificationsPopover.tsx client/src/components/dashboard/AccountMenu.tsx client/src/components/dashboard/HelpModal.tsx client/src/components/dashboard/DashboardHeader.tsx client/src/lib/dashboard.test.ts && git commit -m "feat(header): upgrade DashboardHeader search bar and unified studio controls"`
