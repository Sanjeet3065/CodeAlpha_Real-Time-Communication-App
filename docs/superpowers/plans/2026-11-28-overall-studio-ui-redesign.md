# CONNECTLY Overall Studio UI & Copy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade every page, popup, pre-join lobby, and live meeting interface across CONNECTLY (`client/`) to Stone & Carbon Matte styling with a full-bleed `100dvh` meeting theater, shared `<ModalShell>` / `<StudioSwitch>` primitives, zero dark-mode regressions, and crisp human copy.

**Architecture:** Synchronize Tailwind/CSS tokens and replace broken utility classes once (`Task 1`), build two zero-dependency shared primitives (`<ModalShell>` portaled stack-aware dialog + `<StudioSwitch>` toggle, `Task 2`), then upgrade header/global modals (`Task 3`), scheduling modals (`Task 4`), Hub pages & dashboard card shadows (`Task 5`), Auth/Router chrome (`Task 6`), Pre-Join Green Room (`Task 7`), Full-Bleed `100dvh` Live Meeting Studio (`Task 8`), and Video/ScreenShare/Panels/Whiteboard + verification script alignment (`Task 9`).

**Tech Stack:** React 18, TypeScript 5, Tailwind CSS 3 (`tailwind.config.js` + `tailwind.config.ts` paired), Vite 6, Lucide React, Node native test runner (`node --experimental-strip-types --test "src/**/*.test.ts"`).

**Spec:** [2026-11-28-overall-studio-ui-redesign-design.md](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/superpowers/specs/2026-11-28-overall-studio-ui-redesign-design.md)

## Global Constraints

- Design tokens: Light canvas `#F3F2EE`, card `#FAF9F6`, elevated `#FFFFFF`, ink `#1F2428`, body secondary `#555D66` / dark `#A3AAB2`, Pine `#2F6F68` / dark `#5FA399`, Danger `#C24D4D` / dark `#D46A6A`, hairline `#DDDAD0` / dark `#2A2F37`. Theater dark lock: `#111316` canvas, `#181B20` stage/dock, `#1C1F24` modal/panel.
- Zero broken Tailwind v3 classes anywhere in `client/src/`: replace all `shadow-xs` (`shadow-cly-sm`), `animate-in`/`fade-in*`/`zoom-in*`/`slide-in-from-*` (`.cly-animate-*`), `xs:` (`sm:`/`md:`), `py-0.2` (`py-0.5`), `z-25` (`z-20`/`z-30`), `drop-shadow-xs` (`drop-shadow-sm`), `scrollbar-thin` (`.cly-scrollbar`). Note `tailwind.config.js` sets `sm: '480px'`, `md: '768px'`, `lg: '1024px'`, `z-modal: 400`.
- Zero server/API protocol changes. Preserve `DEF-17-03` mobile toolbar (5 primary controls + 9 More items) and all preserved DOM selectors (`data-tab="participants"`, `#setting-audio-muted`, `#setting-video-off`, `#instant-meeting-title`, `#join-meeting-code-input`, `data-livekit-status`, `[data-table="downloads-files"]`, `[data-modal="file-preview"]`, `data-panel="files-panel"`).
- Strict copy cleanliness & truthfulness: strip internal jargon (`User Identifier`, `Argon2id + Dual Token Protection`, `Local Preview Only`, `Status: ACTIVE`, `Live Stage`, `Phase 03 scaffold`), duplicate headers, and untruthful claims (never claim auto-retry in Settings; state `"Saved locally — click Retry to sync."`).

## Review Focus

1. **Nested `<ModalShell>` scroll-lock & Escape stack (Task 2):** Closing a child confirmation modal stacked on a parent modal must not unlock body scroll early or close the parent modal on the same Escape press; body overflow unlocks only when the outermost dialog closes.
2. **Global shortcut isolation during text input or open dialogs (Task 8 & Task 9):** Pressing `W` in `MeetingRoomPage` or `V`/`H`/`P`/`E`/`T`/`Delete` in Whiteboard while focus is inside `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, or an open `[role="dialog"]` must be ignored.
3. **Config sync & zero broken Tailwind class leak (Task 1 & Task 9):** `tailwind.config.ts` matches `tailwind.config.js`, `vite.config.ts` keeps `manualChunks`/proxies, and static grep confirms 0 remaining `shadow-xs`, `animate-in`, `xs:`, `py-0.2`, `z-25`, `drop-shadow-xs`, or `scrollbar-thin` tokens under `client/src/`.
4. **Truthful offline Settings copy & full Meetings filter clearing (Task 5):** `SettingsPage` offline alert renders `"Saved locally — click Retry to sync."` (never auto-retry), and `MeetingsPage` `"Clear Filters"` button displays and resets filters even when only `historyStatusFilter` or `historyRoleFilter` is active (`historySearchTerm === ''`).
5. **Pre-Join Web Audio fallback & 320px notification popover bounds (Task 3 & Task 7):** `usePreJoinMediaPreview` degrades cleanly without throwing when `AudioContext` or `HTMLMediaElement.setSinkId` is unavailable, and `NotificationsPopover` constrains width cleanly on 320px mobile viewports without `ring-white`.

---

### Task 1: Foundation Tokens, Config Sync, CSS Keyframes, `Button` Focus Fix & Favicon

**Files:**
- Modify: `client/tailwind.config.ts:1-137`
- Modify: `client/src/styles/tokens.css:1-150`
- Modify: `client/src/styles/globals.css:1-75`
- Modify: `client/src/components/ui/Button.tsx:33-68`
- Modify: `client/public/favicon.svg:1-5`
- Create: `client/src/lib/studioTokens.ts`
- Test: `client/src/lib/studioFoundation.test.ts`

**Interfaces:**
- Produces:
  - `MEETING_STATUS_META`: `Record<string, { label: string; badgeClass: string }>` (`Scheduled`, `Live`, `Ended`, `Cancelled`, `Expired`)
  - `PARTICIPANT_ROLE_META`: `Record<ParticipantRole, { label: string; badgeClass: string }>`
  - `FILE_TONE_CLASSES`: `Record<'document' | 'image' | 'sheet' | 'archive' | 'video' | 'code' | 'default', { iconWrap: string; iconColor: string; chipClass: string }>`
  - `STUDIO_INPUT_CLASS`, `STUDIO_ALERT_DANGER_CLASS`, `STUDIO_ALERT_WARNING_CLASS`
  - CSS utility classes in `globals.css`: `.cly-animate-modal`, `.cly-animate-popover`, `.cly-animate-fade`, `.cly-scrollbar`

- [ ] **Step 1: Write failing foundation test (`client/src/lib/studioFoundation.test.ts`)**

Test assertions covering:
- `MEETING_STATUS_META['ENDED']` returns `{ label: 'Ended', ... }` (Title Case, not `'ENDED'`), `'ACTIVE'` -> `'Live'`, `'EXPIRED'` -> `'Expired'`, `'CANCELLED'` -> `'Cancelled'`, `'SCHEDULED'` -> `'Scheduled'`.
- `tailwind.config.ts` source contains `'#111316'`, `'#2F6F68'`, and does NOT contain legacy `'#168B83'` or `'#101820'`.
- `globals.css` defines `@keyframes clyModalIn` and `.cly-scrollbar`, and `Button.tsx` includes `dark:focus-visible:ring-offset-`.
- `favicon.svg` uses Pine `'#2F6F68'` and does NOT contain `'#168B83'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/lib/studioFoundation.test.ts"`
Expected: FAIL (`Cannot find module './studioTokens.ts'` / legacy hex assertions fail).

