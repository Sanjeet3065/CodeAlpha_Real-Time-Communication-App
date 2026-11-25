# CONNECTLY — Phase 08 API & Real-Time Events Documentation

**Phase:** 08 – Meeting Room Management  
**Base REST Prefix:** `/api/v1/meetings` (legacy alias `/api/meetings`)  
**Real-Time Transport:** Socket.IO on the Node HTTP server (`/socket.io`, WebSocket primary with HTTP long-polling fallback)  
**Authentication:** Mandatory JWT Bearer access token (`requireAuth` middleware for REST; `verifyAccessToken` handshake middleware for Socket.IO)

---

## 1. Security & Transport Headers

| Requirement | Mechanism |
| --- | --- |
| Authentication | `Authorization: Bearer <accessToken>` on every `/api/v1/meetings/*` endpoint. Unauthenticated callers receive `401 UNAUTHORIZED`. |
| Input Validation | Strict Zod v4 (`z.strictObject`) schemas in `server/src/schemas/meeting.schema.ts`. Unknown properties are rejected with `400 VALIDATION_ERROR` (mass-assignment protection). |
| Rate Limiting | `meetingCreateLimiter`: 100 requests / 15 min per IP on meeting creation. `meetingActionLimiter`: 180 requests / 1 min per IP on room join, leave, and moderation actions. Socket.IO per-socket limiter: 30 events / 10 s. |
| Response Envelope | Success: `{ "success": true, "data": { ... }, "requestId": "..." }`. Error: `{ "status": <number>, "code": "<ERROR_CODE>", "message": "<safe human message>", "requestId": "...", "timestamp": "..." }`. |

---

## 2. REST Endpoints (`/api/v1/meetings`)

### 2.1 Create Meeting
- **Endpoints:** `POST /api/v1/meetings` and `POST /api/v1/meetings/instant`
- **Auth / Roles:** Any authenticated user (becomes `host` and `originalHostId`).
- **Rate Limiter:** `meetingCreateLimiter`
- **Request Body (`createMeetingSchema`):**
```json
{
  "title": "Architecture Sync",
  "maxParticipants": 60,
  "settings": {
    "waitingRoomEnabled": true,
    "allowCoHostAdmit": true,
    "allowCoHostRemove": true,
    "allowCoHostLock": false
  }
}
```
All fields are optional (`title` defaults to `"Instant Meeting"`, 1–120 chars; `maxParticipants` defaults to `60`, integer `2..60`).
- **Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "meeting": {
      "id": "6afca...",
      "meetingCode": "cly-t6f-dxe",
      "title": "Architecture Sync",
      "joinUrl": "http://localhost:5173/join/cly-t6f-dxe",
      "hostId": "6afcb...",
      "hostName": "Elena Host",
      "status": "CREATED",
      "isLocked": false,
      "maxParticipants": 60,
      "activeParticipantCount": 0,
      "settings": {
        "waitingRoomEnabled": true,
        "allowCoHostAdmit": true,
        "allowCoHostRemove": true,
        "allowCoHostLock": false
      },
      "version": 1,
      "activatedAt": null,
      "endedAt": null,
      "expiresAt": "2026-11-18T19:35:00.000Z",
      "createdAt": "2026-11-17T19:35:00.000Z",
      "updatedAt": "2026-11-17T19:35:00.000Z"
    }
  }
}
```

### 2.2 Validate Meeting Code / Pre-Join Metadata
- **Endpoint:** `GET /api/v1/meetings/validate/:meetingCode`
- **Auth / Roles:** Any authenticated user. Accepts canonical `cly-xxx-xxx`, `xxx-xxx`, raw 6/9 alphanumeric variants, or full URLs (normalized server-side).
- **Behavior:** Checks expiration (`CREATED` meetings past `expiresAt` transition atomically to `EXPIRED`). Returns safe pre-join metadata without leaking participant roster PII.
- **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "meeting": { "...MeetingSummary..." },
    "myStatus": {
      "role": "participant",
      "admissionStatus": "WAITING",
      "presenceStatus": "OFFLINE"
    }
  }
}
```
- **Error Codes:** `400 INVALID_MEETING_CODE`, `404 MEETING_NOT_FOUND`, `410 MEETING_ENDED`, `410 MEETING_EXPIRED`.

