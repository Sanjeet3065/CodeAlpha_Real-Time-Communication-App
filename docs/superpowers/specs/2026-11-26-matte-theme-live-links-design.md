# CONNECTLY Matte Dual-Theme Redesign & Live Meeting Links Design

**Date:** 2026-11-26  
**Scope:** Frontend UI visual architecture (`client/`), Light/Dark matte theme system, Landing CTA routing polish, and live deployment meeting link generation.  
**Non-Goals:** Breaking backend strict preferences validation (`server/src/schemas/user.schema.ts`), modifying existing WebRTC/LiveKit admission security logic, or altering backend API paths.

---

## 1. Intent & Aesthetic Goals

1. **Matte Finish Design System (Zero Gloss / Zero Neon):** Replace all glossy teal/turquoise highlights (`#168B83`, `#2EC4B6`, `#7CE5DB`, `#DCEDE8`), heavy blue-black surfaces (`#172B3A`), and bright gradient cards with a refined **Stone & Carbon Matte** palette using calm mineral tones, crisp 1px hairline borders, and diffused low-glare elevation.
2. **True Light & Dark Modes (`light` / `dark` / `system`):** Support effortless switching between Light Matte and Dark Matte across Landing, Auth, Dashboard, Meetings, Downloads, Settings, and Pre-Join Lobby, plus a cohesive Matte Charcoal studio palette in the live Meeting Room so video tiles remain distraction-free in both themes.
3. **Live Meeting Link Integrity:** Guarantee every meeting link created, scheduled, displayed, copied, or embedded in calendar/invitation text resolves to the active live origin (e.g., `https://connectly-ashy.vercel.app/join/cly-xxx-xxx`), never a stale preview/localhost domain or raw backend host mismatch.
4. **Live Landing Polish:** Replace legacy "Planned for Phase XX" placeholder modals/badges on the public Landing Page with real live navigation (`/join/:code`, `/dashboard`, `/register`) reflecting the deployed production app.

---

## 2. Matte Color & Surface Palette ("Stone & Carbon Matte")

Defined as semantic CSS custom properties in `client/src/styles/tokens.css` under `:root` (Light Matte) and `html.dark` (Dark Matte), mapped cleanly in `client/tailwind.config.js` (`darkMode: 'class'`).

### Light Matte (`:root`)
- `--cly-surface-canvas`: `#F3F2EE` (Warm Alabaster matte base)
- `--cly-surface-card`: `#FAF9F6` (Soft Matte Chalk card/modal)
- `--cly-surface-elevated`: `#FFFFFF` (Raised clean matte input/popover surface)
- `--cly-surface-muted`: `#EAE8E1` (Warm Clay hover/badge/well surface)
- `--cly-text-primary`: `#1F2428` (Matte Charcoal Ink)
- `--cly-text-secondary`: `#555D66` (Muted Slate Text)
- `--cly-text-muted`: `#7C848D` (Soft Graphite Subtext)
- `--cly-border-subtle`: `#DDDAD0` (Hairline Matte Stone)
- `--cly-border-strong`: `#C9C5B8`
- `--cly-accent`: `#2F6F68` (Matte Mineral Pine-Slate)
- `--cly-accent-hover`: `#255A54`
- `--cly-accent-active`: `#1E4944`
- `--cly-accent-soft`: `#E2ECE9`
- `--cly-accent-soft-hover`: `#D2E1DC`
- `--cly-danger`: `#C24D4D` (Matte Brick Terracotta)
- `--cly-danger-hover`: `#A63D3D`
- `--cly-danger-soft`: `#F6E6E6`
- `--cly-warning`: `#B87323` / soft `#F6EDE0`
- `--cly-info`: `#3E6899` / soft `#E6EDF5`
- Shadows: diffused matte (`0 1px 2px rgba(31, 36, 40, 0.04)`, `0 4px 12px rgba(31, 36, 40, 0.06)`).

### Dark Matte (`html.dark`)
- `--cly-surface-canvas`: `#141619` (Deep Matte Carbon)
- `--cly-surface-card`: `#1C1F24` (Graphite Matte Card)
- `--cly-surface-elevated`: `#24282E` (Elevated Slate Panel)
- `--cly-surface-muted`: `#2B3038` (Hover / Input / Chip Fill)
- `--cly-text-primary`: `#EAECEE` (Soft Chalk White — zero pure `#FFFFFF` glare)
- `--cly-text-secondary`: `#A3AAB2`
- `--cly-text-muted`: `#747C86`
- `--cly-border-subtle`: `#2B3038`
- `--cly-border-strong`: `#3A404A`
- `--cly-accent`: `#5FA399` (Desaturated Matte Lichen Sage — zero neon glow)
- `--cly-accent-hover`: `#6EB2A8`
- `--cly-accent-active`: `#4E8F85`
- `--cly-accent-soft`: `#1F302E`
- `--cly-accent-soft-hover`: `#273C39`
- `--cly-danger`: `#D46A6A` (Soft Rose Clay)
- `--cly-danger-hover`: `#C15858`
- `--cly-danger-soft`: `#342023`
- `--cly-warning`: `#D49A4A` / soft `#302719`
- `--cly-info`: `#6E95C2` / soft `#1E2936`

