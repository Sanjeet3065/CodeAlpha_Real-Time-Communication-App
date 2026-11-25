# CONNECTLY — Phase 08 Database Schema & Persistence Changes

**Phase:** 08 – Meeting Room Management  
**Database:** MongoDB (Mongoose ODM)  
**Backward Compatibility:** Zero breaking changes to Phase 05 `users` / `refresh_tokens` or Phase 07 `user_preferences` collections.

---

## 1. New Collections Overview

Phase 08 introduces two normalized MongoDB collections designed for authoritative room state, atomic concurrency guards, waiting-room workflows, and clean Phase 09 LiveKit room mapping:

1. **`meetings`** (`server/src/models/Meeting.model.ts`) — Stores meeting metadata, lifecycle status, capacity counters, lock state, settings, optimistic version counter, expiration timestamp, and bounded audit log.
2. **`meeting_participants`** (`server/src/models/MeetingParticipant.model.ts`) — Stores per-user room membership, role, admission state machine, live presence state, and moderation decision metadata.

---

## 2. Collection: `meetings`

| Field | Type | Constraints / Defaults | Purpose |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Primary key | Authoritative meeting identifier (also used to namespace Socket.IO channels and future Phase 09 LiveKit room mapping) |
| `meetingCode` | `String` | `required`, `unique`, lowercase, trimmed, regex `/^cly-[a-z0-9]{3}-[a-z0-9]{3}$/` | CSPRNG-generated shareable code (31-char unambiguous alphabet, 31⁶ = 887,503,681 combinations) |
| `title` | `String` | `required`, trimmed, `1..120` chars, default `'Instant Meeting'` | Display title of the room |
| `hostId` | `ObjectId` | `ref: 'User'`, `required` | Current active Host (updated on deterministic host handover) |
| `originalHostId` | `ObjectId` | `ref: 'User'`, `required` | Original meeting creator preserved for auditability |
| `status` | `String` | `enum: ['CREATED', 'ACTIVE', 'ENDED', 'EXPIRED']`, default `'CREATED'` | Explicit room lifecycle state |
| `isLocked` | `Boolean` | `required`, default `false` | Blocks new non-host entrants when `true` |
| `maxParticipants` | `Number` | `required`, `min: 2`, `max: 60`, default `60` | Room participant capacity limit |
| `activeParticipantCount` | `Number` | `required`, `min: 0`, default `0` | Atomically updated admitted participant count |
| `settings` | `Object` | Embedded `MeetingSettingsSchema` (`_id: false`) | `{ waitingRoomEnabled: false, allowCoHostAdmit: true, allowCoHostRemove: true, allowCoHostLock: false }` |
| `version` | `Number` | `required`, default `1` | Monotonic mutation counter incremented on room state updates |
| `activatedAt` | `Date \| null` | default `null` | Timestamp when room transitioned `CREATED -> ACTIVE` |
| `endedAt` | `Date \| null` | default `null` | Timestamp when room transitioned to `ENDED` |
| `expiresAt` | `Date` | `required` | Room expiration timestamp (`CREATED` rooms expire after 24 hours if unused) |
| `auditLog` | `Array` | Embedded `MeetingAuditEntrySchema[]` (`_id: false`) | Bounded (`$slice: -100`) log of administrative events (`CREATED`, `ACTIVATED`, `LOCKED`, `UNLOCKED`, `SETTINGS_UPDATED`, `PARTICIPANT_ADMITTED`, `PARTICIPANT_REJECTED`, `PARTICIPANT_REMOVED`, `ROLE_UPDATED`, `HOST_TRANSFERRED`, `ENDED`, `EXPIRED`) |
| `createdAt`, `updatedAt` | `Date` | Mongoose `timestamps: true` | Automatic document timestamps |

### `meetings` Indexes
1. `{ meetingCode: 1 }` — **Unique** (fast code lookup & collision enforcement at database level).
2. `{ hostId: 1, status: 1 }` — Fast lookup of active/created meetings owned by a host.
3. `{ status: 1, expiresAt: 1 }` — Supports lifecycle expiration scans.

---

## 3. Collection: `meeting_participants`