- [ ] **Step 3: Implement Task 1 updates**
- Synchronize `client/tailwind.config.ts` colors, `shadow-cly-*`, breakpoints, and `zIndex` with `client/tailwind.config.js`.
- Check `--cly-text-secondary` (`#555D66` light / `#A3AAB2` dark) and calibrate `--cly-text-muted` / theater vars in `client/src/styles/tokens.css`.
- Add `@keyframes clyModalIn`, `clyPopoverIn`, `clyFadeIn`, classes `.cly-animate-modal`, `.cly-animate-popover`, `.cly-animate-fade`, and `.cly-scrollbar` (respecting `prefers-reduced-motion`) in `client/src/styles/globals.css`.
- Update `client/src/components/ui/Button.tsx` (`sizeStyles.sm`: `h-9 min-h-[36px]`, `md`: `h-10 min-h-[40px]`, `lg`: `h-11 min-h-[44px]`; add `focus-visible:ring-offset-[#FAF9F6] dark:focus-visible:ring-offset-[#111316]` at line 67).
- Update `client/public/favicon.svg` to the BrandMark curved `C` + dot geometry in `#2F6F68` on `#FAF9F6` (or pine badge `#2F6F68` with `#FAF9F6` stroke).
- Create `client/src/lib/studioTokens.ts` exporting `MEETING_STATUS_META`, `PARTICIPANT_ROLE_META`, `FILE_TONE_CLASSES`, and shared form/alert classes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test "client/src/lib/studioFoundation.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/tailwind.config.ts client/src/styles/tokens.css client/src/styles/globals.css client/src/components/ui/Button.tsx client/public/favicon.svg client/src/lib/studioTokens.ts client/src/lib/studioFoundation.test.ts
git commit -m "style(ui): sync design tokens, animations, button focus ring, and favicon"
```

---

### Task 2: Shared Portaled `<ModalShell>` & `<StudioSwitch>` Primitives

**Files:**
- Create: `client/src/components/ui/ModalShell.tsx`
- Create: `client/src/components/ui/StudioSwitch.tsx`
- Test: `client/src/components/ui/modalShell.test.ts`

**Interfaces:**
- Produces:
  - `ModalShellProps`:
    ```ts
    export interface ModalShellProps {
      isOpen: boolean;
      onClose: () => void;
      title: string;
      titleId: string;
      subtitle?: string;
      icon?: React.ReactNode;
      size?: 'sm' | 'md' | 'lg' | 'xl';
      variant?: 'default' | 'danger' | 'theater';
      closeLabel?: string;
      closeOnBackdrop?: boolean;
      closeOnEscape?: boolean;
      disableClose?: boolean;
      initialFocusRef?: React.RefObject<HTMLElement>;
      footer?: React.ReactNode;
      dialogProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, string | undefined>;
      children: React.ReactNode;
    }
    ```
  - Helpers exported for deterministic stack testing: `acquireModalLock(id: string): number`, `releaseModalLock(id: string): number`, `isTopModal(id: string): boolean`.
  - `StudioSwitchProps`:
    ```ts
    export interface StudioSwitchProps {
      checked: boolean;
      onChange: (checked: boolean) => void;
      id?: string;
      label: string;
      description?: string;
      disabled?: boolean;
      mode?: 'switch' | 'checkbox'; // 'checkbox' renders <input type="checkbox" className="sr-only"> inside visual toggle
      className?: string;
    }
    ```

- [ ] **Step 1: Write failing test (`client/src/components/ui/modalShell.test.ts`)**

Test assertions covering:
- `acquireModalLock('parent')` then `acquireModalLock('child')`: `isTopModal('child') === true`, `isTopModal('parent') === false`; `releaseModalLock('child')` leaves lock count `=== 1` and restores `isTopModal('parent') === true`; `releaseModalLock('parent')` brings count to `0` (`Review Focus #1`).
- Source contract check that `ModalShell.tsx` uses `createPortal(..., document.body)`, `z-modal`, `role="dialog"`, `aria-modal="true"`, `Tab` trap including `input, select, textarea`, and `cly-animate-modal`.
- SSR `renderToStaticMarkup` check that `<StudioSwitch mode="checkbox" id="setting-audio-muted" checked={true} ... />` outputs `<input type="checkbox" id="setting-audio-muted" ... checked=""` AND `<StudioSwitch mode="switch" ... />` outputs `role="switch" aria-checked="true"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/components/ui/modalShell.test.ts"`
Expected: FAIL (`ModalShell.tsx` / `StudioSwitch.tsx` not found).

