# CONNECTLY — Architecture Decision Records (ADRs)

## 1. Index of Decisions

- **ADR-001:** Selection of LiveKit SFU over P2P Full Mesh and MCU
- **ADR-002:** Dual-Conduit Architecture (LiveKit Media + Socket.IO Events)
- **ADR-003:** Argon2id for Password Hashing with Modular Bcrypt Fallback
- **ADR-004:** Hybrid Storage Strategy (S3-Compatible Storage + Cloudinary)
- **ADR-005:** Client State Strategy (Zustand + TanStack Query over Redux)
- **ADR-006:** Selection of MongoDB Atlas as Primary Data Store
- **ADR-007:** Dual-Token Session Architecture with Rotated Refresh Tokens
- **ADR-008:** 60-Participant Capacity & Simulcast Subscription Model
- **ADR-009:** "Modern Editorial" Visual Language over Generic SaaS Templates
- **ADR-010:** Encryption Architecture: Transport Baseline vs. Phase 15 True E2EE (SFrame) Assignment
- **ADR-011:** Build System Upgrade — Vite 6.4.x and esbuild 0.25.x for Development Tooling Security

---

## ADR-001: Selection of LiveKit SFU over P2P Full Mesh and MCU

### Context
CONNECTLY targets interactive video meetings supporting up to 60 concurrent participants. We must select a media routing topology capable of operating within consumer bandwidth and CPU constraints.

### Options Considered
1. **Full-Mesh Peer-to-Peer (P2P):** Each participant establishes a direct WebRTC connection with every other participant.
2. **Multipoint Control Unit (MCU):** The media server decodes all incoming streams, composites them into a single video grid, re-encodes, and sends one stream to each participant.
3. **Selective Forwarding Unit (SFU - LiveKit):** The media server acts as an intelligent packet router. It does not decode or re-encode video; it receives streams and selectively forwards them to subscribers based on viewport visibility and bandwidth.

### Decision
**Adopt LiveKit SFU.**

### Rationale
- In a 60-participant meeting under P2P mesh, total connections equal $N(N-1) = 60 \times 59 = 3540$ streams. Each client would have to encode and upload 59 video streams simultaneously, requiring >100 Mbps uplink and crashing browser threads.
- MCU requires massive server-side CPU/GPU resources to decode and transcode 60 high-definition streams in real-time, resulting in high latency (>500ms) and prohibitive cloud infrastructure costs.
- LiveKit SFU requires each client to upload **exactly one** set of simulcast streams. The SFU intelligently forwards tracks without transcoding, maintaining sub-200ms latency and minimal server CPU overhead.

---

## ADR-002: Dual-Conduit Architecture (LiveKit Media + Socket.IO Events)

### Context
We need to handle two fundamentally different real-time data categories: continuous heavy media streams (audio/video) and discrete application events (chat, presence, waiting room queues, and collaborative whiteboard vector strokes).

### Options Considered
1. **Unified LiveKit Data Channels:** Route chat and whiteboard data through LiveKit WebRTC DataChannels.
2. **Unified Socket.IO:** Route media through WebSockets alongside application events.
3. **Dual-Conduit Architecture:** LiveKit SFU for WebRTC media; Socket.IO for application events.

### Decision
**Adopt the Dual-Conduit Architecture.**

### Rationale
- Routing raw media over Socket.IO (WebSocket/TCP) causes severe packet queuing, head-of-line blocking, and latency ballooning.
- While LiveKit provides DataChannels, Socket.IO provides superior room multiplexing, server-side room adapters (`@socket.io/redis-adapter`), delivery acknowledgments, offline message replay, and effortless horizontal clustering.
- Separating concerns isolates media failures from application controls: if an SFU node encounters network turbulence, chat, whiteboard, and host moderation controls remain fully operational.

---

## ADR-003: Argon2id for Password Hashing with Modular Bcrypt Fallback

### Context
User password credentials must be stored securely against modern computational attacks.

### Options Considered
1. **PBKDF2:** NIST-approved but vulnerable to GPU parallelization.
2. **Bcrypt:** Industry standard for decades, but constrained by a 72-byte input truncation limit and 4KB state size that allows high-density GPU/ASIC cracking.
3. **Argon2id:** Winner of the Password Hashing Competition (PHC). Memory-hard, resistant to GPU/ASIC brute forcing, with no character truncation limit.

### Decision
**Adopt Argon2id as primary hasher, with a modular fallback to Bcrypt if native C++ compilation is blocked.**

### Rationale
Argon2id provides the highest cryptographic defense available. We configure it with 64MB memory cost, 3 iterations, and 1 thread. To eliminate vendor lock-in and build-failure risks on minimal CI containers, we encapsulate the hasher behind a `PasswordHasher` interface that provides graceful degradation to `bcrypt` (cost 12).

