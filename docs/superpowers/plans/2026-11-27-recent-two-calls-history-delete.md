# Recent Calls Cap, History Redirect & Per-Account History Delete Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only 2 latest calls on the Dashboard, redirect `History →` straight to `/meetings/history`, and let each user selectively delete their own hosted/attended history records cleanly from a professional UI.

**Architecture:** Extract `purgeMeetingsAndCascade` from `meetingHistoryRetentionWorker.service.ts`, add `historyHiddenBy` to `Meeting` (Mongoose + Supabase bridge/mapper), expose user-scoped single and batch history delete endpoints (`DELETE /api/v1/meetings/history/:meetingId` and `DELETE /api/v1/meetings/history`), then update `RecentActivityWidget`, `headerCommandSearch`/`DashboardHeader`, `schedulingApi`, and `MeetingsPage` with URL-synced `/meetings/history` routing and multi-select + single-row deletion UI with confirmation modal.

**Tech Stack:** Node.js, Express, TypeScript, Zod, Mongoose/Supabase bridge, React 18, Tailwind CSS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-27-recent-two-calls-history-delete-design.md`

## Global Constraints
- Deleting a shared meeting from User A's history MUST leave User B's history, `userRole`, participant logs, and files intact until every viewer removes it (or the 48h retention worker expires it).
- Third-party callers attempting to delete someone else's history MUST receive `403 FORBIDDEN`; invalid state (`ACTIVE`, `SCHEDULED`, `CREATED`) MUST reject with `400`.
- Reuse `purgeMeetingsAndCascade` for solo/all-hidden permanent removal; do not duplicate child/storage cleanup code.

## Review Focus
- User B attends User A's meeting, User B deletes it from history -> User B sees `total === 0`, User A still sees the meeting intact in `listMeetingHistory` and `getMeetingHistoryDetails`.
- Host deletes a solo ended meeting -> `Meeting`, child docs, and `SharedFile` objects are immediately removed from DB + storage.
- Batch delete containing an unauthorized `meetingId` fails cleanly (`403`) without mutating authorized siblings beforehand (authorize all IDs before mutating).
- Visiting `/meetings/history` or clicking `History →` from `RecentActivityWidget` lands immediately on Past History tab rather than Upcoming Scheduled tab.
- Deleting the only row on page 2 of history refetches page 1 cleanly without getting stuck on an empty page 2.

---

### Task 1: Backend Per-Account History Deletion & Shared Purge Helper

**Files:**
- Modify: `server/src/models/Meeting.model.ts`
- Modify: `server/src/repositories/supabaseMappers.ts`
- Modify: `server/src/repositories/supabaseModelBridge.ts`
- Modify: `server/src/services/meetingHistoryRetentionWorker.service.ts`
- Modify: `server/src/schemas/meeting.schema.ts`
- Modify: `server/src/services/scheduling.service.ts`
- Modify: `server/src/controllers/scheduling.controller.ts`
- Modify: `server/src/routes/meetings.routes.ts`
- Modify: `server/src/tests/historyRetention.test.ts`

**Interfaces:**
- Produces:
  - `purgeMeetingsAndCascade(expiredIds: Types.ObjectId[], customStorage?: IStorageProvider): Promise<{ purgedFilesCount: number; deletedStorageObjectsCount: number; purgedMeetingsCount: number }>`
  - `schedulingService.deleteMeetingHistoryEntry(userId: string, meetingId: string): Promise<{ deletedId: string; purged: boolean }>`
  - `schedulingService.deleteMeetingHistoryEntries(userId: string, meetingIds: string[]): Promise<{ deletedIds: string[]; deletedCount: number; purgedIds: string[] }>`
  - Routes `DELETE /api/v1/meetings/history` & `DELETE /api/v1/meetings/history/:meetingId`

- [ ] **Step 1: Add failing TDD tests in `server/src/tests/historyRetention.test.ts`**
  Cover:
  1. Per-account isolation: User B deletes shared attended meeting from User B's history -> disappears from User B `listMeetingHistory` and throws `404` on `getMeetingHistoryDetails`, while Host A still retains full access; once Host A also deletes it, meeting & files are permanently purged from DB + storage.
  2. Host solo deletion immediately purges DB + storage; `ACTIVE` & `SCHEDULED` rooms reject deletion (`400`); third-party caller rejects (`403`) across both single and atomic batch delete (`DELETE /api/v1/meetings/history`).

- [ ] **Step 2: Run `historyRetention.test.ts` to watch RED**
  Run: `npm test --workspace=server -- --test src/tests/historyRetention.test.ts`
  Expected: FAIL (`deleteMeetingHistoryEntry is not a function`)

- [ ] **Step 3: Implement model, mapper, shared cascade helper, schema, service, controller & routes**
  - Add `historyHiddenBy` to `Meeting.model.ts`, `supabaseMappers.ts` (`_connectly`), and `supabaseModelBridge.ts` (`defaults`).
  - Export `purgeMeetingsAndCascade` in `meetingHistoryRetentionWorker.service.ts`.
  - Filter `historyHiddenBy: { $ne: userObjId }` in `listMeetingHistory` and check hidden status in `getMeetingHistoryDetails`.
  - Implement `deleteMeetingHistoryEntry` & `deleteMeetingHistoryEntries` (atomic pre-validation of all IDs -> add `userObjId` to `historyHiddenBy` -> purge any meeting whose remaining visible viewer set `[hostId, ...attendedUserIds]` minus `historyHiddenBy` is empty).
  - Add Zod `deleteMeetingHistoryBatchSchema` (`meetingIds` array 1..50, validated ObjectIds), controller handlers, and `DELETE /history` + `DELETE /history/:meetingId` routes (before `/:meetingCode`).

- [ ] **Step 4: Run server tests, lint, typecheck, and build**
  Run: `npm run lint --workspace=server && npm run typecheck --workspace=server && npm run build --workspace=server && npm test --workspace=server -- --test src/tests/historyRetention.test.ts src/tests/zodSecurity.test.ts src/tests/supabaseArchitecture.test.ts`
  Expected: PASS (`0` errors, all tests pass)

- [ ] **Step 5: Commit Task 1**

---

### Task 2: Recent Calls Cap (2), `/meetings/history` Routing & Selective Delete UI

**Files:**
- Modify: `client/src/services/schedulingApi.ts`
- Modify: `client/src/services/schedulingApi.test.ts`
- Modify: `client/src/components/dashboard/RecentActivityWidget.tsx`
- Modify: `client/src/lib/headerCommandSearch.ts`
- Modify: `client/src/lib/headerCommandSearch.test.ts`
- Modify: `client/src/components/dashboard/DashboardHeader.tsx`
- Modify: `client/src/pages/MeetingsPage.tsx`
- Modify: `client/src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `DELETE /api/v1/meetings/history` & `DELETE /api/v1/meetings/history/:meetingId`
- Produces:
  - `schedulingApi.deleteMeetingHistoryEntry(meetingId: string)`
  - `schedulingApi.deleteMeetingHistoryEntries(meetingIds: string[])`
  - `MeetingsPage` synced to `/meetings/history` + selective single/multi-row delete UI & confirmation dialog

