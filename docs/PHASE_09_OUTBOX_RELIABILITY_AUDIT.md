# CONNECTLY — Phase 09 Final Transactional Outbox Reliability Audit Report

**Phase:** 09 – WebRTC + LiveKit Integration  
**Audit Date:** 2026-11-18  
**Scope:** Strictly Phase 09 transactional realtime outbox reliability (`MeetingRealtimeEvent`, `MeetingRealtimeOutboxDispatcher`, `MeetingService`, `MeetingRealtimeHub`, `server.ts`, client Socket.IO consumers, and Replica Set + standalone regression tests).  
**Roadmap & Gate Status:** **Phase 10 has NOT been started.** Finalized 18-phase roadmap is unchanged. **Phase 09 is NOT self-approved** — awaiting Project Owner review.

---

## 1. Exact Files Changed

### New Files
- `server/src/realtime/meetingOutboxDispatcher.ts` — Recoverable, multi-instance-safe lease-based outbox dispatcher (`MeetingRealtimeOutboxDispatcher` + singleton `meetingOutboxDispatcher`) implementing atomic claim/lease expiration recovery, cold DB payload hydration, per-meeting lifecycle ordering, retry backoff on transient errors, and deterministic crash hooks.
- `server/src/tests/meetingOutboxReliability.test.ts` — 6 deterministic regression tests covering Crash A, Crash B, Crash C, operational emit retry, Crash D + at-least-once consumer idempotency, multi-instance claim contention, stale lease-owner fencing, meeting termination during an active `CLAIMED` lease, terminal-only TTL index verification, legacy `createdAt` TTL removal, and >24-hour outage recovery.

### Modified Production Files
- `server/src/models/MeetingRealtimeEvent.model.ts` — Added `CLAIMED` state, unique `eventId`, `leaseOwner`, `leaseToken`, `claimedAt`, `leaseExpiresAt`, `attemptCount`, `lastError`, `nextAttemptAt`, `dispatchedAt`, `suppressedAt`, and nullable `terminalAt`; replaced the unsafe unconditional `{ createdAt: 1 }` TTL index with terminal-only partial TTL index `terminalAt_ttl_24h`; added `ensureMeetingRealtimeOutboxReady()` to actively drop any legacy `createdAt` TTL index on startup.
- `server/src/models/LiveKitRevocationEvent.model.ts` — Wired `ensureMeetingRealtimeOutboxReady()` into `ensureRevocationCollectionsReady()`.
- `server/src/services/meeting.service.ts` — Routed `admitParticipant()` through `MeetingRealtimeOutboxDispatcher.dispatchById()`; updated all 5 termination/expiration paths (`endMeeting`, last-host `leaveMeeting`, `findMeetingAndEnforceExpiration`, Replica Set & standalone) to atomically suppress **both** `PENDING` and actively `CLAIMED` outbox entries (`suppressedAt` + `terminalAt` set, lease fields cleared) and set `terminalAt` on `MEETING_ENDED` markers.
- `server/src/realtime/meetingSocket.ts` — Added optional `eventId` forwarding to `emitAdmissionApproved()` and `emitParticipantJoined()` for consumer idempotency.
- `server/src/server.ts` — Started `meetingOutboxDispatcher.start()` after Socket.IO attachment on startup (running immediate catch-up recovery) and stopped `meetingOutboxDispatcher.stop()` during graceful `SIGTERM`/`SIGINT` shutdown.
- `client/src/pages/MeetingRoomPage.tsx` — Added bounded `seenEventIds` deduplication for `meeting:participant-joined` alongside existing `userId` upsert idempotency.
- `client/src/pages/PreJoinLobbyPage.tsx` — Added `seenEventIds` deduplication and terminal lockout (`terminalLocked`) so duplicate `meeting:admission-approved` events are idempotent and can never override `meeting:ended` or `meeting:admission-rejected`.

### Modified Test & Documentation Files
- `scripts/test-phase09-replicaset.ts` — Added `RS-12` and `RS-13` (expanded from 11 to 13 real MongoDB 8.3 Replica Set ACID transaction & Change Stream tests).
- `docs/PHASE_09_SECURITY_AUDIT.md`, `docs/PHASE_09_TEST_REPORT.md`, `docs/PHASE_09_ACCEPTANCE.md` — Synchronized counts and outbox state machine / TTL documentation.

