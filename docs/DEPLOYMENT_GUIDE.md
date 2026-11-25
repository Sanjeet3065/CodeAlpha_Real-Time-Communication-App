# CONNECTLY — PRODUCTION DEPLOYMENT & ZERO-BUDGET ARCHITECTURE GUIDE
## Phase 18: Deployment & Documentation (Sprint 03 Final Reconciled Edition)

**Document Version:** 1.3.0  
**Phase:** 18 — Deployment & Documentation  
**Target Architecture:** Zero-Budget ($0.00) Constrained Public Showcase  
**Topology:** Single-Origin Reverse Proxy (Option 1B) with Feature-Gated Storage (Option 2B)  
**Revalidation Date:** November 2026  

---

> [!WARNING]
> **DISCLAIMER ON ZERO-BUDGET ($0.00) PUBLIC SHOWCASE LIMITATIONS**  
> This zero-budget deployment architecture is designed **strictly for demonstration, evaluation, and public showcase purposes**. It operates within the stringent quotas of free-tier cloud providers and is **NOT** certified for enterprise mission-critical production.
> 
> Critical Quota Realities:
> - **Koyeb Free Tier:** Provides 1 free Web Service instance per organization (indefinite, not a 750-hour time-limited bucket). Allocated 512 MB RAM, 0.1 vCPU, and 2 GB SSD in Frankfurt (`fra`) or Washington, D.C. (`was`). The instance automatically scales down to zero ("deep sleep") after **1 hour of zero inbound HTTP traffic**. The documented platform startup behavior from deep sleep is **1 to 5 seconds** ([Koyeb Free Tier Reference](https://www.koyeb.com/docs/reference/free-tier)). Any longer spin-up latency (such as 30–60s) represents unverified empirical observation (e.g. during cold container image pulling or heavier application initialization) rather than documented platform behavior. Koyeb explicitly designates the Free tier for prototyping, hobby experiments, and personal projects, and does **not** recommend it for production workloads. Registration requires credit/debit card verification for fraud prevention ($0 billed).
> - **MongoDB Atlas M0:** Shared RAM/vCPU with a strict 512 MB storage limit. Operates as a 3-node replica set supporting multi-document ACID transactions, but does **not** provide automated snapshots, point-in-time recovery, dedicated IOPS, or AWS/GCP VPC peering / PrivateLink (which require dedicated M10+ tiers).
> - **Upstash Redis Free:** Hard cap of **500,000 commands/month** (average ~16,666 commands/day), **10 GB bandwidth/month**, **250 MB data storage**, and a peak throughput ceiling of 10,000 commands/sec. Exceeding monthly commands results in command throttling or rejection until the next billing cycle. The free tier operates on a best-effort basis without a production SLA or multi-zone high availability (HA).
> - **LiveKit Cloud "Build" (Free) Tier:** Provides **5,000 participant-minutes/month**, **100 concurrent connections**, and **50 GB egress data transfer/month** (ingress is free). SFU media services strictly cut off (hard limit) once any quota is exhausted until the next monthly billing cycle.
> - **Signaling vs. WebRTC Media Transport:**
>   - **Signaling Gateway:** Token issuance and admission checks occur via HTTP (`/api/v1/meetings/:code/join`), and WebSocket signaling is negotiated either through the `/livekit-signal` gateway or directly via LiveKit Cloud (`wss://<project>.livekit.cloud`). This signaling traffic is lightweight (JSON control messages) and is proxied through the reverse proxy.
>   - **WebRTC Media Transport:** Actual audio and video streams (RTP/SRTP over UDP/DTLS) flow **directly between participant client browsers and LiveKit Cloud SFU edge servers**. Real-time media packets do **NOT** traverse the Cloudflare Worker reverse proxy or Koyeb backend.
> - **Client Subscription Architecture & Active-Speaker Semantics:**
>   - In CONNECTLY (`client/src/services/livekitClient.ts`), the LiveKit SDK connects with `autoSubscribe: true` by default.
>   - Endpoints subscribe to all published audio tracks in the room. Active-speaker detection (`RoomEvent.ActiveSpeakersChanged`) drives dynamic UI highlighting, speaker ordering, and dominant speaker framing in the layout grid; it does **not** dynamically unsubscribe or detach non-speaking audio tracks at the SFU level.
>   - Bandwidth optimization during periods of silence is handled at the codec layer via **Opus DTX (Discontinuous Transmission)**, which suppresses packet transmission during silence and reduces quiescent audio bitrate to approximately 1–2 kbps per idle stream on the wire.
>   - For video, the client enables `adaptiveStream: true` and simulcast (180p, 360p, 720p). The LiveKit client library monitors DOM element dimensions and visibility, pausing offscreen video tracks and requesting lower-resolution layers for smaller grid tiles.
> - **Participant-Minutes Hard Ceiling & Session Budgets:**
>   Every connected participant in a room consumes exactly 1 participant-minute per clock minute, regardless of whether they publish or subscribe to tracks:
>   - **4 Participants:** $5{,}000 \div 4 = 1{,}250\text{ meeting minutes} = 20.83\text{ total meeting hours} \implies \mathbf{83\text{ demo sessions}}$ (15 minutes each).
>   - **6 Participants:** $5{,}000 \div 6 \approx 833.33\text{ meeting minutes} = 13.89\text{ total meeting hours} \implies \mathbf{55\text{ demo sessions}}$ (15 minutes each).
>   - **10 Participants:** $5{,}000 \div 10 = 500\text{ meeting minutes} = 8.33\text{ total meeting hours} \implies \mathbf{33\text{ demo sessions}}$ (15 minutes each).
>   - **60 Participants:** $5{,}000 \div 60 \approx 83.33\text{ meeting minutes} = 1.39\text{ total meeting hours} \implies \mathbf{5\text{ demo sessions}}$ (15 minutes each) total for the entire calendar month.
> - **Theoretical Media Egress Calculations (Estimates, Not Guaranteed Consumption):**
>   All bandwidth rates below represent *theoretical modeling estimates* based on constant bitrates, not guaranteed real-world consumption:
>   - *Unit Standard:* All egress calculations use standard networking decimal units ($50\text{ GB} = 50 \times 10^9\text{ bytes} = 400{,}000\text{ Mb}$). In binary gigabytes ($2^{30}\text{ bytes}$), $50\text{ GiB} \approx 429{,}496.7\text{ Mb}$ (~7% higher).
>   - *Audio Scenario 1 — Theoretical Unconstrained SFU Forwarding ($N=60$):* If all 60 participants published audio simultaneously at 32 kbps and all 59 other participants received every track ($60 \times 59 = 3{,}540$ tracks):
>     $$\text{Theoretical Raw Egress} = 3{,}540 \times 32\text{ kbps} = 113.28\text{ Mbps} \approx 14.16\text{ MB/s} \implies T_{\text{exhaust}} \approx 58.85\text{ minutes}$$
>   - *Audio Scenario 2 — Realistic Conversational Audio with Opus DTX ($K \le 5$ simultaneous speakers):* With Opus DTX suppressing silent streams to ~1–2 kbps and up to 5 concurrent active speakers:
>     $$\text{Estimated Egress} \approx (60 \times 5 \times 32\text{ kbps}) + (60 \times 55 \times 1.5\text{ kbps}) \approx 9.6\text{ Mbps} + 4.95\text{ Mbps} = 14.55\text{ Mbps} \implies T_{\text{exhaust}} \approx 7.6\text{ hours}$$
>   - *Video Scenario 1 — Theoretical All-to-All Full Forwarding ($N=60$, 250 kbps thumbnail):*
>     $$60 \times 59 \times 250\text{ kbps} = 885\text{ Mbps} \implies T_{\text{exhaust}} \approx 7.53\text{ minutes}$$
>   - *Video Scenario 2 — Adaptive Grid (9 Visible Tiles at 250 kbps, Offscreen Paused):*
>     $$60 \times 9 \times 250\text{ kbps} = 135\text{ Mbps} \approx 16.88\text{ MB/s} \implies T_{\text{exhaust}} \approx 49.38\text{ minutes}$$
> - **Sustainable Showcase Capacity:** For public demonstration purposes, recommended session sizes are **4 to 6 concurrent participants** with active audio and video. Sessions with 10+ participants should be scheduled carefully to avoid rapid quota exhaustion.

---

## 1. REVALIDATED ZERO-BUDGET PROVIDER MATRIX

All provider plans, quotas, and constraints were independently revalidated against official vendor documentation in November 2026:

| Provider & Role | Plan / Tier | Verified Free Quota & Limits | In-Transit Encryption | Date Checked | Official Source Documentation | Suitability & Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Workers**<br>*(Single-Origin Reverse Proxy)* | Free Plan | 100,000 req/day (UTC reset)<br>10ms CPU time/request<br>128 MB RAM, 50 subrequests<br>WebSockets supported<br>Free `*.workers.dev` subdomain | Mandatory TLS at edge | Nov 2026 | [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) | **EXCELLENT** — Routes frontend, API, WebSocket upgrades, and LiveKit signaling under one domain. Solves cross-site cookie blocking. Hard stop on daily quota. |
| **Cloudflare Pages**<br>*(Frontend Static SPA Hosting)* | Free Plan | Unlimited requests & bandwidth<br>500 builds/month<br>100 custom domains<br>20,000 files/deployment | Mandatory TLS at edge | Nov 2026 | [Cloudflare Pages Pricing](https://developers.cloudflare.com/pages/platform/pricing/) | **EXCELLENT** — Hosts compiled React 18 + Vite SPA bundle with global CDN edge caching. |
| **Koyeb**<br>*(Backend Container Service)* | Free Tier<br>*(Web Service)* | 1 free service per org<br>512 MB RAM, 0.1 vCPU<br>2 GB SSD (fra/was regions)<br>Auto scale-to-zero after 1h idle | HTTPS edge terminated | Nov 2026 | [Koyeb Pricing](https://www.koyeb.com/pricing)<br>[Koyeb Free Tier Docs](https://www.koyeb.com/docs/reference/free-tier) | **SUITABLE WITH CAVEATS** — Card required for fraud verification at signup ($0 billed). Documented 1–5s cold start on wake-up. Not recommended by Koyeb for production. |
| **MongoDB Atlas**<br>*(Primary Document Database)* | Shared M0 Cluster | 512 MB storage<br>Shared RAM / vCPU<br>3-node replica set<br>ACID multi-document transactions | TLS 1.2+ mandatory (`mongodb+srv://`) | Nov 2026 | [MongoDB Atlas Pricing](https://www.mongodb.com/pricing) | **EXCELLENT** — Satisfies mandatory multi-document transaction and change-stream requirements. No automated backups or VPC peering on M0. |
| **Upstash Redis**<br>*(Distributed Cache, Rate Limiting, Presence)* | Free Tier | 500,000 commands/month<br>10 GB bandwidth/month<br>250 MB data storage<br>10,000 max cmds/sec | Mandatory TLS (`rediss://`) | Nov 2026 | [Upstash Redis Pricing](https://upstash.com/pricing/redis) | **EXCELLENT** — Enforces TLS on port 6379/6380 (`rediss://`). Native Lua script and Redis command support. Best-effort SLA, no multi-zone HA. |
| **LiveKit Cloud**<br>*(Real-Time WebRTC Audio/Video SFU)* | "Build" Tier<br>*(Free)* | 5,000 participant-min/month<br>100 concurrent connections<br>50 GB egress bandwidth<br>Free ingress bandwidth | Mandatory WSS/HTTPS | Nov 2026 | [LiveKit Cloud Pricing](https://livekit.io/pricing) | **SUITABLE FOR SMALL DEMOS** — Hard cutoff on quota exhaustion. Showcase capped at 4–6 concurrent media participants per room. |
| **AWS S3**<br>*(Cloud Object Storage)* | Standard / Free Tier | 5 GB storage (12-mo free tier)<br>Bucket Versioning required | Mandatory TLS | Nov 2026 | [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/) | **OPTIONAL / DISABLED** — Bypassed via Option 2B (`ENABLE_FILE_SHARING=false`, `STORAGE_PROVIDER=disabled`) for zero-budget setup. |

---

## 2. ARCHITECTURE TOPOLOGY & DATA FLOW

```
                                      PUBLIC INTERNET
                                     (Client Browsers)
                                  ┌──────────┴───────────────────────────────┐
                HTTPS / WSS       │                                          │ Direct Signaling (optional wss://)
     (SPA, /api/*, /socket.io/*,  │                                          │ & Direct WebRTC Media Streams
               /livekit-signal/*) ▼                                          │ (DTLS-SRTP over UDP 50000-60000;
               ┌──────────────────────────────────┐                          │  bypasses Worker & Koyeb backend)
               │ Cloudflare Worker Reverse Proxy  │                          │
               │ (Single Origin, X-Proxy-Secret)  │                          │
               └──────┬─────────────────────┬─────┘                          │
                      │                     │                                │
         Static / SPA │          Auth Proxy │                                │
              Routes  │      (/api/*,       │                                │
                      │      /socket.io/*,  │                                │
                      ▼   /livekit-signal/*)▼                                ▼
        ┌──────────────────────────┐  ┌─────┴──────────────────────┐     ┌───┴──────────────────────┐
        │  Cloudflare Pages SPA    │  │     Koyeb Web Service      │────►│ LiveKit Cloud Build Tier │
        │ (React 18 + Vite Bundle) │  │    (Node 20 Container)     │API/ │  WebRTC Audio/Video SFU  │
        └──────────────────────────┘  └───────┬─────────────┬──────┘Token└──────────────────────────┘
                                              │             │
                                              ▼             ▼
                                ┌───────────────────┐ ┌──────────────────┐
                                │ MongoDB Atlas M0  │ │  Upstash Redis   │
                                │ Replica Set (ACID)│ │  rediss:// (TLS) │
                                └───────────────────┘ └──────────────────┘
                                              │
                                 [File Sharing DISABLED (Opt 2B)]
                                 No S3 Bucket Required for $0 Boot
```

### Routing Rules Implemented in `proxy/src/worker.js`:
- `/api/v1/*`: Proxied to Koyeb backend (`BACKEND_ORIGIN/api/v1/*`), with incoming client `Host` deleted so upstream receives virtual-host name. Dynamic cache headers set to `no-store, no-cache, must-revalidate, proxy-revalidate`.
- `/socket.io/*`: Proxied to Koyeb backend with WebSocket upgrade preservation (`HTTP 101 Switching Protocols`) and HTTP long-polling POST body forwarding.
- `/livekit-signal/*`: Proxied to Koyeb backend Signaling Admission Gateway with WebSocket upgrade preservation.
- Static assets (`/assets/*`, `/favicon.ico`) and SPA navigation (`/`, `/meeting/*`): Proxied to Cloudflare Pages (`FRONTEND_ORIGIN`).

---

## 3. SINGLE-ORIGIN REVERSE PROXY PACKAGE (`proxy/`)

The repository includes a ready-to-deploy Cloudflare Worker package in the `proxy/` directory:

### Directory Structure:
```
proxy/
├── package.json               # Wrangler script definitions and dependencies
├── wrangler.toml              # Worker name, entrypoint, compatibility flags, vars
├── .env.example               # Environment variables template
├── README.md                  # Comprehensive setup, test, and deploy instructions
├── src/
│   └── worker.js              # Reverse proxy routing logic, host rewriting, WS handling, origin validation
└── test/
    └── proxyRouting.test.js   # Automated unit tests for routing, headers, WS upgrades, polling, and 502 masking
```

### Host-Header Correctness Requirement:
Koyeb edge proxies route inbound traffic to customer containers based on the HTTP `Host` header. If a reverse proxy blindly forwards the client's public hostname (e.g. `connectly.workers.dev`), Koyeb cannot match the destination service and returns `404 Not Found` or `502 Bad Gateway`.

In `proxy/src/worker.js`, this is resolved by explicitly deleting the client `Host` header prior to forwarding:
```javascript
// Remove client Host header so Fetch runtime derives Host from upstream targetUrl
forwardedHeaders.delete('host');
```

### Worker-to-Backend Origin Authentication & Client IP Integrity (Phase 18 Sprint 06R & 06T: F-06S-01 through F-06S-05):
1. **Dynamic Cloudflare Worker Egress IP Architecture:**
   Cloudflare Workers execute on Cloudflare's global edge network. Outbound `fetch()` calls to upstream backends originate from dynamic anycast IP pools rather than fixed, static IP addresses. Consequently, traditional network-layer IP allowlisting is infeasible on zero-budget PaaS environments without costly Cloudflare Enterprise Static Egress IPs.
2. **Server-to-Server Origin Authentication (`PROXY_SECRET` / `X-Proxy-Secret`):**
   To ensure the backend container (`connectly-backend.koyeb.app`) is only accessible through the Cloudflare Worker and cannot be targeted directly by attackers attempting to bypass Cloudflare edge WAF or rate limits, CONNECTLY implements application-layer origin authentication:
   - `PROXY_SECRET` is **MANDATORY in production**. Both startup validation and preflight checks fail closed if it is missing, weak, or a placeholder.
   - The Cloudflare Worker validates `env.PROXY_SECRET` and fails closed (HTTP 500 `PROXY_CONFIGURATION_ERROR`) if missing or invalid.
   - The Cloudflare Worker attaches `X-Proxy-Secret: <PROXY_SECRET>` to all outbound backend requests.
   - Inbound client-supplied `X-Proxy-Secret`, `X-Verified-Client-IP`, `X-Forwarded-For`, and `X-Real-IP` headers are unconditionally stripped at the Worker edge before request forwarding.
   - The backend validates the secret using constant-time timing-safe comparison (`crypto.timingSafeEqual`) in `server/src/middlewares/originAuth.ts`.
   - Direct requests lacking the secret are rejected with HTTP 403 `ORIGIN_AUTHENTICATION_REQUIRED`.
3. **Canonical Client IP Integrity & Rate Limiter Defense:**
   - The Worker extracts the real client IP **exclusively from Cloudflare's trusted TCP socket header `CF-Connecting-IP`** (falling back to nothing, returning HTTP 400 `INVALID_CLIENT_IP` if missing or malformed).
   - Incoming `X-Forwarded-For` is completely replaced with the validated edge client IP.
   - Upon origin authentication, the backend overrides `req.ip` with `X-Verified-Client-IP`, ensuring all Express rate limiters, auth auditing, and security logging operate on true client identities rather than spoofed headers.
4. **Health Probe Exemption & Trailing-Slash Consistency:**
   - Container orchestration liveness/readiness probes (`/health`, `/health/`, `/health/ready`, `/health/ready/`, `/api/v1/health`, `/api/v1/health/`, etc.) bypass origin authentication so platform health monitors (e.g., Koyeb or Render health checkers) succeed without holding secrets. No other routes are exempt.

### Running Proxy Automated Tests:
```bash
npm run test:proxy
# or: node --test proxy/test/proxyRouting.test.js
```

### Deploying the Proxy to Cloudflare:
```bash
cd proxy
npm install
npx wrangler login
npx wrangler deploy
```

---

## 4. REQUIRED ENVIRONMENT VARIABLES & SECURITY CONFIGURATION

### Backend Environment (`server/.env.production`)
| Variable | Required | Production Constraint | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Yes | Numeric (Default: `5000`) | Internal listening port for Express. |
| `NODE_ENV` | Yes | Strictly `production` | Enables production security gates and optimizations. |
| `CLIENT_ORIGIN` | Yes | Strictly `https://...` | Public HTTPS domain of Cloudflare Worker proxy. |
| `JWT_ACCESS_SECRET` | Yes | Min 32 chars, high entropy | Cryptographic secret for signing short-lived access tokens. |
| `JWT_REFRESH_SECRET` | Yes | Min 32 chars, high entropy | Cryptographic secret for signing long-lived refresh tokens. |
| `CONNECTLY_ENCRYPTION_KEY_V1` | Yes | 64 hex chars (256 bits) | AES-256 envelope encryption key for sensitive user fields. |
| `TRUST_PROXY` | No | Numeric hop ("1", "2") or preset ("loopback", "uniquelocal") | Express reverse proxy trust level (F-06O-03, F-06Q-02). Default: "1" behind PaaS ingress. Setting "true" or arbitrary strings is strictly prohibited by startup validation. |
| `PROXY_SECRET` | Yes (Mandatory in prod) | Strictly 64 hex chars (256 bits) | Worker-to-backend origin authentication secret (F-06S-01, F-06S-02). Mandatory in production; startup fails immediately if missing, weak, or placeholder. Direct backend requests lacking secret return HTTP 403. |
| `MONGODB_URI` | Yes | Must be a **Replica Set** | Connection URI for MongoDB Atlas cluster (`mongodb+srv://...`). |
| `REDIS_URL` | Yes | Strictly `rediss://` | Upstash Redis connection URI with mandatory TLS. |
| `REDIS_SOCKET_PREFIX` | No | Default: `connectly:socketio` | Namespace prefix for Socket.IO multi-instance events. |
| `SOCKET_IO_ADAPTER` | Yes | `redis` (or `mongo`) | Adapter for distributed Socket.IO event coordination. |
| `SOCKET_IO_MULTI_INSTANCE` | Yes | `true` | Enforces distributed Socket.IO synchronization. |
| `LIVEKIT_URL` | Yes | Strictly `wss://` | LiveKit Cloud WebSocket endpoint (`wss://<project>.livekit.cloud`). |
| `LIVEKIT_API_KEY` | Yes | Valid API key | LiveKit API Key from LiveKit Cloud dashboard. |
| `LIVEKIT_API_SECRET` | Yes | Valid API secret | LiveKit API Secret from LiveKit Cloud dashboard. |
| `LIVEKIT_TOKEN_TTL_SECONDS` | No | Default: `600` (10 mins) | Time-to-live for LiveKit video room tokens. |
| `LIVEKIT_SIGNAL_GATEWAY_ENABLED` | No | Default: `auto` | Enforces admission checks before SFU signaling. |
| `ENABLE_FILE_SHARING` | Yes | Strictly `false` (for $0 mode) | Disables file upload/download endpoints and UI. |
| `STORAGE_PROVIDER` | Yes | Strictly `disabled` (for $0 mode) | Safely bypasses S3 bucket versioning check at boot. |

### Frontend Environment (`client/.env.production`)
| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | No | Default: `/api/v1` (routes to same origin under reverse proxy). |
| `VITE_SOCKET_URL` | No | Default: `window.location.origin` (same origin via proxy). |
| `VITE_SOCKET_IO_URL` | No | Alias for `VITE_SOCKET_URL`. |
| `VITE_ENABLE_FILE_SHARING` | Yes | Strictly `false` (hides Files panel and sidebar tab). |

---

## 5. KOYEB BACKEND HOSTING & COLD-START MITIGATION

1. **Deployment Type**: Web Service (Docker container or GitHub repository deployment).
2. **Container Build**: Use `server/Dockerfile` located at the root of the server directory.
3. **Health Check Configuration**:
   - Path: `/api/v1/health`
   - Port: `5000`
   - Initial delay: 15s
4. **Single-Instance Deployment Reliability, Reconnection & Cold-Start Realities**:
   - **Zero-Downtime Rolling Deployment is NOT Guaranteed:** On the Koyeb Free tier, an organization is allocated strictly 1 microVM instance (`max_scale = 1`). During a deployment or container update, the single instance must be restarted, resulting in momentary service downtime (typically 5–15 seconds) and the termination of active TCP connections. True zero-downtime rolling updates require multiple instances (`min_instances >= 2`) on standard paid tiers.
   - **Cold-Start Latency:** Koyeb Free instances automatically scale down to zero ("deep sleep") after **1 hour of continuous zero inbound HTTP traffic**. Documented platform wake-up latency is **1 to 5 seconds** ([Koyeb Free Tier Reference](https://www.koyeb.com/docs/reference/free-tier)). Empirical delays of 30–60 seconds may occur during cold container image pulls or initial multi-tenant database/Redis TLS handshakes. Visitors arriving during sleep will experience a loading state or spinner while the instance wakes.
   - **Socket.IO Reconnection Behavior:** When the backend restarts, the CONNECTLY frontend's Socket.IO client automatically detects disconnect and initiates exponential backoff reconnection (`reconnectionDelay: 1000ms`, `reconnectionDelayMax: 5000ms`, unlimited attempts). As soon as the container is healthy, clients re-establish presence and resynchronize room state.
   - **WebRTC Media Resilience:** For meetings already in progress using LiveKit Cloud, **WebRTC audio and video streams continue uninterrupted** during backend container restarts. Because media packets flow directly between client browsers and LiveKit Cloud SFU edge servers, a restart of the Koyeb backend only temporarily pauses signaling, chat, and whiteboard synchronization without dropping video/audio calls.
   - **Keepalive Evaluation & Rejection:** Synthetic keepalive traffic (e.g., automated pings via UptimeRobot or cron) is **not recommended**. Artificial keepalive traffic circumvents provider resource management policies, introduces fragile external dependencies, risks provider rate-limiting or abuse flags, and does not provide an enterprise-grade reliability guarantee.
   - Koyeb explicitly designates the Free tier for prototyping, personal projects, and hobby experiments. It does **not** recommend this tier for production workloads. Reliable commercial production requires standard hosting with minimum instances set to $\ge 1$ to eliminate scale-to-zero entirely.

### 5.1 Single-Instance Showcase Boundaries & Prerequisites Before Horizontal Scaling (`F-REV-04`)

CONNECTLY's initial zero-budget deployment architecture intentionally runs **a single backend instance (`max_scale = 1`)**. While Socket.IO event broadcasting and chat/whiteboard operation quotas already support Redis coordination (`@socket.io/redis-adapter`, `chatRedis.service.ts`), the following process-local or database-read behaviors **MUST** be updated before scaling horizontally (`replicas > 1`):

| Subsystem | Current Behavior (Safe for 1 Instance) | Limitation Under >1 Backend Replica | Required Change Before Horizontal Scaling |
| :--- | :--- | :--- | :--- |
| **HTTP Rate Limiters** (`server/src/middlewares/rateLimiter.ts`, `readinessLimiter` in `server/src/routes/health.routes.ts`) | Uses `express-rate-limit` default process-local `MemoryStore` (avoiding extra Redis command consumption on Upstash Free's 500k/mo cap). | Per-IP HTTP quotas (`register`, `login`, `refresh`, `meetingCreate`, `meetingAction`, `livekitToken`, `ready`) split independently across each replica (`N × limit`). | Attach a shared Redis rate-limit store (e.g., `rate-limit-redis`) backed by the existing `ioredis` TLS client. |
| **Whiteboard Operation Mutex** (`WhiteboardService.opQueues` in `server/src/services/whiteboard.service.ts`) | Serializes mutating operations per `meetingId` in a process-local `Map` before hitting MongoDB OCC retries (`WHITEBOARD_MAX_OCC_RETRIES = 5`). | Concurrent edits arriving at different backend replicas bypass the local mutex and race via MongoDB OCC writes, risking retry exhaustion under burst contention. | Add Redis distributed locking per `meetingId` (with bounded TTL lease) or sticky meeting-affinity routing across replicas. |
| **Whiteboard Cursor DB Reads** (`whiteboard:cursor` in `server/src/realtime/meetingSocket.ts`) | Executes `Meeting.findOne` + `MeetingParticipant.findOne` (`.lean()`) on every `whiteboard:cursor` event (throttled up to `30/sec` per socket) to guarantee zero stale admission after removal. | At higher room concurrency or multi-instance scale, cursor traffic can amplify MongoDB read IOPS and strain Atlas M0 shared limits. | Introduce a short-TTL in-process admission/epoch cache explicitly invalidated on `livekitRevocationCoordinator` and socket removal events, or lower cursor DB re-check frequency. |

---

## 6. MONGODB ATLAS M0 REPLICA SET & DATABASE NETWORK SECURITY

### 6.1 Replica Set Invariant
1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/) and create a **Free M0 Shared Cluster**.
2. Atlas M0 clusters run as a 3-node replica set automatically.
3. This satisfies CONNECTLY's mandatory multi-document ACID transaction requirements for whiteboard OCC, participant eviction, and outbox event dispatching.
4. Preflight verification strictly enforces replica set topology and **fails closed** if connected to a standalone instance.

### 6.2 Database Network Security: Technical Constraints vs. Recommended Security

> [!CAUTION]
> **NETWORK ACCESS SECURITY NOTICE & RESIDUAL RISK DISCLOSURE**  
> In MongoDB Atlas, adding `0.0.0.0/0` (Allow Access from Anywhere) makes the cluster's SRV host and port reachable from the public internet. Any machine on the internet can attempt TCP handshakes and database authentication against your cluster.
> 
> **Architectural Constraint Analysis:**  
> - Koyeb Free containers run on a shared, dynamic multi-tenant infrastructure pool without static outbound IP addresses. The free tier does not support AWS/GCP VPC Peering or dedicated PrivateLink endpoints.
> - MongoDB Atlas M0 (Free Tier) does not support VPC Peering or AWS PrivateLink (both require dedicated Atlas M10+ instances).
> - While regional IP blocks of Koyeb datacenters could theoretically be discovered, they change dynamically and allow ingress from all other unrelated tenants sharing the infrastructure.
> 
> **Production vs. Zero-Budget Showcase Verdict:**  
> - **Enterprise Production Deployment: BLOCKED.** Under enterprise security compliance standards, unrestricted database ingress (`0.0.0.0/0`) is strictly prohibited. Without VPC peering, PrivateLink, or static egress IP allowlisting, CONNECTLY cannot be certified for enterprise production on the $0 stack.
> - **Zero-Budget Public Showcase: CONDITIONALLY PERMITTED WITH HIGH RESIDUAL RISK.** For non-sensitive demonstrations and testing, `0.0.0.0/0` serves as an operational workaround solely if all compensating controls below are strictly verified and approved by the owner.
> 
> **Owner Security Decision Table:**  
> 
> | Requirement | Limited Public Demo Status |
> | :--- | :--- |
> | **Synthetic Test Data Only** | **Mandatory** — No real PII or sensitive data permitted |
> | **32+ Character Random Database Password** | **Mandatory** — High-entropy CSPRNG generated string |
> | **Least-Privilege Database User** | **Mandatory** — Scoped strictly to `readWrite` on `connectly` db |
> | **TLS 1.2+ Database Connection** | **Mandatory** — Enforced by SRV protocol (`mongodb+srv://`) |
> | **Public `0.0.0.0/0` Ingress** | **Explicit Owner Risk Acceptance Required** |
> | **Enterprise Network Isolation (VPC Peering / PrivateLink)** | **NOT SATISFIED** (Requires paid Atlas M10+ & private networking) |
> 
> **Residual Risk:**  
> Relying on `0.0.0.0/0` eliminates network-layer perimeter defense. Protection relies entirely on cryptographic authentication, transport encryption, and credential secrecy.
> 
> **Mandatory Compensating Security Controls:**  
> If `0.0.0.0/0` is utilized for a zero-budget public showcase:
> 1. **High-Entropy Credentials:** Generate a 32+ character cryptographically random database password using a CSPRNG (e.g. `openssl rand -base64 32`).
> 2. **Least-Privilege User:** Create a dedicated database user whose privileges are strictly scoped to `readWrite` on the `connectly` database only. Do **not** assign `atlasAdmin`, `readWriteAnyDatabase`, or cluster management roles.
> 3. **Mandatory In-Transit Encryption:** Enforce TLS 1.2+ for all database connections using the SRV protocol (`mongodb+srv://`).
> 4. **Zero Production Data:** Treat the database as ephemeral/non-confidential; never ingest real user credentials, PII, or confidential meeting data into a cluster with `0.0.0.0/0` access.
> 5. **Credential Containment:** Never commit database credentials to git repositories or log them in terminal output. Store them exclusively in Koyeb backend environment variables.
> 6. **Recommended Enterprise Configuration:** For commercial production deployments, migrate to a hosting setup providing static outbound IPs (e.g. Koyeb Pro with static IPs or AWS ECS/Fargate with NAT Gateway) or configure AWS/GCP VPC Peering paired with an Atlas M10+ cluster to strictly restrict database ingress to authorized private subnets.
> 
> **Owner Action Instruction:** Do **not** apply `0.0.0.0/0` blindly without understanding this residual risk and verifying all compensating controls above. If strict network isolation is required, do not proceed with deployment.

---

## 7. UPSTASH REDIS (FREE TIER) SETUP

1. Log in to [Upstash Console](https://console.upstash.com/) and create a **Serverless Redis Database**.
2. **Region**: Match backend compute region to minimize round-trip latency.
3. **TLS Enforcement**: Ensure **TLS is Enabled** (mandatory).
4. **Copy Connection String**: Select the `ioredis` tab and copy the `rediss://` URL.
5. **Limits & Monitoring**:
   - Monthly Command Quota: **500,000 commands/month** (~16,666 commands/day average).
   - Monthly Bandwidth Quota: **10 GB/month**.
   - Storage Quota: **250 MB**.
   - Peak Throughput: 10,000 commands/sec.
   - In-Transit Encryption: Mandatory TLS (`rediss://`). CONNECTLY preflight and runtime reject unencrypted `redis://` remote URLs.
   - SLA: Best-effort community support, no multi-zone HA. Commands exceeding 500k/month are throttled or rejected until the next billing cycle.

---

## 8. LIVEKIT CLOUD (BUILD TIER) SFU SETUP

1. Log in to [LiveKit Cloud](https://cloud.livekit.io/) and create a new project.
2. Under **Project Settings > Keys**, generate an API Key and Secret.
3. Set `LIVEKIT_URL` to `wss://<your-project>.livekit.cloud`.
4. **Signaling Admission Gateway Modes (`LIVEKIT_SIGNAL_GATEWAY_ENABLED`):**
   - **`auto` (Default):** For LiveKit Cloud hosts (`*.livekit.cloud`), clients connect directly to the LiveKit Cloud signaling WebSocket endpoint. Token revocation on participant removal is enforced via LiveKit Cloud's native control plane (`revokeTokenTs`). For self-hosted instances (`localhost`, private IPs), signaling routes through CONNECTLY's `/livekit-signal` admission gateway automatically.
   - **`true` (Strict Gateway Mode):** Forces all browser signaling connections to route through CONNECTLY's authoritative `/livekit-signal` admission gateway on Koyeb, even when using LiveKit Cloud. This guarantees that all WebSocket upgrades are vetted against MongoDB admission status, token epoch, and atomic linearization fences in CONNECTLY's application tier before being proxied upstream.
   - **`false` (Direct Mode):** Always bypasses `/livekit-signal` and connects directly to `LIVEKIT_URL` (requires public URL).
5. **Quota Realities**:
   - 5,000 participant-minutes/month free.
   - 100 concurrent connections.
   - 50 GB outbound data transfer/month free.
   - Free ingress bandwidth.
   - Hard cutoff upon exhaustion until the next billing cycle.
   - **Recommended showcase meeting size:** **4 to 6 concurrent participants** with audio and video enabled.

---

## 9. FILE SHARING FEATURE GATE (OPTION 2B) & DOWNLOADS CLARIFICATION

### 9.1 Zero-Budget Feature Gate (Option 2B)
When file sharing is disabled (`ENABLE_FILE_SHARING=false` / `STORAGE_PROVIDER=disabled`):
- **Client**: `VITE_ENABLE_FILE_SHARING=false` strips the Files navigation tab, mobile drawer toggle, and `FilesPanel` from rendering. The Downloads page (`/dashboard/downloads`) displays the Screen 23 Empty State ("No Files Downloaded or Shared Yet").
- **Server**: All six file endpoints (`POST /files/upload`, `POST /files/init-upload`, `POST /files/:id/complete`, `GET /files`, `GET /files/:id/download`, `DELETE /files/:id`) and `GET /users/me/shared-files` strictly return `403 FEATURE_DISABLED`.
- **Startup**: `server.ts` safely skips `verifyBucketVersioning()`, allowing the backend to boot cleanly without AWS S3 credentials or credit-card requirements.

### 9.2 Functional Audit: Available Meeting Files vs. Confirmed Download History
- **Current Data Contract:** In the existing implementation, `GET /api/v1/users/me/shared-files` queries `MeetingParticipant` for attended meetings and returns `SharedFile` records uploaded to those rooms. The UI displays **meeting-shared files available for download**, rather than a persistent history of files the user has downloaded to their local disk.
- **Persistent Download History Proposal (Future Enhancement):** When file sharing is enabled with AWS S3 storage, a separate collection should be introduced to track individual download events without mutating existing `SharedFile` documents:
  - **Schema (`FileDownloadHistory`):**
    ```typescript
    {
      fileId: { type: Schema.Types.ObjectId, ref: 'SharedFile', required: true, index: true },
      meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      downloadedAt: { type: Date, default: Date.now, index: true },
      ipAddress: String,
      userAgent: String,
    }
    ```
  - **Persistence Hook:** In `FileService.getFileForDownload()`, after verifying participant admission, insert an audit record into `FileDownloadHistory`.
  - **API Endpoint:** Expose `GET /api/v1/users/me/download-history` with pagination to populate a dedicated "My Download History" view.

---

## 10. AUTHENTICATION & SAME-ORIGIN COOKIE BEHAVIOR

- **Cookie Specification**: Refresh tokens are stored exclusively in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie named `connectly_refresh`.
- **Path Scope (`path: '/api'`)**: In `server/src/utils/cookies.ts`, the cookie path is strictly defined as `path: '/api'`. This scope ensures:
  - The cookie is automatically attached by browsers to all API calls under `/api/*`, including `POST /api/v1/auth/refresh` for silent token refresh.
  - The cookie is accessible to `POST /api/v1/auth/logout`, enabling clean session termination and server-side cookie clearing (`res.clearCookie('connectly_refresh', { path: '/api', ... })`).
  - The cookie is never leaked to unrelated root paths or static assets (`/assets/*`).
- **Single-Origin Proxy Forwarding**:
  - Because the Cloudflare Worker serves both static frontend assets and the backend API from the same public domain (e.g. `connectly.workers.dev` or `connectly.yourdomain.com`), the browser treats `connectly_refresh` as a **first-party cookie**.
  - All asynchronous `fetch()` requests with `credentials: 'include'` reliably transmit `connectly_refresh` without triggering cross-site tracking blocks in modern browsers (Chrome, Safari ITP, Firefox).
  - The Cloudflare Worker (`proxy/src/worker.js`) preserves upstream `Set-Cookie` headers via `new Headers(upstreamResponse.headers)` without mangling cookie attributes.

---

## 11. PREFLIGHT READINESS AUDIT SCRIPT

Before initiating deployment, run the automated preflight verification script:

```bash
# In development (non-blocking warnings):
npm run verify:production --workspace=server -- --mode=development

# In staging (strict fail-closed verification):
npm run verify:production --workspace=server -- --mode=staging

# In production (strict fail-closed verification):
npm run verify:production --workspace=server -- --mode=production
```

### Preflight Gates Enforced:
1. **Environment Configuration & Cryptographic Keys:** JWT secrets >= 32 chars and non-default, valid 256-bit envelope encryption key, HTTPS client origin.
2. **Database Topology:** MongoDB connection and Replica Set multi-document transaction check. **Standalone MongoDB produces a hard FAIL in staging and production.**
3. **Redis TLS & Dynamic Connectivity:** Validates `rediss://` scheme, establishes connection with 5000ms bounded timeout, sends `PING`, executes atomic Lua script, verifies authentication without logging secrets, closes socket immediately, and disables reconnect loops.
4. **LiveKit SFU Authenticated API:** Validates configuration and executes authenticated `RoomServiceClient.listRooms()` API call with 5000ms bounded timeout, native SDK request timeout, and sanitized error messages.
5. **Storage & Feature Gate:** Validates S3 bucket versioning when enabled; safely bypasses object storage when `ENABLE_FILE_SHARING=false` and `STORAGE_PROVIDER=disabled`.

---

## 12. NON-CIRCULAR DEPLOYMENT SEQUENCE & OPERATOR CHECKLIST

### 12.1 Non-Circular Step-by-Step Deployment Sequence
To prevent circular dependency between Koyeb backend origin and Cloudflare Worker proxy domain:

```
Step 1: Provision Atlas M0 & Upstash Redis & LiveKit Cloud (Data Stores)
                           │
                           ▼
Step 2: Deploy Frontend SPA to Cloudflare Pages (dist/)
        --> Generates: https://connectly-pages.pages.dev
                           │
                           ▼
Step 3: Deploy Backend Container to Koyeb Web Service
        - Set CLIENT_ORIGIN="https://connectly-pages.pages.dev" (Temporary)
        - Configure MONGODB_URI, REDIS_URL, LIVEKIT_*, JWT_*
        - Set PROXY_SECRET="<openssl rand -hex 32>"
        --> Generates: https://connectly-backend.koyeb.app
                           │
                           ▼
Step 4: Deploy Cloudflare Worker Reverse Proxy (proxy/)
        - Set BACKEND_ORIGIN="https://connectly-backend.koyeb.app"
        - Set FRONTEND_ORIGIN="https://connectly-pages.pages.dev"
        - Set PROXY_SECRET="<same secret as Step 3>" via `wrangler secret put PROXY_SECRET`
        --> Generates: https://connectly-proxy.workers.dev (Final Public Origin)
                           │
                           ▼
Step 5: Finalize Koyeb Backend CLIENT_ORIGIN
        - Update CLIENT_ORIGIN="https://connectly-proxy.workers.dev"
        --> Koyeb triggers container restart (expect momentary connection drop on single-instance free tier); CORS & CSRF align perfectly under the single public origin.
```

### 12.2 Operator Checklist (Owner Steps)
Before declaring the deployment live, verify every item:
- [ ] MongoDB Atlas M0 cluster provisioned, 32+ char password set, dedicated user created, and residual risk of network access reviewed.
- [ ] Upstash Redis database created with TLS (`rediss://`) enabled.
- [ ] LiveKit Cloud project created and API key/secret generated.
- [ ] Cloudflare Pages project created for frontend build (`client/dist`).
- [ ] Koyeb web service deployed with container image from `server/Dockerfile`.
- [ ] `PROXY_SECRET` generated (`openssl rand -hex 32`) and configured identically in Koyeb web service and Cloudflare Worker secrets.
- [ ] Cloudflare Worker deployed from `proxy/` with `BACKEND_ORIGIN`, `FRONTEND_ORIGIN`, and `PROXY_SECRET` configured.
- [ ] Koyeb `CLIENT_ORIGIN` updated to Cloudflare Worker domain.
- [ ] `ENABLE_FILE_SHARING=false` and `STORAGE_PROVIDER=disabled` set in backend environment.
- [ ] `VITE_ENABLE_FILE_SHARING=false` set in frontend build environment.
- [ ] Cloudflare Pages SPA fallback rule (`client/public/_redirects` containing `/* /index.html 200`) verified in build output.
- [ ] Reverse proxy trust configured (`TRUST_PROXY=1` or `TRUST_PROXY=2`) in backend environment.
- [ ] Origin authentication verified: direct HTTP request to Koyeb backend returns HTTP 403 `ORIGIN_AUTHENTICATION_REQUIRED`, while `/health` returns HTTP 200 OK.
- [ ] Preflight validation passes with zero errors: `npm run verify:production --workspace=server -- --mode=production`.
- [ ] User registration, login, and token refresh verified on page reload.
- [ ] Meeting room creation, audio/video publication (4–6 users), chat, and collaborative whiteboard verified.

### 12.3 Deliberate Manual Deployment Governance & Architectural Boundaries (Sprint 06P)
1. **Deliberate Manual Deployment Policy:** CONNECTLY intentionally avoids automated continuous deployment (CD) workflows in `.github/workflows/`. Deployment is strictly an owner-governed, manual operation following the step-by-step checklists in this guide to prevent unsanctioned cloud billing or accidental production mutations.
2. **Preserved Enterprise Compliance Boundaries:**
   - **Cloud KMS Hardware Integration:** NOT IMPLEMENTED (`EnvKeyProvider` with envelope encryption active; AWS/GCP KMS hardware integration is a deferred enterprise upgrade).
   - **WORM Audit Storage:** NOT IMPLEMENTED (Application-tier durable persistence in MongoDB `security_audit_entries` with 90-day TTL is active; compliance WORM requires external AWS CloudWatch / Datadog object lock).
   - **True Media E2EE (SFrame):** NOT IMPLEMENTED (WebRTC media is encrypted hop-by-hop via standard DTLS/SRTP transport encryption; client-to-client SFrame frame transform encryption is not implemented).
   - **File Sharing Storage Gate:** Disabled on default zero-budget deployments (`ENABLE_FILE_SHARING=false`, `STORAGE_PROVIDER=disabled`).
   - **Compliance Claims:** Under no circumstances shall marketing, documentation, or UI copy claim HIPAA, SOC 2, or True End-to-End Encryption compliance on this zero-budget stack.

---

## 13. ROLLBACK PROCEDURE

In the event of a deployment failure or critical regression:
1. **Frontend Rollback**: In Cloudflare Pages, select the previous successful deployment and click **Rollback to this deployment**.
2. **Backend Rollback**: In Koyeb, trigger a rollback to the previous container image tag.
3. **Proxy Rollback**: In Cloudflare Workers, roll back to the previous deployment version.
4. **Database Safeguard**: Because no destructive database migrations are executed in Phase 18, the database schema remains backward-compatible with Phase 17 releases.

---

## 14. DURABLE LIVEKIT EVICTION RECOVERY & ADAPTIVE POLLING SYSTEM (PHASE 18 SPRINT 06)

Phase 18 Sprint 06 resolves the active-session token eviction vulnerability identified in Sprint 05F and eliminates unnecessary background database polling on free-tier infrastructure.

### 14.1 The Security Vulnerability & Active Connection Reality
Official LiveKit documentation and empirical verification confirm that JWT expiration (`exp`) is only evaluated during the initial WebSocket handshake authentication. Once connected, LiveKit client SDKs maintain long-lived media and signaling sessions. Furthermore, client SDKs may refresh participant tokens during an active session, updating token metadata. Therefore:
- **JWT expiration is NOT an active-session eviction mechanism.**
- Relying on a 600-second token TTL to terminate an evicted participant is insecure.
- If the LiveKit Cloud `removeParticipant()` REST API call fails during removal, the participant's media and signaling connections remain established.

### 14.2 Durable Eviction Architecture (`LiveKitEvictionJob`)
To guarantee eventual consistency and authoritative eviction, CONNECTLY implements a durable transactional outbox pattern for LiveKit participant removals:

```
[Host / API Removal Request]
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ MongoDB Multi-Document ACID Transaction                │
│  1. MeetingParticipant.admissionStatus = 'REMOVED'     │
│  2. MeetingParticipant.tokenEpoch += 1                 │
│  3. Insert LiveKitRevocationEvent (Realtime Gateway)    │
│  4. Insert LiveKitEvictionJob (Status: PENDING)        │
└───────────────────────────┬────────────────────────────┘
                            │ (Transaction Commits)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Immediate Post-Commit Execution Attempt                │
│  - Executes livekitEvictionWorker.processJobById()     │
│  - Calls LiveKit Cloud REST API                        │
│  - If successful: LiveKitEvictionJob -> COMPLETED      │
└───────────────────────────┬────────────────────────────┘
                            │ (If Cloud API Fails or Times Out)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Background Durable Worker (livekitEvictionWorker)      │
│  - Atomic findOneAndUpdate lease acquisition (20s)     │
│  - Session-scoped identity targeting:                  │
│    usr_<userId>_<admissionSessionId>                   │
│  - Presence inspection via RoomService.getParticipant()│
│    * If participant already absent (404) -> COMPLETED  │
│    * If still connected -> Retries evictParticipant()  │
│  - Exponential backoff with jitter (1s .. 30s)         │
│  - Retries up to maxRetries (5 attempts)               │
│  - On exhaustion: Status -> ESCALATED + Audit Log      │
└────────────────────────────────────────────────────────┘
```

#### Session-Scoped LiveKit Participant Identity & Zombie Prevention
In Sprint 06B, participant identities in LiveKit are uniquely scoped to each admission session:
```typescript
identity = `usr_${userId}_${admissionSessionId}` // 12-char lowercase hex session identifier
```
- **Old vs. New Session Disambiguation:** When participant removal fails at the LiveKit SFU layer and the user subsequently re-joins under a new admission, the new connection operates under `usr_${userId}_${newSessionId}`.
- **Targeted Zombie Eviction:** The background eviction worker targets the specific revoked `identity` (`usr_${userId}_${oldSessionId}`). When LiveKit Cloud connectivity recovers, the old zombie socket is evicted without disrupting or terminating the user's active new session.
- **Client Transparency:** The frontend LiveKit SDK utility `parseLiveKitUserId()` matches `/^usr_([a-f0-9]{24})(?:_([a-z0-9]+))?$/i`, extracting the exact 24-hex user ObjectId across both legacy and session-scoped formats without UI degradation.

#### Deterministic Job Identification
To prevent duplicate eviction jobs for the same participant lifecycle event, job IDs are computed deterministically including the session identifier:
```typescript
jobId = SHA256(`${meetingId}:${userId}:${tokenEpoch}:${admissionSessionId}`)
```
A unique index on `{ jobId: 1 }` guarantees that concurrent or replayed removal requests cannot spawn conflicting eviction tasks.

#### Fail-Closed Standalone Behavior (Production Invariant)
In production and staging (`requireTransactions = true`), atomic participant removal strictly requires a MongoDB Replica Set supporting multi-document ACID transactions. If multi-document transactions are unsupported:
- `removeParticipant()` immediately fails closed with `ServiceUnavailableError` (`TRANSACTION_REQUIRED`).
- Sequential writes and partial state updates are strictly prohibited.
- Participant admission status remains unmodified in MongoDB.

#### Sanitized Error Recording
Failure reasons are strictly sanitized via `sanitizeEvictionError()`:
- Sensitive parameters, URLs, and token secrets are redacted.
- Error strings are truncated to 1024 characters.
- Structured error codes (e.g., `TIMEOUT`, `UPSTREAM_5XX`, `NETWORK_FAILURE`) are recorded for administrative auditing.

#### Operator Recovery & Administrative REST API
When an eviction job exhausts all retries (e.g. during a prolonged LiveKit Cloud platform outage), it transitions to `ESCALATED` and logs an `EVICTION_JOB_ESCALATED` audit event. Authorized administrators can manage and recover jobs via dedicated endpoints:
- `GET /api/v1/admin/eviction-jobs/escalated` — Paginated list of escalated jobs requiring operator attention. Protected by `requireAuth` + `requireAdmin` (`role: 'admin'`).
- `POST /api/v1/admin/eviction-jobs/:jobId/retry` — Manually re-enqueues an `ESCALATED` or `FAILED` eviction job to `PENDING` with `attempts = 0`, triggers an immediate `wakeUp()` sweep, and records an `EVICTION_OPERATOR_RETRY` audit event. Protected by `requireAuth` + `requireAdmin`.

```bash
# Example Operator Eviction Job Retry
curl -X POST https://api.connectly.app/api/v1/admin/eviction-jobs/3bc896e84d018f28fa51d8a59f8ab73202eff16390e80c88637e1323e602ecc8/retry \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

---

### 14.3 Adaptive Polling & Database Bandwidth Optimization
To ensure operation within free-tier MongoDB Atlas and server bandwidth budgets without triggering provider abuse suspensions, CONNECTLY incorporates adaptive exponential backoff across all background workers while preserving zero-delay event processing:

| Background Component | Base Interval | Max Idle Backoff | Event Wakeup Trigger | Idle Traffic Reduction |
| :--- | :--- | :--- | :--- | :--- |
| **LiveKit Revocation Coordinator** | 250 ms | 5,000 ms (5s) | Change Stream event OR local revocation publication immediately resets poll delay to 250 ms | **>95% reduction** in idle DB queries |
| **Meeting Outbox Dispatcher** | 1,000 ms | 10,000 ms (10s) | Immediate dispatch on `dispatchById()` resets backoff to 1s | **>80% reduction** in idle sweeps |
| **LiveKit Eviction Worker** | 1,000 ms | 10,000 ms (10s) | Fast-path removal enqueue OR operator retry immediately invokes `wakeUp()` | **>85% reduction** in idle DB queries |
| **Scheduled Reminder Worker** | 30,000 ms | 60,000 ms (60s) | Dynamic scheduling calculation | **~50% reduction** in idle sweeps |

#### Change Stream Resiliency & Dynamic Fallback
In MongoDB Replica Sets (Atlas M0), the `LiveKitRevocationCoordinator` listens to an active Change Stream on `LiveKitRevocationEvent`. In the event of network disruption or stream interruption:
1. The coordinator logs a structured warning and enters fail-closed polling mode.
2. It executes a contiguous sequence sweep from `lastProcessedSeq` to capture any interleaved events.
3. It schedules automatic Change Stream reinitialization after an exponential reconnection delay (default 2,000 ms).
4. No revocation events are dropped or bypassed during transient stream disconnects.

---

### 14.4 In-Flight Lease Renewal Heartbeat & Durable Audit Persistence (Sprint 06D/06F Hardening)

#### Worker Lease Heartbeat & Single-Flight Concurrency Protection (F-06E-01)
To prevent premature lease expiration during slow external LiveKit Cloud API calls ($\ge 20$s), `LiveKitEvictionWorker` runs an in-flight heartbeat timer:
- **Heartbeat Interval & Margin:** 5,000 ms (5s), with a 20,000 ms (20s) lease window (yielding a 15-second safety buffer).
- **Single-Flight Deduping (`isRenewing`):** If database I/O latency exceeds the 5s heartbeat interval, concurrent renewals are collapsed into the single active in-flight promise. Consecutive ticks never create overlapping `updateOne` queries.
- **Atomic Lease Renewal:** Renews `{ _id, leaseToken, status: 'PROCESSING' }` by setting `leaseExpiresAt = now + 20_000ms`.
- **Fencing & Theft Detection:** If another worker steals the lease or renewal fails, the active worker detects `leaseLost = true`, immediately halts external API calls, and returns `LEASE_LOST` without modifying state.
- **Graceful Termination:** Outstanding renewal promises are tracked in `activeHeartbeatPromises` and awaited during worker `stop()`, preventing unhandled promise rejections during SIGTERM shutdown.

#### Transactional Security Audit Persistence & Fail-Closed Durability (F-06E-02)
To ensure that operator recovery actions (`EVICTION_OPERATOR_RETRY`) and retry exhaustions (`EVICTION_JOB_ESCALATED`) survive application restarts and are transactionally bound to job status changes:
- **Atomic MongoDB Transactions:** In MongoDB Replica Sets, `operatorRetryJob` and `markJobEscalated` commit both the `LiveKitEvictionJob` update and the `SecurityAuditEntry` within a single `session.withTransaction(...)` boundary.
- **Fail-Closed Rollback on Standalone:** If audit persistence fails on standalone environments, `LiveKitEvictionJob` is immediately rolled back to its previous `FAILED` state, and `{ success: false }` / HTTP 500 is returned. An operator action NEVER reports success if the audit entry cannot be durably written.
- **Primary Storage:** Stored durably in MongoDB collection `security_audit_entries` via `SecurityAuditEntry.model.ts`.
- **Compound Indexes:** `{ eventType: 1, timestamp: -1 }`, `{ jobId: 1, timestamp: -1 }`, and `{ operatorId: 1, timestamp: -1 }`.
- **Retention:** 90-day automatic expiration via TTL index on `createdAt`.
- **Administrative API:** `GET /api/v1/admin/audit-logs` allows authorized administrators to query persistent audit events across process restarts.

#### Session-Scoped Identity Specification: 12-Hex Random Format (F-06E-03 / F-06G-02)
- **Format:** `usr_<userId>_<admissionSessionId>`, where `<userId>` is the 24-character hex MongoDB ObjectId and `<admissionSessionId>` is an exact 12-character lowercase hex string generated from `crypto.randomBytes(6).toString('hex')`.
- **Backward & Forward Compatibility:** Regexes on both client and server use `+` quantifiers (`/^usr_([a-f0-9]{24})(?:_([a-zA-Z0-9]+))?$/i`) to accept any alphanumeric session ID string length $\ge 1$ (such as 12-hex, 16-hex, or un-hyphenated 32-hex UUIDs) and gracefully support legacy identities lacking session scope. Note: Standard RFC 4122 hyphenated UUIDs contain hyphens and return null under alphanumeric regexes; Connectly production strictly standardizes on 12-character lowercase hexadecimal tokens.

#### Selective Redaction & Safe Operational Identifier Exemption (F-06E-04 / F-06I-01 / F-06K-01)
- **Compound Sensitive Key Redaction (Sprint 06J):** Sensitive keys are normalized and matched against credential patterns (`password`, `secret`, `token`, `apikey`, `cookie`, `credential`, etc.) across camelCase, snake_case, kebab-case, and UPPERCASE, redacting matching values and entire sensitive parent objects.
- **Strict Exact `jobId` Key Matching (Sprint 06L / F-06K-01):** To ensure non-operational 64-hex hashes or delimited tokens cannot bypass redaction, `isExactJobIdKey(key)` enforces literal case-insensitive equality:
  `key.toLowerCase() === 'jobid'`
  Punctuation-stripping normalization is strictly excluded for this exception. Permitted keys: `jobId`, `jobid`, `JOBID`, `JobId`. Delimited or compounded variants (`job-id`, `job_id`, `job.id`, `myJobId`, `jobIdHash`) are NOT exempted and have their 64-hex values securely redacted to `'[REDACTED]'`. JWT-like and credential strings are always redacted regardless of key name.

#### Tri-State Worker Lease Safety & Deferral Architecture (Sprint 06H / 06J / 06L / F-06K-02)
`LiveKitEvictionWorker` enforces a strict tri-state execution and failure model across all external SFU operations:
1. **Safety-Margin Deferral (`status: 'DEFERRED'`):**
   - **Trigger:** Worker detects confirmed remaining lease time is $\le$ `leaseSafetyMarginMs` (default: 1,000 ms) before initiating presence verification, webhook callbacks, or SFU participant eviction.
   - **Database State:** The job is atomically released back to `status: 'PENDING'` with `leaseOwner: null`, `leaseToken: null`, `leaseExpiresAt: null`, and `nextRunAt: now + Math.max(1000, leaseSafetyMarginMs)`.
   - **Retry Penalty:** `attempts` count is strictly UNCHANGED ($0$ attempts consumed). This prevents premature job escalation or operator alerts when delay is caused solely by worker lease margin boundaries.
   - **Concurrency Safety:** Bounded `nextRunAt` prevents hot-looping in the current sweep while enabling any healthy worker to reclaim the job once the margin delay elapses.
2. **Authoritative Lease Expiry / Theft (`status: 'LEASE_LOST'`):**
   - **Trigger:** Worker detects confirmed lease deadline is expired (`now >= confirmedLeaseDeadlineMs`) or heartbeat renewal reports lease stolen/unconfirmed.
   - **Database State:** Worker treats the job as non-authoritative and makes NO database mutations, leaving state intact for the new legitimate lease owner.
   - **External Safety:** Worker immediately halts all external LiveKit SFU side effects.
3. **Genuine SFU Execution Failure (`status: 'FAILED'` or `'ESCALATED'`):**
   - **Trigger:** External SFU call or HTTP network request dispatched to LiveKit Cloud fails (e.g., 503, 504, timeout).
   - **Database State:** Worker increments `attempts`, logs error to `lastError`, applies exponential backoff to `nextRunAt`, and if `attempts >= maxAttempts`, transitions job to `ESCALATED` and durably writes a CRITICAL security audit event.

#### Scope & Limitations of Controlled Room Adapter Race Tests vs. Live LiveKit Cloud Integration
- **Controlled Room Adapter Scope:** Unit and integration race tests (such as in `sprint06jRemediation.test.ts` and `sprint06lRemediation.test.ts`) use controlled mock/stub RoomService adapters with simulated latency, pauses, and in-flight re-admissions. These tests verify deterministic local locking, session-scoped identity isolation (`usr_<userId>_<sessionId>`), and state machine invariants.
- **Live LiveKit Cloud Distinction:** Controlled tests do NOT replace or emulate full LiveKit Cloud edge networking, regional WebRTC signaling relays, SIP gateway interactions, or live WebSocket packet propagation across distributed SFU clusters. Live staging verification on actual LiveKit Cloud infrastructure must be conducted strictly per the Staging Runbook after formal owner authorization.

#### Real-SFU Staging Verification Runbook
For live staging environment verification instructions exercising real LiveKit Cloud WebRTC track termination and re-admission races, see [PHASE_18_STAGING_LIVEKIT_VERIFICATION_PROCEDURE.md](file:///c:/Users/SANJEET%20CHAUHAN/Desktop/code%20Alpha/antigravity%20communication%20application/docs/PHASE_18_STAGING_LIVEKIT_VERIFICATION_PROCEDURE.md).


