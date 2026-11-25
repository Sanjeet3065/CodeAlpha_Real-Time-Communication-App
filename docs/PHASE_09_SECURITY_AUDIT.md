# CONNECTLY — Phase 09 Security Audit Report

**Phase:** 09 – WebRTC + LiveKit Integration  
**Audit Date:** 2026-11-18 (Updated following Final Distributed Revocation Correction, MongoDB Transaction Atomicity, Non-Skipping Gap Fail-Closed Hardening, and Real Replica Set Change Stream Verification)  
**Deployed & Verified Versions:** `livekit-server-sdk@2.20.0` (backend), `livekit-client@2.24.1` (frontend), self-hosted `livekit-server version 1.13.11` (OSS binary compiled from `github.com/livekit/livekit@v1.13.11`), MongoDB `8.3` (verified separately on both standalone dev topology and ephemeral single-node Replica Set).

---

## 1. Executive Security Finding: Self-Hosted LiveKit `v1.13.11` Token Revocation Audit

### 1.1 Source-Code & Experimental Investigation (`livekit-server-sdk@2.20.0` vs. `livekit-server v1.13.11`)

An independent security audit inspected both the installed SDK (`livekit-server-sdk@2.20.0`) and the compiled LiveKit Server `v1.13.11` Go source code, and executed live multi-browser token-reuse experiments:

1. **SDK Protocol Support (`livekit-server-sdk@2.20.0`):** `RoomServiceClient.removeParticipant(room, identity, { revokeTokenTs?: bigint })` exposes `revokeTokenTs` (`int64 revoke_token_ts = 3` in `livekit.RoomParticipantIdentity`).
2. **Self-Hosted Server Reality (`github.com/livekit/livekit@v1.13.11`):**
   - Searching the entire `livekit@v1.13.11` Go source tree for `RevokeTokenTs` / `revoke_token_ts` returned **0 occurrences**.
   - `pkg/service/roomservice.go:226-247` checks `HasParticipant` (returning `404 participant does not exist` when offline, even when `revokeTokenTs` is supplied) and forwards to `roommanager.go:861-870`, which only disconnects the active peer (`SERVICE_REQUEST_REMOVE_PARTICIPANT`) without storing any revocation cutoff.
   - `pkg/service/auth.go:86-117` (`APIKeyAuthMiddleware`) verifies only JWT HMAC signature, `nbf`, and `exp` via `v.Verify(secret)` — there is no revocation table in OSS `v1.13.11`.
3. **Experimental Pre-Mitigation Proof (Raw `ws://127.0.0.1:7880`):**
   - Host removed Guest via CONNECTLY's Phase 08 `DELETE /api/v1/meetings/:code/participants/:id` (`200 OK`).
   - Guest was disconnected (`Disconnected`, reason `4` = `PARTICIPANT_REMOVED`) and denied new CONNECTLY tokens (`403 PARTICIPANT_REMOVED`).
   - **HOWEVER**, reconnecting directly to raw `ws://127.0.0.1:7880` using the **exact original unexpired JWT** succeeded (`reconnected: true`, `remoteCount: 1`) in:
     - Same browser context (without requesting a new token).
     - Fresh isolated Chrome browser context.
     - After calling `removeParticipant(room, identity, { revokeTokenTs: now + 5s })` while online (LiveKit logged `"revokeTokenTs": 1794970853`, returned `200`, and still started a new RTC session 2 seconds later with the old JWT).
     - After a full browser disconnect + `removeParticipant(..., { revokeTokenTs })` while offline (LiveKit returned `404 participant does not exist`, and reconnecting with the original JWT succeeded).

### 1.2 Implemented Mitigation: Authoritative Signaling Admission Gateway + Signed `tokenEpoch` + Cloud `revokeTokenTs`

To block old-token reuse on self-hosted LiveKit **without disrupting Host or any other admitted participant** (with exact atomic admission-vs-removal linearization and bounded asynchronous cross-instance event propagation, **NOT** a universal 0 ms cross-node claim):

1. **Authoritative LiveKit Signaling Admission Gateway ([livekitSignalGateway.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/realtime/livekitSignalGateway.ts)):**
   - Mounted on CONNECTLY's HTTP/WebSocket server at `/livekit-signal` (`HEAD /livekit-signal`, `GET /livekit-signal/rtc[/v1]/validate`, and WebSocket `UPGRADE /livekit-signal/rtc[/v1]`), leaving `/socket.io` untouched.
   - Automatically enabled (`LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto`) for all self-hosted LiveKit deployments (non-`*.livekit.cloud` hosts); browsers receive `livekitUrl: ws(s)://<api-host>/livekit-signal`.
   - **Pre-Admission Gate (executes BEFORE any packet reaches LiveKit SFU):** Cryptographically verifies the LiveKit JWT (`TokenVerifier`), validates opaque room/identity mapping, queries authoritative MongoDB (`Meeting` + `MeetingParticipant`), and rejects with HTTP `403` / `410` if:
     - Meeting is `ENDED` or `EXPIRED` (`410 LIVEKIT_MEETING_ENDED`).
     - Participant is `REMOVED` (`403 PARTICIPANT_REMOVED`) or not `ADMITTED` (`403 LIVEKIT_ACCESS_DENIED`).
     - Signed JWT `metadata.epoch` does not match MongoDB `MeetingParticipant.tokenEpoch` (`403 LIVEKIT_TOKEN_REVOKED`).
     - JWT `nbf` predates `MeetingParticipant.tokenRevokedBefore` (`403 LIVEKIT_TOKEN_REVOKED`).
   - **Per-Participant Socket Termination:** On removal or leave, only the removed/departed participant's active proxied signaling sockets are closed (`disconnectParticipantSockets`), leaving Host and all other admitted participants connected with **zero disruption**.
   - **Zero JWT Log Leakage:** [requestLogger.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/middlewares/requestLogger.ts) redacts `access_token`, `token`, and `join_request` query parameters before logging.