---

## 2. Confirmed Root Causes

1. **Permanent Event Loss on Crash After Claim (`PENDING -> DISPATCHED`):** `admitParticipant()` previously executed `findOneAndUpdate({ _id, status: 'PENDING' }, { $set: { status: 'DISPATCHED' } })` *before* Socket.IO emission with no intermediate lease state. Any process crash immediately after claiming (Crash B) or before Socket.IO emission (Crash C) permanently marked the record `DISPATCHED` and dropped the event forever.
2. **Stranded Events on Crash Before Claim (Crash A):** There was no background outbox recovery worker wired into `server.ts`, and outbox entries could not be hydrated from MongoDB by a separate instance. Crashing between transaction commit and claim left `PENDING` events permanently undelivered.
3. **Unchecked Active Leases During Meeting Termination:** Termination/expiration paths previously ran `updateMany({ status: 'PENDING' })`, which missed events actively leased in `CLAIMED` state on another instance.
4. **Unsafe Unconditional 24-Hour TTL Index (`createdAt_1`):** `MeetingRealtimeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 })` applied to *every* document regardless of status. During an outage longer than 24 hours, MongoDB's background `TTLMonitor` would permanently delete unrecovered `PENDING` and `CLAIMED` records.

---

## 3. Outbox State Machine & Recovery Behavior

**Delivery Guarantee:** Explicitly **at-least-once** (NOT exactly-once).

### 3.1 States & Transitions

| State | `terminalAt` | Lease Fields | Valid Transitions |
| --- | --- | --- | --- |
| `PENDING` | `null` *(TTL-exempt)* | `null` | `-> CLAIMED` via atomic `findOneAndUpdate` (`nextAttemptAt == null \|\| nextAttemptAt <= now`); `-> SUPPRESSED` on meeting termination/expiration. |
| `CLAIMED` | `null` *(TTL-exempt)* | `leaseOwner`, `leaseToken`, `claimedAt`, `leaseExpiresAt`, `attemptCount++` | `-> DISPATCHED` (fenced by `{ _id, status: 'CLAIMED', leaseToken }`) after emission; `-> PENDING` (with `nextAttemptAt` backoff & `lastError`) on non-crash operational error; `-> CLAIMED` (reclaimed with new `leaseOwner` & `leaseToken`, `attemptCount++`) once `leaseExpiresAt <= now`; `-> SUPPRESSED` atomically on meeting termination/expiration or when participant is no longer `ADMITTED`. |
| `DISPATCHED` *(Terminal)* | `Date` *(24h TTL)* | `null` | Terminal — no further dispatch. |
| `SUPPRESSED` *(Terminal)* | `Date` *(24h TTL)* | `null` | Terminal — never emitted. |

### 3.2 Crash-Boundary Recovery Matrix (Issues 1 A–D & Issue 3)

