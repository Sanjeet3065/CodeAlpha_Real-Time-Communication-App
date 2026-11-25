# CONNECTLY — Technology Stack Specification

## 1. Stack Overview & Architectural Philosophy

CONNECTLY is designed with a modern, type-safe, and asynchronous JavaScript/TypeScript full-stack architecture. The stack adheres strictly to the project mandate: zero silent replacements, production-grade security, enterprise-grade WebRTC distribution via LiveKit SFU, and an editorial design standard.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                  │
│  React 18/19 • TypeScript 5.x • Tailwind CSS 3.4/4 • Motion • Lucide     │
├──────────────────────────────────────────────────────────────────────────┤
│                          REAL-TIME TRANSPORT                             │
│  LiveKit WebRTC SFU (Audio/Video/Screen)  │  Socket.IO (Events/Data/Sync)│
├──────────────────────────────────────────────────────────────────────────┤
│                             SERVER TIER                                  │
│  Node.js 20+ LTS • Express.js 4/5 • TypeScript • Zod • Mongoose 8.x      │
├──────────────────────────────────────────────────────────────────────────┤
│                       DATA & STORAGE INFRASTRUCTURE                      │
│  MongoDB Atlas (Primary Data) • Redis (Socket.IO Adapter / Rate Limits)  │
│  AWS S3 / Cloudflare R2 (Private Files) • Cloudinary (User Avatars)      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Technology Stack

| Layer / Library | Selected Technology | Version | Justification & Architectural Role |
| :--- | :--- | :--- | :--- |
| **Framework** | **React** | `^18.3.1` | Component-driven architecture, concurrent rendering capabilities, rich ecosystem, and battle-tested WebRTC hook integrations. |
| **Language** | **TypeScript** | `^5.5.0` | End-to-end static typing, compile-time safety across media track subscriptions, Socket event payloads, and API contracts. |
| **Styling** | **Tailwind CSS** | `^3.4.10` | Utility-first CSS, zero runtime overhead, arbitrary value precision, built-in responsive variants, and custom token configuration for the Modern Editorial design system. |
| **Animations** | **Motion** (`framer-motion`) | `^11.5.0` | Fluid physics-based layout animations, smooth dialog/sidebar transitions, floating emoji reactions, and video tile rearrangement without jarring layout shifts. |
| **Icons** | **Lucide React** | `^0.440.0` | Crisp, scalable, consistently styled icons with clean geometric aesthetics fitting the editorial design language. |
| **Media Client** | **LiveKit Client SDK** | `^2.5.0` | Official WebRTC client managing SFU signaling, simulcast track publishing, adaptive subscriptions, audio level detection, and ICE reconnects. |
| **Real-time Events** | **Socket.IO Client** | `^4.7.5` | Resilient WebSocket client supporting heartbeat pings, exponential backoff reconnects, room event multiplexing, and binary buffer transport. |
| **State Management** | **Zustand** | `^4.5.5` | Lightweight, unopinionated, hook-based state management without boilerplate; ideal for tracking active participants, room settings, audio devices, and UI toggles. |
| **Data Fetching** | **TanStack Query** (React Query) | `^5.56.0` | Declarative server-state synchronization, automatic caching, revalidation, and optimistic updates for REST endpoints. |
| **Form Management** | **React Hook Form + Zod** | `^7.53.0` / `^3.23.0` | Performant uncontrolled forms with declarative schema validation matching backend Zod models. |
| **Build Tool & Bundler** | **Vite** | `^6.4.6` | Fast ESM development server, Rollup production bundler, and esbuild 0.25.x (upgraded via ADR-011 for dev server security remediation). |

---

## 3. Backend Technology Stack

