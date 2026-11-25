# CONNECTLY — PHASE 07 ATOMIC CONCURRENCY FINAL REPORT

**Phase:** Phase 07 – Backend & Database (18-Phase Finalized Roadmap — Scope Strictly Preserved)  
**Date:** 2026-11-18  
**Audit Scope:** Cross-Instance MongoDB Atomic Preference Updates, Two-Instance Concurrency Races, Client Timestamp Safety, Optimistic Concurrency (`expectedVersion`), Source-of-Truth Integrity, and Full Regression Verification  
**Final Verdict:** **COMPLETE — READY FOR OWNER REVIEW**

---

## 1. Exact Files Inspected and Modified

### 1.1 Files Audited
- [server/src/services/user.service.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/services/user.service.ts)
- [server/src/models/UserPreferences.model.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/models/UserPreferences.model.ts)
- [server/src/models/User.model.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/models/User.model.ts)
- [server/src/controllers/user.controller.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/controllers/user.controller.ts)
- [server/src/controllers/auth.controller.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/controllers/auth.controller.ts)
- [server/src/schemas/user.schema.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/schemas/user.schema.ts)
- [client/src/services/preferencesApi.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/client/src/services/preferencesApi.ts)
- [client/src/pages/SettingsPage.tsx](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/client/src/pages/SettingsPage.tsx)

### 1.2 Audit Findings Before Remediation
Inspecting the prior `UserService.updatePreferences()` implementation revealed three cross-instance race defects that an in-process `Map<string, Promise<unknown>>` queue could **not** protect against across multiple API instances:
1. **Read-Modify-Write Race on `fieldTimestamps`:** `UserPreferences.findOne({ userId })` read `fieldTimestamps` in JavaScript and then issued an unconditional `UserPreferences.findOneAndUpdate({ userId }, { $set: updateFields })`. Across two instances reading the same initial document, an older write finishing second would unconditionally overwrite a newer committed write.
2. **Read-Modify-Write Race on `expectedVersion`:** `currentVersion !== input.expectedVersion` was checked in JavaScript before issuing an unguarded `findOneAndUpdate({ userId })`. Two instances simultaneously submitting the same `expectedVersion` could both pass the JS check and both commit.
3. **Unconditional Legacy Mirror Overwrite:** `User.findByIdAndUpdate(userId, { $set: ... })` mirrored preferences without checking whether a newer version had already been mirrored by another instance.
4. **Future-Dated Timestamp Poisoning & Cross-Device Clock Skew:** `clientTimestamp` previously accepted arbitrarily large future integers without upper bounds or session scoping, meaning a skewed future client clock could silently block subsequent legitimate updates from other devices or after reload/restart.