| Failure Scenario | Outbox Record State Immediately After Failure | Recovery Behavior | Ordering & Termination Safety |
| --- | --- | --- | --- |
| **Crash A (Before claiming)** | `PENDING`, `attemptCount: 0`, `terminalAt: null` | Startup sweep or peer instance atomically claims `PENDING -> CLAIMED`, hydrates authoritative `Meeting`/`MeetingParticipant`/`waitingList` from MongoDB, emits with `eventId`, marks `DISPATCHED` (`terminalAt` set). | Executed inside `runMeetingLifecycleOrdered(meetingId)`; suppressed if meeting ended/expired or participant no longer `ADMITTED`. |
| **Crash B (Immediately after `PENDING -> CLAIMED`)** | `CLAIMED`, `leaseOwner`, `leaseToken`, `leaseExpiresAt`, `terminalAt: null` | Active lease blocks other instances until `leaseExpiresAt`; once expired, peer instance atomically reclaims (`attemptCount++`, new `leaseToken`), emits once, marks `DISPATCHED`. | Stale owner resuming later fails `{ status: 'CLAIMED', leaseToken }` check (`LEASE_LOST` / `ALREADY_DISPATCHED`) and emits nothing. |
| **Crash C (Before Socket.IO emission / Operational throw)** | Hard crash: `CLAIMED` (`terminalAt: null`). Operational error: released to `PENDING` with `lastError` & `nextAttemptAt`. | Hard crash recovers after `leaseExpiresAt`; operational error retries automatically after `retryBackoffMs`. | Pre-emit fence re-verifies `leaseToken`, absence of `MEETING_ENDED`, and live `Meeting` status immediately prior to Socket.IO emit. |
| **Crash D (After Socket.IO emission, before `DISPATCHED`)** | `CLAIMED`, `terminalAt: null` | Peer instance reclaims after `leaseExpiresAt` and redelivers with the **exact same `eventId`** (at-least-once), then marks `DISPATCHED`. | `MeetingRoomPage.tsx` and `PreJoinLobbyPage.tsx` deduplicate by `eventId` (and upsert by `userId`), making duplicate delivery strictly idempotent. |
| **Termination while `CLAIMED` (leased)** | `endMeeting` / last-host `leaveMeeting` / expiration atomically flips `status: { $in: ['PENDING', 'CLAIMED'] }` to `SUPPRESSED`, sets `suppressedAt`/`terminalAt`, clears `leaseToken`. | Leased dispatcher's pre-emit fence detects `SUPPRESSED` / `MEETING_ENDED`, aborts admission with `410 MEETING_ENDED`, and emits **zero** stale events. | Guaranteed across both single-instance and cross-instance Replica Set transactions (`RS-13`). |

---

## 4. TTL Index Definition & Retention Behavior

```ts
MeetingRealtimeEventSchema.index(
  { terminalAt: 1 },
  {
    name: 'terminalAt_ttl_24h',
    expireAfterSeconds: 86400, // 24 hours strictly for terminal records
    partialFilterExpression: {
      status: { $in: ['DISPATCHED', 'SUPPRESSED'] },
    },
  }
);
```