### Meeting Room Theater Surface (Always Matte Charcoal for Video Fidelity)
- Canvas: `#111316`, Video Tile: `#181B20`, Control Dock/Panels: `#1C1F24` (Light-mode side panels like Chat/Participants inside Meeting Room remain consistent dark-matte `#1C1F24`/`#24282E` or subtle matte contrast without harsh navy `#101820`/`#253746` or bright cyan `#7CE5DB`).
- Active speaker border: `#5FA399` matte sage ring (no bright neon cyan).

---

## 3. Architecture & Approaches

### Selected Approach: Semantic CSS Variables + Tailwind `darkMode: 'class'` + Full Component Migration
1. **Theme State & No-Flash Initialization (`client/src/context/ThemeContext.tsx`, `client/index.html`):**
   - `ThemeMode = 'light' | 'dark' | 'system'` stored under localStorage key `cly_theme_mode` (default `'system'` or `'light'` when `matchMedia` prefers light; actually `'system'` respects OS preference out-of-the-box and allows explicit `'light'` / `'dark'` override).
   - Synchronous inline `<script>` in `client/index.html` reads `cly_theme_mode` + `prefers-color-scheme: dark` before React mounts, toggling `document.documentElement.classList.toggle('dark', resolved === 'dark')` and setting `document.documentElement.style.colorScheme = resolved` to eliminate flash-of-wrong-theme (FOWT).
   - Backend `updatePreferencesSchema` strictly rejects unknown keys (`theme` cannot be sent to `PUT /users/me/preferences`), so `ThemeContext` manages theme cleanly client-side without touching backend schemas.
2. **Theme Controls (`client/src/components/ui/ThemeToggle.tsx`):**
   - Reusable accessible toggle component:
     - Compact icon/pill cycle or segmented control for `NavBar` (Landing), `DashboardHeader`, `LoginPage`/`RegisterPage` top bar, and `PreJoinLobbyPage`.
     - Explicit 3-option segmented matte selector (`Light Matte`, `Dark Matte`, `System`) inside `SettingsPage` ("Interface Appearance").
3. **Centralized UI Primitives & Visual Refinement:**
   - Update `client/tailwind.config.js` (`cly` tokens mapped cleanly to `rgb(...)` or `var(--cly-*)` / exact matte tokens) and `tokens.css` / `globals.css`.
   - Update shared UI primitives (`Button`, `Card`, `Input`, `Label`, `Badge`, `Spinner`, `LoadingFallback`, `ErrorFallback`) first so all downstream views inherit matte surfaces, crisp borders, and WCAG AA dark/light contrast automatically.
   - Refactor all remaining components across Landing (`NavBar`, `HeroSection`, `FeatureGrid`, `ArchitectureSpotlight`, `HowItWorksSection`, `SecurityTrustSection`, `ConversionBanner`, `Footer`), Auth (`LoginPage`, `RegisterPage`), Dashboard (`AppSidebar`, `DashboardHeader`, `DashboardLayout`, `MobileNavigationDrawer`, `WelcomeHeader`, `QuickActionBar`, `UpcomingMeetingsSection`, `QuickCodeWidget`, `RecentActivityWidget`, `RecentDownloadsWidget`, `NotificationsPopover`, `AccountMenu`, `HelpModal`, all meeting modals), Secondary Pages (`MeetingsPage`, `DownloadsPage`, `SettingsPage`, `NotFoundPage`, `RootScaffoldPage`), and Realtime Meeting views (`PreJoinLobbyPage`, `MeetingRoomPage`, `MeetingHeader`, `MeetingToolbar`, `VideoConferenceGrid`, `ParticipantVideoTile`, `ScreenShareView`, `ParticipantsPanel`, `WaitingRoomPanel`, `ChatPanel`, `FilesPanel`, `WhiteboardStage`, `WhiteboardToolbar`, `DeviceSettingsModal`, `RoomSettingsModal`, `ConfirmActionDialog`, `LiveKitStatusCard`, `ReactionPicker`, `FloatingReactions`) to eliminate glossy/neon `#168B83`/`#2EC4B6`/`#7CE5DB`/`#172B3A`/`#F7F6F2` hexes cleanly.
   - Remove `bg-gradient-to-br` shiny card gradients in `QuickActionBar` / cards in favor of rich flat matte surface + tactile 1px border + accent icon container.
