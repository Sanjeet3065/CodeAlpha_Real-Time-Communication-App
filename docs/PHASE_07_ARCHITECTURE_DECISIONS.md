# CONNECTLY — PHASE 07 ARCHITECTURE DECISION RECORDS (ADR)
## TECHNICAL DECISIONS & RATIONALE

---

## ADR-0701: Dedicated Collection for User Preferences vs Inlining in User Schema

### Status: APPROVED & IMPLEMENTED
### Date: November 17, 2026

### Context
User preferences control pre-join microphone and camera defaults. They may be frequently toggled from settings screens or meeting lobby interfaces. We needed to choose between storing preferences as an embedded subdocument within the `users` collection or in a dedicated `user_preferences` collection.

### Decision
Store user preferences in a dedicated `user_preferences` collection with an enforced unique index on `{ userId: 1 }`, referencing `User._id`.

### Rationale & Trade-offs
- **Decoupling Core Identity from Client Behavior:** The `users` document contains security-critical identity data (email, password hash, verification status). Inlining client behavioral preferences creates unnecessary write contention on the primary authentication document.
- **Cache Invalidation Isolation:** When auth tokens or sessions validate against the `users` record, high-frequency preference mutations will not invalidate user record caches.
- **Granular Indexing & Scalability:** A separate collection allows future expansion (e.g., custom layout defaults, noise suppression modes) without schema bloat on the core authentication model.
- **Backward Compatibility:** `UserService.getProfile()` automatically resolves and attaches preferences to the user profile object, ensuring existing Phase 05/06 client consumers remain completely unaffected.

---

## ADR-0702: Atomic Upsert Pattern for User Preferences

### Status: APPROVED & IMPLEMENTED
### Date: November 17, 2026

### Context
A user may update preferences immediately upon account registration before any explicit preference provisioning occurs. Under high concurrency, simultaneous updates could create duplicate records or race conditions.

### Decision
Use MongoDB atomic upsert operations:
```typescript
await UserPreferences.findOneAndUpdate(
  { userId },
  { $set: updateFields },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);
```

### Rationale
- **Idempotency:** The upsert operation is fully idempotent. If the document exists, it is patched; if absent, it is created with default values (`defaultAudioMuted: true`, `defaultVideoOff: false`) and immediately modified.
- **Zero Race Conditions:** MongoDB executes atomic find-and-modify operations at the document level, preventing duplicate preference documents. Combined with the engine-level unique index on `userId`, duplicate records are physically impossible.

---

## ADR-0703: Centralized RFC Problem Details & Request Correlation

### Status: APPROVED & IMPLEMENTED
### Date: November 17, 2026

### Context
Frontend applications and API consumers require consistent error representations. When an error occurs, tracking the request across client telemetry, reverse proxies, and server logs is critical for production diagnostics.

### Decision
1. Standardize error responses using RFC 7807 inspired JSON problem details (`status`, `code`, `message`, `errors`, `timestamp`, `requestId`).
2. Implement `requestIdMiddleware` attaching or generating a cryptographically secure UUID (`crypto.randomUUID()`) to `req.id` and the `X-Request-Id` response header.

### Rationale
- **End-to-End Tracing:** A user or QA tester encountering an issue can provide the `requestId` from the error toast or network response, allowing immediate log correlation in server monitoring tools.
- **Centralized Error Parsing:** The frontend `fetchWithAuth` and `ApiError` class can reliably parse errors with predictable shapes without guessing arbitrary backend error structures.

---

## ADR-0704: Fail-Fast Connection Timeouts & Dual Health Probes

### Status: APPROVED & IMPLEMENTED
### Date: November 17, 2026

### Context
By default, some database drivers buffer commands indefinitely when disconnected, leading to request queue exhaustion and cascading server lockups during network partitions. Additionally, container orchestrators (Kubernetes, GCP Cloud Run, AWS ECS) require separate checks for container liveness versus service readiness.

### Decision
1. Configure explicit fail-fast timeouts on Mongoose initialization:
   - `connectTimeoutMS: 10000` (10 seconds)
   - `serverSelectionTimeoutMS: 5000` (5 seconds)
2. Deploy two distinct probe endpoints:
   - `GET /health` (Liveness): Validates that the Node.js/Express process is running.
   - `GET /ready` (Readiness): Validates that MongoDB is connected (`readyState === 1`). Returns `503 Service Unavailable` if disconnected.

### Rationale
- **Preventing Cascade Failures:** If MongoDB experiences a primary election, queries timeout in 5 seconds rather than holding HTTP connections open until gateway timeouts (30–60s).
- **Traffic Routing Safety:** Load balancers inspecting `/ready` will automatically stop directing new user traffic to an instance whose database connection has dropped, while `/health` prevents premature container termination if the database blips momentarily.

---

## ADR-0705: Dual-Tier Preferences Persistence (Cloud First + LocalStorage Cache)

### Status: APPROVED & IMPLEMENTED
### Date: November 17, 2026

### Context
Users expect their audio and video defaults to persist seamlessly across devices (work laptop, home desktop), but they also require zero-latency initialization when loading pre-join meeting lobbies and full offline resilience.

### Decision
Implement a synchronized dual-tier persistence model:
1. **Cloud Tier (Primary):** Authenticated `GET` and `PUT` calls to MongoDB persist preferences across all user devices.
2. **Local Tier (Cache & Offline Fallback):** Browser `localStorage` acts as an instantaneous local cache. On page load, preferences load immediately from local storage, then sync with the database. On save, preferences are committed to both local storage and the database. If offline, changes persist locally and present a clear status notice.

### Rationale
- **Instant Lobby Rendering:** Eliminates UI layout shifts or delay when entering meeting rooms.
- **Cross-Device Parity:** Logging in on a new device immediately synchronizes the user's preferred hardware mute state from MongoDB.
- **Offline Fault Tolerance:** If network connectivity drops or the user enters an offline lobby preview, the application functions cleanly without errors.
