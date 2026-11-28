# CONNECTLY — Overall Studio UI & Copy Redesign Specification

**Date:** 2026-11-28
**Status:** Checked Specification — Ready for User Approval
**Design Language:** Stone & Carbon Matte (Warm Alabaster Light / Matte Carbon Theater Dark / Pine `#2F6F68` Accent)

---

## 1. Intent, Goals & Scope

Bring every screen, popup, drawer, pre-join flow, and live meeting interface across **CONNECTLY** (`client/`) up to the matte editorial studio standard already established on the Overview Dashboard (`DashboardPage`, `DashboardHeader`, `InstantMeetingModal`), while eliminating unnecessary prose, duplicate headings, internal jargon, broken CSS classes, dark-mode contrast failures, and portal/focus-trap bugs.

### Goals
1. **End-to-End Visual Cohesion:** Unify all Hub pages (`Meetings`, `Downloads`, `Settings`, `404`), Auth screens, 13+ popups/modals/popovers, the Pre-Join Green Room, and the Live Meeting Room (Video Grid, Screen Share, Side Panels, Whiteboard) under a single calibrated palette (`#F3F2EE` / `#FAF9F6` light; `#111316` / `#181B20` / `#1C1F24` dark & theater; `#2F6F68` / `#5FA399` pine accent; `#C24D4D` / `#D46A6A` matte danger).
2. **Full-Bleed Distraction-Free Meeting Studio:** Upgrade the live meeting experience to a viewport-locked `100dvh` dark theater workspace (`#111316` / `#181B20`) with a quiet header `Live` pill, collapsible desktop side drawer (open by default on desktop `lg+`), centered floating segmented dock, and non-overlapping screen-share/whiteboard framing—reclaiming ~120px of vertical stage space while preserving desktop & mobile (`DEF-17-03`) contracts.
3. **Minimal, Truthful, Human Copy:** Strip redundant headings, internal engineering/database jargon (`User Identifier`, `Argon2id + Dual Token Protection`, `Local Preview Only`, `Status: ACTIVE`, `Live Stage`, multi-sentence helper walls), and duplicated notices while keeping every essential label, status, empty state, and truthful error recovery action crystal clear.
4. **Accessible Top-Layer Popups & Zero Dark-Mode Breakage:** Route modals and previews through a single stack-aware portaled `<ModalShell>` (`z-modal: 400`) with Escape dismissal, backdrop-click close, `Tab`/`Shift+Tab` focus trapping, focus restoration, and ref-counted scroll-lock teardown; fix all light-only alert/input/hover classes (`bg-amber-50`, `bg-rose-50`, `hover:bg-gray-50`, unstyled `<textarea>`/`<input type="date">`, white `focus-visible` ring offsets) and non-functional Tailwind utilities (`shadow-xs`, `animate-in`, `xs:`, `py-0.2`, `drop-shadow-xs`, `scrollbar-thin`, `z-25`).

### Non-Goals & Anti-Goals
- **No Backend / API / Protocol Changes:** Server endpoints, Supabase schema, LiveKit token/signaling logic, and WebRTC/DataChannel contracts remain untouched.
- **No Selector / Test Regression:** All unit/component test contracts (`authShowcaseContent.test.ts`, `phase17Sprint01.test.ts`, `FilesPanel.accessibility.test.ts`, `dashboard.test.ts`), mobile `DEF-17-03` 5+9 control structure, and key `data-*` / ID hooks remain green (updating paired `dashboard.test.ts` assertions and affected `scripts/verify_phase_*.{js,mjs}` strings explicitly where UI copy is intentionally tightened).
- **Anti-Goal (Visual Bloat):** Never introduce neon gradients, glassmorphic rainbow blobs, bouncing/pulsing notification dots, heavy drop shadows, or ornamental marketing cards inside product workspaces.

---

## 2. Architectural Approaches Considered