2. **Monotonic Signed `tokenEpoch` & Post-Generation TOCTOU Guard:**
   - `MeetingParticipant` stores `tokenEpoch` (default `1`, atomically `$inc: 1` on `removeParticipant` and `leaveMeeting`) and `tokenRevokedBefore`.
   - Every LiveKit JWT embeds `epoch` inside HMAC-signed `metadata`, and `issueLiveKitToken` re-verifies `admissionStatus === 'ADMITTED'` AND `tokenEpoch === expectedTokenEpoch` after room provisioning before returning any token.
   - Permanently invalidates pre-departure unexpired JWTs even if a user leaves and legitimately rejoins within the same second.
3. **LiveKit Cloud `revokeTokenTs` Compatibility:**
   - `LiveKitService.removeParticipant` forwards `{ revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1) }` so LiveKit Cloud deployments also benefit from native Cloud control-plane token revocation.

### 1.3 Explicit Security State Distinction Matrix

| Security Dimension | Self-Hosted `v1.13.11` via CONNECTLY `/livekit-signal` Gateway (Default) | Direct to Raw Self-Hosted `v1.13.11` (`:7880` if exposed) | Managed LiveKit Cloud (`*.livekit.cloud`) |
| --- | --- | --- | --- |
| **Participant disconnected** | **YES — Immediate** (`removeParticipant` + per-participant gateway socket teardown; zero disruption to other peers) | **YES — Immediate** (while online; `404` when offline) | **YES — Immediate** |
| **Existing JWT revoked** | **YES — Immediate at Gateway** (`admissionStatus=REMOVED` + `tokenEpoch` mismatch + `tokenRevokedBefore` checked pre-handshake) | **NO — Not supported by OSS `v1.13.11`** (`revokeTokenTs` ignored) | **YES — Cloud control plane** (via `revokeTokenTs`, 10-min Cloud window) |
| **Existing JWT still valid** | **NO at Gateway** (cryptographically signed, but permanently rejected with HTTP `403` pre-upgrade) | **YES** (remains valid at raw `:7880` until `exp`, default `600s`) | **NO** (rejected by Cloud `nbf < revoke_token_ts` cutoff) |
| **New token request denied** | **YES — Immediate** (`403 PARTICIPANT_REMOVED`; stale in-flight requests also rejected) | **YES — Immediate** (`403 PARTICIPANT_REMOVED` from CONNECTLY API) | **YES — Immediate** (`403 PARTICIPANT_REMOVED`) |
| **Old-token reconnection** | **DENIED (HTTP `403`)** across same browser, auto-reconnect, fresh browser context, and offline-then-removed | **STILL POSSIBLE** if client network can directly reach raw `:7880` | **DENIED** by LiveKit Cloud control plane |

> **Mandatory Self-Hosted Production Network Boundary:** Because self-hosted LiveKit Server `v1.13.11` itself lacks native JWT revocation, production self-hosted deployments **MUST** bind LiveKit's raw HTTP/WS signaling port (`7880`) to a private loopback/VPC interface reachable **only** by the CONNECTLY Signaling Admission Gateway (never directly from untrusted client browsers). Only ICE/WebRTC media ports (`7881/TCP`, UDP media range) are exposed, and WebRTC media cannot be established without completing the gateway-authorized `/rtc` signaling handshake.

### 1.4 Final Gateway Race-Condition, Bypass & Fail-Closed Audit (7-Boundary Verification)

A focused follow-up audit identified and resolved four subtle gateway concurrency and deployment edge cases:

1. **7-Boundary Handshake-vs-Removal TOCTOU Race (Fixed & Barrier-Tested):**
   - *Vulnerability found:* Previously, if `removeParticipant` ran after initial gateway authorization but before upstream WebSocket upgrade completed, `disconnectParticipantSockets` saw zero registered sockets and the late-completing upstream `101` could leave a removed participant connected.
   - *Fix implemented ([livekitSignalGateway.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/realtime/livekitSignalGateway.ts)):*
     - Tracks every in-flight handshake (`pendingByParticipant` / `pendingByMeeting`) immediately upon initial authorization so `disconnectParticipantSockets` / `disconnectMeetingSockets` / `close()` aborts pending upstream requests instantly.
     - Executes an authoritative pre-upstream MongoDB re-check AND a **mandatory post-handshake MongoDB revalidation** (`revalidateParticipantAccess`) AFTER registering `(clientSocket, proxySocket)` and BEFORE sending `HTTP/1.1 101 Switching Protocols` to the client.
     - If removal committed on the same instance OR on another API instance (cross-instance MongoDB), the upgraded upstream socket is destroyed, HTTP `403`/`410` is returned (never `101`), and best-effort `livekit.removeParticipant` is invoked.
   - *Verified deterministically ([livekitGatewaySecurity.test.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/tests/livekitGatewaySecurity.test.ts) Tests 1–2):* All 7 exact boundaries (`beforeAuthorize`, `afterAuthorize`, `beforeUpstreamConnect`, `duringUpstreamHandshake`, `afterUpstreamHandshake`, `duringSocketRegister`, `afterSocketRegister`), cross-instance removal, and a simultaneous 5x connection burst with the same old JWT leave **0** active removed sockets while Host remains connected uninterrupted.
