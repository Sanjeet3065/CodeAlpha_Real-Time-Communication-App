# CONNECTLY — Phase 09 LiveKit Local & Production Setup Guide

**Phase:** 09 – WebRTC + LiveKit Integration  
**Supported Deployments:** Self-hosted LiveKit SFU behind CONNECTLY's `/livekit-signal` Signaling Admission Gateway, Managed LiveKit Cloud (`*.livekit.cloud`), and local `livekit-server --dev` development.

---

## 1. Environment Variables

> [!CAUTION]
> **Never** place `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` in `client/.env*` or any `VITE_` variable. Browsers receive their authoritative signaling URL (`livekitUrl`) strictly from `POST /api/v1/meetings/:code/livekit-token` — client-side direct public signaling fallbacks are intentionally disabled.

### Local Development (`server/.env`)
```env
NODE_ENV=development
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=
LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_TOKEN_TTL_SECONDS=600
```
In local development (`LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto`), CONNECTLY automatically routes browser signaling through `ws://localhost:5000/livekit-signal` to `ws://127.0.0.1:7880`.

### Production — Self-Hosted LiveKit (Mandatory Private-Port Architecture)
```env
NODE_ENV=production
# Internal loopback or private VPC address ONLY — NEVER expose port 7880 publicly!
LIVEKIT_URL=ws://127.0.0.1:7880
# Public TLS endpoint pointing to CONNECTLY's authoritative Signaling Admission Gateway
LIVEKIT_PUBLIC_URL=wss://api.connectly.app/livekit-signal
# Must NOT be false for self-hosted production (enforced fail-closed by env.ts & validateLiveKitConfig)
LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto
LIVEKIT_API_KEY=<production_livekit_api_key>
LIVEKIT_API_SECRET=<production_livekit_api_secret>
LIVEKIT_TOKEN_TTL_SECONDS=600
```

### Production — Managed LiveKit Cloud
```env
NODE_ENV=production
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_PUBLIC_URL=
LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto
LIVEKIT_API_KEY=<livekit_cloud_api_key>
LIVEKIT_API_SECRET=<livekit_cloud_api_secret>
LIVEKIT_TOKEN_TTL_SECONDS=600
```
For `*.livekit.cloud`, `LIVEKIT_SIGNAL_GATEWAY_ENABLED=auto` routes directly to LiveKit Cloud while `LiveKitService.removeParticipant` forwards `revokeTokenTs` to LiveKit Cloud's native revocation control plane.

### Production — Multi-Instance Socket.IO Shared Adapter (Fail-Closed Requirement)
In `NODE_ENV=production` or whenever `SOCKET_IO_MULTI_INSTANCE=true`, CONNECTLY **refuses to start** with the single-process in-memory Socket.IO adapter. Configure one of the following shared adapters:

```env
# Preferred production adapter: Redis Pub/Sub (@socket.io/redis-adapter + ioredis)
SOCKET_IO_ADAPTER=redis
SOCKET_IO_MULTI_INSTANCE=true
REDIS_URL=rediss://<user>:<pass>@<redis-host>:6379
REDIS_SOCKET_PREFIX=connectly:socketio

# Alternative Replica-Set MongoDB adapter (@socket.io/mongo-adapter, requires Change Streams)
# SOCKET_IO_ADAPTER=mongo
# SOCKET_IO_MULTI_INSTANCE=true
# SOCKET_IO_MONGO_COLLECTION=socket_io_adapter_events
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOCKET_IO_ADAPTER` | `auto` | `redis` (preferred), `mongo` (MongoDB Replica Set Change Streams), `memory` (single-instance dev/test ONLY), or `auto` (`redis` when `REDIS_URL` is set; fails closed in production/multi-instance if unset). |
| `SOCKET_IO_MULTI_INSTANCE` | `auto` | Resolves to `true` in `NODE_ENV=production`, `false` in dev/test unless explicitly `true`. Prohibits in-memory adapter when `true`. |
| `REDIS_URL` | *(empty)* | `rediss://` or `redis://` connection URI for `@socket.io/redis-adapter` (`pubClient` + `subClient`). In `NODE_ENV=production`, non-loopback hosts **must** use TLS (`rediss://`); plaintext `redis://` is permitted in production only for loopback hosts (`127.0.0.1`, `localhost`, `::1`). Startup fails closed if malformed, insecure, or unreachable. |
| `REDIS_SOCKET_PREFIX` | `connectly:socketio` | Redis channel prefix isolating CONNECTLY Socket.IO cluster traffic. |
| `SOCKET_IO_MONGO_COLLECTION` | `socket_io_adapter_events` | Capped collection name (16 MB) used when `SOCKET_IO_ADAPTER=mongo` on a MongoDB Replica Set. |

