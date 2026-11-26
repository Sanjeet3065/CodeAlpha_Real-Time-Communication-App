# CONNECTLY

> **Full-Stack Real-Time Video Conferencing and Collaboration Web Application**

CONNECTLY is a multi-workspace monorepo featuring a React 18 SPA frontend (`client/`), a hardened Node.js / Express / Socket.IO / LiveKit backend (`server/`), and a Cloudflare Worker single-origin reverse proxy (`proxy/`).

> [!NOTE]
> All **18 engineering lifecycle phases** (`01` through `18`) have been implemented and verified in the local repository and CI pipeline definition. Live cloud provisioning and staging/production deployment on external vendor accounts are **owner-managed manual cutovers** (`$0.00` zero-budget showcase topology); nothing is auto-deployed from CI or local agent runs.

---

## 1. Completed 18-Phase Lifecycle

| Phase | Designation | Status | Delivered Scope |
| :---: | :--- | :---: | :--- |
| **01** | Project Planning & System Architecture | Complete | Core architecture specs, threat models, and API contracts in `docs/` |
| **02** | UI/UX Design System | Complete | Daylight (`#F7F6F2`) & cinema (`#101820`) token system, wireframes, WCAG 2.2 AA guidelines |
| **03** | Frontend Project Setup | Complete | Vite 6, React 18, TypeScript, Tailwind CSS, router & error boundaries |
| **04** | Landing Page | Complete | Marketing landing page, responsive showcase sections, interactive CTAs |
| **05** | Authentication System | Complete | Argon2id hashing, HTTP-only `connectly_refresh` cookie rotation, breach detection, CSRF defense |
| **06** | User Dashboard | Complete | Dashboard workspace, instant meeting creation/join, sidebar navigation |
| **07** | Backend & Database | Complete | Express API, Zod schema validation, MongoDB Mongoose models & indexes, preferences API |
| **08** | Meeting Room Management | Complete | Meeting lifecycle (`CREATED`/`ACTIVE`/`ENDED`/`EXPIRED`), waiting room, host/co-host moderation |
| **09** | WebRTC + LiveKit Integration | Complete | LiveKit SFU token issuance, `/livekit-signal` admission gateway, distributed revocation & outbox |
| **10** | Multi-User Video & Audio | Complete | Adaptive participant grid (`MAX_TILES_PER_PAGE = 12`, target up to 60 participants), active speaker & devices |
| **11** | Screen Sharing | Complete | WebRTC display capture tracks, server role/permission grants, full-stage presentation layout |
| **12** | Real-Time Chat & Reactions | Complete | Persistent encrypted meeting chat, Redis/in-memory rate limits, emoji reactions |
| **13** | File Sharing | Complete | Presigned & direct upload/download pipelines, magic-byte/archive validation, S3/local/memory & feature gate |
| **14** | Collaborative Whiteboard | Complete | Multi-user whiteboard state persistence, OCC transactions, per-user undo/redo, ephemeral cursors |
| **15** | Encryption & Security | Complete | AES-256-GCM envelope encryption, atomic login lockout, production CSP, timing-safe audit redaction |
| **16** | Scheduling & Meeting History | Complete | IANA-timezone meeting scheduling, notifications, reminder worker, history/detail filtering |
| **17** | Testing, Optimization & Responsiveness | Complete | Rollup vendor code-splitting, adaptive polling backoff, mobile responsiveness & accessibility |
| **18** | Deployment & Documentation | Complete (Code & Docs) | Cloudflare Worker proxy, multi-stage `server/Dockerfile`, strict production preflight, GitHub Actions CI |

---

## 2. Architecture & Workspaces

CONNECTLY contains three deployable components coordinated under one monorepo:

- **`client/`** — React 18 + TypeScript + Vite 6 SPA, Tailwind CSS, Zustand, TanStack Query, `livekit-client`, and `socket.io-client`.
- **`server/`** — Node.js 20 + Express + TypeScript backend, Mongoose (MongoDB Replica Set ACID transactions & Change Streams), `ioredis`, Socket.IO, LiveKit Server SDK, and S3 / feature-gated storage providers.
- **`proxy/`** — Cloudflare Worker (`proxy/src/worker.js`) providing a single-origin reverse proxy (`/*` -> Cloudflare Pages; `/api/*`, `/socket.io/*`, `/livekit-signal/*` -> backend), stripping spoofed client forwarding headers, injecting `X-Proxy-Secret` & `X-Verified-Client-IP` from `CF-Connecting-IP`, and enforcing fail-closed validation.

### Monorepo Layout

