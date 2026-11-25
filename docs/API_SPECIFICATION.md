# CONNECTLY — REST API Specification

## 1. Specification Standards & Conventions

- **Base Path:** `/api/v1`
- **Wire Format:** Standard JSON (`Content-Type: application/json; charset=utf-8`)
- **Authentication:** Dual mode:
  1. `Authorization: Bearer <accessToken>` header OR
  2. Partitioned, HTTP-only, secure `connectly_access` cookie.
- **Error Format:** Standardized RFC 7807 problem details object:
  ```json
  {
    "status": 400,
    "code": "VALIDATION_ERROR",
    "message": "The request body failed schema validation.",
    "errors": [
      { "field": "email", "message": "Invalid email address format" }
    ],
    "timestamp": "2026-05-15T10:00:00.000Z"
  }
  ```

---

## 2. Authentication Endpoints

### 2.1. Register Account
- **Route:** `POST /api/v1/auth/register`
- **Purpose:** Creates a new user profile with hashed password credentials.
- **Auth / Role:** Public (Unauthenticated).
- **Request Body:**
  ```json
  {
    "email": "sarah.chen@connectly.io",
    "password": "SecurePassword123!",
    "firstName": "Sarah",
    "lastName": "Chen"
  }
  ```
- **Responses:**
  - `201 Created`:
    ```json
    {
      "success": true,
      "message": "User registered successfully. Verification email dispatched.",
      "user": {
        "id": "6650a12f84b3e8a1d044a101",
        "email": "sarah.chen@connectly.io",
        "firstName": "Sarah",
        "lastName": "Chen"
      }
    }
    ```
  - `400 Bad Request`: Validation failure on email or password complexity.
  - `409 Conflict`: Email address is already registered.
  - `429 Too Many Requests`: Registration rate limit exceeded (max 5 per IP / hr).

### 2.2. Login
- **Route:** `POST /api/v1/auth/login`
- **Purpose:** Verifies credentials, mints access token and rotated refresh token session. Sets HTTP-only cookies.
- **Auth / Role:** Public.
- **Request Body:**
  ```json
  {
    "email": "sarah.chen@connectly.io",
    "password": "SecurePassword123!"
  }
  ```
- **Responses:**
  - `200 OK`: (Sets `connectly_access` and `connectly_refresh` HTTP-only cookies)
    ```json
    {
      "success": true,
      "user": {
        "id": "6650a12f84b3e8a1d044a101",
        "email": "sarah.chen@connectly.io",
        "firstName": "Sarah",
        "lastName": "Chen",
        "avatarUrl": "https://res.cloudinary.com/connectly/..."
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIs..."
    }
    ```
  - `401 Unauthorized`: Invalid email or password.
  - `429 Too Many Requests`: Brute-force threshold exceeded (5 failed attempts per 15 min).

### 2.3. Refresh Access Token
- **Route:** `POST /api/v1/auth/refresh`
- **Purpose:** Rotates refresh token and issues a new 15-minute access token.
- **Auth / Role:** Public (requires valid `connectly_refresh` cookie).
- **Request:** Cookie: `connectly_refresh=<token>`
- **Responses:**
  - `200 OK`:
    ```json
    { "success": true, "accessToken": "eyJhbGciOi..." }
    ```
  - `401 Unauthorized`: Refresh token expired, malformed, or revoked.

### 2.4. Logout
- **Route:** `POST /api/v1/auth/logout`
- **Purpose:** Revokes active refresh token session in database and clears client cookies.
- **Auth / Role:** Authenticated (`Bearer` or Cookie).
- **Responses:**
  - `200 OK`: `{ "success": true, "message": "Successfully logged out." }`

### 2.5. Forgot Password Request
- **Route:** `POST /api/v1/auth/forgot-password`
- **Purpose:** Generates a 15-minute single-use password reset token and dispatches reset email.
- **Auth / Role:** Public.
- **Request Body:** `{ "email": "sarah.chen@connectly.io" }`
- **Responses:**
  - `200 OK`: `{ "success": true, "message": "If the account exists, a reset link has been dispatched." }`