### 1.3 Files Modified / Created
| File | Action | Purpose |
| :--- | :---: | :--- |
| [server/src/models/UserPreferences.model.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/models/UserPreferences.model.ts) | Modified | Added `fieldMeta` (`clientSessionId`, `serverUpdatedAt`, `lastWriteId`) per preference field alongside `fieldTimestamps` and `version`. |
| [server/src/models/User.model.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/models/User.model.ts) | Modified | Added internal `preferencesVersion` counter to guard non-clobbering legacy mirroring. |
| [server/src/schemas/user.schema.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/schemas/user.schema.ts) | Modified | Enforced strict finite/integer/range bounds on `clientTimestamp` (`0..4_102_444_800_000`), safe `expectedVersion`, and optional validated `clientSessionId` (`^[a-zA-Z0-9_-]{1,64}$`). |
| [server/src/services/user.service.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/services/user.service.ts) | Modified | Replaced JS read-then-write with **single atomic MongoDB aggregation-pipeline `findOneAndUpdate`**, atomic `filter.version = expectedVersion`, server-clock future-skew guard (`MAX_FUTURE_CLOCK_SKEW_MS = 30_000`), `STALE_RACE_WINDOW_MS = 15_000` recovery window, and version-guarded `User.updateOne` mirroring. |
| [client/src/services/preferencesApi.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/client/src/services/preferencesApi.ts) | Modified | Added per-load `clientSessionId`, `resetClientSession()`, and server-clock offset calibration from `meta.timestamp` in `nextClientTimestamp()`. |
| [server/src/tests/atomicConcurrency.test.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/tests/atomicConcurrency.test.ts) | Created | 8 deterministic cross-instance concurrency, timestamp safety, optimistic concurrency, and mirror-race tests using two independent `UserService` instances and two independent Express HTTP servers sharing MongoDB. |
| [server/src/tests/preferences.test.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/tests/preferences.test.ts) | Modified | Adjusted synthetic timestamps in Tests 14–17 and 19 to realistic wall-clock timestamps within the new 30 s future-skew guard. |
| [client/src/services/preferencesApi.test.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/client/src/services/preferencesApi.test.ts) | Modified | Added Test 6 verifying distinct `clientSessionId` on reload/restart and server clock-offset calibration. |
| [scripts/verify_phase_07_audit.js](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/scripts/verify_phase_07_audit.js) | Modified | Added explicit `waitForElement('a[href="/settings"]', 6000)` before sidebar navigation click for deterministic CDP runs under load. |
| [docs/PHASE_07_ATOMIC_CONCURRENCY_FINAL_REPORT.md](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/PHASE_07_ATOMIC_CONCURRENCY_FINAL_REPORT.md) | Created | This final verification report. |

---

## 2. Actual MongoDB Atomicity Strategy

Distributed concurrency safety is enforced **directly inside MongoDB's single-document write lock**, NOT by the process-local queue (the in-process `userMutationQueues` Map remains strictly as a single-instance throughput optimization):

1. **Idempotent Baseline Seeding (Non-`expectedVersion` Writes Only):**
   - If no `user_preferences` document exists yet and `expectedVersion` is omitted, `ensureBaselinePreferencesDoc()` executes `UserPreferences.collection.updateOne({ userId }, { $setOnInsert: { ..., version: 0, fieldTimestamps: { defaultAudioMuted: 0, defaultVideoOff: 0 } } }, { upsert: true })`, ignoring duplicate-key `11000` collisions across concurrent instances.
   - If `expectedVersion` IS supplied, seeding is skipped so a missing document atomically triggers HTTP `409 PREFERENCES_VERSION_CONFLICT`.
2. **Single Atomic MongoDB Aggregation-Pipeline `findOneAndUpdate`:**
   - Filter: `{ userId: userObjId }` (plus `version: input.expectedVersion` directly inside the MongoDB filter when optimistic concurrency is requested).
   - Pipeline Stage 1 (`$set`): Atomically computes `_applyAudio` and `_applyVideo` on the locked document using three predicates:
     - `incomingTs >= $fieldTimestamps.<field>` (newer or equal timestamp for that specific field), OR
     - Different explicit `clientSessionId` (cross-device / post-reload / post-restart update — never pits Device B's wall clock against Device A's wall clock), OR
     - `serverNow - $fieldMeta.<field>.serverUpdatedAt > STALE_RACE_WINDOW_MS` (15 s server-clock automatic recovery for sessionless, versionless lagging clients), OR
     - `expectedVersion` matched atomically in the filter (caller proved knowledge of latest state), OR `clientTimestamp` omitted.
   - Pipeline Stage 2 (`$set`): Conditionally updates `defaultAudioMuted`, `defaultVideoOff`, per-field `fieldTimestamps`, per-field `fieldMeta` (`clientSessionId`, `serverUpdatedAt`, unique per-write UUID `lastWriteId`), increments `version` only when at least one field was applied, and updates `updatedAt`.
   - Pipeline Stage 3 (`$unset`): Removes temporary `_applyAudio` / `_applyVideo` fields.
   - Returns `{ returnDocument: 'after' }`. Comparing `updatedDoc.fieldMeta.<field>.lastWriteId === writeId` determines `staleIgnored` with **zero secondary read**.
