# CONNECTLY — Comprehensive User Flows & Interaction Journeys

## 1. User Journey Architecture

This document specifies the end-to-end user journeys across 20 core workflows in CONNECTLY. Each workflow defines entry points, discrete user steps, algorithmic decision branches, success criteria, failure modes, and recovery behaviors.

---

## 2. Authentication & Onboarding Journeys

### Flow 01: New User Registration
- **Entry Point:** Landing Page (`/`) ➔ "Start Free" CTA or direct `/register`.
- **Steps:**
  1. User fills in First Name, Last Name, Email, and Password.
  2. Client validates password criteria in real-time (8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 symbol).
  3. User checks "Agree to Terms & Privacy" and submits form.
  4. Backend hashes password with Argon2id and creates pending user record.
  5. UI displays confirmation screen instructing user to check their email.
- **Decision Points:** Email already registered? ➔ Display inline error with one-click link to `/login`.
- **Success Outcome:** User account created; verification email dispatched.
- **Failure Recovery:** Network glitch ➔ Retry button preserves all entered form data except password.

### Flow 02: Existing User Login
- **Entry Point:** `/login`
- **Steps:**
  1. User enters Email and Password.
  2. User submits form.
  3. API verifies credentials, issues short-lived JWT access cookie and rotated refresh token cookie.
- **Decision Points:** Invalid credentials? ➔ Display "Invalid email or password" alert; increment rate-limit counter. After 5 attempts, trigger 15-minute lock.
- **Success Outcome:** Authenticated session established; user redirected to `/dashboard` (or cached redirect query target).

### Flow 03: Self-Service Password Recovery
- **Entry Point:** `/login` ➔ "Forgot Password?" link ➔ `/forgot-password`.
- **Steps:**
  1. User enters registered email and submits.
  2. Server generates single-use token (15m expiration) and emails reset link.
  3. User clicks link ➔ `/reset-password?token=...`.
  4. User inputs new password meeting complexity criteria and submits.
- **Decision Points:** Token expired or consumed? ➔ Display error banner with "Request new link" CTA.
- **Success Outcome:** Password updated via Argon2id; existing sessions invalidated; user routed to `/login` with success banner.

---

## 3. Meeting Initiation & Entry Journeys

### Flow 04: Creating an Instant Meeting
- **Entry Point:** `/dashboard` ➔ "Instant Meeting" Quick Action button.
- **Steps:**
  1. User clicks "Instant Meeting".
  2. Modal opens with auto-generated meeting code (e.g., `cly-789-qwa`).
  3. User configures baseline flags (Waiting Room ON/OFF, Mute on Entry ON/OFF).
  4. User clicks "Start Meeting Now".
  5. Client calls `POST /api/v1/meetings/instant`, receives host tokens, and transitions to `/meeting/cly-789-qwa`.
- **Success Outcome:** Host enters active dark meeting room with mic/cam initialized.

### Flow 05: Joining via Direct Meeting Link
- **Entry Point:** User clicks shared link `https://connectly.io/meeting/cly-789-qwa`.
- **Steps:**
  1. Router detects missing active room token and diverts to `/join/cly-789-qwa` (Pre-Join Lobby).
  2. Client inspects local hardware; starts camera/microphone preview.
  3. If user is guest, prompts for "Display Name".
  4. If room is passcode-protected, prompts for 6-digit passcode.
  5. User clicks "Join Meeting".
- **Decision Points:**
  - Waiting Room enabled? ➔ Divert to Flow 07.
  - Waiting Room disabled? ➔ Mint LiveKit & Socket tokens; navigate to `/meeting/cly-789-qwa`.
- **Failure Recovery:** Room does not exist or has ended ➔ Display error card with "Return to Dashboard" action.

### Flow 06: Joining via Meeting Code from Dashboard
- **Entry Point:** `/dashboard` ➔ "Join with Code" input box or modal.
- **Steps:**
  1. User pastes or types 10-character code (`cly-789-qwa`).
  2. Auto-formatting validates syntax.
  3. User clicks "Join".
  4. Client navigates to `/join/cly-789-qwa`.

### Flow 07: Waiting Room Holding & Host Admission
- **Entry Point:** Submitting credentials on `/join/:id` when `waitingRoomEnabled: true`.
- **Steps:**
  1. Client receives `WAITING_ROOM` status and waiting ticket from API.
  2. Screen transitions to pulsing waiting room view: "Please wait, the host will let you in soon."
  3. Socket.IO emits `waiting-room:participant-queued` to Host.
  4. Host sees admission pill in header or participants drawer and clicks "Admit".
  5. Server emits `waiting-room:admitted` with LiveKit token to waiting client.
  6. Client receives admission payload, leaves waiting queue, and connects to `/meeting/:id`.
- **Decision Points:** Host clicks "Deny"? ➔ Server emits `waiting-room:denied`; client screen updates to "The host has declined your entry request" with button to exit.

---

## 4. In-Meeting Governance & Collaboration Journeys

### Flow 08: Managing Active Meeting (Host Controls)
- **Entry Point:** Inside active room as `host`.
- **Steps:**
  1. Host opens Participants Drawer (`P` shortcut).
  2. Host clicks "Mute All" ➔ Modal asks "Allow participants to unmute themselves?" ➔ Host clicks "Mute All".
  3. Server broadcasts `host:mute-all`; all non-host participant mics mute immediately.
- **Success Outcome:** Audio noise eliminated across the room.

