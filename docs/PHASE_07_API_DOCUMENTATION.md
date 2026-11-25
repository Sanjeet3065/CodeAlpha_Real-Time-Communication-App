# CONNECTLY — PHASE 07 API DOCUMENTATION
## RESTful SPECIFICATION & CONTRACT REFERENCE

---

## 1. Global Conventions & Standards

- **Base URL:** `http://localhost:5000` (Direct) or `/api/v1` (Proxied)
- **Content Type:** `application/json; charset=utf-8`
- **Authentication:** HTTP Bearer token (`Authorization: Bearer <access_token>`)
- **Anti-CSRF Headers:** Required on state-changing requests:
  - `X-Requested-With: XMLHttpRequest`
  - `X-CSRF-Protection: 1`
- **Request Tracing:** All responses return an `X-Request-Id` HTTP header populated from the incoming header or generated via `crypto.randomUUID()`.

### 1.1 Standard Success Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "7e3b91a4-9e12-4c55-b44e-128456123456",
    "timestamp": "2026-11-17T17:42:30.170Z"
  }
}
```

### 1.2 Standard Error Problem Details
```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed on request body",
  "errors": [
    {
      "field": "firstName",
      "message": "First name must not exceed 50 characters"
    }
  ],
  "timestamp": "2026-11-17T17:42:30.298Z",
  "requestId": "d551dd5c-7a38-4f8d-8179-fde0e1b0bff0"
}
```

---

## 2. Health & Readiness Endpoints

### 2.1 GET `/health` & `GET /api/v1/health`
Liveness check verifying that the Express application process is running and accepting HTTP connections.

- **Authentication:** None (Public)
- **Success Status:** `200 OK`
- **Response Example:**
```json
{
  "status": "ok",
  "service": "connectly-server",
  "version": "0.1.0",
  "timestamp": "2026-11-17T17:46:51.926Z"
}
```

### 2.2 GET `/ready` & `GET /api/v1/ready`
Readiness check verifying that the MongoDB database connection is active and operational.

- **Authentication:** None (Public)
- **Success Status:** `200 OK` (when database is connected)
- **Success Response Example:**
```json
{
  "status": "ready",
  "database": "connected",
  "timestamp": "2026-11-17T17:46:52.249Z"
}
```
- **Error Status:** `503 Service Unavailable` (when database is disconnected or connecting)
- **Error Response Example:**
```json
{
  "status": "not_ready",
  "database": "disconnected",
  "timestamp": "2026-11-17T17:46:52.249Z"
}
```

---

## 3. User Profile Endpoints

### 3.1 GET `/api/v1/users/me`
Retrieves the sanitized profile of the currently authenticated user.

- **Authentication:** Bearer Token Required
- **Headers:** `Authorization: Bearer <token>`
- **Success Status:** `200 OK`
- **Response Example:**
```json
{
  "id": "6afc933b21245e8c6107244d",
  "name": "Alex Rivera",
  "firstName": "Alex",
  "lastName": "Rivera",
  "email": "alex.rivera@example.com",
  "isEmailVerified": false,
  "avatarUrl": null,
  "preferences": {
    "defaultAudioMuted": true,
    "defaultVideoOff": false,
    "enableVirtualBackground": false,
    "theme": "light",
    "notificationSounds": true
  },
  "createdAt": "2026-11-17T17:42:30.170Z",
  "updatedAt": "2026-11-17T17:42:30.170Z"
}
```
- **Error Statuses:**
  - `401 Unauthorized`: Token missing, expired, or invalid signature.

---

### 3.2 PATCH `/api/v1/users/me`
Updates user identity information (first and last name) with strict schema validation.

- **Authentication:** Bearer Token Required
- **Headers:**
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
  - `X-Requested-With: XMLHttpRequest`
- **Request Body Schema:**
  - `firstName` *(optional string, 1–50 characters)*
  - `lastName` *(optional string, 1–50 characters)*
  - *Must provide at least one field. Extraneous fields are strictly rejected.*
- **Request Example:**
```json
{
  "firstName": "Alexander",
  "lastName": "Rivera"
}
```
- **Success Status:** `200 OK`
- **Response Example:**
```json
{
  "id": "6afc933b21245e8c6107244d",
  "name": "Alexander Rivera",
  "firstName": "Alexander",
  "lastName": "Rivera",
  "email": "alex.rivera@example.com",
  "isEmailVerified": false,
  "avatarUrl": null,
  "preferences": { ... },
  "createdAt": "2026-11-17T17:42:30.170Z",
  "updatedAt": "2026-11-17T17:48:12.345Z"
}
```
- **Error Statuses:**
  - `400 Bad Request`: Empty payload, field length > 50 characters, or unauthorized properties (`role`, `email`, etc.).
  - `401 Unauthorized`: Token missing or invalid.

---

## 4. User Preferences Endpoints

### 4.1 GET `/api/v1/users/me/preferences`
Retrieves persisted audio and video room defaults for the authenticated user from MongoDB.

- **Authentication:** Bearer Token Required
- **Headers:** `Authorization: Bearer <token>`
- **Success Status:** `200 OK`
- **Response Example:**
```json
{
  "success": true,
  "data": {
    "defaultAudioMuted": true,
    "defaultVideoOff": false,
    "updatedAt": "2026-11-17T17:47:39.833Z"
  },
  "meta": {
    "requestId": "228fca44-584d-4b44-9dfa-fe76e0823281",
    "timestamp": "2026-11-17T17:47:39.835Z"
  }
}
```

---

### 4.2 PUT & PATCH `/api/v1/users/me/preferences`
Mutates or provisions user preferences in MongoDB. Supports independent updates to microphone and camera defaults.

- **Authentication:** Bearer Token Required
- **Headers:**
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
  - `X-Requested-With: XMLHttpRequest`
- **Request Body Schema:**
  - `defaultAudioMuted` *(optional boolean)*
  - `defaultVideoOff` *(optional boolean)*
  - *Must provide at least one valid boolean field. Non-boolean values and extra properties trigger `400 Bad Request`.*
- **Independent Microphone Mutation Example:**
```json
{
  "defaultAudioMuted": false
}
```
- **Independent Camera Mutation Example:**
```json
{
  "defaultVideoOff": true
}
```
- **Combined Mutation Example:**
```json
{
  "defaultAudioMuted": false,
  "defaultVideoOff": true
}
```
- **Success Status:** `200 OK`
- **Response Example:**
```json
{
  "success": true,
  "data": {
    "defaultAudioMuted": false,
    "defaultVideoOff": true,
    "updatedAt": "2026-11-17T17:47:40.284Z"
  },
  "meta": {
    "requestId": "6bad58a5-365e-4a4c-a95a-b766775ad2e7",
    "timestamp": "2026-11-17T17:47:40.286Z"
  }
}
```
- **Error Statuses:**
  - `400 Bad Request`: Non-boolean input types (`"true"` as string, numbers), unknown properties (`theme`, `arbitrary`), or empty body `{}`.
  - `401 Unauthorized`: Missing or invalid Bearer token.
  - `403 Forbidden`: Anti-CSRF header missing on state-changing request.

---

## 5. cURL Verification Examples

### Verify Liveness & Readiness:
```bash
curl -s http://localhost:5000/health
curl -s http://localhost:5000/ready
```

### Fetch Authenticated Preferences:
```bash
curl -s http://localhost:5000/api/v1/users/me/preferences \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Update Audio Preference to Unmuted:
```bash
curl -s -X PUT http://localhost:5000/api/v1/users/me/preferences \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "X-CSRF-Protection: 1" \
  -d '{"defaultAudioMuted": false}'
```