3. **Version-Guarded Legacy Mirroring:**
   - Legacy mirroring to `users.preferences` executes `User.updateOne({ _id: userObjId, $or: [{ preferencesVersion: { $exists: false } }, { preferencesVersion: { $lte: updatedDoc.version } }] }, { $set: { 'preferences.defaultAudioMuted': ..., 'preferences.defaultVideoOff': ..., preferencesVersion: updatedDoc.version } })`.
   - Even if an older instance's mirror write executes after a newer instance's mirror write, MongoDB atomically refuses to overwrite the newer mirrored preferences.

---

## 3. Two-Instance Race Reproduction Steps and Results

Implemented deterministically in [server/src/tests/atomicConcurrency.test.ts](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/server/src/tests/atomicConcurrency.test.ts) using **two independent `UserService` instances** (`serviceA`, `serviceB` — zero shared `Map` queue) and **two independent Express HTTP servers** (`serverA`, `serverB` on separate ephemeral ports) sharing the same MongoDB database (`mongodb://127.0.0.1:27017/connectly_atomic_concurrency_test`).

### 3.1 Same-Field Deterministic Race (Test 1)
1. Seeded `user_preferences` with `{ defaultAudioMuted: true, defaultVideoOff: false, version: 1 }`.
2. Sent older update (`T1 = baseNow - 1000`, `defaultAudioMuted: true`) to **Instance A** and newer update (`T2 = baseNow - 100`, `defaultAudioMuted: false`) to **Instance B** with the same `clientSessionId`.
3. Forced both instances to pause at `beforeAtomicWrite` after verifying both observed the exact same initial DB state (`version = 1`).
4. Released **Instance B** (`T2`) to commit first -> returned `{ defaultAudioMuted: false, version: 2 }`.
5. Released **Instance A** (`T1`) to execute its atomic MongoDB `findOneAndUpdate` afterward -> MongoDB atomically rejected the stale field, returned `{ defaultAudioMuted: false, version: 2, staleIgnored: true }`.
6. Queried MongoDB directly -> final persisted document held `defaultAudioMuted: false`, `version: 2`, `fieldTimestamps.defaultAudioMuted: T2`. **PASS.**

### 3.2 Simultaneous Different-Field Updates (Test 2)
- Synchronized **Instance A** (`{ defaultAudioMuted: false, T1 = baseNow - 500 }`) and **Instance B** (`{ defaultVideoOff: true, T2 = baseNow - 100 }`) at `beforeAtomicWrite`, then released both simultaneously.
- Both succeeded (`staleIgnored: undefined`), final MongoDB document held `{ defaultAudioMuted: false, defaultVideoOff: true, version: 3 }`. Neither overwrote the other. **PASS.**

### 3.3 Out-of-Order Legacy Mirror Race (Test 8)
- **Instance A** committed `defaultAudioMuted: false` (version `N`) and paused right before mirroring (`beforeLegacyMirror`).
- **Instance B** committed `defaultAudioMuted: true` (version `N+1`) and completed mirroring `preferencesVersion = N+1` to `users`.
- Released **Instance A**'s stale mirror write (version `N < N+1`) -> MongoDB's `{ preferencesVersion: { $lte: N } }` filter matched 0 documents.
- Final `user_preferences` AND embedded `users.preferences` both held `defaultAudioMuted: true` at version `N+1`. **PASS.**

---

## 4. Timestamp Safety Test Results & Trade-Offs

