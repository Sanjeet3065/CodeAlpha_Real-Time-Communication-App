# Recent Calls Cap (2), History Redirect & Per-Account Selective History Delete — Design Spec

**Date:** 2026-11-27
**Status:** Ready for Confirmation

## Intent
1. Show strictly the latest **2** completed/recent meetings inside Dashboard **Recent Calls** (`RecentActivityWidget`), rather than 4.
2. Make clicking `History →` (or any recent call row, or a recent call in `DashboardHeader` search) redirect directly into `/meetings/history` (**Past History** tab) showing the user's full retained history.
3. Give each user in this multi-user public application full control over their **own** account history — letting them selectively delete any single hosted/attended meeting or bulk-delete selected items with a sleek, professional UI without affecting other participants' accounts.

## Design
1. **Per-Account History Deletion Model (`historyHiddenBy` + Smart Orphan Purge)**
   - Add `historyHiddenBy: ObjectId[]` on `Meeting` (mapped in Mongoose `Meeting.model.ts` and `_connectly.historyHiddenBy` inside `supabaseMappers.ts` + `supabaseModelBridge.ts`).
   - Query-time exclusion: `listMeetingHistory` filters `historyHiddenBy: { $ne: userObjId }`, and `getMeetingHistoryDetails` denies access once hidden (`404 MEETING_NOT_FOUND` for that user after verifying object-level authorization).
   - Endpoints on `meetingsRouter` (protected by `requireAuth`, `validateRequestOrigin`, `meetingActionLimiter`):
     - `DELETE /api/v1/meetings/history/:meetingId` — validates ID, checks host or attended participant authorization (`403` for third parties), enforces historical state (`ENDED` / `CANCELLED` / `EXPIRED`, rejecting `ACTIVE` / `SCHEDULED` / `CREATED` with `400`), adds caller to `historyHiddenBy`.
     - `DELETE /api/v1/meetings/history` — accepts `{ meetingIds: string[] }` (`1–50` ObjectIds via Zod `strictObject`) so users can selectively delete chosen rows in batch.
   - Automatic full DB cleanup: whenever hiding causes **zero non-hidden viewers** (host + all admitted/joined participants) to remain — e.g. solo instant/test calls or calls removed by every attendee — immediately purge the meeting row, child records, and `SharedFile` objects via shared `purgeMeetingsAndCascade` extracted from `meetingHistoryRetentionWorker.service.ts`.
2. **Dashboard `Recent Calls` Cap & Direct Routing**
   - `RecentActivityWidget.tsx` fetches `limit: 2` (and slices cleanly to 2) and links `History →` and row clicks directly to `/meetings/history`.
   - `headerCommandSearch.ts` routes recent history matches directly to `/meetings/history`.
   - `DashboardHeader.tsx` invalidates its cached search meetings on `connectly:history-updated`.
3. **Professional Past History Management UI (`/meetings/history`)**
   - `MeetingsPage.tsx` syncs `activeTab` with `/meetings/history` (`?tab=history` also supported) and updates URL on tab toggle.
   - History rows include clean selection checkboxes, a slide-in multi-select action bar (`N selected`, `Select all`, `Clear`, `Delete Selected`), per-card `Delete` icon button beside `View Details`, and a custom dark/light studio confirmation modal (`Remove from History` vs `Cancel`, zero browser `confirm()`/`alert()`).

## Non-Goals / Constraints
- Never allow deleting `ACTIVE`, `SCHEDULED`, or `CREATED` sessions through history endpoints.
- Never hide or delete another user's copy of a shared meeting when only one attendee deletes it from their own history.