### 2.3 Get Meeting Summary
- **Endpoint:** `GET /api/v1/meetings/:meetingCode`
- **Auth / Roles:** Any authenticated user (returns sanitized `MeetingSummary` + caller's `myStatus`; never exposes admitted participant lists or waiting room entries).

### 2.4 Join Meeting (Direct Admission or Waiting Room Queue)
- **Endpoint:** `POST /api/v1/meetings/:meetingCode/join`
- **Auth / Roles:** Any authenticated user.
- **Rate Limiter:** `meetingActionLimiter`
- **Request Body (`joinMeetingSchema`):** `{ "displayName": "Optional Override (1-100 chars)" }`
- **State & Guard Logic:**
  - Rejects `ENDED` (`410 MEETING_ENDED`), `EXPIRED` (`410 MEETING_EXPIRED`), previously `REMOVED` (`403 PARTICIPANT_REMOVED`), `isLocked === true` for non-hosts (`403 MEETING_LOCKED`), and `activeParticipantCount >= maxParticipants` (`403 MEETING_FULL`).
  - Idempotent for already-`ADMITTED` users (returns `joinResult: "ALREADY_ADMITTED"` without double-counting capacity, guarded by both in-flight deduplication and cross-instance MongoDB re-checks).
  - If `settings.waitingRoomEnabled === true` and caller is not the Host, queues caller with `admissionStatus: "WAITING"` (`joinResult: "WAITING"`) and emits `meeting:waiting-room-updated` exclusively to the hosts Socket.IO channel.
  - Otherwise atomically increments `activeParticipantCount` (with `$lt: maxParticipants` guard), transitions `CREATED -> ACTIVE` if needed, upserts `MeetingParticipant` with `ADMITTED`, and emits `meeting:participant-joined`.
- **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "joinResult": "ADMITTED",
    "meeting": { "...MeetingSummary..." },
    "participant": { "...ParticipantItem..." }
  }
}
```

### 2.5 Get Authoritative Room State (Admitted Members Only)
- **Endpoint:** `GET /api/v1/meetings/:meetingCode/state`
- **Auth / Roles:** Must have `admissionStatus === "ADMITTED"` for this meeting; waiting or non-member users receive `403 FORBIDDEN`.
- **Response (`200 OK`):** Returns `{ meeting, myRole, me, participants, waitingList }`. `waitingList` is populated only when the caller is `host` or a `co-host` with `allowCoHostAdmit`; regular participants receive an empty array `[]`.

### 2.6 List Admitted Participants
- **Endpoint:** `GET /api/v1/meetings/:meetingCode/participants`
- **Auth / Roles:** Admitted members only (`403 FORBIDDEN` for waiting/non-members).
- **Response (`200 OK`):** `{ participants: ParticipantItem[], count: number }`.

### 2.7 List Waiting Room Queue
- **Endpoint:** `GET /api/v1/meetings/:meetingCode/waiting-room`
- **Auth / Roles:** `host` or `co-host` with `settings.allowCoHostAdmit === true`. Regular participants receive `403 FORBIDDEN`.
- **Response (`200 OK`):** `{ waitingList: WaitingRoomItem[], count: number }`.

### 2.8 Admit Waiting Participant
- **Endpoint:** `POST /api/v1/meetings/:meetingCode/waiting-room/:targetUserId/admit`
- **Auth / Roles:** `host` or `co-host` (when `settings.allowCoHostAdmit === true`).
- **Atomic Guarantees:** Atomically reserves capacity (`activeParticipantCount < maxParticipants`), transitions `MeetingParticipant` from `WAITING -> ADMITTED`, rolls back capacity reservation if participant state changed concurrently, emits `meeting:admission-approved` to `waiting:<userId>`, promotes their Socket.IO connection to `:admitted`, emits `meeting:participant-joined`, and refreshes `meeting:waiting-room-updated` for hosts.
- **Error Codes:** `403 FORBIDDEN`, `403 MEETING_FULL`, `409 WAITING_REQUEST_NOT_PENDING`, `410 MEETING_ENDED`.

### 2.9 Reject Waiting Participant
- **Endpoint:** `POST /api/v1/meetings/:meetingCode/waiting-room/:targetUserId/reject`
- **Auth / Roles:** `host` or `co-host` (when `settings.allowCoHostAdmit === true`).
- **Request Body (`rejectWaitingSchema`):** `{ "reason": "Optional <= 200 chars" }`
- **Behavior:** Transitions `WAITING -> REJECTED`, emits `meeting:admission-rejected` to the waiting user's private channel, and updates the hosts' waiting queue.

### 2.10 Promote / Revoke Co-Host Role
- **Endpoint:** `PATCH /api/v1/meetings/:meetingCode/participants/:targetUserId/role`
- **Auth / Roles:** **Host only.** Co-hosts and regular participants receive `403 FORBIDDEN`. Cannot alter the Host's own role (`400 INVALID_ROLE_CHANGE`).
- **Request Body (`updateRoleSchema`):** `{ "role": "co-host" | "participant" }`
- **Behavior:** Updates `MeetingParticipant.role`, records `ROLE_UPDATED` audit entry, immediately joins/leaves the target's connected sockets on `meeting:<id>:hosts`, and broadcasts `meeting:role-updated` to `:admitted`.

### 2.11 Remove Participant
- **Endpoint:** `DELETE /api/v1/meetings/:meetingCode/participants/:targetUserId`
- **Auth / Roles:**
  - `host` can remove any `co-host` or `participant` (cannot remove self).
  - `co-host` can remove `participant` only when `settings.allowCoHostRemove === true`; attempting to remove the `host` or another `co-host` returns `403 FORBIDDEN`.
  - `participant` receives `403 FORBIDDEN`.
- **Request Body (`removeParticipantSchema`):** `{ "reason": "Optional <= 200 chars" }`
- **Behavior:** Marks `admissionStatus: "REMOVED"`, `presenceStatus: "OFFLINE"`, decrements `activeParticipantCount`, immediately evicts the target's sockets from `:admitted` and `:hosts`, emits `meeting:participant-removed` directly to the removed user, and emits `meeting:participant-left` (`reason: "REMOVED"`) to remaining admitted members. Removed users are blocked from rejoining (`403 PARTICIPANT_REMOVED`).

### 2.12 Lock & Unlock Meeting
- **Endpoints:**
  - `POST /api/v1/meetings/:meetingCode/lock`
  - `POST /api/v1/meetings/:meetingCode/unlock`
- **Auth / Roles:** `host`, or `co-host` when `settings.allowCoHostLock === true`. Otherwise `403 FORBIDDEN`.
- **Behavior:** Updates `Meeting.isLocked`, increments `version`, appends `LOCKED`/`UNLOCKED` audit log entry, and emits `meeting:locked` or `meeting:unlocked` to `:admitted`.

### 2.13 Update Room Settings
- **Endpoint:** `PATCH /api/v1/meetings/:meetingCode/settings`
- **Auth / Roles:** **Host only.**
- **Request Body (`updateMeetingSettingsSchema`):** At least one of `title`, `waitingRoomEnabled`, `allowCoHostAdmit`, `allowCoHostRemove`, `allowCoHostLock`.
- **Behavior:** Updates `Meeting.title` / `Meeting.settings`, increments `version`, appends `SETTINGS_UPDATED` audit entry, and broadcasts `meeting:settings-updated` to `:admitted`.

### 2.14 Leave Meeting (with Explicit Host Departure Handover Policy)
- **Endpoint:** `POST /api/v1/meetings/:meetingCode/leave`
- **Auth / Roles:** Any admitted or waiting member of the meeting.
- **Behavior:**
  - **Waiting user:** Transitions `WAITING -> CANCELLED`, refreshes `meeting:waiting-room-updated` for hosts.
  - **Regular Participant or Co-Host:** Transitions `ADMITTED -> LEFT`, decrements `activeParticipantCount`, emits `meeting:participant-left`.
  - **Host Departure Policy (Deterministic):**
    1. Searches for the earliest-joined remaining `ADMITTED` `co-host` (`joinedAt` ascending).
    2. If none, searches for the earliest-joined remaining `ADMITTED` `participant` (`joinedAt` ascending).
    3. If a successor exists: promotes successor to `host`, updates `Meeting.hostId`, appends `HOST_TRANSFERRED` audit entry, emits `meeting:role-updated` + `meeting:participant-left` (with `newHostId`), and moves successor sockets into `:hosts`.
    4. If no admitted participants remain: cleanly ends the meeting (`status: "ENDED"`), cancels any remaining `WAITING` entries, appends `ENDED` audit entry, and broadcasts `meeting:ended`.

### 2.15 End Meeting for All
- **Endpoint:** `POST /api/v1/meetings/:meetingCode/end`
- **Auth / Roles:** **Host only.** Co-hosts and participants receive `403 FORBIDDEN`.
- **Behavior:** Atomically sets `status: "ENDED"`, `endedAt`, `activeParticipantCount: 0`, transitions all `ADMITTED` records to `LEFT` and `WAITING` records to `CANCELLED`, records `ENDED` audit log entry, broadcasts `meeting:ended` to both `:admitted` and every waiting user's private channel, and evicts all connected sockets from meeting channels.

---

## 3. Socket.IO Real-Time Protocol (`server/src/realtime/meetingSocket.ts`)

### 3.1 Handshake & Channel Isolation
- **Authentication:** `socket.handshake.auth.token` (or `Authorization: Bearer <token>`). Invalid/missing JWT is rejected before connection completes (`UNAUTHORIZED`).
- **CORS:** Restricted to `env.CLIENT_ORIGIN`, `http://localhost:5173`, and `http://127.0.0.1:5173`.
- **Isolated Channels per Meeting:**
  - `meeting:<meetingId>:admitted` — Admitted room roster & state events.
  - `meeting:<meetingId>:hosts` — Host & Co-Host waiting-room updates ONLY (regular participants and waiting users are strictly barred).
  - `meeting:<meetingId>:waiting:<userId>` — Private channel for a waiting user's own admit/reject/end notifications.
  - `meeting:<meetingId>:user:<userId>` — Private user-scoped channel for direct removal and socket channel sync.