| Field | Type | Constraints / Defaults | Purpose |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Primary key | Participant record identifier |
| `meetingId` | `ObjectId` | `ref: 'Meeting'`, `required` | Parent meeting reference |
| `userId` | `ObjectId` | `ref: 'User'`, `required` | Authenticated user reference |
| `displayName` | `String` | `required`, trimmed, `1..100` chars | Participant's chosen or profile display name |
| `email` | `String` | `required`, lowercase, trimmed | Authenticated user's email |
| `avatarUrl` | `String \| null` | default `null` | User avatar URL if available |
| `role` | `String` | `enum: ['host', 'co-host', 'participant']`, default `'participant'` | Server-enforced participant role |
| `admissionStatus` | `String` | `enum: ['WAITING', 'ADMITTED', 'REJECTED', 'LEFT', 'REMOVED', 'CANCELLED']`, default `'WAITING'` | Explicit admission state machine |
| `presenceStatus` | `String` | `enum: ['ONLINE', 'OFFLINE']`, default `'OFFLINE'` | Real-time Socket.IO connection presence |
| `requestedAt` | `Date` | `required`, default `Date.now` | Timestamp when user requested entry (FIFO waiting room ordering) |
| `admittedAt` | `Date \| null` | default `null` | Timestamp when user was admitted |
| `joinedAt` | `Date \| null` | default `null` | Timestamp when user entered room (deterministic host handover ordering) |
| `leftAt` | `Date \| null` | default `null` | Timestamp when user left or was removed |
| `decidedBy` | `ObjectId \| null` | `ref: 'User'`, default `null` | Host/Co-Host who admitted, rejected, or removed the participant |
| `decidedAt` | `Date \| null` | default `null` | Decision timestamp |
| `rejectionReason` | `String \| null` | `maxlength: 200`, default `null` | Optional waiting-room rejection reason |
| `removalReason` | `String \| null` | `maxlength: 200`, default `null` | Optional participant removal reason |
| `createdAt`, `updatedAt` | `Date` | Mongoose `timestamps: true` | Automatic document timestamps |

### `meeting_participants` Indexes
1. `{ meetingId: 1, userId: 1 }` — **Unique compound index** (strictly guarantees at most one participant record per user per meeting, preventing duplicate entries under concurrent joins or reconnections).
2. `{ meetingId: 1, admissionStatus: 1, joinedAt: 1 }` — Fast ordered roster retrieval and deterministic host handover queries.
3. `{ meetingId: 1, admissionStatus: 1, requestedAt: 1 }` — Fast FIFO waiting-room queue retrieval.
4. `{ userId: 1, admissionStatus: 1 }` — Lookup of a user's active or waiting rooms.

---

## 4. Lifecycle State Machines & Concurrency Guarantees

### 4.1 Meeting Lifecycle
```
CREATED ──(first admitted user joins)──▶ ACTIVE ──(host ends OR last host leaves empty room)──▶ ENDED
   │                                                                                             ▲
   └──────────────(expiresAt reached before join)──▶ EXPIRED                                     │
   └──────────────(host explicitly ends before anyone joins)─────────────────────────────────────┘
```
- Terminal states (`ENDED`, `EXPIRED`) reject all subsequent join, subscribe, and moderation operations (`410 MEETING_ENDED` / `410 MEETING_EXPIRED`).

### 4.2 Atomic Capacity & Race Condition Protection
- **Capacity reservation (`joinMeeting` and `admitParticipant`):** Uses atomic MongoDB conditional filter `{ _id: meeting._id, status: { $in: ['CREATED', 'ACTIVE'] }, activeParticipantCount: { $lt: maxParticipants } }` with `$inc: { activeParticipantCount: 1 }`.
- **Compensation rollback:** If a downstream participant state transition fails after capacity reservation (e.g., concurrent rejection or duplicate admission), `activeParticipantCount` is immediately decremented via `$inc: { activeParticipantCount: -1 }` (clamped at `>= 0`).
- **Concurrent duplicate-join protection:** Combines in-process per-`meetingId:userId` in-flight deduplication (`inflightJoins` Map) with the unique `{ meetingId, userId }` database index and cross-instance `ADMITTED` state re-checking when capacity reservation fails—preventing false `MEETING_FULL` responses and ensuring `activeParticipantCount` always equals the exact count of `ADMITTED` records.
- **Bounded audit log:** Every audit push uses `$push: { auditLog: { $each: [...], $slice: -100 } }` so meeting documents never grow unboundedly.

---

## 5. Phase 09 Readiness Boundary (Not Implemented in Phase 08)

The `meetings` (`_id`, `meetingCode`) and `meeting_participants` (`userId`, `role`, `admissionStatus`) schemas provide the exact authorization authority required by Phase 09 (WebRTC + LiveKit Integration) to mint scoped LiveKit room tokens solely for `ADMITTED` members of `ACTIVE` rooms without modifying existing Phase 08 fields. No LiveKit tokens, SDP offers, ICE candidates, or media track fields exist in Phase 08.
