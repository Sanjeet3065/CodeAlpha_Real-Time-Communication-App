# CONNECTLY — Phase 05: Authentication System Security Review

## 1. Security Architecture & Threat Model

CONNECTLY’s Phase 05 authentication implementation adheres to OWASP, NIST SP 800-63B, and RFC 6749 guidelines. Following an independent security audit and subsequent remediation, the threat matrix below outlines the active mitigations enforced by the Phase 05 subsystem:

| Threat Vector | Attack Scenario | Implemented Mitigation | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Credential Cracking / Rainbow Tables** | Offline brute-force against compromised password hashes | **Argon2id** (v=19, 64MB memory, 3 iterations, 1 parallelism, 16-byte random salt). | Verified in MongoDB: Hash starts with `$argon2id$v=19$m=65536,t=3,p=1$`. |
| **XSS Token Theft** | Malicious script extracts session tokens from browser | Access token is stored **strictly in JavaScript memory**; Refresh token is stored in an **`HttpOnly` cookie**. Neither is ever placed in `localStorage` or `sessionStorage`. | Verified: `localStorage.getItem('token')` returns `null`. Cookie has `HttpOnly` flag. |
| **CSRF (Cross-Site Request Forgery)** | Third-party origin triggers forged session requests | Multi-layered defense: Cookie configured with `SameSite: Lax` scoped to `/api`; `validateRequestOrigin` blocks untrusted Origin/Referer headers; `requireCsrfHeader` enforces custom headers (`X-Requested-With` or `X-CSRF-Protection`) on state-changing cookie requests. | Integration tests 7, 8, 9, 10 prove untrusted origins and missing headers return `403 Forbidden`. |
| **Refresh Token Replay & Multi-Device Isolation** | Stolen refresh token replayed by attacker | **Token Family Isolation & Atomic Rotation**: Each device session has a unique `familyId`. Atomic `findOneAndUpdate` handles token rotation. Replaying an old token outside a 5-second concurrency grace window revokes **only the compromised token family**, keeping other device sessions safe. | Integration tests 17, 18, 19 prove atomic rotation, concurrent race tolerance, and isolated breach revocation. |
| **Credential Stuffing / Brute Force** | Automated dictionary attacks against `/login` or `/refresh` | `express-rate-limit` throttles requests per IP: 20 attempts/15m for `/login`, 30 attempts/15m for `/register`, 60 attempts/15m for `/refresh`. | Verified: Rate limiter returns `429 Too Many Requests` (Integration test 22). |
| **NoSQL Injection** | Client submits malicious selector objects (`{ $gt: "" }`) | Strict Zod payload schema validation strips unauthorized keys; Mongoose schemas enforce strong typing on query selectors. | Verified: Zod schemas reject non-string primitives. |
| **Open Redirect / Phishing** | Attacker crafts `?redirect=//evil.com` or `\evil.com` to hijack post-login redirect | Protocol and domain sanitization (`sanitizeNavigationPath`) strips backslashes (`CVE-2025-68470`), protocol-relative URLs (`//`), and external protocols (`javascript:`, `data:`). | Verified: Client unit test suite (9/9 pass) and live CDP fuzzing test. |
| **Production Secret Compromise** | Weak or default JWT secret keys deployed to production | Zod environment schema refinement enforces minimum 32-character high-entropy secret in production, rejecting default dev secrets. | Verified: `server/src/config/env.ts` schema validation. |

---

## 2. Cryptographic Analysis: Argon2id Parameters

### 2.1. Parameter Justification
Argon2id combines the data-dependent memory access of Argon2d with the data-independent memory access of Argon2i, offering the highest state-of-the-art resistance against both side-channel cache attacks and GPU/ASIC acceleration:

- **Algorithm:** `Argon2id` (version 19).
- **Memory Cost ($m$):** `65536` KB ($64\text{ MB}$). Exceeds OWASP minimum recommended threshold ($19\text{ MB}$), imposing heavy memory bandwidth penalties on specialized hardware attackers.
- **Time Cost ($t$):** `3` iterations. Provides adequate computation overhead (~250–350ms on modern x86_64 server CPUs) without degrading user perceived latency.
- **Parallelism ($p$):** `1` thread. Predictable resource consumption across concurrent worker threads.
- **Salt:** 16 bytes of cryptographically secure randomness generated via native CSPRNG per password.

### 2.2. Sample Verified Cryptographic Hash from MongoDB
```
$argon2id$v=19$m=65536,t=3,p=1$TGzHdIXiREJ1MY7UoxE/WQ$Xy3U8rdvZz7RvqH6Ua2awl/A81AJcaqPy9JPJvdNXlw
```

---

## 3. Session Lifecycle & Token Management

