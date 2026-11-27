# CONNECTLY Video Studio Dashboard, 2-Day Retention & Profile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a streamlined video-first `/dashboard` (`UpNextBanner`, `PreCallStudioWidget`, `RecentActivityWidget` with `Meet Again`), automatic 48-hour database cleanup of ended/cancelled/expired meetings, and full database-backed user profile/email/password editing from the top-right `AccountMenu` and `/settings`.

**Architecture:** Server adds a periodic `MeetingHistoryRetentionWorker` + 48h query cutoff in `scheduling.service.ts` (handling cascading DB rows and file storage blobs across MongoDB and Supabase), plus separated mass-assignment-safe `/api/v1/users/me` (user details) and `/me/email` + `/me/password` (credential mutations with `googleSub` linkage and `familyId`-aware session rotation). Frontend updates `AccountMenu` + `EditProfileModal` + `SettingsPage`, removes `RecentDownloadsWidget` from `DashboardPage` (preserving `/downloads`), and builds `UpNextBanner` and on-demand local-preview `PreCallStudioWidget`.

**Tech Stack:** Node.js 22 (`node --test`), Express, TypeScript, Mongoose + Supabase PG bridge (`supabaseMappers.ts`), Zod, Argon2 (`hashPassword`/`verifyPassword`), React 19, React Router, Tailwind CSS, `livekit-client`, Web Audio API (`AudioContext`).

**Spec:** [2026-11-27-studio-dashboard-retention-profile-design.md](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/superpowers/specs/2026-11-27-studio-dashboard-retention-profile-design.md)

## Global Constraints