- [ ] **Step 3: Implement `ModalShell.tsx` & `StudioSwitch.tsx`**
- `ModalShell.tsx`: Module-level `openModalStack: string[]` + ref-counted `document.body.style.overflow = 'hidden'` management (`dataset.clyModalLocks`). Only handles `Escape` and `Tab`/`Shift+Tab` trap when `isTopModal(modalId)` is true; restores `previousFocusRef.current` on close (`wasOpenRef` guard); renders via `createPortal` into `document.body`; applies Stone & Carbon Matte header (`#F3F2EE` / `#141619` or danger tint `#F6E6E6` / `#2B1B1D` or theater `#181B20`).
- `StudioSwitch.tsx`: Accessible matte toggle pill (`#DDDAD0`/`#272C33` off, `#2F6F68`/`#5FA399` on) supporting both button `role="switch"` and `sr-only` `<input type="checkbox">` binding for settings IDs.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test "client/src/components/ui/modalShell.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/ModalShell.tsx client/src/components/ui/StudioSwitch.tsx client/src/components/ui/modalShell.test.ts
git commit -m "feat(ui): add stack-aware portaled ModalShell and StudioSwitch primitives"
```

---

### Task 3: Header Overlays & Core Dialogs (`NotificationsPopover`, `AccountMenu`, `HelpModal`, `PhaseNoticeModal`, `EditProfileModal`, `InstantMeetingModal`, `JoinMeetingModal`)

**Files:**
- Modify: `client/src/components/dashboard/NotificationsPopover.tsx`
- Modify: `client/src/components/dashboard/AccountMenu.tsx`
- Modify: `client/src/components/dashboard/HelpModal.tsx`
- Modify: `client/src/components/landing/PhaseNoticeModal.tsx`
- Modify: `client/src/components/dashboard/EditProfileModal.tsx`
- Modify: `client/src/components/dashboard/InstantMeetingModal.tsx`
- Modify: `client/src/components/dashboard/JoinMeetingModal.tsx`
- Modify: `client/src/lib/dashboard.test.ts:144-160`
- Test: `client/src/components/dashboard/overlays.test.ts`

**Interfaces:**
- Consumes: `ModalShell` (`Task 2`), `.cly-animate-popover`, `shadow-cly-sm` (`Task 1`).
- Preserves existing props on all 7 components (`isOpen`, `onClose`, `initialCode`, `initialTab`, `triggerClassName`, etc.), `#instant-meeting-title`, `#instant-meeting-name`, `#instant-waiting-room`, `#join-meeting-code-input`, `#join-code-error`, `div[role="region"][aria-label="Notifications"]`, `div[role="menu"]`, and `EditProfileModal.tsx` `wasOpenRef`.

- [ ] **Step 1: Write failing overlay tests (`client/src/components/dashboard/overlays.test.ts` + update `dashboard.test.ts:156`)**

Test assertions covering:
- `HelpModal.tsx` uses `<ModalShell`, pine matte icon surface `dark:bg-[#1F302E]`, and zero `emerald-` or `shadow-xs` classes; update `client/src/lib/dashboard.test.ts:144,156` in lockstep (`EditProfileModal.tsx` asserts `<ModalShell` + `wasOpenRef` and `HelpModal.tsx` asserts `dark:bg-[#1F302E]`).
- `NotificationsPopover.tsx` constrains mobile width (`left-3 right-3 sm:left-auto`), renders `<button>` notification items (`type="button"`), uses no `ring-white` or `animate-pulse`, and escapes header blur cleanly (`Review Focus #5`).
- `AccountMenu.tsx` supports `ArrowDown`/`ArrowUp`/`Home`/`End`/`Escape` keyboard navigation across `role="menuitem"` controls and contains no `animate-in` / `shadow-xs`.
- `InstantMeetingModal.tsx`, `JoinMeetingModal.tsx`, `PhaseNoticeModal.tsx`, `EditProfileModal.tsx` all wrap content in `<ModalShell` and replace any `animate-in`/`shadow-xs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/components/dashboard/overlays.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Upgrade all 7 overlay components**
- Migrate `HelpModal`, `PhaseNoticeModal`, `InstantMeetingModal`, `JoinMeetingModal`, and `EditProfileModal` (keeping `wasOpenRef` tab/feedback reset logic intact) onto `<ModalShell>`. Trim verbose Helper paragraphs in `HelpModal` to scannable shortcut/action rows.
- Upgrade `NotificationsPopover`: fixed responsive top-layer bounds (`fixed top-16 left-3 right-3 sm:left-auto sm:right-6 sm:w-96` or portal) keeping `div[role="region"][aria-label="Notifications"]`, `<button>` rows instead of `<div onClick>`, calm static pine unread indicator dot (no `animate-pulse`, no `ring-white`), empty state concise `"All caught up"`.
- Upgrade `AccountMenu`: portal/top-layer `div[role="menu"]` with `ArrowUp`/`ArrowDown`/`Home`/`End`/`Escape` keyboard focus movement, `.cly-animate-popover`, clean display name fallback (`user?.email || 'Account'`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test "client/src/components/dashboard/overlays.test.ts" "client/src/lib/dashboard.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/dashboard/NotificationsPopover.tsx client/src/components/dashboard/AccountMenu.tsx client/src/components/dashboard/HelpModal.tsx client/src/components/landing/PhaseNoticeModal.tsx client/src/components/dashboard/EditProfileModal.tsx client/src/components/dashboard/InstantMeetingModal.tsx client/src/components/dashboard/JoinMeetingModal.tsx client/src/lib/dashboard.test.ts client/src/components/dashboard/overlays.test.ts
git commit -m "feat(ui): upgrade header overlays and core dialogs with ModalShell"
```