| Approach | Summary | Trade-offs | Verdict |
| :--- | :--- | :--- | :--- |
| **A. File-by-File CSS Patching** | Manually tweak Tailwind classes in each modal, hub page, and meeting component independently. | Fastest initial start, but leaves duplicated focus traps, body overflow bugs, un-portaled stacking bugs, and diverging button/switch/badge styles across 40+ files. | Rejected |
| **B. Third-Party Component Kit Migration** | Install Radix / Headless UI / shadcn primitives and rewrite every dialog, switch, and popover from scratch. | Adds dependency churn, risks breaking existing DOM attributes/`vite.config` chunks/`FilesPanel.accessibility.test.ts` focus expectations, and slows delivery. | Rejected |
| **C. Unified Token & Shared Studio Primitives (`<ModalShell>` + `<StudioSwitch>` + Status Helpers)** | Synchronize Tailwind/CSS tokens once, extract 2 lightweight shared primitives (`<ModalShell>` portal dialog + `<StudioSwitch>` toggle + shared matte status/tone map), then systematically upgrade Hub Pages, Modals, and the `100dvh` Meeting Studio against those primitives. | Zero new dependencies; fixes dark mode, portals, focus traps, scroll-lock leaks, and mobile/tablet responsiveness everywhere with minimal duplication and preserved contracts. | **Selected** |

---

## 3. Workstream 1 — Foundation, Tokens, Primitives & Build Config

### 3.1 Token, Config & Invalid Tailwind Class Cleanup
1. **Sync `tailwind.config.ts` & `vite.config.*` with `.js` counterparts:**
   - `client/tailwind.config.js` is already on the Stone & Carbon Matte palette (note: defines `sm: '480px'`, `md: '768px'`, `z-modal: 400`). Synchronize stale `client/tailwind.config.ts` (currently carrying `#F7F6F2`, `#168B83`, `#101820`, `#172B3A`, `#D94F4F` and checked by `client/tsconfig.node.json`) so `.js` and `.ts` define identical tokens, `shadow-cly-*`, `z-*`, and breakpoints.
   - Keep `client/vite.config.ts` and `client/vite.config.js` aligned (`manualChunks` and `/api`, `/socket.io`, `/livekit-signal` proxies verified by `client/src/services/phase17Sprint01.test.ts:88,130`).
2. **Real CSS Keyframes, Shadows, Scrollbars & Valid Breakpoints:**
   - Replace all **29 occurrences** of invalid Tailwind v3 `shadow-xs` (`HelpModal`, `PreCallStudioWidget`, `QuickActionBar`, `RecentActivityWidget`, `RecentDownloadsWidget`, `UpcomingMeetingsSection`, `UpNextBanner`, `ParticipantVideoTile`, `DownloadsPage`, `MeetingsPage`, `PreJoinLobbyPage`, `SettingsPage`) with `shadow-cly-sm` (`var(--cly-shadow-sm)`).
   - Add `@keyframes` utilities in `client/src/styles/globals.css` (`.cly-animate-modal`, `.cly-animate-popover`, `.cly-animate-fade`, `.cly-scrollbar`) and replace all **17** broken `animate-in`/`fade-in*`/`zoom-in*`/`slide-in-from-*`, **2** `scrollbar-thin`, **5** `py-0.2`, **1** `drop-shadow-xs`, and **1** `z-25` classes.
   - Replace all **6** broken `xs:` breakpoint classes (5 in `MeetingToolbar.tsx` + 1 in `WhiteboardStage.tsx:146`) with valid breakpoints (`md:` / `sm:`). Because `tailwind.config.js` sets `sm: '480px'` and `md: '768px'`, update `MeetingToolbar.tsx` desktop visibility breakpoints from `sm:` to `md:`/`lg:` so phone (`<768px`) keeps the `DEF-17-03` 5+9 structure and tablet (`768px+`) stops wrapping mid-row.
3. **WCAG Contrast, Buttons & Favicon:**
   - Calibrate `--cly-text-secondary` (`#555D66` light / `#A3AAB2` dark) across descriptive labels/captions in `client/src/styles/tokens.css` so secondary text meets >= 4.5:1 AA contrast.
   - Update `client/src/components/ui/Button.tsx` (`line 67`) to add surface-matched dark focus-ring offsets (`dark:focus-visible:ring-offset-[#111316]` / `#181B20`) eliminating white ring halos, and standardize button size tiers (`sm: h-9`, `md: h-10`, `lg: h-12` or calibrated consistently).
   - Update `client/public/favicon.svg` from legacy `#172B3A`/`#168B83` checkmark to the `BrandMark` geometric studio mark in Pine `#2F6F68`.

