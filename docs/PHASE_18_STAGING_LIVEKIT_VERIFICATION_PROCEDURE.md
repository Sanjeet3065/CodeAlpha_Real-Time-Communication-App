# CONNECTLY — PHASE 18
## STAGING LIVEKIT SFU REAL-NETWORK VERIFICATION PROCEDURE

**Document ID:** `DOC-P18-STG-001`  
**Phase:** Phase 18 — Deployment & Documentation  
**Classification:** Operational Runbook & Staging Gate Verification  
**Zero-Budget Execution Status in Local Environment:** **NOT EXECUTED** (Staging Environment Prerequisite)

---

## 1. PURPOSE & SCOPE

This document provides a deterministic, reproducible, step-by-step verification procedure for testing CONNECTLY's real-time media eviction, session-scoped identity isolation, and durable recovery mechanisms against a live **LiveKit Cloud** (or self-hosted LiveKit SFU) cluster in a dedicated staging environment.

In local development and automated CI testing ($0.00 zero-cloud policy), all LiveKit SFU interactions are validated via the in-memory `LiveKitRoomClientAdapter` mock. This staging runbook exercises the official `livekit-server-sdk` (`RoomServiceClient`) over physical network protocols (TLS, HTTP/2, Twirp, WebSockets, WebRTC) before production deployment.

---

## 2. REQUIRED ENVIRONMENT CONFIGURATION

### 2.1 Staging Environment Variables

The staging backend deployment (e.g. Render Staging Service or ECS Staging Task) must be configured with the following verified environment variables:

```bash
# Node Environment
NODE_ENV=production

# Database (MUST be a Replica Set for multi-document ACID transactions)
MONGODB_URI=mongodb+srv://<username>:<password>@staging-cluster.mongodb.net/connectly_staging?retryWrites=true&w=majority

# LiveKit SFU Configuration
LIVEKIT_URL=wss://connectly-staging-xxxx.livekit.cloud
LIVEKIT_API_KEY=<staging-livekit-api-key>
LIVEKIT_API_SECRET=<staging-livekit-api-secret-minimum-32-chars>
LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto
LIVEKIT_TOKEN_TTL_SECONDS=600

# Client Web Origin
CLIENT_ORIGIN=https://staging.connectly.app

# Cryptographic Keys (Must be 32+ characters, no development defaults)
JWT_ACCESS_SECRET=<staging-secure-access-secret-32-chars-min>
JWT_REFRESH_SECRET=<staging-secure-refresh-secret-32-chars-min>
CONNECTLY_ENCRYPTION_KEY_V1=<staging-256-bit-hex-key-64-characters>
```

### 2.2 Pre-Flight Credential Validation Rules