---

### Task 4: Scheduling Modals (`ScheduleMeetingModal`, `ScheduleNoticeModal`, `RescheduleModal`, `CancelMeetingModal`, `MeetingInvitationModal`)

**Files:**
- Modify: `client/src/components/dashboard/ScheduleMeetingModal.tsx`
- Modify: `client/src/components/dashboard/ScheduleNoticeModal.tsx`
- Modify: `client/src/components/dashboard/RescheduleModal.tsx`
- Modify: `client/src/components/dashboard/CancelMeetingModal.tsx`
- Modify: `client/src/components/dashboard/MeetingInvitationModal.tsx`
- Test: `client/src/components/dashboard/schedulingModals.test.ts`

**Interfaces:**
- Consumes: `ModalShell` (`Task 2`), `STUDIO_INPUT_CLASS`, `STUDIO_ALERT_WARNING_CLASS` (`Task 1`).
- Preserves both `ScheduleMeetingModal` and `ScheduleNoticeModal` exports (`phase17Sprint01.test.ts:241-242`) and `role="dialog"` `aria-modal="true"`.

- [ ] **Step 1: Write failing scheduling modal test (`client/src/components/dashboard/schedulingModals.test.ts`)**

Test assertions covering:
- All 4 main modals (`ScheduleMeetingModal.tsx`, `RescheduleModal.tsx`, `CancelMeetingModal.tsx`, `MeetingInvitationModal.tsx`) use `<ModalShell` and zero light-only `bg-amber-50` / `bg-rose-50` / `hover:bg-gray-50` / `text-emerald-300`.
- `RescheduleModal.tsx` and `ScheduleMeetingModal.tsx` apply `[color-scheme:light] dark:[color-scheme:dark]` and `dark:bg-[#141619]` to date/time/select inputs.
- `CancelMeetingModal.tsx` uses `variant="danger"` on `<ModalShell` and dark-safe `<textarea>` styling.
- `MeetingInvitationModal.tsx` includes `Copy Link`, `Copy Code`, `Copy Invitation`, and `Open Room` actions.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/components/dashboard/schedulingModals.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement scheduling modal upgrades**
- `ScheduleMeetingModal.tsx` + `ScheduleNoticeModal.tsx`: wrap in `<ModalShell>`, unify `h-10` matte inputs (`dark:[color-scheme:dark]`), dark-safe DST ambiguity box, crisp form -> Created Link Ready copy (`Copy Join Link` / `Done`).
- `RescheduleModal.tsx`: wrap in `<ModalShell>`, dark date/time inputs, matte DST notice, concise copy.
- `CancelMeetingModal.tsx`: `<ModalShell variant="danger">`, dark-mode danger banner + dark `<textarea>`, clear `"Keep Meeting"` / `"Cancel Meeting"` buttons.
- `MeetingInvitationModal.tsx`: `<ModalShell>`, fix `text-emerald-300`, replace raw text dump with clean structured card (`Title`, `Date & Time`, `Meeting Code`) and `Copy Link`, `Copy Code`, `Copy Invitation`, `Open Room`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test "client/src/components/dashboard/schedulingModals.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/dashboard/ScheduleMeetingModal.tsx client/src/components/dashboard/ScheduleNoticeModal.tsx client/src/components/dashboard/RescheduleModal.tsx client/src/components/dashboard/CancelMeetingModal.tsx client/src/components/dashboard/MeetingInvitationModal.tsx client/src/components/dashboard/schedulingModals.test.ts
git commit -m "feat(ui): upgrade scheduling, reschedule, cancel, and invitation modals"
```

---

### Task 5: Hub Pages (`MeetingsPage`, `DownloadsPage`, `SettingsPage`, `NotFoundPage`) & Dashboard `shadow-xs` Cleanup

**Files:**
- Modify: `client/src/pages/MeetingsPage.tsx`
- Modify: `client/src/pages/DownloadsPage.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`
- Modify: `client/src/pages/NotFoundPage.tsx`
- Modify: `client/src/components/dashboard/PreCallStudioWidget.tsx`
- Modify: `client/src/components/dashboard/QuickActionBar.tsx`
- Modify: `client/src/components/dashboard/RecentActivityWidget.tsx`
- Modify: `client/src/components/dashboard/RecentDownloadsWidget.tsx`
- Modify: `client/src/components/dashboard/UpcomingMeetingsSection.tsx`
- Modify: `client/src/components/dashboard/UpNextBanner.tsx`
- Test: `client/src/pages/hubPages.test.ts`

**Interfaces:**
- Consumes: `ModalShell`, `StudioSwitch` (`Task 2`), `MEETING_STATUS_META`, `FILE_TONE_CLASSES` (`Task 1`).
- Preserves: `'/meetings/history'`, `'deleteMeetingHistoryEntry'`, `'deleteMeetingHistoryEntries'` (`dashboard.test.ts`), `#setting-audio-muted`, `#setting-video-off`, `[data-table="downloads-files"]`, `[data-row-file]`.