### 4.1 Test Matrix Results (Tests 5, 6, 7 of `atomicConcurrency.test.ts` & Test 6 of `preferencesApi.test.ts`)
| Scenario | Verified Behavior | Result |
| :--- | :--- | :---: |
| **Rapid consecutive updates** (same `clientSessionId`) | Monotonic `nextClientTimestamp()` orders writes; stale out-of-order writes rejected atomically by MongoDB | **PASS** |
| **Page reload followed by update** | Generates fresh `clientSessionId`; succeeds immediately even if clock lags prior tab | **PASS** |
| **Browser restart followed by update** | Generates fresh `clientSessionId`; succeeds immediately | **PASS** |
| **Future-dated timestamp** (`+35s`, `+1 hr`, `+1 yr` ahead of server UTC) | Rejected with HTTP `400 INVALID_CLIENT_TIMESTAMP` (`> MAX_FUTURE_CLOCK_SKEW_MS = 30_000`); never persisted; next legitimate update succeeds immediately | **PASS** |
| **Second device with clock behind first device** (Device 1 `+10s`, Device 2 `-5 min`) | Distinct `clientSessionId` (`device-2-mobile` != `device-1-tab-1`) succeeds immediately; sessionless lagging client also self-heals after `STALE_RACE_WINDOW_MS` (15 s) or immediately with `expectedVersion` | **PASS** |
| **Malformed / negative / non-finite / float / huge timestamps** (`"not-a-number"`, `-1`, `-999999`, `1234.56`, `4_102_444_800_001`, `Number.MAX_SAFE_INTEGER`, `null`, `NaN`, `Infinity`) | Strictly rejected with HTTP `400 VALIDATION_ERROR` / `INVALID_CLIENT_TIMESTAMP`; MongoDB version and values untouched | **PASS** |
| **Client clock calibration** (`preferencesApi.ts`) | Calibrates `serverClockOffsetMs` from server `meta.timestamp` so browsers with skewed local OS clocks stay aligned with server UTC | **PASS** |

### 4.2 Design Trade-Offs Documented Honestly
- **Same-session ordering vs. cross-device LWW:** Scoping `fieldTimestamps` by `clientSessionId` eliminates cross-device clock-skew lockouts while keeping strict same-tab rapid-click ordering. If two different devices deliberately submit conflicting edits in the same millisecond without `expectedVersion`, last-writer-to-MongoDB wins; callers requiring strict cross-device conflict detection use `expectedVersion` (HTTP 409).
- **30-second future skew ceiling (`MAX_FUTURE_CLOCK_SKEW_MS`):** Prevents future-timestamp poisoning by raw/malicious API clients, while legitimate web clients automatically align via `meta.timestamp` calibration.

---

## 5. Expected-Version Optimistic Concurrency Results

Verified in `atomicConcurrency.test.ts` Tests 3 & 4 and `preferences.test.ts` Test 18:
1. **Two simultaneous updates using the same `expectedVersion` across Instance A and Instance B (Test 3):** Synchronized at `beforeAtomicWrite` and released together -> **exactly 1 succeeded (`version = V+1`) and exactly 1 threw `409 PREFERENCES_VERSION_CONFLICT`**. MongoDB retained solely the winning write at `V+1`. **PASS.**
2. **One successful update on Server A followed by stale-version update on Server B (Test 4):** Server A advanced `V -> V+1` (HTTP 200); Server B sent `expectedVersion: V` -> received **HTTP 409 `PREFERENCES_VERSION_CONFLICT`**. Verified MongoDB was **not** overwritten by the 409 request. **PASS.**
3. **Conflict followed by fresh read and successful retry (Test 4):** Server B issued `GET /api/v1/users/me/preferences` (observing `V+1`), retried `PUT` with `expectedVersion: V+1` -> **HTTP 200**, advancing cleanly to `V+2`. **PASS.**

---

## 6. Source-of-Truth Integrity Verification

- **`user_preferences` authoritative across all read paths:** Verified in `preferences.test.ts` Test 19 across `GET /api/v1/users/me/preferences`, `GET /api/v1/users/me`, `GET /api/v1/auth/me`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, and `PATCH /api/v1/users/me`.
- **Legacy embedded fallback only when no authoritative document exists:** Verified in `preferences.test.ts` Test 20 (legacy values preserved on initial read and seeded into `user_preferences` on partial first write without deleting legacy user data).
- **Profile updates cannot overwrite preferences:** `UserService.updateProfile()` executes atomic field-level `User.findByIdAndUpdate(userId, { $set: updateSet })`, never touching `preferences`.
- **Mirroring never replaces authoritative values with stale data:** Verified deterministically in `atomicConcurrency.test.ts` Test 8 via `preferencesVersion <= updatedDoc.version` atomic guard.