Before launching the server, execute the pre-flight gate validation:
```bash
npm --prefix server run verify:production
```
The pre-flight gate automatically enforces:
1. `LIVEKIT_URL` must use a secure `wss://` or `https://` protocol.
2. `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must **not** match placeholder prefixes (`replace_with_`, `your_livekit_`, `changeme`).
3. An authenticated API call (`RoomServiceClient.listRooms()`) is executed during pre-flight. If unauthorized (HTTP 401) or timed out ($>5\text{s}$), the service fails closed and halts container startup.

---

## 3. PROCEDURE 1 — TWO-BROWSER REAL WEBRTC REMOVAL & DISCONNECTION

### Objective
Verify that removing a participant through CONNECTLY's authoritative Host API physically disconnects their active WebRTC audio/video streams on LiveKit Cloud and stops camera/mic hardware within 500ms.

### Test Execution Steps
1. **Host Setup (Browser 1 - Chrome):**
   - Log in as Host (`host@staging.connectly.app`).
   - Create a new meeting: `cly-stg-abc`.
   - Join the meeting room. Confirm microphone and camera are active.
2. **Participant Setup (Browser 2 - Firefox / Edge / Incognito):**
   - Log in as Participant (`guest@staging.connectly.app`).
   - Join `cly-stg-abc`. Allow camera and microphone permissions.
   - Verify that both video tiles appear in the meeting room grid on both browsers.
   - Verify audio transmission between Browser 1 and Browser 2.
3. **Trigger Host Eviction:**
   - On Browser 1 (Host), open the Participants panel.
   - Click the "Remove Participant" action on Guest User.
   - Select reason: "Testing LiveKit Cloud media eviction". Confirm removal.
4. **Authoritative Observations on Browser 2 (Participant):**
   - Participant's client must receive `RoomEvent.Disconnected` with reason `PARTICIPANT_REMOVED`.
   - Browser hardware indicator (green/orange camera/microphone recording dot) must turn off immediately (`track.stop()` executed on local media stream).
   - UI must immediately unmount the video room and redirect to `/meeting/removed?reason=Testing+LiveKit+Cloud+media+eviction`.
5. **Observability Verification:**
   - In LiveKit Cloud Dashboard -> Project -> Rooms -> `cly_room_<meetingId>`:
     - Verify participant count decremented from 2 to 1.
     - Verify `usr_<userId>_<sessionId>` is listed as `Disconnected`.
   - In Server Logs:
     - `[LiveKit] Evicted participant from SFU room { participantIdentity: "usr_<userId>_<sessionId>" }`.

---

## 4. PROCEDURE 2 — OLD-SESSION ZOMBIE SEVERANCE & RE-ADMISSION DISAMBIGUATION

### Objective
Verify that if an initial SFU eviction API call fails during removal, and the user is subsequently re-admitted, the background worker evicts *only* the old zombie WebRTC connection and does *not* disconnect the user's active new session.

### Test Execution Steps
1. **Establish Session 1:**
   - Host and Guest join meeting `cly-stg-xyz`.
   - Inspect MongoDB: `MeetingParticipant` document contains `admissionSessionId: "a1b2c3d4e5f6"`.
   - Guest is connected to LiveKit SFU under identity: `usr_<userId>_a1b2c3d4e5f6`.
2. **Simulate API Outage During Removal:**
   - Temporarily block egress from the staging backend container to LiveKit Cloud REST IP (or iptables rule: `iptables -A OUTPUT -p tcp --dport 443 -d <livekit-cloud-ip> -j DROP`).
   - Host removes Guest User.
   - Because LiveKit Cloud REST API is unreachable, the immediate eviction call fails with `ETIMEDOUT`.
   - Inspect MongoDB:
     - Participant status: `REMOVED`.
     - `LiveKitEvictionJob` created: `status: 'FAILED'`, `identity: 'usr_<userId>_a1b2c3d4e5f6'`, `sessionId: 'a1b2c3d4e5f6'`.
     - Note: In Browser 2 (Guest), the local Socket.IO connection is closed, but the WebRTC connection on LiveKit Cloud remains established (zombie SFU session).
3. **Re-Admit Guest (Session 2):**
   - Host resets Guest User to waiting room and clicks "Admit".
   - Guest joins from a new browser tab.
   - Inspect MongoDB: `MeetingParticipant` document now contains a **new** `admissionSessionId: "7890abcdef12"`.
   - Guest connects to LiveKit SFU under new identity: `usr_<userId>_7890abcdef12`.
   - Verify video and audio are streaming on Session 2.
4. **Restore Connectivity & Trigger Background Worker:**
   - Remove iptables block: `iptables -D OUTPUT -p tcp --dport 443 -d <livekit-cloud-ip> -j DROP`.
   - Trigger worker sweep: `livekitEvictionWorker.wakeUp()`.
5. **Measurable Success Criteria:**
   - Eviction worker processes the job for `usr_<userId>_a1b2c3d4e5f6`.
   - LiveKit Cloud severances the zombie connection `usr_<userId>_a1b2c3d4e5f6`.
   - **Session 2 (`usr_<userId>_7890abcdef12`) remains 100% connected, undisturbed, and transmitting audio/video.**
   - Eviction job in MongoDB transitions to `status: 'COMPLETED'`.

---

## 5. PROCEDURE 3 — RETRY EXHAUSTION, ESCALATION & OPERATOR RECOVERY

### Objective
Verify that permanent SFU outages escalate to the operator and can be manually retried via the administrative REST API.

### Test Execution Steps
1. Simulate permanent LiveKit Cloud outage (invalid credentials or network block).
2. Trigger participant removal.
3. Observe worker retry backoff:
   - Attempt 1: 1s delay
   - Attempt 2: 2s delay
   - Attempt 3: 4s delay
   - Attempt 4: 8s delay
   - Attempt 5: 16s delay
4. Upon 5th failure, verify:
   - Job document in MongoDB updates to `status: 'ESCALATED'`, `escalatedAt: Date.now()`.
   - Security audit event `EVICTION_JOB_ESCALATED` is persisted in `security_audit_entries` and logged to stdout with `severity: 'CRITICAL'`.
5. Administrator Recovery:
   - Authenticate as Admin user.
   - Query escalated jobs: `GET /api/v1/admin/eviction-jobs/escalated`.
   - Restore LiveKit Cloud connectivity.
   - Trigger manual recovery: `POST /api/v1/admin/eviction-jobs/<jobId>/retry`.
   - Verify job resets to `status: 'PENDING'`, attempts reset to 0, and job is evicted immediately.
   - Verify audit event `EVICTION_OPERATOR_RETRY` is persisted in MongoDB and logged with operator ID.

---

## 6. ADMINISTRATIVE AUDIT & JOB INSPECTION COMMANDS

### Inspecting Eviction Jobs in MongoDB
```javascript
// Connect to staging MongoDB via mongosh
use connectly_staging;

// Check escalated jobs
db.livekit_eviction_jobs.find({ status: "ESCALATED" }).pretty();

// Check in-flight leased jobs
db.livekit_eviction_jobs.find({ status: "PROCESSING" }).pretty();
```

### Inspecting Persistent Audit Logs via Admin API
```bash
# Query recent operator retries
curl -X GET "https://staging.connectly.app/api/v1/admin/audit-logs?eventType=EVICTION_OPERATOR_RETRY" \
  -H "Authorization: Bearer <admin-jwt-token>"

# Query escalated eviction failures
curl -X GET "https://staging.connectly.app/api/v1/admin/audit-logs?eventType=EVICTION_JOB_ESCALATED" \
  -H "Authorization: Bearer <admin-jwt-token>"
```

---

## 7. ZERO-BUDGET AUDIT DISCLOSURE

In accordance with strict project rules ($0.00 zero-cloud policy):
- **Live LiveKit Cloud testing was NOT EXECUTED during this local repository sprint.**
- **All tests described above must be executed in the live staging environment prior to production promotion.**
