# CONNECTLY — Quality Assurance & Testing Strategy

## 1. Testing Philosophy & Test Pyramid

CONNECTLY enforces a multi-layered verification strategy that spans unit test isolation, end-to-end integration, real-time socket contract validation, WebRTC media connectivity, and synthetic load testing.

```
                    ┌─────────────────────────┐
                    │   Load & Chaos Tests    │  LiveKit Load Agents (60 Users)
                    │     (Artillery / K6)    │  Network Jitter / Drop Simulation
                    ├─────────────────────────┤
                    │   End-to-End (E2E) UI   │  Playwright Cross-Browser
                    │     & Accessibility     │  Axe-Core WCAG 2.2 AA Audit
                    ├─────────────────────────┤
                    │  Integration / Contract │  Supertest API Test Suite
                    │  & Real-Time Socket Tests│  Socket.IO Multi-Client Harness
                    ├─────────────────────────┤
                    │    Unit & Schema Tests  │  Vitest / Jest
                    │                         │  Zod Schemas, Argon2, State Stores
                    └─────────────────────────┘
```

---

## 2. Test Disciplines & Execution Framework

### 2.1. Unit Testing
- **Framework:** `Vitest` (Client & Server)
- **Scope:**
  - Pure functions (meeting code generators, time formatters, byte calculators).
  - Zod validation schemas (validating valid vs malformed payloads).
  - State store reducers and Zustand actions (verifying immutable state transitions).
  - Cryptographic helpers (Argon2id hashing, token signing and decoding).
- **Target Coverage:** Minimum 85% branch coverage on core domain logic.

### 2.2. API Integration Testing
- **Framework:** `Supertest` + `mongodb-memory-server`
- **Scope:**
  - Execution of complete HTTP request-response cycles against Express routes.
  - Verification of status codes, RFC 7807 error structures, and response schemas.
  - Database persistence validation without requiring an external hosted Atlas instance.

### 2.3. Authentication & Authorization Testing
- **Scenarios:**
  - Password complexity validation: Verify rejection of weak or truncated passwords.
  - Token expiration handling: Ensure expired 15-minute access tokens trigger HTTP 401.
  - Refresh token rotation: Presenting a valid refresh token yields a new token pair; presenting an already-consumed token triggers immediate session revocation across all devices.
  - RBAC verification: Non-host users attempting `POST /api/v1/meetings/:id/end` or `DELETE /participants/:id` must receive HTTP 403 Forbidden.

### 2.4. Real-Time Socket.IO Testing
- **Harness:** In-memory multi-client Socket.IO test runner (`socket.io-client`).
- **Scenarios:**
  - Multi-client room join and presence broadcast (`participant:joined`).
  - Waiting room flow: Guest joins -> Host receives queued event -> Host emits admit -> Guest receives admission ticket.
  - Chat delivery: Verifying public broadcast vs direct private message isolation.
  - Disconnect & Reconnect: Disconnecting a client socket, reconnecting with prior session token, and verifying state re-sync.

### 2.5. WebRTC & Media Connectivity Testing
- **Tooling:** Headless Chromium with fake media streams (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`).
- **Scenarios:**
  - PeerConnection establishment with LiveKit SFU.
  - Local microphone and camera track acquisition and publishing.
  - Simulcast verification: Ensure 3 video encodings (high, mid, low) are signaled in SDP.
  - ICE candidate gathering and STUN/TURN binding success.

### 2.6. File Upload Security Testing
- **Scenarios:**
  - Size boundary test: Uploading a 25.1MB file must fail validation with HTTP 400.
  - MIME spoofing: Renaming an `.exe` file to `.pdf` and testing magic byte inspection.
  - Path traversal: Passing `../../etc/passwd` in `fileName` must be sanitized to a clean basename.
  - Download permission: Requesting a pre-signed download URL for a meeting the user never attended must return HTTP 403 Forbidden.

### 2.7. Whiteboard Synchronization Testing
- **Scenarios:**
  - Stroke propagation latency: Emitting `whiteboard:draw-stroke` on Client A must arrive on Client B within 50ms locally.
  - Snapshot hydration: Connecting a late joiner and verifying receipt of the consolidated vector snapshot matching the host canvas.
  - Lock enforcement: When host locks whiteboard, strokes emitted by participant sockets are rejected by server middleware.

### 2.8. Responsive UI & Accessibility Testing
- **Framework:** `Playwright` + `@axe-core/playwright`
- **Viewports Tested:**
  - Desktop: 1920x1080 and 1366x768
  - Tablet: 820x1180 (iPad Air) and 768x1024
  - Mobile: 390x844 (iPhone 14) and 360x800 (Android)
- **Accessibility Checks:**
  - Zero critical or serious accessibility violations according to WCAG 2.2 Level AA.
  - Visible focus indicators on all interactive buttons and dropdowns.
  - Tab navigation loops properly constrained inside open modal dialogs.

### 2.9. Load & Capacity Testing (Target: Up to 60 Participants — Phase 17 Execution)
> [!IMPORTANT]
> The target of up to 60 participants is a planned architectural design goal, not a guaranteed or empirically proven capacity at this stage. Performance metrics (including the $\le 250\text{ ms}$ glass-to-glass latency target) are theoretical design thresholds. Formal load-testing and performance validation will be conducted during **Phase 17 – Testing, Optimization & Responsiveness**.

- **Tooling:** `LiveKit CLI Load Tester` (`lk load-test`) + `Artillery` / `k6`
- **Load Scenarios Planned for Phase 17:**
  - 1 publisher with 59 subscribers in a single room.
  - 10 publishers (video + audio) with 50 subscribers.
  - 60 simultaneous users in chat and whiteboard emitting concurrent events.
- **Metrics Collected:** CPU utilization, SFU packet drop rate, end-to-end RTT, video freeze percentage.

---

## 3. Measurable Acceptance Criteria Matrix (Design Targets to be Validated in Phase 17)

| Test Category | Metric / Check | Target Design Threshold |
| :--- | :--- | :--- |
| **Unit Tests** | Code Coverage | $\ge 85\%$ statement & branch coverage on business logic |
| **API Integration** | Endpoint Success Rate | $100\%$ pass rate across all documented RFC 7807 endpoints |
| **Auth Security** | Token Lifecycle | $0$ token leakage; $100\%$ rejection of revoked refresh tokens |
| **Media Latency** | Glass-to-Glass SFU Delay | Target $\le 250\text{ ms}$ under simulated 50ms network RTT |
| **Socket Latency** | Room Broadcast Delay | Target $\le 80\text{ ms}$ for chat and whiteboard vector packets |
| **File Validation** | Unsafe File Rejection | $100\%$ rejection of non-whitelisted MIME / spoofed binaries |
| **Accessibility** | Axe-Core Violations | $0$ Critical, $0$ Serious WCAG 2.2 AA violations |
| **UI Responsiveness**| Layout Integrity | $0$ horizontal scroll overflow across mobile/tablet viewports |
| **60-User Load** | SFU Packet Loss | Target $\le 1.5\%$ packet loss on High/Mid layers during 30m session |