---

## 7. Final Dependency Audit & Exact Zod Version

- **Exact Zod Version (`npm ls zod --all`):**
  ```text
  connectly@0.1.0
  `-- connectly-server@0.1.0 -> .\server
    `-- zod@4.6.7
  ```
- **Production Dependency Audit (`npm audit --omit=dev`):**
  - **Critical:** `0`
  - **High:** `0` (`GHSA-mrhx-c7xc-m3w5` fully resolved via `zod@4.6.7`)
  - **Moderate:** `2` (`react-router` / `react-router-dom@6.30.6`: `GHSA-wrjc-x8rr-h8h6` mitigated by `sanitizeNavigationPath` in `client/src/lib/navigation.ts`, and `GHSA-337j-9hxr-rhxg` SSR-only hydration advisory inapplicable to our client-rendered Vite SPA; requires SemVer-major upgrade to `react-router-dom@7.18.5` outside Phase 07 backend scope).

---

## 8. Regression Test Totals & Quality Checks

Automated Node test-runner suites are reported strictly separately from standalone Live API E2E and Chrome CDP browser scripts.

### 8.1 Server Automated Tests (`npm test --workspace=server`)
| Suite File | Discovered | Passed | Failed | Skipped | Pending |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `src/controllers/auth.integration.test.ts` (Phase 05 Auth) | 22 | 22 | 0 | 0 | 0 |
| `src/controllers/rateLimit.test.ts` (Phase 05 Rate Limit) | 1 | 1 | 0 | 0 | 0 |
| `src/utils/security.test.ts` (Phase 05 Security/Cookies/Schemas — 3 suites) | 10 | 10 | 0 | 0 | 0 |
| `src/tests/database.test.ts` (Phase 07 DB) | 4 | 4 | 0 | 0 | 0 |
| `src/tests/health.test.ts` (Phase 07 Health/Readiness) | 5 | 5 | 0 | 0 | 0 |
| `src/tests/user.test.ts` (Phase 07 Profile) | 8 | 8 | 0 | 0 | 0 |
| `src/tests/preferences.test.ts` (Phase 07 Preferences/SSOT) | 20 | 20 | 0 | 0 | 0 |
| `src/tests/zodSecurity.test.ts` (Zod 4.6.7 Security) | 6 | 6 | 0 | 0 | 0 |
| `src/tests/atomicConcurrency.test.ts` (Two-Instance Atomic Concurrency) | 8 | 8 | 0 | 0 | 0 |
| **Server Total (11 suites)** | **84** | **84** | **0** | **0** | **0** |

### 8.2 Client Automated Tests (`npm test --workspace=client`)
| Suite File | Discovered | Passed | Failed | Skipped | Pending |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `src/lib/dashboard.test.ts` (Phase 06 Dashboard) | 5 | 5 | 0 | 0 | 0 |
| `src/lib/meetingCode.test.ts` (Phase 06 Meeting Codes) | 18 | 18 | 0 | 0 | 0 |
| `src/lib/navigation.test.ts` (Phase 06 Navigation Security) | 9 | 9 | 0 | 0 | 0 |
| `src/services/authApi.test.ts` (Refresh Deduplication & Recovery) | 4 | 4 | 0 | 0 | 0 |
| `src/services/preferencesApi.test.ts` (Preferences Ordering & Clock Cal) | 6 | 6 | 0 | 0 | 0 |
| **Client Total (5 suites)** | **42** | **42** | **0** | **0** | **0** |

### 8.3 Combined Automated Node Test-Runner Totals
- **Total Suites:** 16 (11 server + 5 client)
- **Discovered:** **126** | **Passed:** **126** | **Failed:** **0** | **Skipped:** **0** | **Pending:** **0**

