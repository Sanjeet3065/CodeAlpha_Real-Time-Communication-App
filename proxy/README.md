# CONNECTLY — Cloudflare Worker Single-Origin Reverse Proxy

## 1. Overview

This Cloudflare Worker implements the **Single-Origin Reverse Proxy** topology (Option 1B) for CONNECTLY. It routes all inbound requests on a single origin (`*.workers.dev` or a custom domain) to their respective upstream services:

- **Frontend Assets & SPA Routes:** Forwarded to Cloudflare Pages (`FRONTEND_ORIGIN`).
- **REST API (`/api/*`):** Forwarded to Koyeb backend (`BACKEND_ORIGIN`).
- **Socket.IO Real-Time Engine (`/socket.io/*`):** Forwarded to Koyeb backend, preserving WebSocket upgrades (HTTP 101 Switching Protocols).
- **LiveKit Signaling Gateway (`/livekit-signal/*`):** Forwarded to Koyeb backend signaling route.

### Why This Topology Is Mandatory

In a zero-budget architecture without a shared root custom domain (e.g., using `*.pages.dev` and `*.koyeb.app`), cross-origin authentication suffers from modern browser third-party cookie restrictions (SameSite=Lax/Strict partitioning, ITP, CHIPS). By placing both the SPA frontend and the backend API behind a single Cloudflare Worker origin:

1. **First-Party Cookies:** Authentication cookies (`connectly_access_token`, `connectly_refresh_token`) are strictly first-party (`SameSite=Lax; Secure; HttpOnly`).
2. **Simplified CORS & Origin Validation:** The backend and frontend share the worker's origin, eliminating cross-site credential leakage risks.
3. **Transparent WebSocket Upgrades:** Socket.IO WebSocket upgrades and LiveKit HTTP signaling pass seamlessly through Cloudflare's global edge network.

---

## 2. Host-Header Correctness & Virtual Host Routing

> **CRITICAL ARCHITECTURAL REQUIREMENT:**  
> Koyeb (and similar container hosting platforms) uses virtual-host routing at its edge proxies. When an inbound request reaches Koyeb, its edge router inspects the HTTP `Host` header to determine which container service should receive the request.
> 
> If the proxy forwards the client's public hostname (e.g., `connectly-proxy.subdomain.workers.dev`), Koyeb's edge router will fail to match any service and return an HTTP `404 Not Found` or `502 Bad Gateway`.

To prevent this:
1. The Worker constructs each upstream request using the target URL (e.g. `https://connectly-backend.koyeb.app/api/v1/health`).
2. The incoming client `Host` header is explicitly deleted from the forwarded headers (`forwardedHeaders.delete('host')`).
3. The Cloudflare runtime automatically populates the outbound `Host` header from the target URL's hostname.
4. Client IP and protocol headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Real-IP`) are preserved or populated for backend rate-limiting and audit logging.

---

## 3. Configuration & Environment Variables

The worker expects environment variables defined in `wrangler.toml` (`[vars]`) and sensitive secrets configured via Cloudflare Worker secrets (`wrangler secret put`):

| Variable | Description | Example / Configuration Method |
|---|---|---|
| `BACKEND_ORIGIN` | Root URL of the backend container service (no trailing slash) | `https://connectly-backend.koyeb.app` (in `wrangler.toml` or secret) |
| `FRONTEND_ORIGIN` | Root URL of the Cloudflare Pages frontend deployment (no trailing slash) | `https://connectly-frontend.pages.dev` (in `wrangler.toml` or secret) |
| `PROXY_SECRET` | 64-hex character origin authentication secret shared with backend | Set via `npx wrangler secret put PROXY_SECRET` (MANDATORY; never commit) |

### Configuration File (`wrangler.toml`)

```toml
name = "connectly-proxy"
main = "src/worker.js"
compatibility_date = "2024-04-01"
compatibility_flags = ["nodejs_compat"]

[vars]
BACKEND_ORIGIN = "https://connectly-backend.koyeb.app"
FRONTEND_ORIGIN = "https://connectly-frontend.pages.dev"
```

---

## 4. Local Testing & Verification

The proxy includes a standalone automated test suite validating path dispatching, host-header stripping, WebSocket 101 handling, and 502 sanitization.

### Run Unit Tests
```bash
# From workspace root
node --test proxy/test/proxyRouting.test.js

# Or from proxy directory
cd proxy
npm test
```

### Local Dev Server with Wrangler
```bash
cd proxy
npx wrangler dev
```
Wrangler will start a local emulation on `http://localhost:8787`. You can verify routing with curl:
```bash
# Verify API proxying
curl -i http://localhost:8787/api/v1/health

# Verify static asset proxying
curl -i http://localhost:8787/
```

---

## 5. Deployment Instructions (Owner Manual Steps)

> **NOTE:** In accordance with Phase 18 constraints ($0 budget, strict no-deployment mode), agents do not deploy or authenticate to external accounts. The owner performs deployment using the official Cloudflare Wrangler CLI.

### Step 1: Install Wrangler CLI & Authenticate
```bash
cd proxy
npm install
npx wrangler login
```

### Step 2: Configure Upstream Origins & Worker Secrets
Configure the upstream origins and the mandatory origin authentication secret in the Cloudflare Worker environment using the Wrangler CLI or Cloudflare dashboard:
```bash
npx wrangler secret put BACKEND_ORIGIN
npx wrangler secret put FRONTEND_ORIGIN
npx wrangler secret put PROXY_SECRET
```

#### Mandatory Security Rules for `PROXY_SECRET`:
1. **Strict 64-Hexadecimal Requirement:** `PROXY_SECRET` must contain exactly 64 hexadecimal characters (`[0-9a-fA-F]{64}`), representing 256 bits of cryptographic entropy.
2. **Exact Origin Secret Parity:** The Cloudflare Worker (`proxy/`) and the backend application (`server/`) must use the **exact same secret**. Any mismatch results in immediate HTTP 403 `ORIGIN_AUTHENTICATION_REQUIRED` rejections on all API and WebSocket requests.
3. **Owner Generation via CSPRNG:** The secret must be generated securely by the repository owner before deployment using a cryptographically secure random number generator:
   ```bash
   openssl rand -hex 32
   ```
4. **Never Commit Secrets:** Never commit real secrets or production `.env` files to source control or public repositories. Set them exclusively via `npx wrangler secret put PROXY_SECRET` (which stores the secret encrypted in Cloudflare) and the Koyeb/Render environment variables dashboard.
5. **Fail-Closed Security Gate:** If `PROXY_SECRET` is missing, empty, or fails the 64-hex character validation, the Cloudflare Worker fails closed immediately, returning HTTP 500 `PROXY_CONFIGURATION_ERROR` without forwarding requests upstream.

### Step 3: Deploy to Cloudflare Edge
```bash
npx wrangler deploy
```

Upon successful deployment, Wrangler will output your worker URL:
`https://connectly-proxy.<your-subdomain>.workers.dev`

### Step 4: Verification Checklist
1. Navigate to `https://connectly-proxy.<your-subdomain>.workers.dev/` in your browser. Verify the CONNECTLY frontend loads without blank screens.
2. Open Browser DevTools -> Network tab.
3. Test login: verify cookies are set with `SameSite=Lax; Path=/; Secure; HttpOnly`.
4. Test room join: verify `/socket.io/?...` upgrades to `101 Switching Protocols` without disconnection loops.
5. Verify `/api/v1/system/readiness` returns backend status through the proxy.