4. **Live Meeting Link Unification (`client/src/lib/meetingLink.ts`):**
   - Export pure, well-tested helpers:
     - `resolveAppOrigin(windowOrigin?: string, configuredAppUrl?: string): string` — resolves active origin (`window.location.origin` in browser when HTTP/HTTPS, falling back to `VITE_APP_URL` env or empty string, stripped of trailing slashes).
     - `buildMeetingJoinUrl(meetingCode: string, fallbackJoinUrl?: string, windowOrigin?: string, configuredAppUrl?: string): string` — returns `${origin}/join/${meetingCode}` when origin is resolvable, else falls back cleanly to `fallbackJoinUrl` or `/join/${meetingCode}`.
     - `normalizeInvitationUrls(invitationText: string, joinUrl: string, meetingCode: string, windowOrigin?: string, configuredAppUrl?: string): { joinUrl: string; invitationText: string }` — rewrites any `/join/<code>` or `/lobby/<code>` URL inside backend `invitationText` and `joinUrl` to use the canonical live URL (`${liveOrigin}/join/${meetingCode}`).
   - Wire into: `InstantMeetingModal`, `ScheduleMeetingModal`, `MeetingInvitationModal` (also show a clear copyable URL pill!), `UpcomingMeetingsSection` / `MeetingsPage` (if link copied/shown), `PreJoinLobbyPage`, `MeetingHeader`.
   - Update `client/.env.production.example` and Vercel env (`VITE_APP_URL=https://connectly-ashy.vercel.app`) as backup.
5. **Landing Page Live Flow & Production Copy Cleanup (`client/src/pages/LandingPage.tsx`, `HeroSection.tsx`, `FeatureGrid.tsx`, `ArchitectureSpotlight.tsx`, `HowItWorksSection.tsx`, `SecurityTrustSection.tsx`, `ConversionBanner.tsx`, `NavBar.tsx`, `Footer.tsx`, `PhaseNoticeModal.tsx`):**
   - Scrub legacy `"Planned for Phase XX"` / `"Phase 04"` / `"Roadmap"` placeholder strings across all Landing components and replace with live production copy describing operational Connectly features (LiveKit SFU, Collaborative Vector Whiteboard, Real-Time Chat, Supabase Encrypted File Vault, Waiting Room & Scheduling).
   - Keep `PhaseNoticeModal.tsx` exported with its existing component name/ARIA dialog semantics (`role="dialog"`, `aria-modal="true"`) so modal accessibility contracts stay intact, while updating its internal UI badge/copy from `"Active: Phase 04 — Landing Page"` / `"Next In Sequence"` to a clean `"Connectly Platform"` / `"Architecture & Trust"` info modal used by Footer informational links (`handlePolicyNotice`).
   - In `LandingPage.tsx`: `onStartInstantMeeting` routes directly to `/dashboard` when authenticated or `/login?redirect=/dashboard` when signed out; `onJoinCode(code)` normalizes the code and routes to `/join/${normalizedCode}` (removing placeholder modals for primary meeting actions).

6. **Deployment & Verification Boundaries:**
   - Core implementation plan covers all code, unit tests, lint, typecheck, production Vite build, and hex/token audit.
   - Rollout (`git push` to `main`, setting optional `VITE_APP_URL=https://connectly-ashy.vercel.app` on Vercel, and verifying the live site in Chrome) executes as final verification after local checks pass with zero failures.

---

## 4. Verification Strategy

1. **Automated Unit Tests (`node --experimental-strip-types --test`):**
   - Add `client/src/lib/meetingLink.test.ts` testing origin priority (`windowOrigin` > `VITE_APP_URL` > fallback), trailing-slash stripping, `joinUrl` rewriting inside `invitationText` (`ScheduleMeetingModal` & `MeetingInvitationModal` cases), and invalid/relative fallbacks.
   - Add `client/src/context/themeUtils.test.ts` (pure logic extracted cleanly so Node test runner tests it without DOM dependencies) testing theme resolution (`'light'`, `'dark'`, `'system'` with `prefersDark: true/false`), invalid storage fallback, and storage persistence behavior.
   - Re-run all `client` tests (`npm test --workspace=client`), `npm run typecheck`, `npm run lint`, and `npm run build`.
2. **Automated Hex/Token Audit:** Assert zero leftover legacy neon/bright-teal hexes (`#2EC4B6`, `#7CE5DB`, `#DCEDE8`, `#168B83` except explicit whiteboard test/ink swatch if intentional, etc.) outside `tokens.css` legacy compatibility comments or whiteboard ink presets.
3. **Git Push + Live Vercel Redeploy & Chrome Visual Verification:**
   - Push to `main`, verify Vercel auto-deploys cleanly (`Ready`), open live `https://connectly-ashy.vercel.app` in Chrome, test Light Matte & Dark Matte toggles across Landing, Login, and create/inspect live meeting link!