### 2.6. Reset Password Confirmation
- **Route:** `POST /api/v1/auth/reset-password`
- **Purpose:** Consumes reset token and commits new Argon2id password hash.
- **Auth / Role:** Public.
- **Request Body:**
  ```json
  {
    "token": "d82f7c03...64-char-hex",
    "newPassword": "NewSecurePassword456!"
  }
  ```
- **Responses:**
  - `200 OK`: `{ "success": true, "message": "Password updated successfully." }`
  - `400 Bad Request`: Token expired, invalid, or password complexity unmet.

---

## 3. Users & Profile Endpoints

### 3.1. Get Current User Profile
- **Route:** `GET /api/v1/users/me`
- **Purpose:** Fetches current user profile and default preferences.
- **Auth / Role:** Authenticated.
- **Responses:**
  - `200 OK`:
    ```json
    {
      "id": "6650a12f84b3e8a1d044a101",
      "email": "sarah.chen@connectly.io",
      "firstName": "Sarah",
      "lastName": "Chen",
      "avatarUrl": "https://...",
      "preferences": {
        "defaultAudioMuted": true,
        "defaultVideoOff": false,
        "theme": "editorial-light"
      }
    }
    ```
  - `401 Unauthorized`.

### 3.2. Update Profile & Preferences
- **Route:** `PATCH /api/v1/users/me`
- **Purpose:** Modifies display name, avatar, or default media preferences.
- **Auth / Role:** Authenticated.
- **Request Body:**
  ```json
  {
    "firstName": "Dr. Sarah",
    "preferences": {
      "defaultAudioMuted": true,
      "defaultVideoOff": true
    }
  }
  ```
- **Responses:**
  - `200 OK`: Returns updated user object.
  - `400 Bad Request`: Schema validation error.

---

## 4. Meetings Endpoints

### 4.1. Create Instant Meeting
- **Route:** `POST /api/v1/meetings/instant`
- **Purpose:** Generates a new meeting room code and activates it immediately with the caller as host.
- **Auth / Role:** Authenticated (`User`).
- **Request Body:**
  ```json
  {
    "title": "Quick Sync",
    "settings": {
      "waitingRoomEnabled": true,
      "defaultMuteOnEntry": true,
      "allowScreenShare": true
    }
  }
  ```
- **Responses:**
  - `201 Created`:
    ```json
    {
      "meetingId": "6650c35084b3e8a1d044c303",
      "meetingCode": "cly-789-qwa",
      "title": "Quick Sync",
      "joinUrl": "https://connectly.io/meeting/cly-789-qwa",
      "hostId": "6650a12f84b3e8a1d044a101"
    }
    ```

### 4.2. Get Meeting Metadata
- **Route:** `GET /api/v1/meetings/:meetingCode`
- **Purpose:** Public inspection of meeting status before entry (returns title, host name, whether passcode is required, whether waiting room is active).
- **Auth / Role:** Public (or Authenticated).
- **Responses:**
  - `200 OK`:
    ```json
    {
      "meetingCode": "cly-789-qwa",
      "title": "Quarterly Architecture Sync",
      "hostName": "Sarah Chen",
      "status": "active",
      "isPasscodeRequired": true,
      "waitingRoomEnabled": true
    }
    ```
  - `404 Not Found`: Meeting does not exist or has ended.

### 4.3. Join Meeting & Mint LiveKit Token
- **Route:** `POST /api/v1/meetings/:meetingCode/join`
- **Purpose:** Validates passcode/waiting room, issues signed LiveKit WebRTC access token and Socket authorization ticket.
- **Auth / Role:** Public or Authenticated (Guests provide `displayName`).
- **Request Body:**
  ```json
  {
    "passcode": "789123",
    "displayName": "Marcus Vance",
    "avatarUrl": null
  }
  ```