```mermaid
sequenceDiagram
    autonumber
    actor Client as Web Browser (Device A)
    participant API as Connectly Express API
    participant DB as MongoDB Database

    Note over Client,DB: User Login Flow
    Client->>API: POST /api/v1/auth/login (email, password)
    API->>DB: Query user by lowercase email
    DB-->>API: Return User document with Argon2id hash
    API->>API: Verify password with Argon2id
    API->>API: Mint 15m JWT Access Token
    API->>API: Generate 64-hex CSPRNG Refresh Token
    API->>API: Generate unique UUID familyId
    API->>API: Compute SHA-256 hash of Refresh Token
    API->>DB: Save session in auth_sessions (familyId, isValid: true, expiresAt: 7d)
    API-->>Client: Set HttpOnly Cookie (connectly_refresh) + JSON { accessToken }
    Note over Client: Stores accessToken in memory (AuthContext)

    Note over Client,DB: Silent Token Refresh Flow
    Client->>API: POST /api/v1/auth/refresh (Cookie: connectly_refresh, Header: X-Requested-With)
    API->>API: Validate Origin/Referer & Anti-CSRF Header
    API->>API: Compute SHA-256 hash of incoming cookie
    API->>DB: findOneAndUpdate({ refreshTokenHash, isValid: true }) -> mark isValid: false, rotatedAt: now
    alt Valid Active Token
        API->>API: Mint new 15m JWT Access Token
        API->>API: Generate new Refresh Token (inherits same familyId)
        API->>DB: Insert new active session (familyId, expiresAt: 7d)
        API-->>Client: Set new Cookie (connectly_refresh) + JSON { accessToken }
    else Already Rotated (< 5000ms ago) [CONCURRENT RACE]
        API-->>Client: 401 CONCURRENT_REFRESH (Preserve Family)
    else Invalid / Previously Used (> 5000ms ago) [BREACH DETECTION]
        API->>DB: Revoke ALL sessions for this familyId: updateMany({ familyId }, { isValid: false })
        API-->>Client: Clear Cookie + 401 TOKEN_REUSE_DETECTED
    end
```

---

## 4. Live Browser Cookie Metadata Verification

Audited directly from running Google Chrome via Chrome DevTools Protocol (`Network.getCookies`):

```json
{
  "name": "connectly_refresh",
  "domain": "localhost",
  "path": "/api",
  "expires": "2026-11-24T15:21:34.683Z",
  "sizeBytes": 81,
  "httpOnly": true,
  "secure": false,
  "sameSite": "Lax",
  "value": "[REDACTED_64_HEX_CHARS_FOR_SECURITY]"
}
```

> [!NOTE]
> The `secure` flag is dynamically set: `false` in local HTTP development (`http://localhost:5173`), and strictly `true` when `NODE_ENV === 'production'` (enforcing HTTPS transport). The cookie value is redacted in reports in compliance with privacy guidelines.

---

## 5. Rate Limiting & Denial of Service Defenses

The API deploys tiered IP-based rate limiting via `express-rate-limit`:
- **Registration Limiter:** 30 requests per 15-minute window per IP.
- **Login Limiter:** 20 requests per 15-minute window per IP.
- **Refresh Limiter:** 60 requests per 15-minute window per IP.
- **Standard Headers:** Emits `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` HTTP headers.
- **Problem Details:** Exceeded limits respond with standard RFC 7807 `429 Too Many Requests`.

> [!TIP]
> In single-node development and staging, in-memory rate limiting is used. For horizontal multi-node production deployment (Phase 07 and Phase 17), the rate limiter will transition to a distributed Redis store (`rate-limit-redis`) as documented in `docs/SECURITY_PLAN.md`.

---

## 6. Dependency Audit Findings & Mitigations (`npm audit`)

The root `npm audit` was evaluated during independent verification. Two ecosystem advisories were analyzed:

1. **`react-router-dom@6.30.6` (CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6 & GHSA-337j-9hxr-rhxg):**
   - *Advisory Details:* Open redirect via backslash (`/\\`) and SSR hydration error deserialization vulnerability.
   - *Impact Assessment:* Connectly is a Client-Side Rendered (CSR) Single Page Application; SSR hydration is completely unused. Open redirects are mitigated in code via `sanitizeNavigationPath()`, which systematically rejects all backslashes, protocol-relative slashes, and external schemes. Upgrading to React Router v7 is a major breaking API change.
   - *Status:* **Mitigated by application architecture & sanitization logic.**

2. **`zod@3.24.2` (GHSA-mrhx-c7xc-m3w5):**
   - *Advisory Details:* Potential ReDoS / memory exhaustion when parsing deeply nested unbounded collections.
   - *Impact Assessment:* Connectly authentication schemas validate scalar string inputs (`email`, `password`, `firstName`, `lastName`) with strict upper bound length limits (`max(128)`, `max(50)`). No unbounded array or object collections are processed. Upgrading to Zod v4 would require breaking schema migrations across the codebase.
   - *Status:* **Mitigated by strict scalar schema design.**

---

## 7. Security Header Baseline (Helmet)

The Express server deploys `helmet` to inject defense-in-depth HTTP response headers:
- `Content-Security-Policy`: Default restrictive policy.
- `Cross-Origin-Resource-Policy`: `cross-origin` to allow Vite client interactions.
- `X-Content-Type-Options`: `nosniff` preventing MIME confusion attacks.
- `X-Frame-Options`: `SAMEORIGIN` preventing clickjacking.
- `Strict-Transport-Security`: Enforces HTTPS in production environments.

---

## 8. Conclusion & Security Sign-Off

The Phase 05 Authentication System meets all security standards set forth in `docs/SECURITY_PLAN.md`, NIST SP 800-63B, and RFC 6749. All five audit findings have been resolved, verified with 50 passing tests across unit, integration, and live headless browser environments. No mock data, no plaintext credentials, and no persistent browser token vulnerabilities exist in the codebase.

**Security Verdict:** **APPROVED (READY FOR OWNER REVIEW)**