- [ ] **Step 1: Write failing Hub pages test (`client/src/pages/hubPages.test.ts`)**

Test assertions covering:
- `MeetingsPage.tsx`: does NOT call `setIsScheduleModalOpen(false)` inside `onMeetingScheduled`; shows Clear Filters when `historySearchTerm || historyStatusFilter !== 'ALL' || historyRoleFilter !== 'ALL'` (`Review Focus #4`); includes `'EXPIRED'` filter option; uses `MEETING_STATUS_META` & `<ModalShell` for details/delete confirm; removes `"Back to Overview"` duplicate header and `shadow-xs`/`bg-rose-50` without dark classes.
- `DownloadsPage.tsx`: preserves `[data-table="downloads-files"]` + `[data-row-file]`, renders mobile card list (`md:hidden`), surfaces error/retry state, distinguishes `"No shared files yet"` vs `"No matching files"` + Clear Filters, and contains zero `<Link.*>\s*<Button` nested interactive tags.
- `SettingsPage.tsx`: contains `#setting-audio-muted` & `#setting-video-off`, renders `"Saved locally — click Retry to sync."` (`Review Focus #4`), removes `'User Identifier'`, `'Argon2id'`, and unguarded `bg-amber-50` (`L427-450` bug).
- `NotFoundPage.tsx`: includes `BrandMark`, `ThemeToggle`, `"Page not found"`, `"Back to Dashboard"` (`/dashboard`).
- Zero `shadow-xs` left in the 6 dashboard widgets.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/pages/hubPages.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement Hub pages & dashboard card fixes**
- **`MeetingsPage.tsx`:** Remove duplicate inner `<h2>` + `"Back to Overview"`; fix `onMeetingScheduled={() => { fetchUpcoming(1); }}` so modal reaches Created + Copy step; add `'EXPIRED'` option & full Clear Filters visibility; standardize `h-10` search/select filters with `aria-label`; use `MEETING_STATUS_META` matte badges; replace light-only `bg-rose-50` / `hover:bg-rose-50`; migrate Details & Delete confirmation dialogs to `<ModalShell>`.
- **`DownloadsPage.tsx`:** Remove duplicate `<h2>` + `"Back to Overview"`; add loadError/downloadError banner + Retry button; separate empty library vs filtered-empty + `"Clear Filters"`; render mobile card list (`md:hidden`) alongside `[data-table="downloads-files"]` desktop table (`hidden md:block`); remove `<Link><Button>` nesting; apply `FILE_TONE_CLASSES` & `h-10` inputs.
- **`SettingsPage.tsx`:** Remove duplicate header, `User Identifier` UUID box, and `Argon2id + Dual Token Protection` card; fix dark-mode `bg-amber-50` card (`dark:bg-[#262118]`); use `<StudioSwitch mode="checkbox" id="setting-audio-muted" />` and `<StudioSwitch mode="checkbox" id="setting-video-off" />`; consolidate duplicate save banner + inline status into quiet `Saved` status chip + truthful `"Saved locally — click Retry to sync."`.
- **`NotFoundPage.tsx`:** Add minimal header (`BrandMark` + `ThemeToggle`), `"Page not found"`, `"This route may have moved or expired."`, primary `"Back to Dashboard"` (`/dashboard`) + `"Go Back"`.
- Replace all `shadow-xs` with `shadow-cly-sm` in the 6 dashboard widget files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test "client/src/pages/hubPages.test.ts" "client/src/lib/dashboard.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/MeetingsPage.tsx client/src/pages/DownloadsPage.tsx client/src/pages/SettingsPage.tsx client/src/pages/NotFoundPage.tsx client/src/components/dashboard/PreCallStudioWidget.tsx client/src/components/dashboard/QuickActionBar.tsx client/src/components/dashboard/RecentActivityWidget.tsx client/src/components/dashboard/RecentDownloadsWidget.tsx client/src/components/dashboard/UpcomingMeetingsSection.tsx client/src/components/dashboard/UpNextBanner.tsx client/src/pages/hubPages.test.ts
git commit -m "feat(ui): upgrade Meetings, Downloads, Settings, 404 pages and clean widget shadows"
```

---

### Task 6: Auth Accessibility, Loading/Error Chrome & `/scaffold` Cleanup

**Files:**
- Modify: `client/src/pages/AuthGatewayPage.tsx`
- Modify: `client/src/pages/LoginPage.tsx`
- Modify: `client/src/pages/RegisterPage.tsx`
- Modify: `client/src/components/feedback/ErrorFallback.tsx`
- Modify: `client/src/components/feedback/LoadingFallback.tsx`
- Modify: `client/src/app/router/AppRouter.tsx`
- Delete: `client/src/pages/DashboardPlaceholderPage.tsx`
- Test: `client/src/app/router/appRouter.test.ts`

**Interfaces:**
- Preserves all contracts in `client/src/components/auth/authShowcaseContent.test.ts`.
- Removes unused `DashboardPlaceholderPage.tsx` (0 imports) and redirects `/scaffold` cleanly in `AppRouter.tsx`.

- [ ] **Step 1: Write failing router/auth accessibility test (`client/src/app/router/appRouter.test.ts`)**

Test assertions covering:
- `AppRouter.tsx` imports `LoadingFallback` for route/Suspense loading rather than duplicating inline spinner blocks, and redirects `/scaffold` to `/dashboard` (not rendering `RootScaffoldPage`).
- `client/src/pages/DashboardPlaceholderPage.tsx` does not exist and zero references remain.
- `AuthGatewayPage.tsx` contains a skip link (`#main-auth-form` / `Skip to form`) and consistent focus-visible rings while keeping `authShowcaseContent.test.ts` 100% passing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/app/router/appRouter.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement Auth/Router/Feedback cleanup**
- Add subtle skip-to-form link, consistent dark-safe pine focus rings, and calibrated error surface styling across `AuthGatewayPage.tsx`, `LoginPage.tsx`, `RegisterPage.tsx` without touching any `authShowcaseContent.test.ts` assertions.
- Polish `LoadingFallback.tsx` (subtle matte spinner + calm static caption) and `ErrorFallback.tsx` (`BrandMark` header alignment, concise error recovery copy).
- Update `AppRouter.tsx` to use `<LoadingFallback />` inside `ProtectedRoute` / `PublicOnlyRoute` / `Suspense`, redirect `/scaffold` -> `/dashboard`, and delete unused `DashboardPlaceholderPage.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test "client/src/app/router/appRouter.test.ts" "client/src/components/auth/authShowcaseContent.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A client/src/pages/AuthGatewayPage.tsx client/src/pages/LoginPage.tsx client/src/pages/RegisterPage.tsx client/src/components/feedback/ErrorFallback.tsx client/src/components/feedback/LoadingFallback.tsx client/src/app/router/AppRouter.tsx client/src/pages/DashboardPlaceholderPage.tsx client/src/app/router/appRouter.test.ts
git commit -m "feat(ui): unify LoadingFallback, add auth skip-focus polish, and retire /scaffold"
```