- **Double protection for non-terminal records:**
  1. `partialFilterExpression: { status: { $in: ['DISPATCHED', 'SUPPRESSED'] } }` excludes all `PENDING` and `CLAIMED` documents from the TTL index entirely.
  2. `terminalAt` is strictly `null` on `PENDING` and `CLAIMED` records (MongoDB's `TTLMonitor` only expires documents whose indexed field is a BSON `Date`).
- **Legacy index migration:** `ensureMeetingRealtimeOutboxReady()` inspects existing indexes on `meeting_realtime_events` at boot and drops any legacy `createdAt` TTL index before ensuring `terminalAt_ttl_24h`.
- **>24-hour outage recovery:** `PENDING` and expired `CLAIMED` records older than 24 hours remain intact in MongoDB. Upon restart after >24 hours:
  - Events for still-active meetings recover and dispatch cleanly, setting `terminalAt` only once `DISPATCHED`.
  - Events for meetings that expired or ended during the outage are suppressed (`SUPPRESSED`, `terminalAt` set) without emitting stale notifications.

---

## 5. New Test Results

### 5.1 Standalone Deterministic Outbox Audit Suite (`server/src/tests/meetingOutboxReliability.test.ts` — **6 / 6 PASS**)
1. **Crash A (before claiming):** Event remains `PENDING` (`terminalAt: null`, `attemptCount: 0`); peer dispatcher recovers from cold DB state and dispatches cleanly with matching `eventId`.
2. **Crash B (after claiming), Crash C (before emit), & operational emit error:** Hard crashes leave `CLAIMED` (`terminalAt: null`), respect active lease window, and recover on peer instance after `leaseExpiresAt`; transient Socket.IO error releases to `PENDING` with `lastError` & `nextAttemptAt` and succeeds on retry.
3. **Crash D (after emit, before `DISPATCHED`):** Recovers after lease expiry with honest at-least-once redelivery (`rawWireEmissions === 2`) carrying identical `eventId`; idempotent consumer applies logical admission once (`logicalAdmissionApplications === 1`); subsequent sweeps emit zero.
4. **Multi-instance claim contention & stale lease-owner fencing:** Two instances racing via `Promise.all` yield strictly 1 winner (`totalApproved === 1`); a stalled owner pausing past `leaseExpiresAt` fails the `leaseToken` fence and produces zero duplicate emission.
5. **Meeting termination during active `CLAIMED` lease:** Cross-instance `endMeeting()` atomically flips the leased `CLAIMED` record to `SUPPRESSED` (`suppressedAt`/`terminalAt` set, `leaseToken: null`); paused admission aborts with `410 MEETING_ENDED` and emits zero admission events.
6. **TTL safety & >24h outage recovery:** Confirmed legacy `createdAt_1` TTL index is dropped, `terminalAt_ttl_24h` partial filter matches `{ status: { $in: ['DISPATCHED', 'SUPPRESSED'] } }`, 26-hour-old `PENDING` & expired-`CLAIMED` records survive (`terminalAt: null`) and dispatch cleanly after restart, and >24h-old pending events for expired meetings transition to `SUPPRESSED` without emitting.

### 5.2 Real MongoDB 8.3 Replica Set ACID Transaction Tests (`scripts/test-phase09-replicaset.ts` — **13 / 13 PASS**)
- **`RS-12` (PASS):** Real Replica Set atomic `admitParticipant()` commit + hard crash after `PENDING -> CLAIMED` -> Instance B recovers expired lease cleanly, and verified `terminalAt_ttl_24h` partial TTL index (zero `createdAt` TTL index).
- **`RS-13` (PASS):** Real Replica Set `endMeeting()` ACID transaction atomically suppresses an actively `CLAIMED` admission lease (`SUPPRESSED`, `terminalAt` set, `leaseToken: null`) while Instance A aborts `410 MEETING_ENDED` with zero stale admission emissions.

---

## 6. Full Regression, Lint, Typecheck & Build Results

| Verification Check | Command | Result |
| --- | --- | --- |
| **Server Automated Suite (Standalone MongoDB 8.3)** | `npm test --workspace=server` | **169 / 169 PASS** (`22` suites, `0` fail, `0` cancelled, `0` skipped, `0` todo) |
| **Client Automated Suite** | `npm test --workspace=client` | **54 / 54 PASS** (`7` suites, `0` fail) |
| **Combined Automated Node Tests** | Server + Client | **223 / 223 PASS** (`29` suites; zero tests deleted or weakened) |
| **Real Ephemeral MongoDB 8.3 Replica Set Suite** | `node --import tsx scripts/test-phase09-replicaset.ts` | **13 / 13 PASS** (`RS-1`..`RS-13`) |
| **Typecheck (Client + Server)** | `npm run typecheck` | **PASS** (`0` errors) |
| **Client Lint** | `npm run lint --workspace=client` | **PASS** (`0` errors, `0` warnings) |
| **Production Build (Client + Server)** | `npm run build` | **PASS** (client `index`: `481.96 kB`, lazy `MeetingRoomPage`: `643.66 kB`; server `tsc`: `0` errors) |

---

## 7. Remaining Limitations

1. **Multi-Instance Socket.IO Cross-Node Fan-Out Adapter:** The MongoDB outbox guarantees crash-safe persistence, lease recovery, and per-meeting ordering into `MeetingRealtimeHub`, whereas cross-node Socket.IO client fan-out (e.g., Redis Socket.IO adapter when a waiting client is connected to Instance B while Instance A emits) remains a multi-instance production infrastructure requirement (mitigated in the meantime by `PreJoinLobbyPage.tsx`'s 5s authoritative REST fallback poll).
2. **At-Least-Once Delivery (Not Exactly-Once):** A hard crash strictly between Socket.IO `emit` and the MongoDB `CLAIMED -> DISPATCHED` commit causes one redelivery after `leaseDurationMs` with the same `eventId`; consumer-side idempotency handles this safely, and exactly-once delivery across network sockets is not claimed.
3. **Unbounded Retries on Permanent Non-Transient Errors:** Non-crash operational errors currently retry indefinitely after `retryBackoffMs` rather than silently dropping records; dead-letter alerting/thresholds can be added in Phase 18 production observability hardening.
4. **Production Deployment & Deferred Roadmap Scopes:** Multi-node MongoDB Replica Set failover/elections, public `wss://` TLS, VPC `:7880` firewall isolation, public NAT/TURN, Phase 15 E2EE, and Phase 17 load testing remain outside Phase 09 local verification.

---

**Final Confirmation:** **Phase 10 was NOT started.** Phase 09 is **NOT self-approved** and remains stopped at the Project Owner review gate.