| Layer / Library | Selected Technology | Version | Justification & Architectural Role |
| :--- | :--- | :--- | :--- |
| **Runtime Environment** | **Node.js LTS** | `^20.17.0 LTS` | High-throughput asynchronous event loop, native fetch, V8 performance optimizations, and long-term enterprise stability. |
| **Web Framework** | **Express.js** | `^4.19.2` | Minimalist, unopinionated routing engine with battle-tested middleware ecosystem, request pipelines, and custom error handling. |
| **Language** | **TypeScript** | `^5.5.0` | Strict type checking, interface sharing with frontend via shared type definitions, and robust compile-time guarantees. |
| **ORM / ODM** | **Mongoose** | `^8.6.0` | Structured document schema definitions, strong validation hooks, pre/post middleware, auto-indexing, and relationship population for MongoDB. |
| **Real-time Server** | **Socket.IO Server** | `^4.7.5` | Bi-directional event server with room multiplexing, acknowledgment callbacks, and cluster scaling via `@socket.io/redis-adapter`. |
| **Media Server SDK** | **LiveKit Server SDK** | `^2.6.0` | Room token generation (`AccessToken`), cryptographic permission granting, webhook verification, and room lifecycle management. |
| **Validation** | **Zod** | `^3.23.0` | TypeScript-first schema declaration and validation for HTTP request bodies, route query parameters, and Socket.IO payloads. |
| **Security Headers** | **Helmet** | `^7.1.0` | Automatic configuration of HTTP security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy). |
| **CORS Management** | **CORS** | `^2.8.5` | Strict origin whitelisting, HTTP header filtering, and credentialed cookie handling. |
| **Rate Limiting** | **express-rate-limit** | `^7.4.0` | Defense-in-depth against credential stuffing, brute force, and API abuse, paired with `rate-limit-redis`. |
| **Logging** | **Pino + Pino-Pretty** | `^9.4.0` | Ultra-low overhead JSON structured logging with redaction filters for PII and sensitive tokens. |

---

## 4. Deep Evaluation: Password Hashing (Argon2 vs. Bcrypt)

The security of stored credentials is of paramount importance. Below is an exhaustive comparative evaluation:

| Dimension | Argon2 (Argon2id) | Bcrypt |
| :--- | :--- | :--- |
| **Algorithmic Heritage** | Winner of the Password Hashing Competition (PHC, 2015). | Designed by Niels Provos and David Mazières (1999). |
| **Attack Resistance** | Highly resistant to both GPU and custom ASIC attacks due to memory-hardness. Argon2id combines data-dependent and data-independent memory access. | Resistant to CPUs, but susceptible to modern massive parallel FPGA/ASIC acceleration due to low memory footprint (4KB state). |
| **Input Truncation** | No input length limitation (processes arbitrarily long passwords). | Silently truncates input passwords at **72 bytes**; any characters beyond byte 72 are ignored. |
| **Configurability** | 3 independent cost parameters: Memory size ($m$), Iterations/time ($t$), and Parallelism ($p$). | Single cost factor parameter (work factor $2^N$). |
| **Native Compilation Risk** | Relies on C++ Node-gyp bindings (`argon2` npm package). May fail compilation on rare low-spec build machines lacking C++ toolchains. | `bcrypt` also requires native compilation, though `bcryptjs` exists as a pure JS fallback (at a 30% performance penalty). |

### Technical Decision:
- **Primary Selection:** `argon2` implementing the **Argon2id** variant.
- **Configured Parameters:**
  - Memory cost: `65536` KB (64 MB)
  - Time cost (iterations): `3`
  - Parallelism: `1` thread
- **Fallback Compatibility Strategy:** If the deployment environment lacks a C++ compiler for native node-gyp bindings, the codebase provides a modular `PasswordHasher` interface that gracefully falls back to `bcrypt` (work factor 12) with an active warning in production logs.

---

## 5. Deep Evaluation: Storage Architecture (S3-Compatible vs. Cloudinary)

CONNECTLY requires storage for two distinct data classes:
1. **Public/Semi-Public Assets:** User profile pictures / avatars.
2. **Private In-Meeting Collaboration Assets:** Shared meeting documents (PDFs, PPTX, code archives, spreadsheets) and meeting whiteboard vector exports.

| Feature / Metric | AWS S3 / Cloudflare R2 | Cloudinary |
| :--- | :--- | :--- |
| **Access Control (ACL)** | True private buckets; granular IAM policies; strictly time-limited Pre-Signed URLs (15 minutes). | Access control via authenticated transformations and signed URLs, but inherently optimized for public CDN delivery. |
| **Arbitrary File Types** | Universal blob support: `.pdf`, `.docx`, `.zip`, `.csv`, `.drawio`, `.json`. No restrictions. | Optimized for images and videos. Sub-optimal handling and high cost for arbitrary binary office documents. |
| **Egress Cost & Pricing** | Cloudflare R2 provides **$0 egress fees** with 100% S3-compatible API. Standard AWS S3 has predictable storage pricing ($0.023/GB). | Credit-based pricing model that scales aggressively based on bandwidth and transformations. Highly expensive for file downloads. |
| **Direct Browser Upload** | Native pre-signed PUT/POST URLs allow clients to upload directly to bucket with zero server memory overhead. | Supports direct unsigned/signed uploads, but requires Cloudinary client libraries or upload presets. |
| **Image Optimization** | Requires custom Lambda/Sharp pipeline if transformations are needed. | Industry-leading on-the-fly dynamic resizing, format conversion (WebP/AVIF), and face cropping. |