### 3.2 Shared Studio Primitives
1. **`<ModalShell>` (`client/src/components/ui/ModalShell.tsx`):**
   - Renders via `createPortal(..., document.body)` at `z-modal` (`400`) above `DashboardHeader` (`z-30`), `WhiteboardStage` (`overflow-hidden`), and mobile drawer (`z-40`).
   - Maintains a lightweight module-level `openModalStack` and ref-counted body scroll-lock (`data-cly-modal-locks`): when nested modals open (e.g., `ConfirmActionDialog` over `FilesPanel` preview or `MeetingsPage` delete confirm over history details), `Escape` and `Tab`/`Shift+Tab` trapping operate strictly on the topmost modal, and body `overflow` is restored only when the stack empties or unmounts cleanly.
   - Matte surface: backdrop `bg-black/45 dark:bg-black/70 backdrop-blur-[2px]`, card `bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2A2F37] rounded-2xl shadow-cly-lg`, subtle header `#F3F2EE dark:bg-[#141619]` with optional icon badge, `title` (rendered with `id={titleId}`), optional `subtitle`, and close button (`aria-label={closeLabel}` defaulting to `"Close dialog"` — overridable to `"Close preview"` for `FilesPanel`).
   - Supports pass-through `dialogProps` (e.g., `data-modal="file-preview"`), `size?: 'sm' | 'md' | 'lg' | 'xl'`, `variant?: 'default' | 'danger' | 'theater'`, `closeOnBackdrop?: boolean` (`true`), `closeOnEscape?: boolean` (`true`), `initialFocusRef`, `footer?`.
2. **`<StudioSwitch>` (`client/src/components/ui/StudioSwitch.tsx`):**
   - Matte pill switch (`bg-[#DDDAD0] dark:bg-[#272C33]` off, `bg-[#2F6F68] dark:bg-[#5FA399]` on, crisp focus ring with dark offset).
   - Supports both `role="switch"` `<button>` mode (`InstantMeetingModal`, `RoomSettingsModal`) and checkbox-backed `<input type="checkbox" className="sr-only">` mode so Settings switches preserve `#setting-audio-muted` and `#setting-video-off` `<input>` contracts (`.checked`, `.click()`, `<label htmlFor>`).
3. **Shared Matte Badge / Tone Map (`client/src/lib/studioTokens.ts`):**
   - Maps meeting states (`scheduled`, `active`, `ended`, `cancelled`, `expired`), participant roles (`host`, `co-host`), and file categories to calibrated matte light/dark classes and Title Case labels (`Scheduled`, `Live`, `Ended`, `Cancelled`, `Expired`).

---

## 4. Workstream 2 — Popups, Modals & Header Overlays

All dialogs migrate to `<ModalShell>` (`z-modal: 400`, portal, Esc, backdrop dismissal, focus trap & restoration):