---

## ADR-004: Hybrid Storage Strategy (S3-Compatible Storage + Cloudinary)

### Context
The platform requires storage for user avatars as well as private in-meeting documents (PDFs, spreadsheets, code files).

### Options Considered
1. **Cloudinary for All Assets:** Convenient API, but highly expensive bandwidth costs for arbitrary office documents and lacks native pre-signed URL primitives for non-media files.
2. **AWS S3 / Cloudflare R2 for All Assets:** Excellent security and low cost, but lacks automated on-the-fly image transformations and cropping for user avatars.
3. **Hybrid Architecture:** Cloudflare R2 / AWS S3 for private documents; Cloudinary for user avatars.

### Decision
**Adopt the Hybrid Storage Architecture.**

### Rationale
- Private in-meeting documents require zero public access and strict IAM-gated pre-signed URLs. Cloudflare R2 provides an S3-compatible API with **$0 egress fees**, protecting the project from variable bandwidth spikes.
- User profile avatars benefit significantly from Cloudinary's dynamic face-detection cropping, auto-WebP conversion, and global CDN delivery.

---

## ADR-005: Client State Strategy (Zustand + TanStack Query over Redux)

### Context
The React client must manage complex local states (audio/video devices, active participant grids, whiteboard canvas) alongside server-persisted states (user profile, scheduled meetings).

### Options Considered
1. **Redux Toolkit:** Powerful but excessive boilerplate and verbose slice ceremonies.
2. **Zustand + TanStack Query:** Lightweight, decoupled, hook-based state model.

### Decision
**Adopt Zustand for local UI/media state and TanStack Query for remote server state.**

### Rationale
- TanStack Query automatically manages server cache invalidation, background refetching, and loading states for REST queries.
- Zustand provides high-performance atomic subscriptions without context re-render thrashing, which is critical when updating audio volume indicators 30 times per second during meetings.

---

## ADR-006: Selection of MongoDB Atlas as Primary Data Store

### Context
We require a persistent data store for user records, room configurations, chat histories, whiteboard vector states, and meeting analytics.

### Options Considered
1. **PostgreSQL:** Relational integrity and SQL flexibility.
2. **MongoDB Atlas:** Native JSON document store with dynamic schema agility and fast index execution.

### Decision
**Adopt MongoDB Atlas.**

### Rationale
- Collaborative whiteboard snapshots and vector element arrays map natively into BSON documents without awkward relational joins.
- Chat message logs and meeting history rosters are naturally structured as time-ordered document feeds.
- Mongoose provides schema validation and lifecycle hooks that ensure relational integrity across collections without SQL migration overhead.

---

## ADR-007: Dual-Token Session Architecture with Rotated Refresh Tokens

### Context
We require secure, resilient authentication that guards against XSS token theft, CSRF, and session replay attacks.

### Options Considered
1. **Single Long-Lived JWT in LocalStorage:** High XSS vulnerability; impossible to invalidate without maintaining a massive blacklist.
2. **Server-Side Stateful Sessions (Express Session + Redis):** Requires database lookup on every single API request.
3. **Dual-Token Architecture:** Short-lived JWT access token (15m) + rotated long-lived refresh token (7d) stored in HTTP-only cookies and tracked in MongoDB.

### Decision
**Adopt the Dual-Token Architecture with Refresh Token Rotation.**

### Rationale
- HTTP-only, `SameSite=Lax` cookies prevent client-side JavaScript access, neutralizing XSS credential extraction.
- Short-lived 15-minute access tokens eliminate database overhead on high-frequency API routes.
- Refresh token rotation detects and blocks token replay attacks: if a stolen token is reused, the server detects the divergence and immediately revokes all sessions associated with that user.

---

## ADR-008: 60-Participant Capacity & Simulcast Subscription Model

### Context
Supporting up to 60 participants is a critical architectural target that requires strict bandwidth and CPU management on consumer hardware.

### Options Considered
1. **Fixed Resolution Broadcast:** Publish 720p; all subscribers receive 720p.
2. **Client-Side Simulcast with Adaptive Viewport Subscription:** Publish 3 layers (High, Mid, Low); clients subscribe only to visible layers.

### Decision
**Adopt Client-Side Simulcast with Dynacast and Active Speaker Swapping.**

### Rationale
- In a 60-participant meeting, rendering 60 simultaneous 720p streams requires over 90 Mbps downlink bandwidth and crushes client hardware decoders.
- With simulcast and adaptive subscription:
  - Non-visible participants (paginated out of view) have their video tracks paused on the SFU.
  - Visible thumbnail tiles receive Low (180p @ 15fps, ~100 kbps) or Mid (360p @ 20fps, ~300 kbps).
  - Only the active dominant speaker or screen share receives High (720p/1080p @ 30fps, ~1.5 Mbps).
  - Total downstream bandwidth is estimated at a provisional architectural target of under 3.5 Mbps, well within standard broadband capabilities.