### Technical Decision:
- **Hybrid Storage Strategy:**
  1. **Primary Private Document & Collaboration Storage:** **S3-Compatible Storage** (AWS S3 or Cloudflare R2).
     - Bucket is strictly private with public access blocked completely.
     - Uploads: Server validates request and generates a pre-signed `PUT` URL with exact `Content-Type` and 15-minute expiration.
     - Downloads: Server verifies meeting membership and generates a pre-signed `GET` URL with a 5-minute expiration.
  2. **Profile Avatar Storage:** **Cloudinary** (or S3 with Sharp) utilized for auto-cropping and WebP conversion of user profile avatars.

---

## 6. Real-Time Dual-Channel Architecture (LiveKit SFU + Socket.IO)

CONNECTLY strictly separates high-volume media distribution from discrete application events:

```
                      ┌─────────────────────────────────────────┐
                      │             CONNECTLY CLIENT            │
                      └────────────┬───────────────┬────────────┘
                                   │               │
                 WebRTC Media Tracks               Socket.IO Events
              (Simulcast Video, Opus Audio)    (Chat, Whiteboard, Presence)
                                   │               │
                                   ▼               ▼
                      ┌────────────────┐     ┌──────────────────┐
                      │  LiveKit SFU   │     │ Socket.IO Server │
                      │  (Media Node)  │     │  (Express App)   │
                      └────────────────┘     └────────┬─────────┘
                                                      │
                                                      ▼
                                             ┌──────────────────┐
                                             │  Redis / MongoDB │
                                             └──────────────────┘
```

- **LiveKit SFU:** Exclusively handles WebRTC transport: camera video, microphone audio, screen share video, and screen share audio. It executes simulcast encoding, dynacast (adaptive publishing), and selective forwarding to clients based on layout.
- **Socket.IO:** Exclusively handles application state: room joining/leaving handshakes, waiting room admissions, hand-raising queue, in-meeting text messages, emoji reactions, and collaborative whiteboard vector deltas.
- **Strict Boundary:** Socket.IO is NEVER used as a transport medium for video or audio binary frames.

---

## 7. Environment & Configuration Matrix

CONNECTLY maintains strict environment separation using typed environment variables validated at process startup via Zod:

| Variable Name | Environment | Purpose | Sensitivity |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | All | `development` \| `test` \| `production` | Public |
| `PORT` | All | HTTP server listening port (default `5000`) | Public |
| `CLIENT_ORIGIN` | All | Allowed frontend URL for CORS and cookie origin | Public |
| `MONGODB_URI` | All | MongoDB connection string (Atlas in prod) | **Critical Secret** |
| `JWT_ACCESS_SECRET` | All | 256-bit secret for signing access tokens | **Critical Secret** |
| `JWT_REFRESH_SECRET` | All | 256-bit secret for signing refresh tokens | **Critical Secret** |
| `LIVEKIT_URL` | All | WebSocket URL for LiveKit SFU (`wss://...`) | Public |
| `LIVEKIT_API_KEY` | All | LiveKit API Key for room token generation | **Critical Secret** |
| `LIVEKIT_API_SECRET`| All | LiveKit Secret for HMAC-SHA256 signing | **Critical Secret** |
| `S3_BUCKET_NAME` | All | Target private storage bucket | Config |
| `S3_REGION` | All | Storage region (e.g., `us-east-1` or `auto`) | Config |
| `S3_ACCESS_KEY` | All | AWS / R2 IAM Access Key | **Critical Secret** |
| `S3_SECRET_KEY` | All | AWS / R2 IAM Secret Key | **Critical Secret** |
| `REDIS_URL` | Prod/Staging | Redis connection string for Socket.IO adapter | **Critical Secret** |