- **Responses:**
  - `200 OK` (Direct Admission):
    ```json
    {
      "status": "ADMITTED",
      "role": "participant",
      "livekitToken": "eyJhbGciOi...",
      "livekitUrl": "wss://sfu.connectly.io",
      "socketAuthToken": "eyJhbGciOi...",
      "meeting": {
        "id": "6650c35084b3e8a1d044c303",
        "meetingCode": "cly-789-qwa",
        "title": "Quarterly Architecture Sync"
      }
    }
    ```
  - `200 OK` (Waiting Room Holding):
    ```json
    {
      "status": "WAITING_ROOM",
      "waitingTicket": "wtk_881273ab...",
      "message": "You are in the waiting room. Please wait for the host to admit you."
    }
    ```
  - `401 Unauthorized`: Incorrect meeting passcode.
  - `403 Forbidden`: Meeting is locked, capacity (60) reached, or user is banned.
  - `404 Not Found`: Meeting does not exist.

### 4.4. Terminate Meeting (End for All)
- **Route:** `POST /api/v1/meetings/:meetingCode/end`
- **Purpose:** Concludes the meeting, kicks all connected sockets/media tracks, and aggregates session history.
- **Auth / Role:** Authenticated (`Host` only).
- **Responses:**
  - `200 OK`: `{ "success": true, "message": "Meeting ended for all participants." }`
  - `403 Forbidden`: User is not host.

---

## 5. Participants Endpoints

### 5.1. List Active Participants
- **Route:** `GET /api/v1/meetings/:meetingCode/participants`
- **Purpose:** Fetches the active participant roster, roles, and media states.
- **Auth / Role:** Active Room Participant or Host.
- **Responses:**
  - `200 OK`: Array of participant objects (`id`, `displayName`, `role`, `isAudioMuted`, `isVideoEnabled`, `isHandRaised`).

### 5.2. Update Participant Role (Promote / Demote)
- **Route:** `PATCH /api/v1/meetings/:meetingCode/participants/:participantId/role`
- **Purpose:** Host promotes a participant to Co-Host or demotes back to Participant.
- **Auth / Role:** Authenticated (`Host` only).
- **Request Body:** `{ "role": "co-host" }`
- **Responses:**
  - `200 OK`: `{ "success": true, "updatedRole": "co-host" }`
  - `403 Forbidden`.

### 5.3. Eject Participant
- **Route:** `DELETE /api/v1/meetings/:meetingCode/participants/:participantId`
- **Purpose:** Host/Co-host forces removal of a disruptive participant.
- **Auth / Role:** Authenticated (`Host` or `Co-Host`).
- **Responses:**
  - `200 OK`: `{ "success": true, "message": "Participant ejected." }`

---

## 6. Chat Endpoints

### 6.1. Get Meeting Message History
- **Route:** `GET /api/v1/meetings/:meetingCode/messages`
- **Purpose:** Retrieves paginated chat messages for active participants or post-meeting review.
- **Auth / Role:** Active Participant or Host.
- **Query Params:** `?limit=50&before=<messageId>`
- **Responses:**
  - `200 OK`:
    ```json
    {
      "messages": [
        {
          "id": "6650e57084b3e8a1d044e505",
          "senderId": "6650a12f84b3e8a1d044a101",
          "senderName": "Sarah Chen",
          "content": "Welcome everyone!",
          "type": "public",
          "createdAt": "2026-05-15T10:02:00.000Z"
        }
      ],
      "hasMore": false
    }
    ```

---

## 7. Files Endpoints

### 7.1. Request Pre-Signed Upload URL
- **Route:** `POST /api/v1/meetings/:meetingCode/files/presign-upload`
- **Purpose:** Validates file metadata and returns a secure, direct-to-S3 pre-signed upload URL.
- **Auth / Role:** Active Meeting Participant.
- **Request Body:**
  ```json
  {
    "fileName": "system_specs.pdf",
    "fileSizeBytes": 3412000,
    "mimeType": "application/pdf"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "fileId": "6650f68084b3e8a1d044f606",
      "uploadUrl": "https://s3.us-east-1.amazonaws.com/connectly-private/meetings/...?",
      "storageKey": "meetings/cly-789-qwa/3410f92a.pdf",
      "expiresInSeconds": 900
    }
    ```
  - `400 Bad Request`: File size exceeds 25MB or MIME type rejected.
  - `403 Forbidden`: File sharing disabled by host.

### 7.2. Confirm Upload Completion
- **Route:** `POST /api/v1/meetings/:meetingCode/files/confirm`
- **Purpose:** Verifies object existence in storage and records metadata in MongoDB.
- **Auth / Role:** Active Meeting Participant.
- **Request Body:**
  ```json
  {
    "fileId": "6650f68084b3e8a1d044f606",
    "storageKey": "meetings/cly-789-qwa/3410f92a.pdf"
  }
  ```