### 3.2 Client-to-Server Events
| Event | Payload | Server Verification |
| --- | --- | --- |
| `meeting:subscribe` | `{ meetingCode: string }` + optional `ack` | Normalizes code, verifies meeting is not `ENDED`/`EXPIRED`, queries MongoDB `MeetingParticipant` (never trusts client claims), joins strictly appropriate channels, marks `ADMITTED` presence `ONLINE`. |
| `meeting:unsubscribe` | `{ meetingId: string }` | Leaves all channels for `meetingId` and updates presence `OFFLINE` if no other sockets remain for that user in the meeting. |

### 3.3 Server-to-Client Events
| Event | Target Channel(s) | Trigger |
| --- | --- | --- |
| `meeting:participant-joined` | `:admitted` | User joins directly or is admitted from waiting room |
| `meeting:participant-left` | `:admitted` | Participant leaves or is removed (`reason: "LEFT" \| "REMOVED"`) |
| `meeting:presence-updated` | `:admitted` | User's socket connects (`ONLINE`) or last socket disconnects (`OFFLINE`) |
| `meeting:waiting-room-updated` | `:hosts` ONLY | Waiting queue changes (join waiting, admit, reject, cancel) |
| `meeting:admission-approved` | `:waiting:<userId>` | Host/Co-Host admits waiting user |
| `meeting:admission-rejected` | `:waiting:<userId>` | Host/Co-Host rejects waiting user |
| `meeting:participant-removed` | `:user:<userId>` | Host/Co-Host removes admitted participant |
| `meeting:role-updated` | `:admitted` | Co-host promoted/revoked or host ownership transferred |
| `meeting:locked` / `meeting:unlocked` | `:admitted` | Host/permitted Co-Host toggles room lock |
| `meeting:settings-updated` | `:admitted` | Host updates title or waiting-room/co-host delegation settings |
| `meeting:ended` | `:admitted` + each `:waiting:<userId>` | Host ends meeting for all or last host departs empty room |

