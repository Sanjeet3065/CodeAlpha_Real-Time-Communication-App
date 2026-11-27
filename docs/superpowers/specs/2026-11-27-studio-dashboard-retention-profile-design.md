# CONNECTLY Video Studio Dashboard, 2-Day History Retention & Profile Management Design

**Date:** 2026-11-27  
**Routes & Services:** `/dashboard`, `AccountMenu`, `/settings`, `scheduling` worker & queries, `/api/v1/users/me*`  
**Status:** Approved (`proceed`)

---

## 1. Intent & Why

Turn `/dashboard` into a focused, high-craft **Video Meeting Studio** containing only essential video-collaboration workflows in a clear visual priority order, backed by:
1. **Strict 2-day (48-hour) database auto-retention** for ended/cancelled/expired meeting history so old records purge automatically on Day 3 without accumulating dead history.
2. **Complete Profile & Credential Management** directly accessible from the top-right `AccountMenu` dropdown (next to `Account Settings`) and `/settings`, persisting personal user fields (`firstName`, `lastName`, `jobTitle`, `timeZone`, `bio`, `avatarColor`) as well as verified `email` and `password` updates in the database.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Remove non-video clutter (`Downloads & Files` card) from the `/dashboard` Overview while keeping `/downloads` in the sidebar intact.
- Prioritize dashboard widgets by user urgency: **Welcome + Up Next Live Countdown** → **3 Primary Meeting Actions (`Instant`, `Join with Code`, `Schedule`)** → **Upcoming Meetings (Left 7 cols)** paired with **Pre-Call Studio Check + Recent Calls (Right 5 cols)**.
- Add high-delight, zero-spam interactive video features grounded in real backend APIs and browser WebRTC/Audio APIs (`Up Next` countdown strip with 1-click Join/Copy Invite, `Pre-Call Studio Check` with cloud-synced mic/cam defaults + on-demand local camera mirror & voice level meter, and `Meet Again` on Recent Calls).
- Automatically delete completed/cancelled/expired meetings (`ENDED`, `CANCELLED`, `EXPIRED`) older than `48 hours` from both MongoDB and Supabase PostgreSQL (`meetings` + cascading child rows + associated `SharedFile` storage objects) on Day 3 arrival, while shielding `listMeetingHistory` / `getMeetingHistoryDetails` against stale reads between sweeps.
- Provide an `Edit Profile` trigger inside the top-right `AccountMenu` popover (and on `/settings`) opening an accessible modal where users can update their Name, Job Title, Timezone, Bio, Avatar accent, Email, and Password — persisted directly to the database and reflected immediately in `AuthContext` & UI.

### Non-Goals
- Do not change public landing (`/`), meeting theater (`/room/:code`), or `/downloads` dedicated page routes.
- Do not add fabricated analytics counters, fake participant telemetry, or mock activity rows.
- Do not auto-request camera/microphone browser permissions on `/dashboard` page load (permissions are requested strictly on explicit click of `Test Cam & Mic`).
- Do not alter future `SCHEDULED` or live `ACTIVE`/`CREATED` meetings during the 48-hour history cleanup sweep.