### 8.4 Standalone Live API E2E & Chrome CDP Verifications (Reported Separately)
- **Live API E2E (`node scripts/test-phase07-live.mjs`):** **7 / 7 stages passed** (exit code `0`, MongoDB versions `0 -> 1 -> 2` verified).
- **Chrome CDP Browser Verification (`node scripts/verify_phase_07_audit.js`):** **4 / 4 browser test cases passed** (exit code `0`), including cloud load, reload persistence (`mic=false`), truthful offline fallback + non-auto-sync verification + explicit `Retry Cloud Sync`, and real cross-account switching with User 1's scoped `localStorage` preserved (`unscoped: null`, User 2 isolated defaults `{ mic: true, cam: false }`).

### 8.5 Build, Lint & Typecheck Gates
- `npm run lint --workspace=client`: **PASS** (exit code `0`, 0 errors, 0 warnings)
- `npm run typecheck`: **PASS** (exit code `0`, both `client` and `server`)
- `npm run build`: **PASS** (exit code `0`, Vite bundle `dist/assets/index-D-TpqViJ.js` 409.45 kB + server `tsc` build)

---

## 9. Visual Evidence & Execution Logs

Refreshed browser screenshots captured during the final Chrome CDP run (`node scripts/verify_phase_07_audit.js`):
- [phase07_settings_cloud_loaded.png](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/screenshots/phase07_settings_cloud_loaded.png) (123,930 bytes)
- [phase07_settings_reloaded.png](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/screenshots/phase07_settings_reloaded.png) (123,799 bytes)
- [phase07_settings_offline_fallback.png](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/screenshots/phase07_settings_offline_fallback.png) (146,112 bytes)
- [phase07_settings_corrected_behavior.png](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/screenshots/phase07_settings_corrected_behavior.png) (138,214 bytes)

```text
[4/5] Test Case 3: Truthful Offline Fallback, Non-Auto-Sync Verification & Explicit Retry...
Truthful local-only notice displayed: PASS
No false cloud-sync success message: PASS
No false auto-sync claim: PASS
Retry Cloud Sync button present: PASS
Cloud state after reload without retry (expected mic=false, cam=false): { mic: false, cam: false }
Explicit Retry Cloud Sync succeeded: PASS

[5/5] Test Case 4: Real Account Switching WITHOUT Clearing User 1 localStorage...
LocalStorage keys before account switch: {
  unscoped: null,
  keys: [ 'cly_meeting_preferences_6afca0e57cbbc59863ff6ce7' ]
}
User 2 initial preferences (expected mic=true, cam=false): { mic: true, cam: false }
```

---

## 10. Remaining Limitations & Deployment Assumptions

1. **MongoDB Version Requirement:** Aggregation-pipeline updates in `findOneAndUpdate` require **MongoDB 4.2+** (verified on MongoDB **8.3.4** in this environment; all modern MongoDB Atlas tiers 6.x/7.x/8.x are supported).
2. **Server Clock Synchronization (NTP):** Across multi-instance horizontal deployments, API server nodes are assumed to maintain reasonably synchronized UTC clocks via NTP (within a few seconds) so `MAX_FUTURE_CLOCK_SKEW_MS` (30 s) and `STALE_RACE_WINDOW_MS` (15 s) behave consistently across replicas.
3. **Cross-Device Simultaneous Millisecond Edits Without `expectedVersion`:** Two separate devices writing the same preference field within the same millisecond without `expectedVersion` follow last-commit-to-MongoDB wins; strict conflict detection requires callers to pass `expectedVersion`.
4. **React Router Moderate Advisories:** Two moderate `react-router` v6 advisories remain in `client` until a dedicated major-version migration to `react-router-dom@7.x` is scheduled outside Phase 07.
5. **Phase Boundary:** Phase 08 (Meeting Room Management) and Phases 09–18 have **not** been started.

---

**FINAL VERDICT:**

**COMPLETE — READY FOR OWNER REVIEW**