### Flow 09: Inviting Participants During Active Meeting
- **Entry Point:** Meeting Header ➔ Click "Copy Code" or "Invite" icon.
- **Steps:**
  1. Clicking icon copies full link `https://connectly.io/meeting/:id` to clipboard.
  2. Toast notification appears: "Meeting link copied to clipboard".
  3. Optional: Host opens "Invite by Email" dialog to dispatch calendar invites.

### Flow 10: Ejecting a Disruptive Participant
- **Entry Point:** Participants Drawer ➔ Hover over participant item ➔ Click `...` menu ➔ "Remove from Meeting".
- **Steps:**
  1. Host selects "Remove from Meeting".
  2. Confirmation modal asks "Remove Marcus Vance? They will be unable to rejoin this session."
  3. Host confirms.
  4. Server terminates participant's socket and LiveKit room token, blacklisting their identity for session duration.
  5. Ejected user's screen transitions to "You have been removed from this meeting".

### Flow 11: Screen Sharing
- **Entry Point:** Meeting Dock ➔ "Share Screen" icon button (`S` shortcut).
- **Steps:**
  1. User clicks "Share Screen".
  2. Browser prompts native display media picker (Entire Screen, Window, Chrome Tab).
  3. User selects window and clicks "Share".
  4. LiveKit publishes high-definition video track.
  5. Stage automatically reflows into Presentation View (screen occupies 80% width; participants in filmstrip).
- **Termination:** Presenter clicks floating "Stop Sharing" button or browser stop bar. Stage reflows back to Gallery Grid.

### Flow 12: In-Meeting Real-Time Chat
- **Entry Point:** Meeting Dock ➔ "Chat" icon button (`C` shortcut).
- **Steps:**
  1. Chat Drawer slides in from right edge.
  2. User selects recipient ("Everyone" or specific participant dropdown).
  3. User types message and presses `Enter`.
  4. Socket.IO emits `chat:send-message`; server persists message and broadcasts.
  5. Bubble appears in feed with timestamp.

### Flow 13: Private In-Meeting File Sharing
- **Entry Point:** In-Meeting Chat / Files Drawer ➔ Click `Paperclip` attachment icon or drag file into dropzone.
- **Steps:**
  1. User selects `architecture_specs.pdf` (4.8 MB).
  2. Client validates file size $\le 25\text{MB}$ and whitelisted MIME type.
  3. Client requests pre-signed S3 PUT URL via `POST /api/v1/meetings/:id/files/presign-upload`.
  4. Browser uploads binary directly to S3 with linear progress indicator.
  5. Client confirms upload to API; Socket.IO broadcasts `chat:file-shared` event.
  6. File card appears in Chat and Files Drawer for all participants.

### Flow 14: Collaborative Whiteboard Usage
- **Entry Point:** Meeting Dock ➔ "Whiteboard" icon button (`W` shortcut).
- **Steps:**
  1. Main stage swaps video grid for vector canvas. Video tiles pin to right filmstrip.
  2. User selects Freehand Pen tool (`#168B83` Teal).
  3. User draws vector path on canvas.
  4. Delta stroke coordinates emit over Socket.IO (`whiteboard:draw-stroke`).
  5. Peer canvases rasterize stroke within 50ms.
- **Locking:** Host clicks "Lock Whiteboard" in toolbar ➔ Participants receive lock icon and drawing tools are disabled.

---

## 5. Account, Scheduling & Exit Journeys

### Flow 15: Scheduling a Future Meeting
- **Entry Point:** `/dashboard` ➔ "Schedule Meeting" ➔ `/meetings/schedule`.
- **Steps:**
  1. User enters Title, Date, Time, Duration.
  2. Configures Passcode and Waiting Room toggles.
  3. Submits form.
  4. Meeting is saved to MongoDB; modal generates `.ics` calendar download file.

### Flow 16: Reviewing Meeting History & Analytics
- **Entry Point:** `/meetings/history`.
- **Steps:**
  1. User views past meetings table.
  2. Clicks "View Summary" on a completed sync.
  3. Inspects attendee attendance durations, timestamps, and files shared.

### Flow 17: Downloading Shared Meeting Files
- **Entry Point:** Meeting Files Drawer or `/downloads`.
- **Steps:**
  1. User clicks "Download" on `architecture_specs.pdf`.
  2. Client calls `GET /api/v1/meetings/:id/files/:fileId/presign-download`.
  3. Server validates user attendance and returns 5-minute pre-signed S3 GET URL.
  4. Browser downloads file directly from private bucket.

### Flow 18: Updating User Profile & Preferences
- **Entry Point:** `/profile`.
- **Steps:**
  1. User updates display name, bio, and uploads new avatar picture.
  2. Configures default media settings ("Always mute mic upon joining").
  3. Clicks "Save Changes" ➔ Toast confirms "Profile updated".

### Flow 19: Leaving a Meeting (Participant)
- **Entry Point:** Meeting Dock ➔ Coral Red "Leave" button.
- **Steps:**
  1. User clicks "Leave".
  2. Confirmation sheet: "Are you sure you want to leave?"
  3. User confirms ➔ LiveKit media tracks unpublish; Socket disconnects.
  4. User is redirected to `/dashboard` (or "Thank you" feedback screen for guests).

### Flow 20: Ending a Meeting for All (Host)
- **Entry Point:** Meeting Dock ➔ Coral Red "End" button (Host only).
- **Steps:**
  1. Host clicks "End".
  2. Modal presents two options: "Leave Meeting (Assign new host)" OR "End Meeting for Everyone".
  3. Host selects "End Meeting for Everyone".
  4. Server emits `meeting:terminated`; all participants are ejected; session statistics are aggregated into `meeting_history`.
  5. Host is routed to `/dashboard` with session duration summary.