---

## 2. Production Self-Hosted Network Binding, Firewall & Reverse-Proxy Blueprint

> [!IMPORTANT]
> Self-hosted OSS LiveKit Server (`v1.13.11`) does **not** enforce server-side JWT revocation (`revokeTokenTs` is ignored). Therefore, production self-hosted deployments **must** enforce the following network isolation so no untrusted browser can bypass CONNECTLY's `/livekit-signal` gateway.

### 2.1 LiveKit Server Binding (`livekit.yaml`)
```yaml
port: 7880
# CRITICAL: Bind signaling strictly to loopback (same host) or private VPC interface ONLY.
bind_addresses:
  - "127.0.0.1"
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  <production_livekit_api_key>: <production_livekit_api_secret>
```

### 2.2 Firewall / VPC Security Group Policy
| Port / Protocol | Source | Destination | Purpose |
| --- | --- | --- | --- |
| `443 / TCP` (HTTPS/WSS) | Public Internet (`0.0.0.0/0`) | Edge Reverse Proxy (Nginx/Caddy/ALB) | CONNECTLY API, Socket.IO (`/socket.io`), & LiveKit Signaling Admission Gateway (`/livekit-signal`) |
| `7880 / TCP` (Raw LiveKit WS/Twirp) | **DENY Public** (`127.0.0.1` or Backend VPC SG ONLY) | LiveKit SFU | Authoritative backend `RoomServiceClient` & gateway upstream ONLY — **NEVER publicly reachable** |
| `7881 / TCP` (WebRTC ICE/TCP) | Public Internet (`0.0.0.0/0`) | LiveKit SFU | Media ICE fallback (unusable without gateway-authorized `/rtc` SDP/ICE handshake) |
| `50000-60000 / UDP` (WebRTC ICE/DTLS-SRTP) | Public Internet (`0.0.0.0/0`) | LiveKit SFU | Encrypted media transport (unusable without gateway-authorized `/rtc` SDP/ICE handshake) |

### 2.3 Edge Reverse Proxy (Nginx Example for TLS, WebSocket Upgrade & Query-Free JWT Logging)

> [!CAUTION]
> **Signaling Query-Parameter JWT Protection:** LiveKit WebSocket signaling and validation requests pass the short-lived JWT in the `access_token` query parameter. Nginx's default `combined` access log format records `$request`, which captures the full query string. **Never** log `$request`, `$request_uri`, `$args`, or `$query_string` for `/livekit-signal/` routes. Use a dedicated query-free `log_format` logging `$uri` only (as shown below).

```nginx
# Define inside http {} context:
# Logs method, path ($uri ONLY — excludes query string), protocol, status, bytes, latency, and request ID.
# NEVER include $request, $request_uri, $args, or $query_string on signaling routes.
log_format connectly_no_query '$remote_addr - [$time_local] '
                              '"$request_method $uri $server_protocol" '
                              '$status $body_bytes_sent $request_time '
                              'rt=$upstream_response_time req_id=$upstream_http_x_request_id';

server {
  listen 443 ssl http2;
  server_name api.connectly.app;

  # Standard CONNECTLY API & Socket.IO
  location / {
    access_log /var/log/nginx/connectly_api.log connectly_no_query;
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  # Explicit CONNECTLY Authoritative LiveKit Signaling Admission Gateway
  location /livekit-signal/ {
    # Query-free access logging prevents LiveKit JWTs in ?access_token=... from being written to disk.
    # Secure alternative if custom log_format is unavailable: set `access_log off;` on this location
    # and rely on CONNECTLY's sanitized application logs (requestLogger.ts / errorHandler.ts).
    access_log /var/log/nginx/connectly_livekit_signal.log connectly_no_query;
    proxy_pass http://127.0.0.1:5000/livekit-signal/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  # Explicitly deny any direct /rtc or /rtc/v1 path at the edge proxy
  location ~ ^/rtc(/|$) {
    access_log /var/log/nginx/connectly_denied_rtc.log connectly_no_query;
    return 404;
  }
}
```

**Managed Load Balancer / Cloud Ingress Alternative (AWS ALB, GCP Cloud LB, Cloudflare):**  
If your edge proxy or managed load balancer cannot customize per-route access log formats to exclude query strings, choose one of the following secure alternatives before production launch:
1. Terminate `/livekit-signal/` through an edge Nginx/Envoy layer enforcing `connectly_no_query` (or `access_log off;`) while disabling raw query logging on the outer LB; **or**
2. Apply mandatory log-pipeline scrubbing/redaction of `access_token`, `token`, and `join_request` query parameters prior to log storage/indexing, and disable raw request-URI retention on the signaling route.

