# CONNECTLY Matte Dual-Theme Redesign & Live Meeting Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire CONNECTLY client UI with a cohesive Stone & Carbon Matte color palette supporting seamless Light, Dark, and System theme switching, polish live Landing copy/navigation, and unify all meeting invite/join links to always reflect the active live deployment origin.

**Architecture:** We centralize matte color tokens as CSS custom properties under `:root` (Light Matte) and `html.dark` (Dark Matte) in `tokens.css` paired with `tailwind.config.js` (`darkMode: 'class'`), add an anti-FOUC early script in `client/index.html` plus `ThemeContext` + `ThemeToggle` UI controls, migrate all styled primitives/pages/components away from shiny cyan/navy hexes (`#168B83`, `#2EC4B6`, `#7CE5DB`, `#DCEDE8`, `#172B3A`, `#F7F6F2`), and extract a pure `meetingLink.ts` utility consumed by every instant, scheduled, invitation, lobby, and in-room link display/copy action.

**Tech Stack:** React 18, TypeScript 5.5, Tailwind CSS 3 (`darkMode: 'class'`), Vite 6, Lucide Icons, Node `--experimental-strip-types --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-matte-theme-live-links-design.md`

## Global Constraints

- Matte Finish Palette (`:root` Light Matte `#F3F2EE` / `#FAF9F6` / `#1F2428` / `#2F6F68` / `#C24D4D`; `html.dark` Dark Matte `#141619` / `#1C1F24` / `#24282E` / `#EAECEE` / `#5FA399` / `#D46A6A`).
- Meeting Room Theater surfaces stay dark matte charcoal (`#111316` canvas, `#181B20` video tiles, `#1C1F24` panels, `#5FA399` active speaker ring).
- Never send unknown `theme` properties inside `preferencesApi.updatePreferences()` payloads (backend `updatePreferencesSchema` strictly rejects unknown keys).
- Preserve all modal accessibility contracts (`role="dialog"`, `aria-modal="true"`, `PhaseNoticeModal` export & name) verified in `phase17Sprint01.test.ts`.
- Keep all existing client unit test fixtures/contracts (`whiteboardApi.test.ts`, `meetingApi.test.ts`, `schedulingApi.test.ts`) passing.
- `VITE_APP_URL` is optional fallback only; live browser origin (`window.location.origin`) takes precedence when running over HTTP/HTTPS.

## Review Focus

- **Whitespace, trailing slash, or empty string in `VITE_APP_URL` / `window.location.origin`:** Must strip trailing slashes, reject blank/non-HTTP origins (such as `null` or `about:blank`), and cleanly fall back to backend `joinUrl` or `/join/<code>`. Tested in `meetingLink.test.ts`.
- **Legacy `/lobby/<code>` URLs inside backend `invitationText`:** `normalizeInvitationUrls` must rewrite both `/join/<code>` and `/lobby/<code>` occurrences in multi-line invitation text without corrupting title/time/sender text. Tested in `meetingLink.test.ts`.
- **Corrupted or unexpected `localStorage` value under `cly_theme_mode` (or disabled `localStorage`):** `resolveThemeState` must default safely to `'system'` and apply `prefersDark` without throwing in SSR/private browsing. Tested in `themeUtils.test.ts`.
- **Meeting code with whitespace or uppercase inside Landing join flow:** `onJoinCode` must normalize codes via `validateMeetingCode` before navigating to `/join/:code`. Verified in Landing refactor & `meetingCode.test.ts`.
- **Residual neon/shiny hex leak (`#2EC4B6`, `#7CE5DB`, `#168B83`, `#DCEDE8`, `#172B3A`, `#F7F6F2`):** Zero stray legacy UI palette hexes in `client/src/` UI components/pages after migration (`tokens.css` comments and explicit whiteboard stroke swatch tests excluded). Verified by automated audit script.

---

### Task 1: Pure Live Meeting Link Resolver Utility & Tests

**Files:**
- Create: `client/src/lib/meetingLink.ts`
- Test: `client/src/lib/meetingLink.test.ts`

**Interfaces:**
- Produces:
  - `resolveAppOrigin(windowOrigin?: string, configuredAppUrl?: string): string`
  - `buildMeetingJoinUrl(meetingCode: string, fallbackJoinUrl?: string, windowOrigin?: string, configuredAppUrl?: string): string`
  - `normalizeInvitationUrls(invitationText: string, joinUrl: string, meetingCode: string, windowOrigin?: string, configuredAppUrl?: string): { joinUrl: string; invitationText: string }`