- **Responses:**
  - `201 Created`: Returns confirmed `shared_files` record.

### 7.3. Request Pre-Signed Download URL
- **Route:** `GET /api/v1/meetings/:meetingCode/files/:fileId/presign-download`
- **Purpose:** Generates a short-lived (5-minute) pre-signed download URL for a shared file.
- **Auth / Role:** Active Meeting Participant or Host.
- **Responses:**
  - `200 OK`:
    ```json
    {
      "downloadUrl": "https://s3.us-east-1.amazonaws.com/connectly-private/...?X-Amz-Signature=...",
      "fileName": "system_specs.pdf",
      "expiresInSeconds": 300
    }
    ```
  - `403 Forbidden`: Caller is not a participant of the meeting.

---

## 8. Whiteboard Endpoints

### 8.1. Get Current Whiteboard State
- **Route:** `GET /api/v1/meetings/:meetingCode/whiteboard`
- **Purpose:** Hydrates current vector canvas state and lock status for participants.
- **Auth / Role:** Active Meeting Participant.
- **Responses:**
  - `200 OK`:
    ```json
    {
      "version": 42,
      "isLocked": false,
      "elements": [
        { "id": "el_1", "type": "rectangle", "x": 100, "y": 100, "width": 200, "height": 150, "strokeColor": "#172B3A" }
      ]
    }
    ```

### 8.2. Toggle Whiteboard Lock
- **Route:** `PATCH /api/v1/meetings/:meetingCode/whiteboard/lock`
- **Purpose:** Host/Co-host toggles participant edit privileges on the whiteboard.
- **Auth / Role:** Authenticated (`Host` or `Co-Host`).
- **Request Body:** `{ "isLocked": true }`
- **Responses:**
  - `200 OK`: `{ "success": true, "isLocked": true }`

---

## 9. Scheduling Endpoints

### 9.1. Schedule Meeting
- **Route:** `POST /api/v1/meetings/schedule`
- **Purpose:** Schedules an upcoming meeting with start time, passcode, and recurrence.
- **Auth / Role:** Authenticated (`User`).
- **Request Body:**
  ```json
  {
    "title": "Weekly Sprint Planning",
    "scheduledStartTime": "2026-05-20T14:00:00.000Z",
    "durationMinutes": 60,
    "passcode": "449102",
    "settings": {
      "waitingRoomEnabled": true,
      "defaultMuteOnEntry": true
    }
  }
  ```
- **Responses:**
  - `201 Created`: Returns scheduled meeting record with `.ics` calendar download link.

### 9.2. List Scheduled Meetings
- **Route:** `GET /api/v1/meetings/scheduled`
- **Purpose:** Retrieves user's upcoming scheduled meetings.
- **Auth / Role:** Authenticated (`User`).
- **Responses:**
  - `200 OK`: Array of upcoming meeting objects.

---

## 10. Meeting History Endpoints

### 10.1. List Meeting History
- **Route:** `GET /api/v1/meetings/history`
- **Purpose:** Returns a paginated history of meetings hosted or attended by the user.
- **Auth / Role:** Authenticated (`User`).
- **Query Params:** `?page=1&limit=20`
- **Responses:**
  - `200 OK`:
    ```json
    {
      "page": 1,
      "totalMeetings": 18,
      "meetings": [
        {
          "meetingId": "6650c35084b3e8a1d044c303",
          "meetingCode": "cly-789-qwa",
          "title": "Quarterly Engineering Sync",
          "startTime": "2026-05-15T10:01:14.000Z",
          "durationSeconds": 3256,
          "totalParticipants": 14
        }
      ]
    }
    ```

### 10.2. Get Specific Meeting Session Summary
- **Route:** `GET /api/v1/meetings/history/:meetingId`
- **Purpose:** Retrieves detailed attendance log and files for a concluded meeting.
- **Auth / Role:** Authenticated (`Host` or Attending User).
- **Responses:**
  - `200 OK`: Complete historical summary object.