---

### Task 7: Pre-Join Green Room (`PreJoinLobbyPage` & `usePreJoinMediaPreview`)

**Files:**
- Modify: `client/src/hooks/usePreJoinMediaPreview.ts`
- Modify: `client/src/pages/PreJoinLobbyPage.tsx`
- Test: `client/src/hooks/preJoinPreview.test.ts`

**Interfaces:**
- Produces from `usePreJoinMediaPreview`:
  - `micLevel: number` (`0..1` normalized live level when mic preview is active, `0` when muted or AudioContext unsupported)
  - `selectSpeakerDevice: (deviceId: string) => void`
- Preserves all `data-prejoin-*` attributes and `"Join Meeting Now"` CTA label.

- [ ] **Step 1: Write failing pre-join test (`client/src/hooks/preJoinPreview.test.ts`)**

Test assertions covering:
- Exported pure helper `computeMicLevelPercent(rmsOrBytes: Uint8Array): number` returns `0` on silent buffers and bounded `0..100` on active samples, and `usePreJoinMediaPreview.ts` exports `selectSpeakerDevice` and `micLevel` with `try/catch` / capability checks around `AudioContext` (`Review Focus #5`).
- `PreJoinLobbyPage.tsx` imports `BrandMark` (replacing `<Video>`), displays only 1 Dashboard navigation control, removes `'Status: ACTIVE'`, `'Local Preview Only'`, `'Authenticated User'`, and zero `shadow-xs` / `bg-rose-50` / `bg-amber-100` / `bg-amber-50` light-only alert strings remain.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/hooks/preJoinPreview.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Upgrade `usePreJoinMediaPreview.ts` and `PreJoinLobbyPage.tsx`**
- In `usePreJoinMediaPreview.ts`, export pure `computeMicLevelPercent`, wire optional `AudioContext` + `AnalyserNode` (`requestAnimationFrame`) with safe cleanup & fallback (`0` on muted/error), and add `selectSpeakerDevice(deviceId)` wrapping `setSelectedDeviceId('audiooutput', deviceId)`.
- In `PreJoinLobbyPage.tsx`, upgrade header to `<BrandMark />` + single top-left `"Back"` link + `<ThemeToggle />`; render 2-column Stone & Carbon card with live camera viewport + subtle **mic level meter bar**, unified `h-10` mic/camera/**speaker** selectors, calm dark-safe error/permission alerts, single waiting-room note beside `"Join Meeting Now"`, and crisp user label.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test "client/src/hooks/preJoinPreview.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/usePreJoinMediaPreview.ts client/src/pages/PreJoinLobbyPage.tsx client/src/hooks/preJoinPreview.test.ts
git commit -m "feat(ui): upgrade PreJoinLobbyPage Green Room with mic meter and speaker selector"
```

---

### Task 8: Full-Bleed `100dvh` Live Meeting Studio & Floating Dock

**Files:**
- Modify: `client/src/pages/MeetingRoomPage.tsx`
- Modify: `client/src/components/meeting/MeetingHeader.tsx`
- Modify: `client/src/components/meeting/MeetingToolbar.tsx`
- Modify: `client/src/components/meeting/LiveKitStatusCard.tsx`
- Modify: `client/src/components/meeting/FloatingReactions.tsx`
- Modify: `client/src/components/meeting/ReactionPicker.tsx`
- Modify: `client/src/components/meeting/DeviceSettingsModal.tsx`
- Modify: `client/src/components/meeting/RoomSettingsModal.tsx`
- Modify: `client/src/components/meeting/ConfirmActionDialog.tsx`
- Test: `client/src/pages/meetingStudioLayout.test.ts`

**Interfaces:**
- Produces: exported pure shortcut-guard helper `shouldIgnoreStudioShortcut(target: EventTarget | null, hasOpenModal: boolean): boolean`.
- Consumes: `<ModalShell variant="theater">`, `<StudioSwitch mode="switch">` (`Task 2`), `.cly-animate-popover` (`Task 1`).
- Preserves: `data-tab="participants"`, sole `data-livekit-status={liveKitStatus}` on header `Live` pill, `[data-audio-blocked-banner="true"]` + `[data-control="safari-enable-audio"]`, separate `Leave` & `End for All`, `[data-control="toggle-files"]` in DOM (`hidden md:inline-flex`), and all 5 primary + 9 More `DEF-17-03` mobile controls verified by `phase17Sprint01.test.ts`.

- [ ] **Step 1: Write failing meeting studio layout test (`client/src/pages/meetingStudioLayout.test.ts`)**

Test assertions covering:
- `shouldIgnoreStudioShortcut` returns `true` for `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, and whenever `hasOpenModal === true` (`Review Focus #2`), and `false` for normal stage interactions.
- `MeetingRoomPage.tsx`: root viewport uses `h-[100dvh]` and dark `#111316` theater surface, hides `LiveKitStatusCard` when `status === 'connected' || status === 'idle'`, removes `'Live Stage'` sub-header, allows toggling/closing `activeSideTab` to `null`, removes `py-0.2`, adds `textarea:not(:disabled), select:not(:disabled)` to mobile drawer focus trap, and removes duplicate audio banner.
- `MeetingToolbar.tsx`: removes all `xs:` and `py-0.2`, uses centered 3-cluster floating capsule at `md:`/`lg+` (`hidden md:inline-flex` for desktop `[data-control="toggle-files"]`), renders `shrink-0` footer clearance, and still passes `phase17Sprint01.test.ts`.
- `MeetingHeader.tsx`: uses `<BrandMark />` + quiet `Live` indicator carrying `data-livekit-status`.
- `FloatingReactions.tsx` replaces `z-25` with `z-20`; `ReactionPicker.tsx` replaces `animate-in`/`fade-in`/`zoom-in-95` with `.cly-animate-popover`.
- `DeviceSettingsModal.tsx`, `RoomSettingsModal.tsx`, `ConfirmActionDialog.tsx` use `<ModalShell variant="theater">`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/pages/meetingStudioLayout.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement Live Meeting Studio shell, dock, header, overlays & modals**
- Upgrade `MeetingHeader.tsx`: `<BrandMark />`, clean title + copy code chip + sole `data-livekit-status` `Live` status pill, lock/count controls.
- Upgrade `MeetingRoomPage.tsx`: locked `h-[100dvh] w-full overflow-hidden flex flex-col bg-[#111316]`, collapsible desktop sidebar (default `'participants'` on `lg+`, click active tab or `X` sets `null` -> `w-0`), transient `LiveKitStatusCard` strip only during non-healthy states, single floating `"Enable Audio"` banner, expanded mobile drawer focusables, and `shouldIgnoreStudioShortcut` on `W` key.
- Upgrade `MeetingToolbar.tsx`: `shrink-0` bottom dock slot with centered `#181B20/95 backdrop-blur-md` 3-cluster desktop dock (`hidden md:flex` controls keeping `[data-control="toggle-files"]` in DOM + separate Host `End for All`), exact `5+9` `DEF-17-03` mobile dock `< md`, zero `xs:`/`py-0.2`.
- Upgrade `DeviceSettingsModal.tsx`, `RoomSettingsModal.tsx`, `ConfirmActionDialog.tsx` onto `<ModalShell variant="theater">` + `<StudioSwitch>`.
- Fix `FloatingReactions.tsx` (`z-20`) and `ReactionPicker.tsx` (`.cly-animate-popover`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test "client/src/pages/meetingStudioLayout.test.ts" "client/src/services/phase17Sprint01.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/MeetingRoomPage.tsx client/src/components/meeting/MeetingHeader.tsx client/src/components/meeting/MeetingToolbar.tsx client/src/components/meeting/LiveKitStatusCard.tsx client/src/components/meeting/FloatingReactions.tsx client/src/components/meeting/ReactionPicker.tsx client/src/components/meeting/DeviceSettingsModal.tsx client/src/components/meeting/RoomSettingsModal.tsx client/src/components/meeting/ConfirmActionDialog.tsx client/src/pages/meetingStudioLayout.test.ts
git commit -m "feat(ui): upgrade live meeting studio to 100dvh theater layout and floating dock"
```

---

### Task 9: Video Grid, Screen Share, Side Panels, Whiteboard Studio & Verification Alignment

**Files:**
- Modify: `client/src/components/meeting/ParticipantVideoTile.tsx`
- Modify: `client/src/components/meeting/VideoConferenceGrid.tsx`
- Modify: `client/src/components/meeting/ScreenShareView.tsx`
- Modify: `client/src/components/meeting/ParticipantsPanel.tsx`
- Modify: `client/src/components/meeting/WaitingRoomPanel.tsx`
- Modify: `client/src/components/meeting/ChatPanel.tsx`
- Modify: `client/src/components/meeting/FilesPanel.tsx`
- Modify: `client/src/components/meeting/WhiteboardStage.tsx`
- Modify: `client/src/components/meeting/WhiteboardToolbar.tsx`
- Modify: `client/src/components/meeting/WhiteboardCanvas.tsx`
- Modify: `scripts/verify_phase_06.js`
- Modify: `scripts/verify_phase_07.js`
- Modify: `scripts/verify_phase_07_audit.js`
- Modify: `scripts/verify_phase_09_livekit.js`
- Test: `client/src/components/meeting/meetingSubsystems.test.ts`

**Interfaces:**
- Produces:
  - `ParticipantVideoTileProps` adds `compact?: boolean`.
  - Pure helper `mapWhiteboardKeyToAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, activeTool: WhiteboardTool)` tested in Node.
- Consumes: `ModalShell` (`Task 2`), `ConfirmActionDialog` (`Task 8`), `shouldIgnoreStudioShortcut` (`Task 8`), `FILE_TONE_CLASSES`, `.cly-scrollbar` (`Task 1`).
- Preserves: `FilesPanel.accessibility.test.ts` (4/4 tests), `data-participant-tile`, `data-screenshare-*`, `data-whiteboard-*`, `data-tool=*`, `data-action=*`, `data-element=*`.

- [ ] **Step 1: Write failing subsystem test (`client/src/components/meeting/meetingSubsystems.test.ts`)**

Test assertions covering:
- `ParticipantVideoTile.tsx` supports `compact?: boolean`, removes redundant `'Camera Off'` center banner and `drop-shadow-xs` / `shadow-xs`, and uses `#5FA399` speaking ring + matte badges.
- `ScreenShareView.tsx` places sharing header bar as sibling above the stream frame (`flex-col`) rather than `absolute` overlay over top content.
- `FilesPanel.tsx` uses `<ConfirmActionDialog` (zero `window.confirm`), uses `<ModalShell` with `closeLabel="Close preview"` and `dialogProps={{ 'data-modal': 'file-preview' }}`, includes explicit `aria-label` on error dismiss button, and uses `FILE_TONE_CLASSES`.
- `WaitingRoomPanel.tsx` includes `aria-label={`Admit ${...}`}` and `aria-label={`Reject ${...}`}`; `ChatPanel.tsx` uses `.cly-scrollbar` and replaces `py-0.2` / `amber` host chip.
- `WhiteboardStage.tsx` uses `sm:inline-flex` (zero `xs:`) and `.cly-scrollbar`; `WhiteboardToolbar.tsx` has 8 high-contrast dark-safe matte inks (starting with `#EDEFF2`, removing `#1E293B`), `focus-visible:ring-2` swatches, outside-click & Escape popover closure, and wires `mapWhiteboardKeyToAction` for `V`/`H`/`P`/`E`/`T`/`Ctrl+Z`/`Ctrl+Y`/`Delete`; `WhiteboardCanvas.tsx` uses `#5FA399` selection highlight (`L316`) + defaults chalk strokes cleanly on `#111316`.
- Static repo scan (`Review Focus #3`): zero remaining occurrences of `shadow-xs`, `animate-in`, `xs:`, `py-0.2`, `z-25`, `drop-shadow-xs`, or `scrollbar-thin` in `client/src/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test "client/src/components/meeting/meetingSubsystems.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement sub-panel, video/screenshare, whiteboard & verification script updates**
- **`ParticipantVideoTile.tsx` & `VideoConferenceGrid.tsx` & `ScreenShareView.tsx`:** Implement `compact` variant, pine active-speaker ring, calm charcoal Co-Host pill, remove `"Camera Off"` center banner, dock ScreenShare banner above `min-h-0 flex-1` stream.
- **`ParticipantsPanel.tsx`, `WaitingRoomPanel.tsx`, `ChatPanel.tsx`, `FilesPanel.tsx`:** Deduplicate inner drawer headers cleanly; unify matte badges/icons (`FILE_TONE_CLASSES`); replace `window.confirm` with `<ConfirmActionDialog>` and portaled preview via `<ModalShell closeLabel="Close preview" dialogProps={{ 'data-modal': 'file-preview' }}>` (preserving `FilesPanel.accessibility.test.ts` keyboard browse, focus trap, Escape focus restore, and announcer); add missing ARIA labels.
- **`WhiteboardStage.tsx`, `WhiteboardToolbar.tsx`, `WhiteboardCanvas.tsx`:** Fix `sm:inline-flex`, dark-safe chalk/matte palette (`#EDEFF2` default + 7 calibrated inks), `#5FA399` selection frame, outside-click/Escape popover dismissal, `focus-visible` swatches, and guarded keyboard shortcuts (`V`/`H`/`P`/`E`/`T`/`Ctrl+Z`/`Ctrl+Y`/`Delete`).
- **Align Browser Scripts (`scripts/verify_phase_{06,07,07_audit,09_livekit}.{js,mjs}`):** Update tightened copy assertions (`"No shared files yet"`, `"Saved"` / `"Saved locally — click Retry to sync."`, `"Retry Cloud Sync"` -> button selector/label, `[data-livekit-status="connected"]` / `"Live"` pill) while keeping interactive flow checks intact.

- [ ] **Step 4: Run full workspace verification suite (`client` + `server`)**

Run: `npm run lint --workspace=client && npm run typecheck --workspace=client && npm test --workspace=client && npm run build --workspace=client && npm test --workspace=server`
Expected: All lint, TypeScript, client unit tests, production Vite build, and server tests pass with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/meeting/ParticipantVideoTile.tsx client/src/components/meeting/VideoConferenceGrid.tsx client/src/components/meeting/ScreenShareView.tsx client/src/components/meeting/ParticipantsPanel.tsx client/src/components/meeting/WaitingRoomPanel.tsx client/src/components/meeting/ChatPanel.tsx client/src/components/meeting/FilesPanel.tsx client/src/components/meeting/WhiteboardStage.tsx client/src/components/meeting/WhiteboardToolbar.tsx client/src/components/meeting/WhiteboardCanvas.tsx client/src/components/meeting/meetingSubsystems.test.ts scripts/verify_phase_06.js scripts/verify_phase_07.js scripts/verify_phase_07_audit.js scripts/verify_phase_09_livekit.js
git commit -m "feat(ui): upgrade video tiles, screen share, panels, whiteboard, and verify scripts"
```