- [ ] **Step 1: Write the failing test in `client/src/lib/meetingLink.test.ts`**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAppOrigin,
  buildMeetingJoinUrl,
  normalizeInvitationUrls,
} from './meetingLink.ts';

describe('meetingLink live URL resolution', () => {
  it('prefers live HTTP/HTTPS window origin and strips trailing slashes', () => {
    assert.strictEqual(
      resolveAppOrigin('https://connectly-ashy.vercel.app/', 'http://localhost:5173'),
      'https://connectly-ashy.vercel.app'
    );
  });

  it('falls back to configured VITE_APP_URL when windowOrigin is missing or non-HTTP', () => {
    assert.strictEqual(
      resolveAppOrigin('about:blank', 'https://connectly-ashy.vercel.app///'),
      'https://connectly-ashy.vercel.app'
    );
    assert.strictEqual(resolveAppOrigin('', '  '), '');
  });

  it('builds /join/:code using active live origin and falls back cleanly when origin unavailable', () => {
    assert.strictEqual(
      buildMeetingJoinUrl('cly-abc-def', 'http://localhost:5173/join/cly-abc-def', 'https://connectly-ashy.vercel.app'),
      'https://connectly-ashy.vercel.app/join/cly-abc-def'
    );
    assert.strictEqual(
      buildMeetingJoinUrl('cly-abc-def', 'https://fallback.example/join/cly-abc-def', '', ''),
      'https://fallback.example/join/cly-abc-def'
    );
    assert.strictEqual(buildMeetingJoinUrl('cly-abc-def', '', '', ''), '/join/cly-abc-def');
  });

  it('rewrites joinUrl and multi-line invitationText /join or /lobby links to active live origin without corrupting copy', () => {
    const raw = [
      'Join Connectly Meeting: Architecture Sync',
      'Time: Nov 26, 2026',
      'Join Link: http://localhost:5173/lobby/cly-xyz-123',
      'Meeting Code: cly-xyz-123',
    ].join('\n');

    const normalized = normalizeInvitationUrls(
      raw,
      'http://localhost:5173/join/cly-xyz-123',
      'cly-xyz-123',
      'https://connectly-ashy.vercel.app'
    );

    assert.strictEqual(normalized.joinUrl, 'https://connectly-ashy.vercel.app/join/cly-xyz-123');
    assert.ok(normalized.invitationText.includes('Join Link: https://connectly-ashy.vercel.app/join/cly-xyz-123'));
    assert.ok(normalized.invitationText.includes('Join Connectly Meeting: Architecture Sync'));
    assert.ok(!normalized.invitationText.includes('localhost:5173'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test client/src/lib/meetingLink.test.ts`
Expected: FAIL (`Cannot find module './meetingLink.ts'`)

- [ ] **Step 3: Implement `client/src/lib/meetingLink.ts`**

Implement `resolveAppOrigin`, `buildMeetingJoinUrl`, and `normalizeInvitationUrls` cleanly with URL parsing (`new URL`), trailing-slash normalization, runtime `typeof window !== 'undefined' ? window.location.origin : ''` and `import.meta.env?.VITE_APP_URL` defaults, and regex replacement for `https?://[^\s/]+/(?:join|lobby|meeting)/<code-regex>` inside `invitationText`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test client/src/lib/meetingLink.test.ts`
Expected: PASS (`4/4` tests pass)

---

### Task 2: Wire Centralized Live Meeting Link Helper Across UI & Env Examples

**Files:**
- Modify: `client/src/components/dashboard/InstantMeetingModal.tsx`
- Modify: `client/src/components/dashboard/ScheduleMeetingModal.tsx`
- Modify: `client/src/components/dashboard/MeetingInvitationModal.tsx`
- Modify: `client/src/components/meeting/MeetingHeader.tsx`
- Modify: `client/src/pages/PreJoinLobbyPage.tsx`
- Modify: `client/.env.production.example`

**Interfaces:**
- Consumes: `buildMeetingJoinUrl`, `normalizeInvitationUrls` from `@/lib/meetingLink`

- [ ] **Step 1: Replace ad-hoc URL building in modals, lobby, and meeting header**

Update:
- `InstantMeetingModal.tsx`: replace inline `getInvitationLink` with `buildMeetingJoinUrl(meeting.meetingCode, meeting.joinUrl)` and display the live join URL clearly alongside Copy Link.
- `ScheduleMeetingModal.tsx`: replace `successMeeting.joinUrl` with `buildMeetingJoinUrl(successMeeting.meetingCode, successMeeting.joinUrl)` on copy + display it visibly in the scheduled summary box.
- `MeetingInvitationModal.tsx`: compute normalized `{ joinUrl, invitationText } = normalizeInvitationUrls(invitation.invitationText, invitation.joinUrl, invitation.meetingCode)` and use it for display + `handleCopy` + `handleCopyLinkOnly`.
- `PreJoinLobbyPage.tsx` & `MeetingHeader.tsx`: use `buildMeetingJoinUrl(...)`.
- `client/.env.production.example`: document `VITE_APP_URL=https://your-app.vercel.app`.

- [ ] **Step 2: Run typecheck + client tests**

Run: `npm run typecheck --workspace=client && npm test --workspace=client`
Expected: PASS

---

### Task 3: Theme Logic, Anti-FOUC Boot, ThemeContext & ThemeToggle

**Files:**
- Create: `client/src/context/themeUtils.ts`
- Create: `client/src/context/ThemeContext.tsx`
- Create: `client/src/components/ui/ThemeToggle.tsx`
- Test: `client/src/context/themeUtils.test.ts`
- Modify: `client/index.html`
- Modify: `client/src/app/providers/AppProviders.tsx`

**Interfaces:**
- Produces:
  - `export type ThemeMode = 'light' | 'dark' | 'system';`
  - `export type ResolvedTheme = 'light' | 'dark';`
  - `THEME_STORAGE_KEY = 'cly_theme_mode'`
  - `parseStoredThemeMode(raw: unknown): ThemeMode`
  - `resolveEffectiveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme`
  - `ThemeProvider`, `useTheme()` (`{ mode, resolvedTheme, setMode, cycleMode }`)
  - `<ThemeToggle variant="compact" | "segmented" />`

- [ ] **Step 1: Write failing unit tests in `client/src/context/themeUtils.test.ts`**

Test `parseStoredThemeMode` (`'light'`, `'dark'`, `'system'`, invalid/corrupt strings -> `'system'`), `resolveEffectiveTheme` for all mode × `systemPrefersDark` combinations, and safe localStorage helper behavior when storage throws or returns `null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test client/src/context/themeUtils.test.ts`
Expected: FAIL (`Cannot find module './themeUtils.ts'`)

- [ ] **Step 3: Implement `themeUtils.ts`, `ThemeContext.tsx`, `ThemeToggle.tsx`, `index.html`, and `AppProviders.tsx`**

- `client/index.html`: add tiny synchronous inline script in `<head>` setting `.dark` class and `color-scheme` from `localStorage.getItem('cly_theme_mode')` + `matchMedia('(prefers-color-scheme: dark)')`, and update `<body>` classes to matte semantic surface classes (`bg-[var(--cly-surface-canvas)] text-[var(--cly-text-primary)]`) + theme-color meta tags `#F3F2EE` / `#141619`.
- `ThemeContext.tsx`: manages `mode`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` change events when `mode === 'system'`, toggles `document.documentElement.classList.toggle('dark', resolved === 'dark')`, and updates `document.documentElement.style.colorScheme` + `meta[name="theme-color"]`.
- `ThemeToggle.tsx`: `compact` pill button (shows current Sun/Moon/Monitor icon + crisp tooltip/label, cycles `light -> dark -> system`) and `segmented` 3-button matte selector for `SettingsPage`.
- Wrap `AppProviders` cleanly with `<ThemeProvider>`.

- [ ] **Step 4: Run test & typecheck**

Run: `node --experimental-strip-types --test client/src/context/themeUtils.test.ts && npm run typecheck --workspace=client`
Expected: PASS

---

### Task 4: Matte Dual-Theme Design Tokens, Globals, Tailwind Config & UI Primitives

**Files:**
- Modify: `client/src/styles/tokens.css`
- Modify: `client/src/styles/globals.css`
- Modify: `client/tailwind.config.js`
- Modify: `client/src/components/ui/Button.tsx`
- Modify: `client/src/components/ui/Card.tsx`
- Modify: `client/src/components/ui/Input.tsx`
- Modify: `client/src/components/ui/Label.tsx`
- Modify: `client/src/components/ui/Badge.tsx`
- Modify: `client/src/components/ui/Spinner.tsx`
- Modify: `client/src/components/feedback/ErrorFallback.tsx`
- Modify: `client/src/components/feedback/LoadingFallback.tsx`
- Modify: `client/src/components/layout/PageShell.tsx`
- Modify: `client/src/layouts/AppLayout.tsx`

- [ ] **Step 1: Upgrade `tokens.css`, `globals.css`, and `tailwind.config.js` to Stone & Carbon Matte CSS variables**

Define all Light Matte (`:root`) and Dark Matte (`html.dark`) variables in `tokens.css`, extend `tailwind.config.js` so `cly` semantic tokens reference CSS custom properties / matte hexes cleanly, and keep soft diffused shadows (`shadow-cly-sm`, `shadow-cly-md`) with zero glossy cyan (`#2EC4B6`, `#7CE5DB`) or bright neon highlights.

- [ ] **Step 2: Refactor all `ui/`, `feedback/`, and layout shell primitives to dual-mode matte classes**

Update `Button`, `Card`, `Input`, `Label`, `Badge`, `Spinner`, `ErrorFallback`, `LoadingFallback`, `PageShell`, and `AppLayout` to use matte semantic tokens and clean `dark:` surfaces (`bg-[#FAF9F6] dark:bg-[#1C1F24]`, `border-[#DDDAD0] dark:border-[#2B3038]`, `bg-[#2F6F68] dark:bg-[#5FA399]`).

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck --workspace=client && npm run lint --workspace=client`
Expected: PASS

---

### Task 5: Landing Page Matte Redesign, Live Flows & Production Copy + Auth Pages

**Files:**
- Modify: `client/src/pages/LandingPage.tsx`
- Modify: `client/src/components/landing/NavBar.tsx`
- Modify: `client/src/components/landing/HeroSection.tsx`
- Modify: `client/src/components/landing/FeatureGrid.tsx`
- Modify: `client/src/components/landing/ArchitectureSpotlight.tsx`
- Modify: `client/src/components/landing/HowItWorksSection.tsx`
- Modify: `client/src/components/landing/SecurityTrustSection.tsx`
- Modify: `client/src/components/landing/ConversionBanner.tsx`
- Modify: `client/src/components/landing/Footer.tsx`
- Modify: `client/src/components/landing/PhaseNoticeModal.tsx`
- Modify: `client/src/pages/LoginPage.tsx`
- Modify: `client/src/pages/RegisterPage.tsx`
- Modify: `client/src/pages/NotFoundPage.tsx`
- Modify: `client/src/pages/RootScaffoldPage.tsx`
- Modify: `client/src/components/auth/ProtectedRoute.tsx`
- Modify: `client/src/components/auth/PublicOnlyRoute.tsx`

- [ ] **Step 1: Add `ThemeToggle` to `NavBar`, `LoginPage`, and `RegisterPage` and convert all Landing + Auth + Route files to Stone & Carbon Matte Light/Dark**

Also update:
- `LandingPage.tsx`: `onStartInstantMeeting` navigates to `/dashboard` (when authenticated) or `/login?redirect=/dashboard` (when logged out); `onJoinCode` validates & normalizes via `validateMeetingCode` and navigates directly to `/join/${code}`.
- Scrub `"Planned for Phase XX"` / `"Phase 04"` / `"Roadmap"` text in `NavBar`, `HeroSection`, `FeatureGrid`, `ArchitectureSpotlight`, `HowItWorksSection`, `SecurityTrustSection`, `Footer`, and `PhaseNoticeModal` (retaining `PhaseNoticeModal` component export & ARIA dialog semantics for Footer info links).
- Ensure zero shiny gradients (`blur-3xl` glow, `#2EC4B6`, `#7CE5DB`, `#168B83`).

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run typecheck --workspace=client && npm run lint --workspace=client`
Expected: PASS

---

### Task 6: Dashboard, Navigation, Secondary Pages & Modals Matte Dual-Theme Migration

**Files:**
- Modify: `client/src/components/dashboard/DashboardLayout.tsx`
- Modify: `client/src/components/dashboard/DashboardHeader.tsx`
- Modify: `client/src/components/dashboard/AppSidebar.tsx`
- Modify: `client/src/components/dashboard/MobileNavigationDrawer.tsx`
- Modify: `client/src/components/dashboard/WelcomeHeader.tsx`
- Modify: `client/src/components/dashboard/QuickActionBar.tsx`
- Modify: `client/src/components/dashboard/UpcomingMeetingsSection.tsx`
- Modify: `client/src/components/dashboard/QuickCodeWidget.tsx`
- Modify: `client/src/components/dashboard/RecentActivityWidget.tsx`
- Modify: `client/src/components/dashboard/RecentDownloadsWidget.tsx`
- Modify: `client/src/components/dashboard/AccountMenu.tsx`
- Modify: `client/src/components/dashboard/NotificationsPopover.tsx`
- Modify: `client/src/components/dashboard/HelpModal.tsx`
- Modify: `client/src/components/dashboard/InstantMeetingModal.tsx`
- Modify: `client/src/components/dashboard/JoinMeetingModal.tsx`
- Modify: `client/src/components/dashboard/ScheduleMeetingModal.tsx`
- Modify: `client/src/components/dashboard/MeetingInvitationModal.tsx`
- Modify: `client/src/components/dashboard/RescheduleModal.tsx`
- Modify: `client/src/components/dashboard/CancelMeetingModal.tsx`
- Modify: `client/src/pages/DashboardPlaceholderPage.tsx`
- Modify: `client/src/pages/MeetingsPage.tsx`
- Modify: `client/src/pages/DownloadsPage.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add `ThemeToggle` compact control to `DashboardHeader` & 3-option segmented matte appearance selector to `SettingsPage`**
- [ ] **Step 2: Convert all Dashboard shell, cards, widgets, modals (`QuickActionBar` flat matte instant card without shiny gradient), `MeetingsPage`, `DownloadsPage`, and `SettingsPage` to matte light/dark classes**
- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck --workspace=client && npm run lint --workspace=client`
Expected: PASS

---

### Task 7: Pre-Join Lobby & Matte Charcoal Meeting Room Studio Migration

**Files:**
- Modify: `client/src/pages/PreJoinLobbyPage.tsx`
- Modify: `client/src/pages/MeetingRoomPage.tsx`
- Modify: `client/src/components/meeting/MeetingHeader.tsx`
- Modify: `client/src/components/meeting/MeetingToolbar.tsx`
- Modify: `client/src/components/meeting/VideoConferenceGrid.tsx`
- Modify: `client/src/components/meeting/ParticipantVideoTile.tsx`
- Modify: `client/src/components/meeting/ScreenShareView.tsx`
- Modify: `client/src/components/meeting/ParticipantsPanel.tsx`
- Modify: `client/src/components/meeting/WaitingRoomPanel.tsx`
- Modify: `client/src/components/meeting/ChatPanel.tsx`
- Modify: `client/src/components/meeting/FilesPanel.tsx`
- Modify: `client/src/components/meeting/WhiteboardStage.tsx`
- Modify: `client/src/components/meeting/WhiteboardToolbar.tsx`
- Modify: `client/src/components/meeting/WhiteboardCanvas.tsx`
- Modify: `client/src/components/meeting/DeviceSettingsModal.tsx`
- Modify: `client/src/components/meeting/RoomSettingsModal.tsx`
- Modify: `client/src/components/meeting/ConfirmActionDialog.tsx`
- Modify: `client/src/components/meeting/LiveKitStatusCard.tsx`
- Modify: `client/src/components/meeting/ReactionPicker.tsx`
- Modify: `client/src/components/meeting/FloatingReactions.tsx`
- Modify: `client/src/hooks/useWhiteboard.ts`
- Modify: `client/src/app/router/AppRouter.tsx`

- [ ] **Step 1: Convert `PreJoinLobbyPage` (dual Light/Dark matte with `ThemeToggle` in header) and all `meeting/` components to cohesive Matte Charcoal Studio + Muted Sage (`#5FA399`) / Terracotta (`#C24D4D`/`#D46A6A`) with zero shiny `#7CE5DB` / `#2EC4B6` / `#168B83` / `#172B3A` leaks**
- [ ] **Step 2: Run full client hex/token audit + typecheck + lint + build + full test suites**

Run:
1. Hex leak check across `client/src/` (asserting 0 occurrences of `#168B83`, `#2EC4B6`, `#7CE5DB`, `#DCEDE8`, `#172B3A`, `#F7F6F2`, `#101820`, `#253746` outside test fixtures/whiteboard stroke palette).
2. `npm run typecheck && npm run lint && npm run build && npm test --workspace=client && npm run test:proxy && node --import tsx --test server/src/tests/supabaseArchitecture.test.ts`

Expected: All pass with 0 errors and 0 skipped assertions.

---

### Task 8: Commit, Push to GitHub `main`, and Live Vercel Verification

- [ ] **Step 1: Commit only the intended modified/created files and push cleanly to `origin main`**
- [ ] **Step 2: Wait for Vercel production deployment (`https://connectly-ashy.vercel.app`) to complete (`Ready`), optionally set `VITE_APP_URL=https://connectly-ashy.vercel.app` in Vercel project settings, and visually test Light Matte, Dark Matte, Landing routes, and live meeting invite URL in Chrome.**