2. **Half-Open Socket Cleanup & Graceful Shutdown (Fixed & Verified):**
   - Added `'end'` listeners alongside `'close'`/`'error'` so TCP FIN from either peer immediately destroys and untracks both sockets (`getActiveSocketCount() === 0`).
   - Added `livekitSignalGateway.close()` and wired it into `server/src/server.ts`'s graceful `SIGTERM`/`SIGINT` shutdown handler (`getActiveSocketCount() === 0`, subsequent upgrades receive `503`).
3. **Alternate Route Locking & Fail-Closed MongoDB (Fixed & Verified):**
   - All alternate WebSocket upgrade routes (`/rtc`, `/rtc/v1`, `/livekit-signal/rtc/v2`, `/livekit-signal/*`) and unknown HTTP routes return `404` without reaching LiveKit (leaving `/socket.io` untouched).
   - MongoDB query errors inside `authorizeLiveKitSignalHandshake` / `revalidateParticipantAccess` strictly fail CLOSED (`503 LIVEKIT_AUTH_UNAVAILABLE`).
   - Missing/malformed `epoch` metadata, cross-meeting metadata mismatches, and outsider tokens are rejected (`403`).
4. **Anti-Bypass Production Transport Enforcement (Fixed & Verified):**
   - `env.ts` and `validateLiveKitConfig` reject `LIVEKIT_SIGNAL_GATEWAY_ENABLED=false` for self-hosted production deployments (preventing silent gateway bypass) and enforce `wss://` for `LIVEKIT_PUBLIC_URL` / production gateway URLs.
   - Removed client-side `VITE_LIVEKIT_URL` direct fallback in `useLiveKitConnection.ts` and `livekitClient.ts` so browsers strictly use the authoritative backend `livekitUrl`.
   - Local development verification (real loopback `127.0.0.1:7880` behind `localhost:5000/livekit-signal`) is explicitly distinguished from production infrastructure verification (TLS reverse proxy + VPC port `7880` firewall isolation, documented in `PHASE_09_LIVEKIT_SETUP.md` and verified during Phase 18 Deployment).

### 1.5 Cross-Instance Distributed Revocation, Atomic Linearization, Transactional Sequencing & Non-Skipping Gap Audit

A final distributed-systems audit verified and hardened the exact source code of `livekitRevocationCoordinator.ts`, `LiveKitRevocationEvent.model.ts`, `livekitSignalGateway.ts`, `MeetingParticipant.model.ts`, and `meeting.service.ts`:

1. **Atomic MongoDB Linearization Point (`claimSignalingAdmissionFence` vs. `removeParticipant`, `leaveMeeting`, `endMeeting`, & Expiration):**
   - *Key distributed-systems fact:* Neither a MongoDB read followed by an OS socket `write(101)`, nor `coordinator.syncNow()` alone, provides cross-instance linearizability. There is **NO universal 0 ms cross-node revocation guarantee**.
   - *Exact linearization point implemented:*
     - Both signaling admission (`claimSignalingAdmissionFence`) and participant removal/departure (`removeParticipant`, `leaveMeeting`) execute an **atomic conditional single-document `findOneAndUpdate`** on the exact same `MeetingParticipant` document, incrementing monotonic `signalFenceVersion` (and `tokenEpoch` on removal/leave/re-admission).
     - `endMeeting()` and `findMeetingAndEnforceExpiration()` ALSO increment `tokenEpoch` and `signalFenceVersion`, set `tokenRevokedBefore`, and publish a durable `MEETING_ENDED` revocation event. `claimSignalingAdmissionFence()` executes a **post-fence `Meeting` status & `expiresAt` verification** strictly AFTER `MeetingParticipant.findOneAndUpdate`, closing the cross-collection race between meeting termination/expiration and admission.
     - **Case A — Removal / Leave / Meeting End / Expiration linearizes BEFORE Admission:** `claimSignalingAdmissionFence()` atomically fails (returns `403`/`410`), destroys the upstream socket, and **NEVER emits `HTTP 101`** — even if the gateway's revocation notification delivery is paused.
     - **Case B — Admission linearizes BEFORE Removal / Meeting End:** Admission committed `signalFenceVersion = k` before removal committed `admissionStatus = 'REMOVED'` (or `Meeting.status = 'ENDED'`). **Unavoidable propagation interval (explicitly disclosed):** If a gateway process stalls *after* winning `claimSignalingAdmissionFence()` and *before* kernel `clientSocket.write(101)` while asynchronous cross-instance event delivery is delayed, `HTTP 101` reflects the pre-removal linearized admission and the already-registered socket pair is unconditionally terminated once the durable revocation event propagates via Change Stream or durable cursor sweep (or via defense-in-depth `revalidateActiveSockets()`).
     - **Fail-Closed Fence & Publish Error Resilience:** MongoDB errors inside `claimSignalingAdmissionFence()` return `503 LIVEKIT_FENCE_UNAVAILABLE`. On a Replica Set, `removeParticipant()` and `endMeeting()` execute participant/meeting mutation + counter allocation + revocation event insertion inside **one MongoDB ACID transaction** (aborting cleanly on DB failure with zero partial state). In non-production standalone mode, if `publishLiveKitRevocation()` fails after a DB mutation, `meeting.service.ts` still executes local socket teardown, LiveKit SFU eviction, and Socket.IO notification, marks the local coordinator unhealthy (fail-closed), throws `503 LIVEKIT_REVOCATION_PUBLISH_FAILED`, and remote gateways enforce bounded defense-in-depth `revalidateActiveSockets()` so a removed participant cannot remain connected indefinitely.
