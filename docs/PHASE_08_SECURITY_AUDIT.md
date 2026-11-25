# CONNECTLY — Phase 08 Security Audit Report

**Phase:** 08 – Meeting Room Management  
**Audit Date:** 2026-11-18  
**Scope:** Meeting code entropy, REST authentication & RBAC, waiting-room isolation, Socket.IO channel security & post-commit event ordering, leave/removal socket eviction, input validation, rate limiting, and production dependency posture.

---

## 1. Cryptographic Meeting Code Security

- **Generator:** `server/src/utils/meetingCode.ts` (`generateSecureMeetingCode()`).
- **CSPRNG:** Uses Node.js `crypto.randomInt(0, CODE_ALPHABET.length)` exclusively. Zero use of `Math.random()`, sequential integers, or timestamps.
- **Entropy & Format:** 6 random characters drawn from a 31-character unambiguous lowercase alphanumeric alphabet (`abcdefghjkmnpqrstuvwxyz23456789`, omitting `0`, `1`, `i`, `l`, `o`), formatted as `cly-xxx-xxx` ($31^6 = 887{,}503{,}681$ combinations, ~29.7 bits of entropy per active window).
- **Uniqueness & Sanitization:** MongoDB unique index `{ meetingCode: 1 }` with up to 5 collision retries; `normalizeMeetingCode()` enforces `<= 300` chars and rejects HTML tags and `javascript:` / `data:` URI schemes.

---

## 2. Server-Side RBAC & Privilege Escalation Prevention

Every privileged operation verifies the caller's `MeetingParticipant` document in MongoDB (`admissionStatus === 'ADMITTED'` and server-stored `role`). Client-supplied role headers or payload fields are never accepted.

| Action | Host | Co-Host | Regular Participant | Waiting / Unadmitted |
| --- | --- | --- | --- | --- |
| View room state & admitted roster (`GET /state`, `GET /participants`) | Allowed | Allowed | Allowed | **403 FORBIDDEN** |
| View waiting room (`GET /waiting-room`) | Allowed | Allowed if `allowCoHostAdmit` | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Admit / reject waiting users | Allowed | Allowed if `allowCoHostAdmit` | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Remove regular participant | Allowed | Allowed if `allowCoHostRemove` | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Remove Host or another Co-Host | Host can remove Co-Host; cannot remove self | **403 FORBIDDEN** | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Promote / revoke Co-Host (`PATCH /role`) | Allowed | **403 FORBIDDEN** | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Lock / unlock room | Allowed | Allowed if `allowCoHostLock` | **403 FORBIDDEN** | **403 FORBIDDEN** |
| Edit room settings (`PATCH /settings`) | Allowed | **403 FORBIDDEN** | **403 FORBIDDEN** | **403 FORBIDDEN** |
| End meeting for all (`POST /end`) | Allowed | **403 FORBIDDEN** | **403 FORBIDDEN** | **403 FORBIDDEN** |

---

## 3. Socket.IO Real-Time Security, Eviction & Event Ordering

Inspected in `server/src/realtime/meetingSocket.ts` and verified by `meetingRealtime.test.ts` (6/6) and `meetingConcurrency.test.ts` (9/9):

- **Handshake Auth:** Rejects missing, malformed, or expired JWTs at `io.use(...)` before connection completes.
- **DB-Verified Subscription:** `meeting:subscribe` queries MongoDB for `Meeting` and `MeetingParticipant` using verified JWT `sub`. Non-members, `REMOVED`, `REJECTED`, `LEFT`, and `ENDED`/`EXPIRED` rooms are rejected.
- **Strict Channel Isolation:**
  - Waiting users join ONLY `meeting:<id>:waiting:<userId>` and `meeting:<id>:user:<userId>` — never `:admitted` or `:hosts`.
  - Regular admitted participants never join `:hosts` and never receive `meeting:waiting-room-updated`.
- **Immediate Channel Eviction on Membership Change:**
  - `leaveMeeting` (admitted departure or waiting cancel) calls `evictUserFromMeeting()` so departed Hosts/Co-Hosts' old open sockets immediately stop receiving `:hosts` and `:admitted` events (verified in `meetingConcurrency.test.ts` Test F).
  - `removeParticipant` immediately emits `meeting:participant-removed`, calls `evictUserFromMeeting()`, and blocks reconnect `meeting:subscribe` (`FORBIDDEN`) and REST rejoin (`403 PARTICIPANT_REMOVED`).
  - `updateParticipantRole` demoting a Co-Host immediately removes their sockets from `:hosts`.
  - `endMeeting` marks the meeting ended and evicts all admitted and waiting sockets.
- **Post-Commit Authoritative Event Ordering:**
  - Success events are NEVER broadcast prior to authoritative MongoDB commits.
  - Pre-emission DB verification + `endedMeetingIds` + monotonic `lastLockVersionByMeeting` suppress stale `locked`/`unlocked` events and post-termination `admission-approved`/`participant-joined` emissions (verified deterministically in Tests B1, C, D, and G).

---

## 4. Rate Limiting, Payload Bounds & Dependency Posture

| Control | Configuration | Verified |
| --- | --- | --- |
| Meeting Creation Limiter | 100 req / 15 min / IP (`meetingCreateLimiter`) | Yes |
| Meeting Action Limiter | 180 req / 1 min / IP (`meetingActionLimiter`) | Yes |
| Socket.IO Per-Socket Limiter | 30 events / 10 s / socket | Yes |
| JSON Body Size Limit | `100kb` global Express limit (Phase 07 preserved) | Yes |
| Input Validation | Zod `4.6.7` (`z.strictObject`, mass-assignment blocked) | Verified via `npm ls zod` & `zodSecurity.test.ts` (6/6) |
| Production Dependency Audit (`npm audit --omit=dev`) | **0 critical, 0 high**, **2 pre-existing moderate** (`react-router` `6.0.0–7.17.0`: `GHSA-wrjc-x8rr-h8h6` open redirect via backslash — mitigated via `sanitizeRedirectPath` in Phase 06 — and `GHSA-337j-9hxr-rhxg` SSR hydration `deserializeErrors`, not used by CONNECTLY SPA) | Verified (`socket.io` & `socket.io-client` have 0 advisories) |

---

## 5. Known Security & Consistency Limitations

1. **In-Process Rate Limit & Socket State:** `express-rate-limit` stores and `MeetingRealtimeHub` maps (`activeSocketsByMember`, `endedMeetingIds`, `lastLockVersionByMeeting`) are in-process; Redis adapters are deferred to multi-instance production scaling (Phase 18).
2. **Non-Transactional DB-to-Socket Coupling:** While MongoDB commits always precede broadcasts and stale/post-end events are suppressed via DB re-reads and monotonic version checks, a hard process crash between a DB commit and its Socket.IO emit relies on client reconnect state synchronization (`GET /api/v1/meetings/:code/state`).
3. **Pre-Existing `react-router` v6 Moderate Advisories:** Major upgrade to `react-router` v7 remains deferred outside Phase 08 to protect Phase 05–07 routing stability.
4. **Media E2EE:** E2EE/SFrame belongs to Phase 15; Phase 08 implements authenticated room governance only.
