# CONNECTLY — Phase 07: Initial Repository & Architecture Audit Report

**Phase:** Phase 07 – Backend & Database  
**Roadmap Position:** Phase 07 of 18 (Phases 01–06 Approved)  
**Audit Date:** 2026-11-17  
**Audit Scope:** Full Monorepo Architecture, Existing Server Code, Database Schemas, Authentication Infrastructure, Security Controls, and Dependency Health

---

## 1. Executive Summary

This initial audit establishes an exact, empirical baseline of the CONNECTLY repository before implementing Phase 07 (Backend & Database). The current codebase features an operational Phase 05 authentication system and an approved Phase 06 User Dashboard. The backend currently uses Express 4, TypeScript 5, Mongoose 8, Argon2id, and JSON Web Tokens.

The audit identifies the specific architectural foundations already in place, gaps that Phase 07 must fulfill, components requiring modification or extension, and components that must remain strictly untouched to preserve Phase 05/06 stability.

---

## 2. What Is Already Implemented

1. **Monorepo Structure:**
   - NPM workspaces separating `client` (`connectly-client@0.1.0`) and `server` (`connectly-server@0.1.0`).
   - Shared root commands for `dev`, `build`, `test`, `typecheck`, `lint`.
2. **MongoDB Connection Baseline:**
   - `server/src/config/database.ts` establishes a basic Mongoose connection using `env.MONGODB_URI` with `serverSelectionTimeoutMS: 5000`.
   - `disconnectDatabase()` provides basic disconnection for graceful shutdown in `server.ts`.