| Component | Key Fixes & Redesign Details |
| :--- | :--- |
| **`ScheduleMeetingModal` & `ScheduleNoticeModal`** | Fix `MeetingsPage.tsx:1063-1066` bug where `onMeetingScheduled` calls `setIsScheduleModalOpen(false)` prematurely, hiding `ScheduleMeetingModal`'s Created + Copy Join Link step (`ScheduleMeetingModal.tsx:261-323`); change to refresh `fetchUpcoming(1)` only so the user sees the confirmation & copy step until clicking Done. Fix light-only `bg-amber-50` DST notice (`dark:bg-[#262118] dark:border-[#8C6A2E]/40 dark:text-[#E7C684]`), `hover:bg-gray-50`, and missing dark link color. Preserve both exports (`phase17Sprint01.test.ts:241-242`). |
| **`RescheduleModal`** | Fix unstyled `<input type="date">` / `<input type="time">` in dark mode (`bg-white dark:bg-[#141619] text-[#1F2428] dark:text-[#EDEFF2] border-[#DDDAD0] dark:border-[#2A2F37] [color-scheme:light] dark:[color-scheme:dark]`), fix DST alert box & hover states, streamline helper text. |
| **`CancelMeetingModal`** | Replace light rose header/alert (`lines 108-130`) and unstyled `<textarea>` with `<ModalShell variant="danger">` (`#F6E6E6 dark:bg-[#2B1B1D]`, `#C24D4D dark:text-[#E58484]`), dark-styled textarea (`dark:bg-[#141619]`), and clear `"Keep Meeting"` vs `"Cancel Meeting"` buttons. |
| **`MeetingInvitationModal`** | Fix `text-emerald-300` on `primary` button. Present a clean structured summary card (Title, Date/Time, Code) with crisp 1-click **`Copy Link`**, **`Copy Code`**, **`Copy Invitation`** (compact full-text copy action without dumping a raw text wall inline), and **`Open Room`** buttons. |
| **`JoinMeetingModal` & `InstantMeetingModal`** | Wrap in `<ModalShell>`, gaining backdrop-click + Escape close while preserving `#join-meeting-code-input`, `#join-code-error`, `titleId="instant-meeting-title"`, `#instant-meeting-name`, `#instant-waiting-room`, and `[10, 25, 60]` capacity pills. |
| **`EditProfileModal` & `HelpModal`** | Migrate chrome to matte `<ModalShell>` aesthetic. Preserve `wasOpenRef` in `EditProfileModal.tsx` (and update `dashboard.test.ts:144` if portal creation moves cleanly inside `<ModalShell>`, OR keep `createPortal` explicit). Upgrade `HelpModal` from bright emerald to pine matte (`#E2ECE9 dark:bg-[#1F302E]`) and update `dashboard.test.ts:156` in lockstep; trim Help prose to scannable shortcut/action rows. |
| **`PhaseNoticeModal` & `ConfirmActionDialog`** | Unify under `<ModalShell size="sm">` in Stone & Carbon Matte styling (`z-modal: 400`). |
| **`NotificationsPopover` & `AccountMenu`** | Preserve `div[role="region"][aria-label="Notifications"]` and `div[role="menu"]` while fixing mobile `320px` overflow (`fixed top-16 left-3 right-3 sm:left-auto sm:right-6 sm:w-96` or portal-anchored outside `<header>`'s `backdrop-blur-md` layer). Replace clickable `<div>` notification items with accessible `<button>` rows, add `ArrowUp`/`ArrowDown`/`Home`/`End`/`Escape` menu keyboard navigation, use a calm static pine dot (no pulse), and preserve `!notifications.includes('ring-white')` (`dashboard.test.ts:157`). |
| **`MeetingsPage` Details & Delete Confirm** | Route `selectedHistoryDetails` (currently un-portaled, missing Esc/backdrop/focus-trap/`aria-labelledby`) and `deleteConfirmTargets` through `<ModalShell>`. |

---

## 5. Workstream 3 — Hub Pages (`Meetings`, `Downloads`, `Settings`, `404`), Auth & Router

1. **Single Clean Header Across Hub Pages:**
   - Remove the redundant inner `<h2>` + `"Back to Overview"` button strip that duplicates `DashboardHeader`'s `<h1>` on `MeetingsPage`, `DownloadsPage`, and `SettingsPage`. Replace with a concise contextual action bar (optional filter summary/subtitle left, primary CTA right).
2. **`MeetingsPage`:**
   - Fix dark-mode `bg-rose-50` error alert and `hover:bg-rose-50` delete row actions (`dark:bg-[#2B1B1D]`, `dark:hover:bg-[#332022]`).
   - Standardize Search + Status + Role controls to `h-10` with explicit `aria-label`s (`Search meetings`, `Filter by status`, `Filter by role`). Include `'EXPIRED'` in the status `<select>` alongside `'SCHEDULED'`, `'ACTIVE'`, `'ENDED'`, `'CANCELLED'`.
   - Fix empty-state `"Clear Filters"` visibility condition (`MeetingsPage.tsx:605`: show whenever `historySearchTerm || historyStatusFilter !== 'ALL' || historyRoleFilter !== 'ALL'`, not only `historySearchTerm`).
   - Humanize raw uppercase badges (`ENDED` -> `Ended`, `CANCELLED` -> `Cancelled`, `EXPIRED` -> `Expired`) using the matte tone helper, and preserve `'/meetings/history'`, `'deleteMeetingHistoryEntry'`, and `'deleteMeetingHistoryEntries'` (`dashboard.test.ts:169-179`).
3. **`DownloadsPage`:**
   - Preserve the desktop `[data-table="downloads-files"]` `[data-row-file]` table (`hidden md:block`) and add a clean stacked card list (`md:hidden`) so 320–767px screens never require horizontal scrolling.
   - Surface inline matte error banners with a `"Retry"` button whenever loading files or downloading fails (currently swallowed via `console.error`).
   - Distinguish true empty state (`"No shared files yet"`) from filtered-empty (`"No matching files"` + `"Clear Filters"` button).
   - Remove invalid `<Link><Button>` nested interactive DOM (`lines 311-320`); style `<Link>` directly or use a single `<button onClick>`.
   - Standardize filter inputs to `h-10` and style file-type badges in calm matte tones.
4. **`SettingsPage`:**
   - Fix critical dark-mode bug (`lines 427-450`: `bg-amber-50` + `dark:text-[#EAECEE]`) using calibrated matte warning colors (`#FAF3E4 dark:bg-[#262118] border-[#D8B467]/40`).
   - Replace raw native checkboxes with accessible `<StudioSwitch>` components backed by `#setting-audio-muted` and `#setting-video-off` checkboxes so scripts inspecting `.checked` / `.click()` work seamlessly.
   - Strip internal/jargon fields (`User Identifier` UUID row, `"Argon2id + Dual Token Protection"` card) and replace the 31-word sync error wall with concise, **strictly truthful** copy (`"Saved locally — click Retry to sync."`, never claiming automatic background retry since none exists). Consolidate duplicated top save banner + bottom status text into one quiet inline status pill (`Saved`, `Saving...`, or retry state).
5. **`NotFoundPage`, Auth & Router Chrome:**
   - Upgrade `NotFoundPage` with a minimal `BrandMark` + `ThemeToggle` top bar, concise copy (`"Page not found"`, `"This route may have moved or expired."`), and `"Back to Dashboard"` link (`/dashboard`).
   - Ensure `AuthGatewayPage`, `LoginPage`, and `RegisterPage` feature calibrated `focus-visible` pine rings, high-contrast dark error states, and skip-to-form navigation while keeping every `authShowcaseContent.test.ts` assertion green (`studio-workspace.jpg`, `PhaseNoticeModal`, `ThemeToggle`, `sticky top-0`, `AUTH_TOPBAR_COPY`, `max-w-[500px]`, `<Label htmlFor="login-password"`, `Continue with Google`, `loginWithGoogle`).
   - Wire `AppRouter` (`ProtectedRoute`, `PublicOnlyRoute`) through the single shared `<LoadingFallback />`; remove dead `DashboardPlaceholderPage.tsx` (0 imports) and redirect `/scaffold` cleanly to `/dashboard` so no internal Phase 03 scaffold copy reaches end users.

---

## 6. Workstream 4 — Pre-Join Green Room & Full-Bleed Live Meeting Studio

### 6.1 Pre-Join Green Room (`PreJoinLobbyPage` + `usePreJoinMediaPreview`)
- **Minimal Studio Header:** Replace `<Video>` icon with `<BrandMark />`, show a single top-left `"Back"` link to Dashboard, and remove the two redundant Dashboard links inside cards/below actions.
- **2-Column Studio Stage + Readiness Card:**
  - **Left (Camera Stage):** Rounded matte theater viewport (`#181B20`) with live video or clean monogram fallback, plus a subtle **live Web Audio microphone meter bar** directly under the mic toggle (extending `usePreJoinMediaPreview.ts` to expose `micLevel` via `AudioContext` + `AnalyserNode`, degrading cleanly when audio is muted/denied/unsupported).
  - **Right (Device & Join Controls):** Room title, single concise waiting-room indicator above/beside the primary CTA (`"Join Meeting Now"`), unified `h-10` mic/camera/**speaker** selectors (exposing `selectSpeakerDevice` cleanly from `usePreJoinMediaPreview.ts` when `sinkId` is supported), mic/camera preview toggles, and matte pine join CTA.
- **Copy & Dark-Mode Alerts:** Remove raw `Status: ACTIVE`, `Local Preview Only`, and `"Authenticated User"` fallback; replace `bg-rose-50`, `bg-amber-100`, and `bg-amber-50` banners with dark-safe matte error/warning styling while keeping all `data-prejoin-*` attributes.

### 6.2 Live Meeting Studio Layout (`MeetingRoomPage`, `MeetingHeader`, `MeetingToolbar`)
- **Locked `100dvh` Dark Theater Studio (`#111316` / `#181B20`):** Keep Live Meeting Room & Whiteboard strictly matte dark theater (`#111316` canvas, `#181B20` elevated surfaces, `#EDEFF2` text) matching `SettingsPage.tsx` (*"Meeting theater stays low-glare dark matte for clear video contrast"*), replacing the `min-h-screen` + `max-w-7xl` boxed layout with `h-[100dvh] w-full overflow-hidden flex flex-col`.
- **Quiet Header (`h-14 shrink-0`):**
  - Left: compact `<BrandMark />`, truncated room title, 1-click copy room code pill, and quiet **`Live`** indicator (pine dot + `"Live"` text carrying the sole `data-livekit-status={liveKitStatus}` attribute on the page so selectors always match cleanly).
  - Right: room lock pill (when locked), participant counter, drawer toggle, and view action.
  - **Transient Connection Strip:** Omit the permanent ~100px `LiveKitStatusCard` & `"Live Stage"` sub-header during healthy `'connected'` / `'idle'` states; show a compact `LiveKitStatusCard` strip only during `'requesting_token' | 'connecting' | 'reconnecting' | 'disconnected' | 'failed' | 'unauthorized' | 'meeting_ended'` (omitting duplicate `data-livekit-status`).
  - **Single Audio-Blocked Banner:** Consolidate `MeetingRoomPage` + `LiveKitStatusCard` audio notices into one floating banner (`data-audio-blocked-banner="true"`, `data-control="safari-enable-audio"`).
- **Collapsible Side Drawer (`w-0` closed / `w-[352px]` open on `lg+`):**
  - Default open to `participants` on `lg+` so host controls (`Promote`/`Remove`/`Waiting`) remain immediately accessible; closed by default (`isMobileDrawerOpen = false`) below `lg`.
  - Clicking an already-active tab pill or the drawer `X` button collapses the drawer (`activeSideTab = null`), expanding the stage to 100% width instead of resetting back to Participants.
  - Preserve `data-tab="participants" | "chat" | "files" | "waiting"` (keeping `"participants"`, NOT `"people"`), static pine count pills (no `animate-pulse`), and extend the mobile drawer focus trap query (`MeetingRoomPage.tsx:125`) to include `textarea:not(:disabled), select:not(:disabled)`.
- **Floating Segmented Dock (`MeetingToolbar`):**
  - Render `MeetingToolbar` as a `shrink-0` footer container (or reserve `pb-20` on the stage) so the Whiteboard's bottom-center toolbar never overlaps the main meeting dock.
  - **Desktop (`md:` / `lg+`):** Centered floating capsule (`bg-[#181B20]/95 backdrop-blur-md border border-[#2A2F37] rounded-2xl shadow-cly-theater`) grouped into 3 clean clusters separated by `w-px h-6 bg-[#2A2F37]`:
    1. **Media:** Mic (`toggle-mic`), Camera (`toggle-camera`), Devices (`open-devices`)
    2. **Collaborate:** Share Screen (`toggle-screenshare`), Whiteboard (`toggle-whiteboard`), Reactions (`toggle-reactions`), Chat (`toggle-chat`), Participants (`toggle-participants`), Files (`toggle-files`)
    3. **Room & Leave:** Host controls (Waiting Room, Lock Room, Room Settings), `Leave` (`leave-meeting`), and Host `End for All` (kept separate in the DOM for instant host termination & script compatibility) in matte danger `#C24D4D`.
  - **Mobile (`<768px`, `md` breakpoint):** Strictly keep `phase17Sprint01.test.ts` (`DEF-17-03`) structure — **5 primary controls** (`toggle-mic`, `toggle-camera`, `toggle-chat`, `mobile-more-actions`, `leave-meeting`) and **9 secondary More drawer items** (`mobile-screenshare`, `mobile-whiteboard`, `mobile-files`, `mobile-reactions`, `mobile-devices`, `mobile-people`, `mobile-waiting`, `mobile-lock`, `mobile-room-settings`) — while keeping desktop toolbar buttons hidden responsively via `hidden md:inline-flex` so `[data-control="toggle-files"]` remains queryable in the DOM on mobile viewports too.

### 6.3 Video Grid, Screen Share, Side Panels, Meeting Modals & Whiteboard
1. **`VideoConferenceGrid`, `ParticipantVideoTile` & `ScreenShareView`:**
   - Add `compact?: boolean` to `ParticipantVideoTile` for ScreenShare & Whiteboard filmstrips (`144x88px` / `160x96px`) so badges and monogram fallbacks never clip or overlap.
   - Replace `slate-*` / `sky-*` accents with matte pine active-speaker rings (`ring-2 ring-[#5FA399]`), pine Host chip, and charcoal `#272C33` Co-Host / Muted chips. Remove redundant center `"Camera Off"` banner (avatar monogram + bottom name/mic pill only). Preserve `data-participant-tile`, `data-local-tile`, `data-speaking`, `data-camera-on`, `data-mic-on`.
   - Move `ScreenShareView` status bar above the stream container (`flex-col` bar + `min-h-0 flex-1` video frame) so top UI/slides in shared screens are never covered, preserving `data-screenshare-*`.
2. **`ParticipantsPanel`, `WaitingRoomPanel`, `ChatPanel` & `FilesPanel`:**
   - Deduplicate inner drawer headers (single drawer chrome header + compact contextual action strip for `Mute All`, `Upload`, etc.).
   - Apply calibrated matte tones across role chips (`Host` pine, `Co-Host` charcoal) and file icons; add explicit `aria-label`s (`Admit <name>`, `Reject <name>`, `Dismiss upload error`).
   - Replace `window.confirm` in `FilesPanel.tsx:260` with portaled `<ConfirmActionDialog>`; wrap `FilesPanel` preview modal in `<ModalShell closeLabel="Close preview" dialogProps={{ 'data-modal': 'file-preview' }}>` while preserving every `FilesPanel.accessibility.test.ts` contract (`data-panel="files-panel"`, `data-dropzone="file-upload"`, `data-modal="file-preview"`, `data-testid="files-panel-announcer"`, Enter/Space browse, focus trap, Escape focus restore).
3. **`DeviceSettingsModal`, `RoomSettingsModal` & `ConfirmActionDialog`:**
   - Wrap in `<ModalShell variant="theater">` (`z-modal: 400`) using `<StudioSwitch>` controls (`role="switch"`), preserving `phase17Sprint01.test.ts` `role="dialog"` + `aria-modal="true"` checks.
4. **Whiteboard Studio (`WhiteboardStage`, `WhiteboardToolbar`, `WhiteboardCanvas`):**
   - Fix `[data-badge="collaborators-count"]` broken `xs:inline-flex` -> `sm:inline-flex`.
   - Replace `#1E293B` Deep Slate default ink (invisible on dark `#111316`) with visible `#EDEFF2` Chalk ink across an 8-swatch (`grid-cols-4`) matte high-contrast dark palette (`#EDEFF2` Chalk, `#D9D2C5` Sand, `#5FA399` Pine, `#86B89A` Sage, `#E5B869` Amber, `#D46A6A` Coral, `#7FA6CC` Steel, `#A799CC` Lavender). Upgrade selection box stroke (`WhiteboardCanvas.tsx:316`) from low-contrast `#2F6F68` to crisp `#5FA399`.
   - Implement outside-click + `Escape` dismissal for Shapes/Color/Width popovers so menus never stack open simultaneously, and replace `focus:outline-none` on swatches with `focus-visible:ring-2 focus-visible:ring-[#5FA399]`.
   - Implement the advertised keyboard shortcuts (`V` Select, `H` Hand/Pan, `P` Pen, `E` Eraser, `T` Text, `Ctrl/Cmd+Z` Undo, `Ctrl/Cmd+Y`/`Ctrl/Cmd+Shift+Z` Redo, `Delete`/`Backspace` remove selection), plus guard both Whiteboard listeners and `MeetingRoomPage`'s `W` shortcut whenever focus is inside `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, or an open `[role="dialog"]`. Preserve all `data-whiteboard-*`, `data-tool=*`, `data-action=*`, `data-element=*`.

---

## 7. Copy Cleanup Standard (Minimal & Crisp)

| Surface | Removed Unnecessary Copy | Replacement Copy |
| :--- | :--- | :--- |
| **Settings** | `"User Identifier"` raw UUID row; `"Argon2id + Dual Token Protection"`; duplicate save banners; 31-word sync error wall | Clean preferences rows; `"Saved locally — click Retry to sync."`; quiet inline `Saved` status chip |
| **Pre-Join Lobby** | `"Status: ACTIVE"`, `"Local Preview Only"`, `"Authenticated User"` fallback, 3 `"Back to Dashboard"` links, repeated waiting-room blurbs | Single top-left `"Back"`, display name / initial, live mic meter, single waiting-room note beside `"Join Meeting Now"` |
| **Live Meeting Stage** | `"Live Stage"` sub-header, permanent `~100px` `LiveKitStatusCard` details box during connected state, duplicate `"Audio blocked"` banners, `"Camera Off"` center banner | Quiet header `"Live"` status pill (`data-livekit-status`), single `"Enable Audio"` banner, centered avatar monogram + bottom name pill |
| **Hub Pages (`Meetings`, `Downloads`, `Settings`)** | Duplicate `<h1>`/`<h2>` + `"Back to Overview"` links; raw `"ENDED"` / `"CANCELLED"` / `"EXPIRED"` badges | Single page heading in header + concise action strip; Title Case pills (`Ended`, `Cancelled`, `Expired`) |
| **Not Found (`404`)** | Verbose fallback description | Branded header + `"Page not found"` + `"This route may have moved or expired."` + `"Back to Dashboard"` |
| **Public `/scaffold`** | `"Phase 03 scaffold"` internal copy | Redirect `/scaffold` safely to `/dashboard` (authenticated) or `/login` (guest); delete unused `DashboardPlaceholderPage.tsx` |

---

## 8. Test & Verification Script Alignment

- **Unit/Component Tests (`client/src/**/*.test.*`):**
  - Keep `EditProfileModal.tsx` `wasOpenRef` (update `dashboard.test.ts:144` only if `createPortal` delegates to `<ModalShell>`, and update `dashboard.test.ts:156` `HelpModal` `dark:bg-emerald-950` -> `dark:bg-[#1F302E]` in the same commit).
  - Keep all assertions in `authShowcaseContent.test.ts`, `phase17Sprint01.test.ts`, `FilesPanel.accessibility.test.ts`, and `dashboard.test.ts:157,169-179` green.
- **Browser Scripts (`scripts/verify_phase_*.{js,mjs}`):**
  - Preserve high-value shared selectors (`"Join Meeting Now"`, `End for All`, `data-tab="participants"`, `data-livekit-status`, `#instant-meeting-title`, `#setting-audio-muted`, `#setting-video-off`, `[data-table="downloads-files"]`, `[data-row-file]`, `div[role="region"][aria-label="Notifications"]`, `div[role="menu"]`, `[data-control="toggle-files"]`).
  - Explicitly update affected Phase 06 / 07 / 09 browser script text expectations (`verify_phase_06.js`, `verify_phase_07.js`, `verify_phase_07_audit.js`, `verify_phase_09_livekit.js`) in the implementation plan alongside tightening `DownloadsPage` empty state, `SettingsPage` sync copy, and hiding `LiveKitStatusCard` when connected.

---

## 9. Verification Plan (Post-Implementation)

1. Run `npm run lint --workspace=client`, `npm run typecheck --workspace=client`, `npm test --workspace=client`, and `npm run build --workspace=client` — confirm 0 errors across lint, TypeScript, unit/component tests, and production bundle.
2. Run `npm test --workspace=server` (sanity check no shared contract regressions).
3. Inspect key desktop (`1440px`), tablet (`768px`), and mobile (`375px`) flows against the built bundle across Light, Dark, and Meeting Theater modes (`Dashboard`, `Meetings`, `Downloads`, `Settings`, `404`, `Pre-Join Lobby`, `Live Meeting Room`, `Whiteboard`, and key modals).