- `MEETING_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000` (2 days / 48 hours): historical or dead meetings past 48h purge on Day 3; upcoming `SCHEDULED` (`expiresAt > now - 48h`) and active/recent rooms stay untouched.
- `PATCH /api/v1/users/me` strictly preserves Zod `.strictObject` mass-assignment rejection of `email`, `role`, `isAdmin`, `isEmailVerified`, `password`, and `passwordHash` (`user.test.ts` #7).
- `PreCallStudioWidget` NEVER calls `navigator.mediaDevices.getUserMedia` on mount/load — hardware preview starts strictly on explicit button click and stops all tracks + closes `AudioContext` on toggle off, unmount, or `beforeunload`.
- Zero manual Supabase SQL DDL breaking changes: persist user metadata (`jobTitle`, `bio`, `timeZone`, `avatarColor`, `googleSub`, `hasLocalPassword`) via `User.model.ts` and `supabaseMappers.ts` `userAdapter` JSON metadata in `user_preferences.video_input_device`.
- Light (`#F3F2EE` / `#FAF9F6` / `#2F6F68` / `#DDDAD0`) and dark (`#141619` / `#1C1F24` / `#5FA399` / `#2B3038`) matte palettes matched throughout; keep `Session Active` and `Join Room` text selectors intact.

## Review Focus

- **Legacy `ENDED` meetings lacking `endedAt` vs meetings created >2d ago (`phase16Scheduling.test.ts` 10.7):** Retention cutoff must resolve `endedAt ?? cancelledAt ?? scheduledEndAt ?? activatedAt ?? updatedAt ?? createdAt` so a meeting created 10 days ago that ended today stays visible for 48 hours.
- **Unattended `SCHEDULED` / abandoned `CREATED`/`ACTIVE` rooms past `expiresAt`:** Retention worker purges those only when `expiresAt <= now - 48h`, preventing missed past rooms from staying forever while preserving current/upcoming rooms.
- **Google-only user changing email/password (`hasLocalPassword === false`):** `PATCH /api/v1/users/me/email` rejects with `403 LOCAL_PASSWORD_REQUIRED` until a local password is set via `/me/password`, and `googleAuth()` stores + matches `googleSub` first so email changes never orphan Google logins.
- **Bearer-only callers without cookies (`user.test.ts`, API clients):** Adding optional `familyId` to `AccessTokenPayload` allows sibling session revocation when present while skipping cookie clearing/global wipe when no session family exists.
- **Orphaned hardware camera/mic LED or missing device on `/dashboard`:** `PreCallStudioWidget` renders graceful inline feedback when permissions are denied or no media hardware exists (`test` browsers) and tracks active stream/AudioContext refs cleanly for guaranteed unmount cleanup.
- **Direct `/lobby/:meetingCode` links from existing schedule cards vs `/join/:meetingCode`:** Both routes render `PreJoinLobbyPage` in `AppRouter.tsx` so neither `UpNextBanner` nor `UpcomingMeetingsSection` hits 404.

---

### Task 1: Backend 2-Day Meeting History Auto-Retention Worker & Query Guard

**Files:**
- Create: `server/src/services/meetingHistoryRetentionWorker.service.ts`
- Modify: `server/src/services/scheduling.service.ts:855-1105`
- Modify: `server/src/server.ts:15-116`
- Test: `server/src/tests/historyRetention.test.ts`

**Interfaces:**
- Produces:
  - `MEETING_HISTORY_RETENTION_MS` (`48 * 60 * 60 * 1000`)
  - `resolveMeetingRetentionTimestamp(meeting: MeetingRetentionTimestampSource): Date`
  - `MeetingHistoryRetentionWorker` class & `meetingHistoryRetentionWorker` singleton (`purgeExpiredMeetingHistory(now?: Date): Promise<HistoryPurgeReport>`, `start(): Promise<void>`, `stop(): Promise<void>`)
- Consumes: `Meeting`, `MeetingParticipant`, `ChatMessage`, `SharedFile`, `Whiteboard`, `WhiteboardOperation`, `ScheduledReminder`, `MeetingRealtimeEvent`, `Notification`, `getStorageProvider()`

- [ ] **Step 1: Write failing tests in `server/src/tests/historyRetention.test.ts`**

Create test suite asserting:
1. `purgeExpiredMeetingHistory()` permanently deletes `ENDED`, `CANCELLED`, and `EXPIRED` meetings older than 48h (using `endedAt`/`cancelledAt`/`expiresAt`), plus abandoned `SCHEDULED`/`CREATED`/`ACTIVE` rooms with `expiresAt <= now - 48h`.
2. Dependent `MeetingParticipant`, `ChatMessage`, `SharedFile`, `Whiteboard`, `WhiteboardOperation`, `ScheduledReminder` rows for purged meetings are deleted and `storageProvider.deleteObject(file.storagePath)` is invoked.
3. Historical meetings < 48h old (`47h` ago), meetings created 10 days ago that `endedAt` 1 hour ago, and future `SCHEDULED` / current `ACTIVE` meetings are NOT deleted.
4. `schedulingService.listMeetingHistory` hides any >48h record immediately (even prior to sweep) and `schedulingService.getMeetingHistoryDetails` rejects >48h records with `404 HISTORY_EXPIRED`.

- [ ] **Step 2: Run test suite to verify it fails**

Run: `node --experimental-strip-types --test server/src/tests/historyRetention.test.ts` (from `server/`)
Expected: FAIL (`Cannot find module '../services/meetingHistoryRetentionWorker.service.js'`)

- [ ] **Step 3: Implement `server/src/services/meetingHistoryRetentionWorker.service.ts`**

Export `MEETING_HISTORY_RETENTION_MS`, `resolveMeetingRetentionTimestamp`, `HistoryPurgeReport`, `MeetingHistoryRetentionWorker`, and `meetingHistoryRetentionWorker`. Query candidate docs (`status: { $in: ['ENDED', 'CANCELLED', 'EXPIRED'] }` plus `status: { $in: ['SCHEDULED', 'CREATED', 'ACTIVE'] }` with `expiresAt <= cutoff`), filter exact expired ids (`resolveMeetingRetentionTimestamp(doc).getTime() <= cutoff.getTime()`), best-effort delete associated `SharedFile` objects from storage when `env.ENABLE_FILE_SHARING && env.STORAGE_PROVIDER !== 'disabled'`, delete child collections + `Notification` docs for `meetingId: { $in: expiredIds }`, and finish with `Meeting.deleteMany({ _id: { $in: expiredIds } })`. Schedule periodic 15-minute `setInterval(...).unref()` in `start()`.

- [ ] **Step 4: Wire retention cutoff in `scheduling.service.ts` and worker lifecycle in `server.ts`**

In `scheduling.service.ts`:
- Enforce `const retentionCutoff = new Date(Date.now() - MEETING_HISTORY_RETENTION_MS)` in `listMeetingHistory()` (both in `from`/`to` range resolution and occurrence post-filter/re-count via occurrence timestamp `endedAt ?? cancelledAt ?? scheduledEndAt ?? activatedAt ?? updatedAt ?? createdAt > retentionCutoff` so expired rows never return or inflate `total`).
- In `getMeetingHistoryDetails()`, check terminal/expired history meetings (`status` in `['ENDED', 'CANCELLED', 'EXPIRED']`) against `retentionCutoff` and throw `NotFoundError('Meeting history has expired after the 2-day retention window.', 'HISTORY_EXPIRED')` if `<= retentionCutoff`.

In `server.ts`:
- Import `meetingHistoryRetentionWorker`, call `await meetingHistoryRetentionWorker.start()` alongside `reminderWorker.start()`, and call `await meetingHistoryRetentionWorker.stop()` in `stopSubsystems`.

- [ ] **Step 5: Run new test + existing scheduling suite**

Run (from `server/`):
`node --experimental-strip-types --test src/tests/historyRetention.test.ts src/tests/phase16Scheduling.test.ts`
Expected: PASS (0 failed)

- [ ] **Step 6: Commit Task 1**

Stage and commit `server/src/services/meetingHistoryRetentionWorker.service.ts`, `server/src/services/scheduling.service.ts`, `server/src/server.ts`, and `server/src/tests/historyRetention.test.ts`.

---

### Task 2: Backend Profile Extension, Verified Email/Password Endpoints & Google Linkage

**Files:**
- Modify: `server/src/models/User.model.ts:12-135`
- Modify: `server/src/repositories/supabaseMappers.ts:163-348`
- Modify: `server/src/schemas/user.schema.ts:1-40`
- Modify: `server/src/utils/tokens.ts:5-12`
- Modify: `server/src/controllers/auth.controller.ts:30-65, 220-320, 460-535, 610-655, 785-805`
- Modify: `server/src/services/user.service.ts:20-185`
- Modify: `server/src/controllers/user.controller.ts:1-45`
- Modify: `server/src/routes/users.routes.ts:1-40`
- Test: `server/src/tests/user.test.ts` (extend with credential/profile cases)

**Interfaces:**
- Produces:
  - `UserProfileResponse`: `{ id, name, firstName, lastName, email, avatarUrl, avatarColor, jobTitle, bio, timeZone, hasLocalPassword, isEmailVerified, preferences, createdAt, updatedAt }`
  - `PATCH /api/v1/users/me` (`firstName`, `lastName`, `jobTitle`, `bio`, `timeZone`, `avatarColor`)
  - `PATCH /api/v1/users/me/email` (`{ email, currentPassword }`) -> `{ user, accessToken }`
  - `PATCH /api/v1/users/me/password` (`{ currentPassword?, newPassword }`) -> `{ user, accessToken }`
  - `AccessTokenPayload` with optional `familyId?: string`

- [ ] **Step 1: Add failing tests in `server/src/tests/user.test.ts` (Tests 9–14)**

Add test cases verifying:
- `9. PATCH /api/v1/users/me` persists `jobTitle`, `bio`, `timeZone`, `avatarColor` while STILL rejecting `email`, `role`, `isAdmin`, `passwordHash` (`400 VALIDATION_ERROR`).
- `10. PATCH /api/v1/users/me/email` rejects wrong `currentPassword` (`401`) and duplicate email (`409 EMAIL_ALREADY_EXISTS`), succeeds with `200`, persists new email in DB, preserves `isEmailVerified`, and returns fresh `accessToken`.
- `11. PATCH /api/v1/users/me/password` rejects weak password (`400`), wrong `currentPassword` (`401`), updates hash with `200`, revokes sibling `AuthSession` family while preserving caller's family, and login succeeds with the new password.
- `12. Google-only user (hasLocalPassword: false)`: `/me/email` rejects with `403 LOCAL_PASSWORD_REQUIRED` before setting local password, `/me/password` sets initial password without `currentPassword` and flips `hasLocalPassword: true`, and subsequent `/me/email` succeeds with the new password.

- [ ] **Step 2: Run `user.test.ts` to verify new assertions fail**

Run (from `server/`): `node --experimental-strip-types --test src/tests/user.test.ts`
Expected: Tests 9–12 FAIL

- [ ] **Step 3: Update `User.model.ts`, `supabaseMappers.ts`, and `tokens.ts`**

- `User.model.ts`: add optional fields `jobTitle`, `bio`, `timeZone`, `avatarColor` (`'sage' | 'slate' | 'amber' | 'rose' | 'indigo'`), `googleSub` (`sparse` unique/index), `hasLocalPassword` (`default: true`).
- `supabaseMappers.ts`: serialize & deserialize `jobTitle`, `bio`, `timeZone`, `avatarColor`, `googleSub`, and `hasLocalPassword` in `profileMeta` (`user_preferences.video_input_device`).
- `tokens.ts`: add optional `familyId?: string` to `AccessTokenPayload`.

- [ ] **Step 4: Update `auth.controller.ts` (`register`, `issueAuthenticatedSession`, `googleAuth`, `refresh`, `getMe`)**

- `register`: pass `hasLocalPassword: true`.
- `issueAuthenticatedSession` & `refresh`: include `familyId` inside `generateAccessToken(...)` and serialize `jobTitle`, `bio`, `timeZone`, `avatarColor`, `hasLocalPassword` in `user` payload (reuse helper `toPublicUserDto(user, preferences)`).
- `googleAuth`: lookup by `{ googleSub: profile.subjectId }` first, falling back to `{ email: profile.email }`; link `googleSub` onto matching existing account if absent; on new account creation set `hasLocalPassword: false` and `googleSub: profile.subjectId`.
- `getMe`: return `userService.getProfile(req.user.sub)`.

- [ ] **Step 5: Update `user.schema.ts`, `user.service.ts`, `user.controller.ts`, and `users.routes.ts`**

- `user.schema.ts`: extend `updateProfileSchema` (`.strictObject` adding `jobTitle`, `bio`, `timeZone` verified by `isValidIanaTimeZone`, `avatarColor`), plus `updateEmailSchema` (`.strictObject`) and `updatePasswordSchema` (`.strictObject` reusing `passwordCriteriaRegex` from `auth.schema.ts`).
- `user.service.ts`: implement `updateProfile()`, `updateEmail()`, `updatePassword()` (with `currentPassword` check, Argon2id `hashPassword`, `securityAudit` logging, `AuthSession` sibling revocation & refresh cookie rotation helper in controller).
- `users.routes.ts`: wire `PATCH /me/email` and `PATCH /me/password` with `requireAuth`, `validateRequestOrigin`, and `validateBody(...)`.

- [ ] **Step 6: Run full affected server tests + typecheck**

Run (from `server/`):
`npm run typecheck && node --experimental-strip-types --test src/tests/user.test.ts src/tests/zodSecurity.test.ts src/tests/googleAuth.test.ts src/tests/preferences.test.ts`
Expected: ALL PASS (0 failed)

- [ ] **Step 7: Commit Task 2**

Stage and commit modified server files.

---

### Task 3: Frontend Auth State, Profile/Credential Client APIs & EditProfileModal

**Files:**
- Modify: `client/src/types/auth.ts:9-48`
- Modify: `client/src/services/authApi.ts:113-242`
- Modify: `client/src/context/AuthContext.tsx:12-140`
- Create: `client/src/components/dashboard/EditProfileModal.tsx`
- Modify: `client/src/components/dashboard/AccountMenu.tsx:1-176`
- Modify: `client/src/pages/SettingsPage.tsx:450-493`
- Test: `client/src/lib/dashboard.test.ts`

**Interfaces:**
- Produces:
  - `authApi.updateProfile(data: UpdateProfileData): Promise<User>`
  - `authApi.updateEmail(data: UpdateEmailData): Promise<{ user: User; accessToken: string }>`
  - `authApi.updatePassword(data: UpdatePasswordData): Promise<{ user: User; accessToken: string }>`
  - `AuthContext.updateUser(user: User): void`
  - `EditProfileModal` (`isOpen`, `onClose`, `initialTab?: 'profile' | 'security'`)

- [ ] **Step 1: Extend `client/src/types/auth.ts`, `authApi.ts`, and `AuthContext.tsx`**

- Add `jobTitle?: string | null`, `bio?: string | null`, `timeZone?: string | null`, `avatarColor?: AvatarAccentColor`, `hasLocalPassword?: boolean` to `User`.
- Add `authApi.updateProfile`, `authApi.updateEmail`, `authApi.updatePassword` (updating `authStorage.setAccessToken(res.accessToken)` on email/password change!).
- Expose `updateUser(user)` on `AuthContextType` so header/sidebar/welcome banner refresh instantaneously after saving.

- [ ] **Step 2: Create `client/src/components/dashboard/EditProfileModal.tsx`**

Build accessible modal (`role="dialog"`, Escape + Tab focus trap, Light/Dark matte tokens) with two tabs:
- **Personal Details:** `First Name`, `Last Name`, `Job Title / Role`, `Timezone` (curated common IANA options + user's browser `Intl.DateTimeFormat().resolvedOptions().timeZone`), `Short Bio`, `Avatar Color` swatches (`sage`, `slate`, `amber`, `rose`, `indigo`), and `Save Profile` -> `authApi.updateProfile` + `updateUser`.
- **Email & Password:**
  - *Email Address* form: New Email + Current Password (when `hasLocalPassword !== false`; if `hasLocalPassword === false`, show clear prompt pointing to *"Set Local Password"* form below so Google accounts set a password before switching emails).
  - *Password* form (`Change Password` or `Set Local Password` when `hasLocalPassword === false`): conditional Current Password + New Password with password visibility toggle & live 5-criterion strength pills + inline success/error banners.

- [ ] **Step 3: Wire `AccountMenu.tsx` and `SettingsPage.tsx`**

- `AccountMenu.tsx`: apply `user.avatarColor` palette classes, display `user.jobTitle` under name if present, preserve email verification badge (`Verified Email` / `Email Unverified` / `Session Active`), and add **`Edit Profile`** button (`UserPen` icon) right above `Account Settings` opening `<EditProfileModal />`.
- `SettingsPage.tsx`: render `jobTitle`, `timeZone`, `bio` inside `Account Identity` card and add an **`Edit Profile`** button opening `<EditProfileModal />`.

- [ ] **Step 4: Add client assertions & run checks**

Add contract assertions in `client/src/lib/dashboard.test.ts` checking `AccountMenu.tsx` includes `Edit Profile` & `EditProfileModal`, and `EditProfileModal.tsx` handles both `updateProfile` and `updateEmail`/`updatePassword`.
Run: `npm run lint --workspace=client && npm run typecheck --workspace=client && npm test --workspace=client`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

Stage and commit all Task 3 files.

---

### Task 4: Video-First Dashboard (`UpNextBanner`, `PreCallStudioWidget`, `RecentActivityWidget` + `Meet Again`, Modal Polish & `/lobby` Alias)

**Files:**
- Create: `client/src/components/dashboard/UpNextBanner.tsx`
- Create: `client/src/components/dashboard/PreCallStudioWidget.tsx`
- Modify: `client/src/components/dashboard/WelcomeHeader.tsx:1-55`
- Modify: `client/src/components/dashboard/RecentActivityWidget.tsx:1-120`
- Modify: `client/src/components/dashboard/InstantMeetingModal.tsx:20-371`
- Modify: `client/src/components/dashboard/ScheduleMeetingModal.tsx:255-460`
- Modify: `client/src/components/dashboard/JoinMeetingModal.tsx:135-175`
- Modify: `client/src/pages/DashboardPage.tsx:1-71`
- Modify: `client/src/app/router/AppRouter.tsx:95-115`
- Modify: `client/src/lib/dashboard.test.ts`

**Interfaces:**
- Produces:
  - `UpNextBanner`: `{ refreshKey?: number }` — loads next `SCHEDULED` meeting via `schedulingApi.listUpcomingMeetings({ page: 1, limit: 1 })`, displays relative countdown (ticks 30s), `Copy Invite`, and 1-click `Join Now` -> `/join/:code`.
  - `PreCallStudioWidget`: cloud-synced `Start Muted` & `Camera Off` toggles (`preferencesApi.savePreferences()` + `AuthContext.updateUserPreferences()`) + on-demand `Test Cam & Mic` button (local `getUserMedia`, mirrored `<video>`, live Web Audio RMS meter, device labels, graceful error state, strict track/AudioContext cleanup).
  - `RecentActivityWidget`: adds `Last 48h` retention chip, `Copy Code`, and `onMeetAgain?: (title: string) => void` triggering `InstantMeetingModal` with prefilled `initialTitle`.

- [ ] **Step 1: Write failing contract assertions in `client/src/lib/dashboard.test.ts`**

Assert:
- `DashboardPage.tsx` does NOT import or render `RecentDownloadsWidget`, and DOES render `UpNextBanner`, `QuickActionBar`, `UpcomingMeetingsSection`, `PreCallStudioWidget`, and `RecentActivityWidget`.
- `AppRouter.tsx` maps both `/join/:meetingCode` and `/lobby/:meetingCode` to `PreJoinLobbyPage`.
- `PreCallStudioWidget.tsx` persists via `preferencesApi` and stops media tracks on cleanup (no unconditional `getUserMedia` inside mount-only `useEffect`).

- [ ] **Step 2: Run `npm test --workspace=client` to confirm new contract tests fail**

Run: `node --experimental-strip-types --test client/src/lib/dashboard.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `UpNextBanner.tsx`, `PreCallStudioWidget.tsx`, modal polish (`InstantMeetingModal.tsx`, `ScheduleMeetingModal.tsx`, `JoinMeetingModal.tsx`), `WelcomeHeader.tsx`, `RecentActivityWidget.tsx`, `DashboardPage.tsx`, and `AppRouter.tsx`**

Implement each component cleanly in strict Stone & Carbon matte parity:
- `WelcomeHeader.tsx`: honor `user.timeZone` (`formatInTimeZone` / `toLocaleDateString(..., { timeZone })` with safe fallback) and show compact `user.jobTitle` badge beside the date if set.
- `InstantMeetingModal.tsx`: accept `initialTitle?: string` and initialize `title` state from `initialTitle` when opened; streamline header (`New Instant Meeting`), `Meeting Name` field, sleek `Waiting Room` pill toggle + concise 1-line helper, segmented `10` / `25` / `60` capacity pills, dark-mode alert colors, and crisp `Room Ready` summary with `Join Lobby ->`.
- `ScheduleMeetingModal.tsx` & `JoinMeetingModal.tsx`: tighten labels, apply consistent `dark:bg-[#141619]` input surfaces, replace `window.alert` copy notice with inline `Copied` state, and align error/footer spacing.
- `UpNextBanner.tsx`: fetch earliest scheduled meeting, compute countdown badge (`Starting now` / `Starts in Xm` / formatted time), `Copy Invite` using `buildMeetingJoinUrl`, `Join Now` navigating to `/join/${meeting.meetingCode}`. Hide cleanly (`null`) when 0 upcoming meetings.
- `PreCallStudioWidget.tsx`: render synced Mic & Camera default switches + collapsible on-demand `Test Cam & Mic` live studio preview (`Stop Test` + cleanup on unmount/`beforeunload`).
- `RecentActivityWidget.tsx`: show `Last 48h` badge, real meeting history items (`limit: 4`), copy-code button, and `Meet Again` button triggering `onMeetAgain(\`Follow-up: \${act.title}\`)`.
- `DashboardPage.tsx`: remove `RecentDownloadsWidget`, place `WelcomeHeader` -> `UpNextBanner` -> `QuickActionBar` -> balanced 12-col grid (`UpcomingMeetingsSection` on left 7 cols, `PreCallStudioWidget` + `RecentActivityWidget` (`flex-1`) on right 5 cols).
- `AppRouter.tsx`: add `/lobby/:meetingCode` route alias to `PreJoinLobbyPage`.

- [ ] **Step 4: Run full client lint, typecheck, test suite & Vite production build**

Run:
`npm run lint --workspace=client`
`npm run typecheck --workspace=client`
`npm test --workspace=client`
`npm run build --workspace=client`
Expected: ALL PASS (0 errors)

- [ ] **Step 5: Commit Task 4**

Stage and commit all Task 4 files.

---

### Task 5: Full End-to-End Verification, Push, CI, and Live Browser Audit

- [ ] **Step 1: Run full server test suite & server build**

Run (from root): `npm test --workspace=server` and `npm run build --workspace=server` (plus `npm run typecheck --workspace=server`).
Expected: ALL tests pass with 0 failures and build exits 0.

- [ ] **Step 2: Push to `origin main` and verify GitHub Actions + Render + Vercel deploy**

Push explicitly committed changes, inspect `CONNECTLY CI` until `completed / success`, confirm live Vercel bundle + Render `/api/v1/health` update.

- [ ] **Step 3: Live Chrome Verification (`https://connectly-meet.vercel.app/dashboard`)**

- Reload live `/dashboard` (`ignoreCache: true`), check `0` console errors.
- Verify `Downloads & Files` card is gone from Overview while `/downloads` sidebar item works.
- Verify aligned 2-column grid bottom edges match in both Dark and Light modes.
- Open top-right `AccountMenu` -> click `Edit Profile` -> inspect Personal Details + Email & Password UI and verify persistence on Name/Job Title/Timezone/Bio save across hard reload.
- Inspect `PreCallStudioWidget` toggles and `Test Cam & Mic` graceful toggle behavior + screenshots across Dark & Light modes.

---

## Plan Self-Review

1. **Spec Coverage:** Every requirement in [2026-11-27-studio-dashboard-retention-profile-design.md](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/superpowers/specs/2026-11-27-studio-dashboard-retention-profile-design.md) (`UpNextBanner`, `PreCallStudioWidget`, `RecentActivityWidget` + `Meet Again`, removing `RecentDownloadsWidget` from Overview, `MeetingHistoryRetentionWorker` + 48h query cutoff, `EditProfileModal` + `/me/email` + `/me/password` + `googleSub` linkage + `AccountMenu`/`SettingsPage`) maps 1-to-1 to Tasks 1–5.
2. **Consistency:** `PATCH /api/v1/users/me/email`, `PATCH /api/v1/users/me/password`, `MEETING_HISTORY_RETENTION_MS`, `PreCallStudioWidget`, `UpNextBanner`, `EditProfileModal`, and `/join/:meetingCode` + `/lobby/:meetingCode` match identically across spec and all tasks.
3. **Review Focus Coverage:** Every edge case listed under `## Review Focus` has explicit test coverage in Tasks 1, 2, 3, and 4.