- [ ] **Step 1: Add failing TDD tests in `schedulingApi.test.ts`, `headerCommandSearch.test.ts`, and `dashboard.test.ts`**
  Cover:
  1. `schedulingApi.deleteMeetingHistoryEntry` (`DELETE /meetings/history/:id`) & `deleteMeetingHistoryEntries` (`DELETE /meetings/history` with JSON `{ meetingIds }`).
  2. `headerCommandSearch` routes recent meetings to `/meetings/history`.
  3. `dashboard.test.ts` verifies `RecentActivityWidget` fetches `limit: 2` and links to `/meetings/history`, and `MeetingsPage` syncs `/meetings/history` & supports selective deletion UI.

- [ ] **Step 2: Run failing tests to verify RED**
  Run: `node --experimental-strip-types --test client/src/services/schedulingApi.test.ts client/src/lib/headerCommandSearch.test.ts client/src/lib/dashboard.test.ts`
  Expected: FAIL on missing delete methods & `/meetings/history` expectations.

- [ ] **Step 3: Implement frontend API methods, Recent Calls cap/routing, and `MeetingsPage` delete UI**
  - Update `RecentActivityWidget.tsx` to request `limit: 2`, slice cleanly to 2, and navigate to `/meetings/history`.
  - Update `headerCommandSearch.ts` + `DashboardHeader.tsx` (`recent` -> `/meetings/history`, reset cache on `connectly:history-updated`).
  - Update `schedulingApi.ts` with `deleteMeetingHistoryEntry` and `deleteMeetingHistoryEntries`.
  - Update `MeetingsPage.tsx`:
    - Sync `activeTab` with `/meetings/history` pathname & `?tab=history`; tab switches navigate `/meetings` <-> `/meetings/history`.
    - Add selection checkboxes per card + `"Select all"` toggle + slide-in multi-select delete toolbar (`N selected`, `Clear`, `Delete Selected`).
    - Add per-card `Delete` icon button alongside `View Details`.
    - Add dark/light matte Confirmation Modal + inline feedback banners + clean page fallback when deleting last record on page > 1 + dispatch `connectly:history-updated`.

- [ ] **Step 4: Run client lint, typecheck, full test suite, and Vite build**
  Run: `npm run lint --workspace=client && npm run typecheck --workspace=client && npm test --workspace=client && npm run build --workspace=client`
  Expected: PASS (`0` errors, all suites pass, build green)

- [ ] **Step 5: Commit Task 2, run whole-branch review & hardening, push to `origin/main`, verify CI & live Chrome UI**