2. **Atomic Sequence Allocation & Event Insertion (MongoDB ACID Transactions — Zero Leaked Gaps):**
   - *Prior vulnerability corrected:* Previously, `allocateNextRevocationSeq()` and `LiveKitRevocationEvent.create()` were separate operations, allowing a crash or slow pause between them to create a sequence gap `N` before `N+1`.
   - *Fix implemented (`LiveKitRevocationEvent.model.ts`, `livekitRevocationCoordinator.ts`):*
     - On MongoDB Replica Sets / sharded clusters (mandatory in `NODE_ENV=production` or `transactionPolicy: 'required'`), `LiveKitRevocationCounter.$inc` and `LiveKitRevocationEvent.create` execute inside a **single ACID MongoDB transaction** (`readConcern: majority`, `writeConcern: majority`).
     - *Crash-consistency & ordering proof:* WiredTiger acquires an exclusive write lock on the single `LiveKitRevocationCounter` document (`_id: 'livekit_revocation_global_seq'`) until the transaction commits or aborts. A crash/failure before commit rolls back BOTH the counter increment and event insert (zero orphaned sequence `N`). Concurrent multi-instance publishers serialize cleanly on the counter lock with `WriteConflict` retries so event `N` commits before `N+1` can be allocated.
     - *No silent non-atomic fallback:* If a transaction fails, `publishLiveKitRevocation()` throws `503 LIVEKIT_REVOCATION_TRANSACTION_FAILED` without falling back to non-atomic writes. If `NODE_ENV=production` (or `transactionPolicy: 'required'`) runs against standalone MongoDB, both `publishLiveKitRevocation()` (`503 LIVEKIT_REVOCATION_TRANSACTION_REQUIRED`) and `LiveKitRevocationCoordinator.start({ requireTransactions: true })` fail closed immediately.
3. **Corrected Missing-Sequence, Late-Event & Durable Cursor Handling:**
   - *Prior vulnerability corrected:* Previously, `advanceExpiredGaps()` added unseen sequences to `dispatchedSeqs` after `gapSkipGraceMs`, silently advancing `lastContiguousSeq` and permanently discarding late-arriving events.
   - *Fix implemented (`livekitRevocationCoordinator.ts`):*
     - **Missing sequences are NEVER skipped or marked dispatched.** `lastContiguousSeq` advances strictly across actually delivered consecutive sequences.
     - Both `seq <= lastContiguousSeq` and `dispatchedSeqs.has(seq)` enforce exact deduplication safely even after memory pruning.
     - `syncNow()` sweeps in paginated batches of 500 AND checks `LiveKitRevocationCounter` to detect both mid-stream gaps and total trailing TTL retention wipeouts.
     - If any missing sequence persists past `gapFailClosedGraceMs` (or predates an aged higher event), the coordinator transitions immediately to **UNHEALTHY / FAIL-CLOSED** (terminating active/pending sockets and rejecting new upgrades with `503`) rather than skipping the gap. If the delayed event later arrives, it **IS delivered** (never silently discarded) and closes the gap cleanly.
     - **Durable Cursor Persistence (`LiveKitRevocationCursor`):** Coordinators configured with `instanceId` persist `{ lastContiguousSeq, resumeToken }` in MongoDB for automatic restart recovery without relying on in-memory state.
     - **Re-Admission Epoch Isolation:** `admitParticipant()` and `joinMeeting()` re-admission strictly increment `tokenEpoch` and `signalFenceVersion`, ensuring delayed old-epoch revocation events (`entry.tokenEpoch < event.revokedEpoch`) never terminate newer legitimate sessions.
     - **Stalled-Delivery Watchdog:** `isHealthy()` checks both DB failure thresholds and `Date.now() - lastSuccessfulSyncAt > maxStaleDeliveryMs`.