```
antigravity communication application/
├── .github/workflows/ci.yml        # GitHub Actions CI (lint, typecheck, tests, build, CI preflight)
├── .env.example                    # Root local development reference template
├── .env.production.example         # Full-stack production reference template (placeholders only)
├── .gitignore / .dockerignore      # Secret & build exclusions (.env.*, proxy/.dev.vars, !.env*.example)
├── package.json                    # Root npm workspace scripts
├── server/
│   ├── Dockerfile                  # Two-stage node:24-alpine container build (non-root USER node)
│   ├── eslint.config.js            # Backend ESLint 9 flat configuration
│   ├── .env.example                # Backend local env template
│   ├── .env.production.example     # Backend production env template
│   └── src/                        # Controllers, middlewares, models, realtime gateways, services, scripts, tests
├── client/
│   ├── eslint.config.js            # Frontend ESLint 9 flat configuration
│   ├── vite.config.ts              # Rollup vendor chunks & local dev proxies (/api, /socket.io, /livekit-signal)
│   ├── .env.example                # Frontend local env template
│   ├── .env.production.example     # Frontend single-origin production env template
│   └── src/                        # App router, pages, meeting components, hooks, services, tests
├── proxy/
│   ├── wrangler.toml               # Cloudflare Worker routing & compatibility configuration
│   ├── .env.example                # Worker origin configuration template
│   ├── README.md                   # Cloudflare Worker deployment & secret binding instructions
│   ├── src/worker.js               # Single-origin routing & fail-closed X-Proxy-Secret / IP edge logic
│   └── test/proxyRouting.test.js   # Automated Worker routing & security unit tests
└── docs/
    ├── DEPLOYMENT_GUIDE.md         # Zero-budget deployment runbook, quotas & scaling prerequisites
    ├── DEPLOYMENT_ARCHITECTURE.md  # Cloud topology & multi-replica scaling notes
    ├── archive/phase-09/           # Archived Phase 09 export report & audit bundles
    └── PHASE_*.md                  # Historical phase acceptance, security & test reports
```

---

## 3. Getting Started (Local Development)

### Prerequisites
- **Node.js:** v22.6+ / v24 LTS (`ci.yml` runs Node 24 for client `--experimental-strip-types` test support; `server/Dockerfile` builds and runs compiled JS on `node:24-alpine` for native WebSocket support required by Supabase JS)
- **npm:** v9+
- **MongoDB:** Standalone local MongoDB on `127.0.0.1:27017` plus Replica Set (`rs0`) on `127.0.0.1:27018` for ACID transaction and preflight test paths
- **Redis (optional in dev, required for strict staging/production):** Local or TLS endpoint

### Installation
```bash
npm ci
```

### Run Locally
```bash
# Start backend TypeScript watcher (default port 5000)
npm run dev:server

# Start frontend Vite dev server (port 5173, proxies /api, /socket.io, /livekit-signal)
npm run dev
```

### Quality Assurance, Testing & Preflight Commands
```bash
# Lint both client and server workspaces
npm run lint

# Type-check client and server TypeScript projects
npm run typecheck

# Build client Vite bundle and server TypeScript output
npm run build

# Run full automated test suites (client + server + proxy)
npm test

# Run isolated workspace suites
npm test --workspace=client
npm test --workspace=server
npm run test:proxy

# Run development or strict production readiness preflight
npm run verify:production --workspace=server -- --mode=development
npm run verify:production --workspace=server -- --mode=production

# Run deterministic CI preflight harness (with local mock LiveKit Twirp server)
npm run verify:ci-production --workspace=server
```

---

## 4. Environment Configuration & Secret Hygiene

Never commit `.env`, `.env.local`, `.env.production`, or `proxy/.dev.vars`. Use the `.env.example` and `.env.production.example` templates and configure real secrets only inside your runtime hosting dashboard (`wrangler secret put`, Koyeb, or Cloudflare Pages).

| Scope | Template File | Key Responsibilities |
| :--- | :--- | :--- |
| **Root Overview** | `.env.production.example` | End-to-end variable inventory for backend, frontend, and Worker proxy |
| **Backend Local** | `server/.env.example` | Local MongoDB, JWT dev secrets, storage mode, LiveKit local endpoints |
| **Backend Production** | `server/.env.production.example` | Mandatory 64-hex `PROXY_SECRET`, `TRUST_PROXY`, non-dev `CONNECTLY_ENCRYPTION_KEY_V1`, high-entropy JWT secrets, `rediss://`, replica-set `MONGODB_URI`, Option 2B file gate (`ENABLE_FILE_SHARING=false`, `STORAGE_PROVIDER=disabled`) |
| **Frontend Local / Prod** | `client/.env.example`, `client/.env.production.example` | Public `VITE_*` URLs and feature flags (never place backend secrets in `VITE_*`) |
| **Worker Proxy** | `proxy/.env.example` | `BACKEND_ORIGIN`, `FRONTEND_ORIGIN`; set matching `PROXY_SECRET` via `npx wrangler secret put PROXY_SECRET` |

---

## 5. Initial Single-Instance Deployment & Scaling Boundaries

The zero-budget showcase topology runs **strictly 1 backend container instance (`max_scale = 1` on Koyeb Free Tier)** behind the Cloudflare Worker reverse proxy. As documented in [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) and [docs/DEPLOYMENT_ARCHITECTURE.md](docs/DEPLOYMENT_ARCHITECTURE.md), scaling horizontally beyond 1 backend replica requires:

1. Replacing `express-rate-limit`'s default in-memory `MemoryStore` (`server/src/middlewares/rateLimiter.ts`, `readinessLimiter` in `server/src/routes/health.routes.ts`) with a shared Redis store (matching chat/whiteboard limiters in `chatRedis.service.ts`).
2. Replacing or supplementing `WhiteboardService`'s process-local mutex (`opQueues` in `server/src/services/whiteboard.service.ts`) with distributed locking or meeting-affinity sticky sessions.
3. Caching or throttling `whiteboard:cursor` MongoDB admission/epoch lookups (`server/src/realtime/meetingSocket.ts`) with revocation invalidation so cursor bursts do not amplify Atlas M0 read ops.