### Anti-Goals
- **Never weaken mass-assignment security:** `PATCH /api/v1/users/me` MUST continue rejecting `email`, `role`, `isAdmin`, `isEmailVerified`, and `passwordHash` with HTTP `400 VALIDATION_ERROR` (preserving `server/src/tests/user.test.ts` #7). Sensitive credential mutations (`email`, `password`) live strictly on dedicated password-verified routes (`/api/v1/users/me/email` and `/api/v1/users/me/password`).
- **Never leak camera/mic streams:** Hardware tracks started in `PreCallStudioWidget` must stop immediately on toggle off, route navigation, unmount, or `beforeunload`.
- **Never apply Supabase DDL migrations that break existing deployments:** Persist new personal profile fields (`jobTitle`, `bio`, `timeZone`, `avatarColor`, `hasLocalPassword`) through existing `User` schema + `supabaseMappers.ts` metadata (`user_preferences.video_input_device` JSON + `users` columns) so zero manual production DB migration is required.

---

## 3. Approaches Considered

### Dashboard Architecture
1. **Approach 1 (Selected): Video Studio Workspace (2-Row, Balanced 12-Col Grid)**
   - Keeps `/dashboard` focused exclusively on meetings (`Up Next` countdown + 3 primary actions on top; `Upcoming Meetings` on left 7 cols; `Pre-Call Studio Check` + `Recent Calls` on right 5 cols).
   - *Trade-off:* Slightly richer right-column UI than bare schedule-only lists, but solves pre-call hardware anxiety and gives real "studio" utility without clutter.
2. **Approach 2 (Rejected): Ultra-Minimal Schedule + Recent List Only**
   - Drops Pre-Call Studio Check and Up Next spotlight.
   - *Trade-off:* Leaves `/dashboard` too thin after removing `Downloads & Files` and lacks a signature video-app workflow.

### 2-Day History Retention
1. **Approach 1 (Selected): Backend Retention Worker (`MeetingHistoryRetentionWorker`) + Query Cutoff**
   - Periodic background worker (`server.ts` lifecycle, matching `fileCleanupWorker` / `reminderWorker`) sweeps on startup and every 15 minutes (`HISTORY_RETENTION_SWEEP_INTERVAL_MS`), deleting historical meetings (`ENDED | CANCELLED | EXPIRED`) whose completion timestamp is `<= now - 48h`, after cleaning up any `SharedFile` storage objects and dependent child documents (`MeetingParticipant`, `ChatMessage`, `SharedFile`, `WhiteboardOperation`, `Whiteboard`, `ScheduledReminder`, `MeetingRealtimeEvent`, `Notification`). `listMeetingHistory` & `getMeetingHistoryDetails` also enforce the `48h` cutoff immediately.
   - *Trade-off:* Small periodic DB sweep vs zero maintenance; works identically across Supabase PostgreSQL, MongoDB, storage buckets, and offline test suites.
2. **Approach 2 (Rejected): Database-Only `pg_cron` / TTL Index**
   - *Trade-off:* Cannot remove storage blobs in S3/Supabase Storage, requires elevated DB extension privileges, and does not work consistently across Mongoose + Supabase bridge + tests.

### Profile, Email & Password Editing
1. **Approach 1 (Selected): Modal Triggered from `AccountMenu` + `/settings` with Separated Profile vs Verified Credential Endpoints**
   - `AccountMenu` dropdown gains `Edit Profile` right above `Account Settings`, opening `EditProfileModal` (two clean tabs: `Profile Details` and `Email & Password`). `/settings` `Account Identity` card also renders saved fields + an `Edit Profile` trigger button.
   - `PATCH /api/v1/users/me` handles user profile details (`firstName`, `lastName`, `jobTitle`, `bio`, `timeZone`, `avatarColor`). `PATCH /api/v1/users/me/email` and `PATCH /api/v1/users/me/password` handle credentials with `currentPassword` verification (`hasLocalPassword !== false`), session token rotation/invalidation of sibling sessions, and security audit logging.
   - *Trade-off:* Two extra focused API routes instead of one overloaded endpoint, preserving strict mass-assignment boundaries and security audit parity.

---

## 4. Detailed Architecture & Contracts

### 4.1 Frontend Dashboard Layout (`/dashboard`)
- **Top → Bottom Order:**
  1. `WelcomeHeader`: Personalized greeting + timezone-aware formatted date + user's optional `jobTitle` subtitle chip if set.
  2. `UpNextBanner` (new component `client/src/components/dashboard/UpNextBanner.tsx`, optional / hidden when no upcoming meeting exists):
     - Fetches or derives nearest upcoming meeting (`scheduledStartAt` sorted ascending).
     - Shows countdown badge (`Starting now`, `In 12 min`, or `Today at HH:MM`), meeting title, `cly-xxx-xxx` code, `Copy Invite` button (`buildMeetingJoinUrl`), and `Join Now` CTA (`/join/:code`). Also register `/lobby/:meetingCode` alias route in `AppRouter.tsx` pointing to `PreJoinLobbyPage` so existing schedule/notification `/lobby/:code` links work without 404. Updates tick every 30s without network polling.
  3. `QuickActionBar`: Unchanged height-aligned 3-card row (`Instant Meeting`, inline `Join with Code (cly-xxx-xxx)`, `Schedule Meeting`).
  4. **Streamlined Meeting Modals (`InstantMeetingModal`, `ScheduleMeetingModal`, `JoinMeetingModal`):**
     - `InstantMeetingModal`: Concise title (`New Instant Meeting`), clean `Meeting Name (Optional)` field, sleek compact settings panel (aligned pill toggle for `Waiting Room` with 1-line helper `"Approve guests before joining"` + segmented `10` / `25` / `60` capacity selector instead of verbose dropdown), and streamlined `Room Ready` screen (`Room Ready` badge, compact copyable code & link, `Close`, and `Join Lobby ->`) with dark-mode error contrast parity. Accept optional `initialTitle?: string` for `Meet Again`.
     - `ScheduleMeetingModal` & `JoinMeetingModal`: Concise labels, proper dark-mode input backgrounds (`dark:bg-[#141619]`), non-blocking inline `"Copied"` state instead of `window.alert()`, and consistent matte button sizing.
  5. **Balanced 2-Column Studio Grid (`lg:grid-cols-12`, `items-stretch`):**
     - **Left (`lg:col-span-7`):** `UpcomingMeetingsSection` — chronological scheduled meetings with `Join`, `Copy Invite`, `Invite Details`, `Reschedule`, `Cancel` + clean empty state. Shares live `refreshKey` updates when `ScheduleNoticeModal` creates/modifies a meeting or `UpNextBanner` syncs.
     - **Right (`lg:col-span-5`, `flex-col gap-5 sm:gap-6`):**
       - **`PreCallStudioWidget` (`client/src/components/dashboard/PreCallStudioWidget.tsx`):**
         - Top: Compact two-toggle strip for **Start Muted** (`defaultAudioMuted`) and **Camera Off** (`defaultVideoOff`), saving straight to `preferencesApi.savePreferences()` (`authApi` / `AuthContext.updateUserPreferences()`) with non-blocking sync indicator (`Saved`).
         - Bottom: **Hardware Readiness Test** collapsible area (`Test Cam & Mic` toggle). When inactive: compact status strip (`Click to preview camera & mic before joining`). When activated by user click: requests local-only video + audio (`navigator.mediaDevices.getUserMedia`), renders mirrored local `<video>` preview + real-time RMS audio meter bars via `AudioContext`/`AnalyserNode` + device labels + `Stop Test` button. Stops all `MediaStreamTrack`s + closes `AudioContext` immediately on close, route unmount, or `beforeunload`.
       - **`RecentActivityWidget` (`flex-1`):**
         - Fetches `schedulingApi.listMeetingHistory({ page: 1, limit: 4, sort: 'desc' })` (which enforces 48h retention on server).
         - Header shows `Recent Calls` + subtle **`Last 48h`** pill + `History ->` link (`/meetings`).
         - Each call row shows title, host/participant pill, duration, date, quick **Copy Code** icon button, and **`Meet Again`** icon/text trigger (creates/opens `InstantMeetingModal` prefilled with `"Follow-up: <Title>"` or opens `/meetings` details).
- `RecentDownloadsWidget` is removed from `DashboardPage.tsx` (`DownloadsPage.tsx` at `/downloads` and sidebar link remain intact).

### 4.2 Backend 2-Day History Auto-Retention
- **Constant:** `MEETING_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000` (2 days / 48 hours).
- **Retention Target Filter:**
  - Any meeting in `['ENDED', 'CANCELLED', 'EXPIRED']` whose completion reference timestamp (`endedAt ?? cancelledAt ?? scheduledEndAt ?? activatedAt ?? updatedAt ?? createdAt`) is `<= now - MEETING_HISTORY_RETENTION_MS` (expired beyond Day 2 / Day 3 reached).
  - Additionally, any unvisited/abandoned `['SCHEDULED', 'CREATED', 'ACTIVE']` room whose `expiresAt` (`scheduledEndAt + 24h` or `createdAt + 24h`) passed more than `48 hours` ago (`expiresAt <= now - MEETING_HISTORY_RETENTION_MS`), so unattended missed meetings do not persist indefinitely.
  - Upcoming `SCHEDULED` meetings (`expiresAt > now - 48h`) and active/non-expired rooms are never removed.
- **New Service:** `server/src/services/meetingHistoryRetentionWorker.service.ts` (`MeetingHistoryRetentionWorker`, singleton `meetingHistoryRetentionWorker`):
  - `purgeExpiredMeetingHistory(now = new Date()): Promise<HistoryPurgeReport>`:
    1. Queries candidate meetings with `status: { $in: ['ENDED', 'CANCELLED', 'EXPIRED'] }`.
    2. Filters exact `referenceTime <= cutoff` (`now - 48h`) cleanly (handles any legacy meetings lacking `endedAt`).
    3. For matched `meetingIds`:
       - Looks up `SharedFile.find({ meetingId: { $in: expiredIds } })` and best-effort deletes `storageProvider.deleteObject(file.storagePath)` when file sharing/storage provider is active (catching storage failures gracefully with warnings so DB cleanup continues).
       - Deletes child collections explicitly for MongoDB parity (`MeetingParticipant`, `ChatMessage`, `SharedFile`, `WhiteboardOperation` by whiteboardId, `Whiteboard`, `ScheduledReminder`, `MeetingRealtimeEvent`, and `Notification` rows referencing `meetingId`), then executes `Meeting.deleteMany({ _id: { $in: expiredIds } })` (which also triggers `ON DELETE CASCADE` on Supabase PostgreSQL).
  - Lifecycle: Starts in `server/src/server.ts` (`bootstrap()`) with startup sweep + 15-minute `setInterval(...).unref()`, and stops cleanly in `stopSubsystems`.
- **Query Enforcement (`scheduling.service.ts`):**
  - `listMeetingHistory()` enforces occurrence timestamp `> new Date(now - 48h)` (clamping `query.from` upward if older than 48h, or filtering expired historical occurrences) so even before the next 15-min background sweep finishes, 3rd-day records never appear in API responses.
  - `getMeetingHistoryDetails()` verifies completion/reference timestamp is within 48h; if past 48h (and not `ACTIVE`/`SCHEDULED`), throws `NotFoundError` (`HISTORY_EXPIRED`).

### 4.3 Profile & Credential Editing (`AccountMenu` + `/settings` + `/api/v1/users/me*`)
- **Backend Schemas (`server/src/schemas/user.schema.ts`):**
  - Extend `updateProfileSchema` (`.strictObject`):
    - Keep `firstName`, `lastName`.
    - Add optional `jobTitle` (trimmed string, `max(80)`, nullable/empty string clears it), `bio` (trimmed string, `max(160)`, nullable/empty clears it), `timeZone` (validated via `Intl.DateTimeFormat`, `max(64)`), `avatarColor` (`enum` of safe matte tokens `'sage' | 'slate' | 'amber' | 'rose' | 'indigo'`).
    - Refine: at least one permitted field present. Note: `.strictObject` STILL strictly rejects `email`, `role`, `isAdmin`, `isEmailVerified`, `password`, `passwordHash`, etc.
  - New `updateEmailSchema` (`.strictObject`): `{ email: valid normalized email <=254, currentPassword?: string(min 1, max 128) }`.
  - New `updatePasswordSchema` (`.strictObject`): `{ currentPassword?: string(max 128), newPassword: strong password matching registerSchema (8-128, upper, lower, number, symbol) }`.
- **Backend Endpoints & Service (`server/src/routes/users.routes.ts`, `user.controller.ts`, `user.service.ts`):**
  - `User.model.ts` & `supabaseMappers.ts` (`userAdapter` meta JSON in `user_preferences.video_input_device`): store `jobTitle`, `bio`, `timeZone`, `avatarColor`, `googleSub`, and `hasLocalPassword` (`boolean`, default `true`; `auth.controller.ts` `googleAuth` stores `googleSub` on login/signup, matches by `googleSub` then `email`, and sets `hasLocalPassword: false` ONLY when creating a brand-new Google-only account).
  - `AccessTokenPayload` (`tokens.ts`, `auth.middleware.ts`): embed optional `familyId?: string` on tokens minted by `issueAuthenticatedSession` / `refresh` so credential endpoints identify the caller's session family cleanly across both cookie and Bearer contexts.
  - `UserProfileResponse` & `/auth/login`, `/auth/refresh`, `/auth/google`, `/auth/me`, `/users/me`: expose `{ id, name, firstName, lastName, email, avatarUrl, avatarColor, jobTitle, bio, timeZone, hasLocalPassword, isEmailVerified, preferences, createdAt, updatedAt }` (NEVER `passwordHash` or `googleSub`).
  - Both `PATCH /api/v1/users/me/email` and `PATCH /api/v1/users/me/password` apply `requireAuth` + `validateRequestOrigin`.
  - `PATCH /api/v1/users/me/email`:
    1. Load `User` by `req.user.sub`.
    2. If `user.hasLocalPassword === false`, reject with `403 LOCAL_PASSWORD_REQUIRED` (`"Please set a local password before changing your email so you keep account recovery access."`) — UI displays an inline jump/prompt to the Set Password form right inside `EditProfileModal`. Otherwise verify `currentPassword` against `user.passwordHash` (`401 INVALID_CREDENTIALS` on mismatch/missing).
    3. Reject unchanged email cleanly (`400`) or duplicate email belonging to another user (`409 EMAIL_ALREADY_EXISTS`).
    4. Atomically update `email`, preserve `user.isEmailVerified` (`true` for verified accounts since no email re-verification SMTP flow exists yet), write `securityAudit` (`AUTH_EMAIL_UPDATED`), mint fresh `accessToken` + rotate current `AuthSession` / `connectly_refresh` cookie if a matching session family exists (`req.user.familyId` or `req.cookies?.connectly_refresh`), and return `{ user, accessToken }`.
  - `PATCH /api/v1/users/me/password`:
    1. Load `User` by `req.user.sub`.
    2. If `user.hasLocalPassword !== false`, require and verify `currentPassword` (`401 INVALID_CREDENTIALS`). If `user.hasLocalPassword === false` (Google-only user setting initial local password), allow setting initial password directly without `currentPassword`.
    3. Verify `newPassword` does not equal `currentPassword` (`400 SAME_PASSWORD`).
    4. Hash via `hashPassword(newPassword)`, persist `passwordHash` + `hasLocalPassword: true`, revoke OTHER active `AuthSession`s (`familyId !== currentFamilyId` when `currentFamilyId` is known, keeping caller's active session intact & rotating cookie if present; for Bearer callers with no `familyId` skip global revocation so tests remain deterministic), log `securityAudit` (`AUTH_PASSWORD_CHANGED`), and return `{ user, accessToken }`.
- **Frontend UI (`AccountMenu`, `EditProfileModal.tsx`, `SettingsPage.tsx`, `AuthContext`, `authApi`):**
  - **`AccountMenu.tsx`:** Displays user avatar with `avatarColor` styling, `displayName`, `jobTitle` (if set), `email`, verification badge, and menu items:
    1. **`Edit Profile`** (opens `EditProfileModal` immediately from top-right menu on any dashboard page)
    2. **`Account Settings`** (`/settings`)
    3. **`Sign Out`**
  - **`EditProfileModal.tsx` (`client/src/components/dashboard/EditProfileModal.tsx`):**
    - Accessible modal (`role="dialog"`, `Escape`/Tab focus trap, Matte Stone & Carbon parity in light & dark modes).
    - **Tab 1 — Personal Profile:** First Name, Last Name, Role / Job Title (`jobTitle`), Preferred Timezone selector (`timeZone` with detected browser timezone option), Short Bio (`bio`), Avatar Accent swatch (`avatarColor`). Submits to `authApi.updateProfile(...)` -> updates `AuthContext` (`setUserData` / `refreshUser`).
    - **Tab 2 — Email & Password:**
      - *Update Email* form: New Email + Current Password (if `hasLocalPassword !== false`) + inline conflict/error feedback.
      - *Change Password* form (or *Set Local Password* if `hasLocalPassword === false` Google account): Current Password (when needed) + New Password (with interactive 5-criterion strength checklist matching auth gateway) + eye visibility toggle + database persistence feedback.
  - **`SettingsPage.tsx`:** `Account Identity` card shows `Job Title`, `Timezone`, `Bio` when present plus an `Edit Profile` button opening `EditProfileModal`.

---

## 5. Verification Plan

- **Server Tests (`npm test --workspace=server`):**
  - Preserve all existing tests (`user.test.ts` mass assignment rejection of `email`/`role`/`passwordHash` on `PATCH /api/v1/users/me`, `zodSecurity.test.ts`, `phase16Scheduling.test.ts`).
  - Add new automated tests:
    - **History Retention Suite:** Tests that `ENDED`, `CANCELLED`, and `EXPIRED` meetings older than 48h are deleted from DB alongside child `MeetingParticipant` / `ChatMessage` / `SharedFile` records (plus storage cleanup callback), while < 48h history, `SCHEDULED`, and `ACTIVE` meetings remain untouched, and `listMeetingHistory`/`getMeetingHistoryDetails` hide 3rd-day items.
    - **Profile & Credential Mutation Suite:** Tests updating `jobTitle`, `bio`, `timeZone`, `avatarColor` via `PATCH /api/v1/users/me` + mass-assignment guard intact; tests `PATCH /api/v1/users/me/email` (401 bad password, 409 duplicate email, 200 persisted change); tests `PATCH /api/v1/users/me/password` (401 bad current password, 400 weak password, 200 Argon2id rehash + login works with new password, Google `hasLocalPassword: false` initial password setup).
- **Client Tests & Build:**
  - `npm run lint --workspace=client`, `npm run typecheck --workspace=client`, `npm test --workspace=client`, `npm run build --workspace=client` (including `dashboard.test.ts` verifying Studio Workspace structure, absence of `RecentDownloadsWidget` on `DashboardPage`, presence of `PreCallStudioWidget` & `EditProfileModal` in `AccountMenu`).
- **Live Verification:** Deploy pushed commit to Vercel + Render, verify CI green, reload live `https://connectly-meet.vercel.app/dashboard` in Chrome, test `AccountMenu` → `Edit Profile` modal, test `PreCallStudioWidget` layout/controls in Dark & Light modes, verify DB updates persist across reload, and check 0 console errors.

---

## 6. Left to the Builder

- Exact Tailwind utility tokens matching existing matte palette (`#FAF9F6` / `#F3F2EE` / `#2F6F68` light; `#1C1F24` / `#141619` / `#5FA399` dark).
- Choosing concrete `InstantMeetingModal` prefill prop (`initialTitle?: string`) to support `Meet Again` one-click follow-up launch cleanly.
- Handling graceful fallback in `PreCallStudioWidget` when running in headless or device-less browsers.