### Capacity & Performance Limitations
- The 60-participant figure and sub-3.5 Mbps bandwidth profile represent **planned architectural targets and design limits**, not empirically proven or guaranteed capacities in Phase 01.
- Formal validation, stress-testing, and threshold verification will be executed during **Phase 17 (Testing, Optimization & Responsiveness)** using synthetic load-testing agents.

---

## ADR-009: "Modern Editorial" Visual Language over Generic SaaS Templates

### Context
The platform must stand out as a serious, professional, human-designed engineering project rather than an AI-generated prototype.

### Decision
**Enforce the Modern Editorial + Premium Collaboration SaaS Design Standard.**

### Rationale
- Utilizes an intentional high-contrast dual surface palette: Warm Ivory (`#F7F6F2`) for productive daytime dashboard use, and Deep Dark (`#101820`) for focused, low-fatigue conference sessions.
- Employs classic typography pairing: Manrope for strong geometric editorial headings, Inter for high-legibility UI text, and JetBrains Mono for meeting codes and technical readouts.
- Strictly bans gimmicky visual clutter: zero random floating particles, zero illegible heavy glassmorphism, and zero decorative animations that degrade rendering performance.

---

## ADR-010: Encryption Architecture: Transport Baseline vs. Phase 15 True E2EE (SFrame)

### Context
The security model must strictly define encryption boundaries and establish clear phase ownership for True End-to-End Encryption (E2EE) using SFrame / WebRTC Insertable Streams.

### Options Considered
1. **Claim E2EE on Baseline Transport:** Rely on HTTPS/WSS and WebRTC DTLS-SRTP and label the system "End-to-End Encrypted."
2. **Strict Boundary Separation with Dedicated Phase Ownership:** Acknowledge that standard SFU architecture terminates DTLS-SRTP in memory for track routing (Transport Encryption). Assign True E2EE (SFrame) to its designated security phase.

### Decision
**Adopt strict encryption transparency. All transport is encrypted via TLS 1.3 and DTLS-SRTP. True End-to-End Encryption (E2EE) using SFrame / Insertable Streams is formally assigned to Phase 15 – Encryption & Security. Phase 16 is strictly and exclusively dedicated to Scheduling & Meeting History.**

### Rationale
- Misrepresenting transport encryption as true E2EE is an architectural and security defect. LiveKit SFU must inspect RTP headers to forward simulcast layers; therefore, media packets are decrypted in-memory at the SFU node unless frame-level encryption (SFrame) is applied.
- By assigning E2EE evaluation and SFrame implementation strictly to **Phase 15 (Encryption & Security)**, the system maintains a clean phase boundary and ensures Phase 16 remains exclusively focused on **Scheduling & Meeting History**. Under no circumstances shall marketing or UI copy claim "End-to-End Encrypted" until Phase 15 verification is complete.

---

## ADR-011: Build System Upgrade — Vite 6.4.x and esbuild 0.25.x for Development Tooling Security

### Context
Phase 03 initially pinned Vite 5.4.21 and esbuild 0.21.5. A full security dependency audit identified multiple upstream security advisories in `vite <=6.4.3` (CWE-22 path traversal, Windows editor launcher argument injection GHSA-587h-7wmj-h5pm) and `esbuild <=0.24.2` (dev server request validation GHSA-67mh-4wv8-2f99).

### Options Considered
1. **Retain Vite 5.4.21:** Preserves initial Phase 01 specification text, but leaves development tooling vulnerable to known local dev server and compiler security advisories.
2. **Force-upgrade to Vite 8.x:** Premature bleeding-edge upgrade that introduces major breaking plugin and configuration changes.
3. **Targeted In-Major Upgrade to Vite 6.4.x with esbuild 0.25.x:** Fully resolves all compiler and dev server vulnerabilities while preserving complete backward compatibility with React 18, TypeScript 5.5, Tailwind CSS 3.4, and PostCSS.

### Decision
**Adopt Vite 6.4.6 and esbuild 0.25.12.**

### Rationale
- `@vitejs/plugin-react@4.7.0` natively supports `vite ^6.0.0` as a peer dependency.
- Node.js engine requirement (`>=18.0.0`) is completely satisfied by the development environment (Node 24.19.0).
- Upgrading to `vite@6.4.6` cleanly resolves `esbuild` to `0.25.12`, eliminating all High and Moderate severity development vulnerabilities.
- Verification tests (`npm run typecheck`, `npm run lint`, `npm run build`, and live headless Chrome testing) confirm 100% regression-free behavior across all desktop, tablet, and mobile layouts.