> [!NOTE]
> **Deployment Verification Status:** Production reverse-proxy and cloud load-balancer access-log behavior is **NOT VERIFIED locally**. During Phase 18 staging/production deployment, execute a test `/livekit-signal/rtc/v1/validate?access_token=<dummy_jwt>` request and inspect the live proxy/LB access logs to confirm zero JWT capture.

---

## 3. Cross-Instance Distributed Revocation Dependencies & Behavior

CONNECTLY does **not** require Redis for Phase 09 cross-instance LiveKit revocation — distributed invalidation and atomic admission fencing run directly on MongoDB (the platform's existing SSOT) via `LiveKitRevocationCounter` + `LiveKitRevocationEvent` + `LiveKitRevocationCoordinator` + `claimSignalingAdmissionFence`:

- **Production MongoDB Replica Set (Change Stream Push + Durable `seq` Catch-Up):**
  - `LiveKitRevocationCoordinator` attaches a MongoDB Change Stream (`LiveKitRevocationEvent.watch`), records `resumeAfter` tokens for stream reconnects, and runs a periodic indexed monotonic `seq` cursor sweep (`250ms` default) so transient Change Stream errors never drop events.
  - Propagation latency is governed by MongoDB oplog commit, network RTT, and event-loop scheduling (no hard real-time millisecond SLA is claimed).
- **Standalone MongoDB (Local Dev / CI Automatic Fallback):**
  - When `hello.setName` is absent, `LiveKitRevocationCoordinator` skips Change Streams and delivers cross-instance events on the durable `seq` cursor sweep (`pollIntervalMs`, default `250ms`).
- **Atomic Linearization vs. Post-Linearization Propagation:**
  - Signaling admission (`claimSignalingAdmissionFence`) and removal (`removeParticipant`) serialize atomically on the single `MeetingParticipant` document (`signalFenceVersion`). Any removal committed before admission's atomic `findOneAndUpdate` blocks `HTTP 101` (`403`). Any removal committed after admission linearized triggers revocation of the already-registered socket upon durable event delivery (with an unavoidable asynchronous cross-host propagation interval).
- **TTL Retention & Failure Policy (Fail-Closed):**
  - `LiveKitRevocationEvent` TTL is **24 hours (`86400s`)** — 24x the maximum configurable 1-hour JWT TTL — with cursor discontinuity detection (`oldestSeq > lastContiguousSeq + 1`).
  - Both repeated DB failures (`consecutiveFailures >= 2`) AND stalled delivery (`Date.now() - lastSuccessfulSyncAt > maxStaleDeliveryMs`) transition the coordinator to UNHEALTHY -> Gateway **fails closed** (terminates active proxied sockets and returns `503 LIVEKIT_REVOCATION_UNAVAILABLE` for new upgrades/validations). Atomic fence DB errors return `503 LIVEKIT_FENCE_UNAVAILABLE`.

---

## 4. Local Development Verification vs. Production Deployment Verification

- **Verified Locally (Executed in Phase 09):**
  - Native `livekit-server.exe v1.13.11` bound to `127.0.0.1:7880` (`--dev --bind 127.0.0.1`), CONNECTLY Express + `/livekit-signal` on `localhost:5000`, real WebRTC ICE UDP `7882` / TCP `7881` connectivity established after authorized gateway signaling across multiple isolated Chrome contexts.
  - Automated unit/integration verification of production config rules (`env.ts`, `validateLiveKitConfig`, fail-closed `wss://` requirement, rejection of `LIVEKIT_SIGNAL_GATEWAY_ENABLED=false` for self-hosted production).
- **Requires Production Infrastructure Verification (Phase 18 Deployment):**
  - Live TLS certificate termination (`wss://`) at an external reverse proxy/load balancer, external cloud VPC security group verification confirming port `7880` is unreachable from public IPs, and public internet ICE/TURN traversal across NATs.

---

## 4. Local Verification Commands

```bash
# 1. Start local LiveKit SFU (v1.13.11)
.\tools\livekit\livekit-server.exe --dev --bind 127.0.0.1

# 2. Run automated Phase 05-09 regression + deterministic 7-boundary gateway race suite
npm test --workspace=server
npm test --workspace=client

# 3. Run real LiveKit SFU API & removed-participant old-JWT reuse browser verification
node scripts/test-phase09-livekit-real.mjs
node scripts/test-phase09-token-reuse-audit.mjs
node scripts/verify_phase_09_livekit.js
```