---

## 4. Standardized Error Codes

| HTTP Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_MEETING_CODE` | Malformed meeting code or unsafe link input |
| `400` | `VALIDATION_ERROR` | Zod schema violation or unknown body field |
| `400` | `INVALID_ROLE_CHANGE` | Attempted invalid role change (e.g., changing Host's own role) |
| `401` | `UNAUTHORIZED` | Missing, expired, or invalid JWT access token |
| `403` | `FORBIDDEN` | Insufficient role/permission or unauthorized room access |
| `403` | `PARTICIPANT_REMOVED` | Previously removed user attempted to rejoin |
| `403` | `MEETING_LOCKED` | Room is locked to new non-host entrants |
| `403` | `MEETING_FULL` | Room reached `maxParticipants` capacity |
| `404` | `MEETING_NOT_FOUND` | Meeting code does not exist |
| `404` | `PARTICIPANT_NOT_FOUND` | Target user is not an active admitted participant in this room |
| `409` | `WAITING_REQUEST_NOT_PENDING` | Waiting-room request was cancelled or already handled |
| `410` | `MEETING_ENDED` | Meeting was explicitly ended |
| `410` | `MEETING_EXPIRED` | Meeting expired prior to joining |
| `429` | `RATE_LIMIT_EXCEEDED` | REST or Socket.IO rate limit exceeded |