4. **Critical Source Audit Hardening (Tasks 1–6):**
   - **Task 1 — Crash-Safe Change Stream Checkpointing (`livekitRevocationCoordinator.ts`):** `stagedResumeTokensBySeq` + `promoteContiguousResumeToken()` ensures `lastResumeToken` is NEVER promoted or persisted until listeners finish processing the event AND `lastContiguousSeq` strictly covers that `seq` (never advancing while `deliveryPaused === true` or past an unresolved lower gap). Change stream event processing (`changeProcessChain`) and checkpoint writes (`checkpointWriteChain`) are serialized with conditional monotonic MongoDB updates (`lastContiguousSeq: { $lte: targetSeq }`) so polling recovery and Change Stream recovery cannot race into an unsafe checkpoint.
   - **Task 2 — Fail-Closed Active Revalidation & Zero Destructive Handshake Side Effects (`livekitSignalGateway.ts`):** MongoDB errors inside `revalidateActiveSockets()` now fail closed (closing active/pending sockets upon reaching `maxRevalidationFailures`, default `1`) instead of silently keeping sockets authorized. All 8 non-removal `livekit.removeParticipant()` calls in handshake failure/fence/proxy branches were removed so transient signaling errors never evict legitimate SFU sessions. Socket tracking cleanup (`untrackSockets`) is hoisted and invoked consistently across every reject/error/close path, and `.pipe()` ordering ensures buffered upstream LiveKit `join` frames are never dropped before piping.
   - **Task 3 — Atomic Waiting-Room Admission (`meeting.service.ts` `admitParticipant()`):** On Replica Sets, meeting status/expiry/capacity validation, actor membership/role/waiting-room revalidation (using a conditional write touch on the actor's `MeetingParticipant` doc to catch concurrent demotion/removal via WiredTiger write conflict), capacity reservation, `WAITING -> ADMITTED` transition (`tokenEpoch` + `signalFenceVersion` incremented once), and transactional outbox insert execute in **one MongoDB ACID transaction**. Production/required mode fails closed (`503 TRANSACTION_REQUIRED`) instead of falling back to non-atomic writes; standalone dev/test mode remains isolated with explicit capacity rollback.
   - **Task 4 & Final Outbox Reliability Audit — Recoverable Lease-Based Transactional Outbox & Terminal-Only TTL (`MeetingRealtimeEvent.model.ts`, `meetingOutboxDispatcher.ts`, `meetingSocket.ts`, `meeting.service.ts`, `server.ts`, `MeetingRoomPage.tsx`, `PreJoinLobbyPage.tsx`):** Waiting-room admissions write a `PENDING` outbox record (`terminalAt: null`, stable unique `eventId`) inside the admission transaction. `MeetingRealtimeOutboxDispatcher` executes an explicit recoverable lease state machine (`PENDING -> CLAIMED -> DISPATCHED | SUPPRESSED`) with `leaseOwner`, `leaseToken`, `leaseExpiresAt`, `attemptCount`, `nextAttemptAt`, and per-meeting serialized ordering (`runMeetingLifecycleOrdered`). Expired leases recover automatically across instances (honest **at-least-once** delivery with `eventId`-idempotent consumers). `endMeeting()`, last-host `leaveMeeting()`, and `findMeetingAndEnforceExpiration()` atomically suppress **BOTH `PENDING` and `CLAIMED`** admission records (`suppressedAt` & `terminalAt` set, lease cleared) and propagate `MEETING_ENDED` across instances. The 24h TTL index (`terminalAt_ttl_24h`) uses `partialFilterExpression: { status: { $in: ['DISPATCHED', 'SUPPRESSED'] } }` on nullable `terminalAt` (and drops any legacy `createdAt_1` TTL index on startup), ensuring `PENDING`/`CLAIMED` records NEVER expire even across >24-hour outages.
   - **Task 5 — Atomic Leave Meeting (`meeting.service.ts` `leaveMeeting()`):** On Replica Sets, participant `LEFT` transition (`tokenEpoch`/`signalFenceVersion` bump), `activeParticipantCount` decrement, deterministic host succession (earliest-joined admitted co-host, else earliest-joined admitted participant), automatic last-host termination (guarded by `activeParticipantCount: 0` against concurrent joins), waiting-room cancellation, outbox suppression, and durable `PARTICIPANT_LEFT`/`MEETING_ENDED` revocation event execute in **one MongoDB ACID transaction** (fail-closed `503 TRANSACTION_REQUIRED` if standalone in production/required mode).
   - **Task 6 — Isolated Removal Post-Commit Cleanup (`meeting.service.ts` `removeParticipant()`):** Extracted `executeRemovalPostCommitCleanup()` with independent `try/catch` blocks across both Replica Set and standalone paths so local signaling sockets ALWAYS disconnect even if Socket.IO notification or LiveKit SFU eviction fails; structured errors (`meetingId`, `participantId`, `operation`) and an honest `RemovalCleanupReport` ensure failed external cleanup is never silently masked as success.

### 1.6 Verification Scope & Environment Separation Matrix

To prevent conflating mocked, local, and production guarantees, every Phase 09 verification layer is documented separately:

| Verification Category | Exact Scope & What It Proves | Actual Executed Result | What It Does NOT Prove |
| --- | --- | --- | --- |
| **Verified Source-Code Guarantees** | ACID transaction coupling (`LiveKitRevocationCounter` + `LiveKitRevocationEvent` + `removeParticipant`/`admitParticipant`/`leaveMeeting`/`endMeeting`), crash-safe monotonic `resumeToken` checkpointing, transactional `MeetingRealtimeEvent` outbox, atomic `claimSignalingAdmissionFence` + post-fence `Meeting` check, non-skipping gap fail-closed, fail-closed `revalidateActiveSockets()`, zero destructive handshake `removeParticipant()` calls, isolated post-commit removal cleanup, query-param redaction. | Audited directly in `livekitSignalGateway.ts`, `livekitRevocationCoordinator.ts`, `LiveKitRevocationEvent.model.ts`, `MeetingRealtimeEvent.model.ts`, `MeetingParticipant.model.ts`, `meetingSocket.ts`, `meeting.service.ts`, `server.ts`. | Runtime production topology compliance until deployed. |
| **Standalone MongoDB Automated Node Tests** | 21 server suites (`163/163`) + 7 client suites (`54/54`) = **`217/217` PASS** (`0 failed`, `0 skipped`, `0 todo`) including 10-scenario `livekitDistributedRevocationAudit.test.ts` and 7-scenario `livekitCriticalAuditRegression.test.ts` (checkpoint crash safety, fail-closed active revalidation, zero destructive handshake SFU evictions, stale actor & rollback admission guards, 4-boundary admission-vs-termination outbox race, host leave succession & concurrent join guard, isolated removal cleanup failure reporting). | **PASS (`217/217`)** on standalone MongoDB 8.3. | Does not exercise MongoDB Replica Set Change Streams or multi-document transactions (tested separately below). |
| **Mock LiveKit Upstream Gateway Tests** | `livekitGatewaySecurity.test.ts` (5), `livekitCrossInstanceRevocation.test.ts` (7), `livekitPostSyncFencing.test.ts` (6), `livekitDistributedRevocationAudit.test.ts` (10), `livekitCriticalAuditRegression.test.ts` (7), and gateway sockets in `test-phase09-replicaset.ts` use a local mock HTTP/WS `101` upstream server for deterministic barrier control. | **PASS** across all deterministic concurrency barriers. | **NOT proof of a real LiveKit SFU deployment** (real SFU tested separately below). |
| **Real MongoDB 8.3 Replica Set ACID Transaction & Change Stream Tests** | `node --import tsx scripts/test-phase09-replicaset.ts` on an ephemeral local single-node MongoDB 8.3 Replica Set (`connectlyRsAudit`): `RS-1`..`RS-6` (ACID rollback on crash after alloc, WiredTiger counter-lock serialization, atomic `removeParticipant` rollback, pure Change Stream push, disconnect + `resumeAfter` catch-up, coordinator restart) + `RS-7`..`RS-11` (Change Stream crash-safe `resumeToken` checkpointing & paused delivery, atomic `admitParticipant` rollback & demoted co-host write-conflict block, transactional outbox suppression on cross-instance `endMeeting`, atomic `leaveMeeting` host succession & last-host auto-end, isolated Replica Set `removeParticipant` cleanup when realtime emit fails). | **PASS (`11/11`)** on local single-node MongoDB 8.3 Replica Set. | Does not test multi-node Replica Set primary stepdown/network partition failover in production. |
| **Real Self-Hosted LiveKit SFU `v1.13.11` Tests** | `test-phase09-livekit-real.mjs` (`6/6`), `test-phase09-token-reuse-audit.mjs` (`6/6` across 3+ isolated Chrome contexts via `/livekit-signal`), and Chrome CDP UI verification (`verify_phase_09_livekit.js`, `verify_phase_09_unavailable.js`, 11 screenshots) against genuine `livekit-server v1.13.11`. | **PASS** (`6/6` API, `6/6` old-JWT reuse audit, 11/11 CDP screenshots). | Localhost loopback only; not public internet NAT/TURN or production TLS. |
| **Production Network & Deferred Phase Requirements (NOT YET DEPLOYED)** | Multi-node production MongoDB Replica Set + oplog sizing, public TLS (`wss://`) reverse proxy, VPC firewall isolation blocking external access to raw `:7880`, public NAT/TURN ICE traversal, **Phase 15 E2EE (SFrame)**, **Phase 17 capacity/load testing**. | **NOT DEPLOYED / DEFERRED** to Phase 15, Phase 17, and Phase 18 respectively. | Not claimed as verified in Phase 09. |

---

## 2. Secret Management & Client Bundle Isolation

- **Server-Only Credentials:** `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` exist strictly in server environment variables (`server/src/config/env.ts`) and are NEVER returned by any API endpoint, Socket.IO event, or `VITE_` frontend variable.
- **Production Boot Fail-Safe:** In `NODE_ENV=production`, `env.ts` refuses to start if `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` is missing, uses an insecure scheme (`ws://` / `http://`), or uses placeholder/dev credentials (`devkey`, `secret`, `replace_with_*`).
- **No Mock Fallback:** When LiveKit configuration is absent, `POST /api/v1/meetings/:code/livekit-token` returns `503 LIVEKIT_NOT_CONFIGURED`.
- **Client Bundle, Web Storage & Log Verification:**
  - Compiled `client/dist/assets/*.js`: **0** secret occurrences.
  - Chrome CDP Web Storage (`localStorage` / `sessionStorage`): **0** LiveKit JWTs stored.
  - Express HTTP logs (`requestLogger.ts`): `access_token=[REDACTED]` verified live against real browser traffic.

---

## 3. Least-Privilege Token Permission Model (Phase 09 Boundary)

Verified cryptographically with LiveKit's `TokenVerifier` (`livekitService.test.ts` Tests 3 & 7, `livekitTokenAuth.test.ts` Test 3):

| Claim / Grant | Value Issued (All Roles) | Rationale |
| --- | --- | --- |
| `sub` (Identity) | `usr_<mongoUserId>` | Opaque internal ID; zero email/phone PII |
| `video.room` | `cly_room_<mongoMeetingId>` | Server-derived from MongoDB; client cannot choose room |
| `metadata` | `{"role":"...","meetingId":"...","epoch":N}` | HMAC-signed monotonic token epoch for immediate gateway revocation |
| `video.roomJoin` | `true` | Allows WebRTC signaling & room entry |
| `video.canPublish` | **`false`** | Media publishing strictly deferred to Phase 10 |
| `video.canSubscribe` | **`false`** | Media subscription strictly deferred to Phase 10 |
| `video.canPublishData` | **`false`** | Data channels deferred to later phases |
| `video.roomAdmin` / `roomCreate` / `roomList` / `roomRecord` | **`false`** | Never granted to any client role |
| TTL (`exp - nbf`) | **`600s` (10 min)** | Short-lived credential window |

---

## 4. Exact Reconciliation: 14 Server-Side Token Issuance Checks vs. 20 Tested Security Scenarios

Previous documentation cited **14 authorization checks** on the token endpoint and **18 security scenarios** in the test matrix without cross-referencing them. The exact 1-to-1 reconciliation is documented below.

### 4.1 The 14 Server-Side Token Issuance Gate Checks (`POST /api/v1/meetings/:meetingCode/livekit-token`)

| Check # | Layer & File | Exact Check Enforced | Failure Status / Code |
| ---: | --- | --- | --- |
| 1 | Middleware (`auth.middleware.ts`) | `requireAuth` — valid authenticated Bearer/session JWT | `401 UNAUTHORIZED` |
| 2 | Middleware (`csrf.middleware.ts`) | `validateRequestOrigin` — rejects untrusted `Origin`/`Referer` | `403 CSRF_INVALID_ORIGIN` / `CSRF_INVALID_REFERER` |
| 3 | Middleware (`rateLimiter.ts`) | `livekitTokenLimiter` — `60 req / 5 min / IP` | `429 RATE_LIMIT_EXCEEDED` |
| 4 | Middleware (`meeting.schema.ts`) | `livekitTokenRequestSchema = z.strictObject({})` — blocks forged `role`, `roomName`, `identity`, `userId`, `canPublish` | `400 VALIDATION_ERROR` |
| 5 | Service (`meeting.service.ts:1747`) | Valid MongoDB `ObjectId` for authenticated `userId` | `400 INVALID_IDENTIFIER` |
| 6 | Service (`meeting.service.ts:1751`) | Valid canonical meeting code (`cly-xxx-xxx`) + meeting exists in MongoDB | `400 INVALID_MEETING_CODE` / `404 MEETING_NOT_FOUND` |
| 7 | Service (`meeting.service.ts:1752`) | Meeting is neither `ENDED` nor `EXPIRED` (enforces expiration atomically) | `410 LIVEKIT_MEETING_ENDED` / `410 MEETING_EXPIRED` |
| 8 | Service (`meeting.service.ts:1772`) | Participant record exists (if absent and locked -> `MEETING_LOCKED`; else `LIVEKIT_ACCESS_DENIED`) | `403 MEETING_LOCKED` / `403 LIVEKIT_ACCESS_DENIED` |
| 9 | Service (`meeting.service.ts:1785`) | Participant `admissionStatus !== 'REMOVED'` | `403 PARTICIPANT_REMOVED` |
| 10 | Service (`meeting.service.ts:1792`) | Participant `admissionStatus === 'ADMITTED'` (rejects `WAITING`, `REJECTED`, `LEFT`, `CANCELLED`) | `403 LIVEKIT_ACCESS_DENIED` |
| 11 | Service (`meeting.service.ts:1801`) | Meeting capacity bound (`activeParticipantCount <= maxParticipants`) | `403 MEETING_FULL` |
| 12 | Service (`livekit.service.ts:276`) | LiveKit config present & production-valid (`assertConfigured`) | `503 LIVEKIT_NOT_CONFIGURED` |
| 13 | Service (`livekit.service.ts:309`) | LiveKit SFU room lazily provisioned & reachable (`ensureRoomExists`) | `503 LIVEKIT_UNAVAILABLE` |
| 14 | Service (`meeting.service.ts:1829`) | **Post-generation TOCTOU re-check:** re-reads MongoDB to confirm meeting not `ENDED`/`EXPIRED`, participant still `ADMITTED`, and `tokenEpoch` unchanged | `410 LIVEKIT_MEETING_ENDED` / `403 PARTICIPANT_REMOVED` / `403 LIVEKIT_ACCESS_DENIED` |

*(Plus **5 Pre-Handshake Signaling Gateway Checks** in `livekitSignalGateway.ts` on every `/livekit-signal/rtc[/v1]` validate & WebSocket upgrade: JWT cryptographic signature/exp, opaque room/identity parsing, live Meeting status, live Participant `ADMITTED` status, and signed `tokenEpoch` + `tokenRevokedBefore` validation.)*

### 4.2 The 20 Tested Security, Forgery & Revocation Scenarios

| Scenario # | Attack / Edge Case | Gate Check(s) Exercised | Enforced Outcome | Verification Source |
| ---: | --- | --- | --- | --- |
| 1 | Unauthenticated token request | Check #1 | `401 UNAUTHORIZED` | `livekitTokenAuth.test.ts` Test 1 |
| 2 | Untrusted `Origin` CSRF request | Check #2 | `403 CSRF_INVALID_ORIGIN` | `livekitTokenAuth.test.ts` Test 1 |
| 3 | Invalid meeting code format | Check #6 | `400 INVALID_MEETING_CODE` | `livekitTokenAuth.test.ts` Test 1 |
| 4 | Non-existent meeting | Check #6 | `404 MEETING_NOT_FOUND` | `livekitTokenAuth.test.ts` Test 1 |
| 5 | Non-member / outsider token request | Check #8 | `403 LIVEKIT_ACCESS_DENIED` | `livekitTokenAuth.test.ts` Test 2 & `test-phase09-livekit-real.mjs` |
| 6 | Waiting-room participant token request | Check #10 | `403 LIVEKIT_ACCESS_DENIED` | `livekitTokenAuth.test.ts` Test 2 & `test-phase09-livekit-real.mjs` |
| 7 | Rejected participant token request | Check #10 | `403 LIVEKIT_ACCESS_DENIED` | `livekitTokenAuth.test.ts` Test 2 |
| 8 | Removed participant new token request | Check #9 | `403 PARTICIPANT_REMOVED` | `livekitTokenAuth.test.ts` Test 2 & `test-phase09-livekit-real.mjs` |
| 9 | Left participant new token request | Check #10 | `403 LIVEKIT_ACCESS_DENIED` | `livekitTokenAuth.test.ts` Test 2 |
| 10 | Ended meeting token request | Check #7 | `410 LIVEKIT_MEETING_ENDED` | `livekitTokenAuth.test.ts` Test 4 & `test-phase09-livekit-real.mjs` |
| 11 | Locked meeting non-member token request | Check #8 | `403 MEETING_LOCKED` | `livekitTokenAuth.test.ts` Test 4 |
| 12 | Forged `identity`, `roomName`, `role`, or `canPublish` in request body | Check #4 | `400 VALIDATION_ERROR` | `livekitTokenAuth.test.ts` Test 1 |
| 13 | Removed participant original unexpired JWT reuse (same browser, fresh browser, offline-removed) via Gateway | Gateway Checks + `tokenEpoch` | **HTTP `403 PARTICIPANT_REMOVED`** pre-upgrade; Host uninterrupted | `livekitTokenAuth.test.ts` Test 7 & `test-phase09-token-reuse-audit.mjs` (6/6 PASS) |
| 14 | Pre-departure unexpired JWT reuse after `leaveMeeting` + legitimate rejoin | Gateway `tokenEpoch` Check | **HTTP `403 LIVEKIT_TOKEN_REVOKED`** | `livekitTokenAuth.test.ts` Test 8 |
| 15 | Concurrent token requests for same & distinct users | Checks #1–#14 | Clean parallel signing, zero corruption | `livekitTokenAuth.test.ts` Test 5 |
| 16 | Meeting terminated concurrently during token generation | Check #14 (barrier) | `410 LIVEKIT_MEETING_ENDED` (token discarded) | `livekitTokenAuth.test.ts` Test 5 |
| 17 | Participant removed concurrently during in-flight token generation | Check #14 (barrier) | `403 PARTICIPANT_REMOVED` (token discarded) | `livekitTokenAuth.test.ts` Test 8 |
| 18 | LiveKit configuration missing | Check #12 | `503 LIVEKIT_NOT_CONFIGURED` | `livekitService.test.ts` Test 4 & `livekitTokenAuth.test.ts` Test 6 |
| 19 | LiveKit server unavailable | Check #13 | `503 LIVEKIT_UNAVAILABLE` + honest `Connection failed` UI | `livekitService.test.ts` Test 5 & `verify_phase_09_unavailable.js` |
| 20 | Invalid/expired JWT or gateway `403` revoked rejection in client | Gateway + `livekitClient.ts` | Classified to `LIVEKIT_INVALID_TOKEN` / terminal `unauthorized` (`PARTICIPANT_REMOVED`) | `livekitClient.test.ts` Tests 3 & 6 |

*(Note: Rate limiter Check #3 is implemented via `livekitTokenLimiter` at `60 req / 5 min / IP` in `server/src/middlewares/rateLimiter.ts` and mounted on `meetings.routes.ts`.)*

---

## 5. Transport Encryption vs. End-to-End Encryption, Capacity Scope & Dependency Audit

- **Transport Encryption Only in Phase 09:** WebSocket signaling uses TLS (`wss://` in production) and WebRTC peer transport uses DTLS/SRTP. True **End-to-End Encryption (E2EE / SFrame)** is NOT implemented in Phase 09 and remains strictly scoped to **Phase 15**.
- **Capacity & Scale Testing Boundary:** Multi-region scale, high-concurrency media SFU load, and production multi-node MongoDB Replica Set failover capacity testing are NOT claimed in Phase 09 and remain strictly scoped to **Phase 17 (Performance & Load Testing)** and **Phase 18 (Deployment)**.
- **Production Dependency Audit (`npm audit --omit=dev`):**
  - `livekit-server-sdk@2.20.0`: **0 vulnerabilities**.
  - `livekit-client@2.24.1`: **0 vulnerabilities**.
  - `zod@4.6.7`: Patched and verified intact (`zodSecurity.test.ts` 6/6 PASS).
  - **2 pre-existing moderate advisories** remain disclosed in `react-router` v6 (`GHSA-wrjc-x8rr-h8h6` mitigated via `sanitizeRedirectPath`, and `GHSA-337j-9hxr-rhxg` SSR hydration unused by SPA).