3. **Core Database Models:**
   - `User.model.ts`: Defines `IUser` with `email`, `passwordHash` (Argon2id), `firstName`, `lastName`, `avatarUrl`, `isEmailVerified`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpires`, and an embedded `preferences` subdocument. Indexes exist on `email` (unique), `passwordResetToken` (sparse), and `createdAt`.
   - `Session.model.ts`: Defines `IAuthSession` in collection `auth_sessions` with `userId`, `familyId`, `refreshTokenHash` (unique), `userAgent`, `ipAddress`, `isValid`, `rotatedAt`, `expiresAt`, `createdAt`. TTL index on `expiresAt` and compound indexes on `{ userId: 1, isValid: 1 }` and `{ familyId: 1, isValid: 1 }`.
4. **Phase 05 Authentication Engine:**
   - Registration with Argon2id password hashing ($m=65536, t=3, p=1$).
   - Dual-token architecture: 15-minute in-memory access token, 7-day HttpOnly refresh cookie.
   - Refresh token rotation with family tracking, concurrency race grace window (5s), and family revocation upon reuse.
   - Origin/Referer and custom anti-CSRF headers (`X-Requested-With`, `X-CSRF-Protection`).
   - Express rate limiter on `/api/v1/auth/login`.
   - `GET /api/v1/users/me` endpoint in `users.routes.ts` returning basic user fields.
5. **Basic Server Express Shell:**
   - `server/src/app.ts`: Helmet with CORS allowlist, `express.json()`, `cookieParser()`, and basic `/health` check.

---

## 3. What Is Incomplete (Phase 07 Scope)

1. **Readiness Check (`/ready`):**
   - The server only exposes `/health` (process liveness), but lacks a dedicated `/ready` probe that dynamically verifies MongoDB connectivity (`mongoose.connection.readyState === 1`) and returns 503 when disconnected.
2. **Dedicated User Preferences Architecture:**
   - Preferences currently exist only as a default subdocument on `User` and in client `localStorage` (`cly_meeting_preferences`).
   - Missing dedicated endpoints: `GET /api/v1/users/me/preferences` and `PUT /api/v1/users/me/preferences`.
   - Missing dedicated `UserPreferences` model/repository enforcing 1:1 user scoping, safe upsert, and validation of `defaultAudioMuted` and `defaultVideoOff`.
3. **User Profile Mutation (`PATCH /api/v1/users/me`):**
   - No update endpoint exists for user profiles. Users cannot update safe profile fields (e.g. `firstName`, `lastName`).
   - Missing strict validation against mass assignment (must reject unauthorized role changes, email verification tampering, password hash overwrite).
4. **Centralized API Response Standardization:**
   - API endpoints format JSON responses ad-hoc rather than using a centralized helper (`apiResponse.ts`) or consistent response envelope.
5. **Centralized Async Error Handling:**
   - Missing custom domain errors (`AppError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`) with structured error formatting and request ID tracking.
6. **Structured Observability & Logging:**
   - Existing logs use raw `console.log` / `console.error`. Missing a structured logging utility (`logger.ts`) with ISO timestamps, log levels, request IDs, sanitized headers, and no secret leakage.
7. **Request ID Tracking:**
   - Missing an asynchronous request ID middleware assigning a unique UUID to `X-Request-Id` and request context.
8. **Client Settings Cloud Sync:**
   - `SettingsPage.tsx` saves only to `localStorage` with a notice that cloud sync activates in Phase 07. Missing integration with `GET /api/v1/users/me/preferences` and `PUT /api/v1/users/me/preferences`.

---

## 4. What Is Duplicated

- Route alias duplication: `app.ts` mounts `/api/v1/auth` and `/api/auth`, `/api/v1/users` and `/api/users`. While harmless for backward compatibility, it should be cleanly structured in a central router index.
- Error formatting: Error responses in `auth.controller.ts` repeat boilerplate `{ status, code, message, timestamp }` object creation.

---

## 5. What Is Insecure or Fragile

1. **Raw Database URI Logging Risk:**
   - In `database.ts`, connection logging outputs `host:port/name`, which is safe, but there is no explicit check preventing full URI disclosure in debug/error logs if misconfigured.
2. **Readiness Reporting:**
   - The current `/health` endpoint returns `200 OK` even if MongoDB is completely disconnected. A load balancer or orchestrator would route traffic to an unready node.
3. **Lack of Request ID in Errors:**
   - Client errors cannot be correlated with server log entries because no request ID is propagated.

---

## 6. What Needs Modification

1. **`server/src/config/database.ts`:**
   - Add connection state monitoring, connection timeout, server selection timeout, clear startup failure handling, connection event logging, and safe reconnection behavior without logging credentials.
2. **`server/src/app.ts`:**
   - Mount centralized request ID middleware, structured request logging middleware, `/ready` endpoint, modularized `/api/v1/users` routes (including profile update and preferences), and centralized error handling middleware.
3. **`server/src/routes/users.routes.ts`:**
   - Extend with `PATCH /me` (profile updates) and `GET /me/preferences` + `PUT /me/preferences`.
4. **`client/src/services/authApi.ts` & `client/src/pages/SettingsPage.tsx`:**
   - Add preferences API calls (`getPreferences`, `updatePreferences`) with graceful offline/local fallback.

---

## 7. What Must Remain Untouched

1. **Argon2id Password Hashing Primitives:**
   - `$argon2id$v=19$m=65536,t=3,p=1` parameters and functions in `server/src/utils/password.ts`.
2. **Dual-Token Lifetime & Refresh Rotation:**
   - 15-minute access token, 7-day refresh cookie, 5-second concurrency grace window, and family revocation in `server/src/controllers/auth.controller.ts`.
3. **CSRF Middleware:**
   - Origin and custom header verification in `server/src/middlewares/csrf.middleware.ts`.
4. **Cookie Security Options:**
   - `HttpOnly`, `SameSite=Lax`, `Secure` options in `server/src/utils/cookies.ts`.
5. **Existing 33 Server Tests & 32 Client Tests:**
   - All tests must pass with zero modifications to assertions or expectations.
6. **Roadmap Gating:**
   - Zero room management (Phase 08), WebRTC/LiveKit (Phase 09), audio/video (Phase 10), screen share (Phase 11), chat (Phase 12), file sharing (Phase 13), whiteboard (Phase 14), encryption (Phase 15), scheduling (Phase 16).

---

## 8. Dependency & Compatibility Risk Assessment

- **Vite 6.4.6 & React 18.3.1:** Compatible, building cleanly.
- **Express 4.21.2 & Mongoose 8.10.1:** Stable, fully compatible with Node 20 LTS and MongoDB 8.x.
- **Zod 3.24.2:** Safe validation library; high-severity advisory mitigated by payload byte size limit in Express (`express.json({ limit: '100kb' })`).
- **No new external npm packages required:** Phase 07 can be built using existing packages (`mongoose`, `express`, `zod`, `crypto` native). Zero new dependencies needed, ensuring zero dependency churn or vulnerability introduction.

---

## 9. Conclusion & Implementation Sequence

The repository audit confirms a solid foundation. Implementation will proceed in the following ordered sequence:
1. **Modular Architecture & Database Layer:** Robust MongoDB connection lifecycle, event logging, and `UserPreferences` model/indexes.
2. **Centralized Utilities & Middleware:** Structured logger, request ID, API response helpers, custom error classes, and error handler.
3. **User Profile & Preferences Services/Controllers:** Validation schemas, profile retrieval/update, preference retrieval/upsert with data isolation.
4. **Endpoints & Routing:** Connect `/health`, `/ready`, `/api/v1/users/me`, `/api/v1/users/me/preferences`.
5. **Frontend Settings Integration:** Wire `SettingsPage.tsx` to save and load preferences from the database with local storage fallback.
6. **Automated Testing & Verification:** Comprehensive test suite for DB, user API, preferences API, security isolation, and regression verification.
