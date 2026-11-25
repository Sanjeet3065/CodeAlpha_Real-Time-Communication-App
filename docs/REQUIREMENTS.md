# CONNECTLY — Software Requirements Specification (SRS)

## 1. Introduction & Purpose

This document establishes the definitive functional and non-functional requirements for the CONNECTLY Real-Time Video Collaboration Platform. These requirements serve as the foundation for architectural validation, test plan construction, and subsequent implementation phases.

## 2. User Personas

1. **Host (Dr. Sarah Chen, University Lecturer / Team Lead):**
   - Needs deterministic control over who enters the room, who speaks, and who shares screen.
   - Requires scheduled meetings with passcodes and waiting rooms to prevent meeting disruption ("zoom-bombing").
   - Demands whiteboard collaboration with immediate capture and participant management tools (mute-all, eject).

2. **Participant (Marcus Vance, Senior Engineer / Student):**
   - Joins across diverse network conditions (home fiber, mobile 5G, congested Wi-Fi).
   - Needs fluid audio/video, seamless screen sharing, interactive in-meeting chat, and hand-raising.
   - Expects rapid switching between whiteboard, presentation view, and gallery view without lag.

3. **Co-Host (Elena Rostova, Teaching Assistant / Event Facilitator):**
   - Assists the host by admitting users from the waiting room, moderating chat, answering raised hands, and muting background noise.

4. **Guest / Unregistered Participant (Alex Rivera, External Client):**
   - Joins a designated meeting via a secure direct link, inputs a display name, passes a waiting room gate, and interacts without requiring persistent profile creation.

---

## 3. Functional Requirements (18 Core Product Capabilities)

### FR-01: User Registration & Authentication
- **FR-01.1:** System shall support user account creation using unique email address, secure password, first name, and last name.
- **FR-01.2:** System shall enforce password complexity: minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 numeric digit, and 1 special symbol.
- **FR-01.3:** Passwords must be hashed using Argon2id prior to database persistence.
- **FR-01.4:** System shall support authentication via email and password, issuing an ephemeral HTTP-only access token cookie (15m validity) and a rotated refresh token stored in an HTTP-only secure cookie (7d validity).
- **FR-01.5:** System shall support user logout, immediately invalidating the refresh token session in the database.
- **FR-01.6:** System shall provide a secure password reset workflow utilizing time-bounded (15-minute), cryptographically random single-use reset tokens sent via email.

### FR-02: User Profiles & Settings
- **FR-02.1:** Authenticated users shall view and update their profile metadata (display name, avatar image URL, bio, organization/affiliation).
- **FR-02.2:** System shall allow users to configure audio/video defaults (join with camera off, join with microphone muted, default virtual background / blur preference).
- **FR-02.3:** System shall allow users to select default audio input/output devices and video input hardware.

### FR-03: Meeting Creation & Joining
- **FR-03.1:** Authenticated users shall create instant meetings with a single action.
- **FR-03.2:** System shall generate an 8-character or 10-character cryptographically random, collision-resistant alphanumeric meeting ID (e.g., `cly-789-qwa`).
- **FR-03.3:** Meeting creator is automatically assigned the `host` role.
- **FR-03.4:** Users can join meetings via meeting ID or unique direct link.
- **FR-03.5:** System shall support pre-join device verification screen (mic check meter, camera preview, device selector).

### FR-04: Unique Meeting Links
- **FR-04.1:** Every meeting instance must have a canonical URI structure: `https://<domain>/meeting/:meetingId`.
- **FR-04.2:** Meeting links may optionally bundle an encrypted join token or require an explicit room passcode.
- **FR-04.3:** System shall validate meeting link integrity before granting connection tokens.

### FR-05: Multi-User Audio & Video Calling (Target Capacity: Up to 60 Participants)
- **FR-05.1:** Audio/video media must be processed and routed via LiveKit SFU (Selective Forwarding Unit); peer-to-peer full mesh is strictly prohibited for groups. The architectural capacity target is up to 60 participants, subject to empirical validation during Phase 17 load-testing.
- **FR-05.2:** Video publishing must support client-side simulcast (High: 720p/1080p, Mid: 360p, Low: 180p).
- **FR-05.3:** Client shall adaptively subscribe to video qualities based on viewport size, layout mode (Gallery vs. Active Speaker), and receiver downlink capacity.
- **FR-05.4:** The system shall prioritize audio packets with Opus forward error correction (FEC) and DTX (Discontinuous Transmission).

### FR-06: Microphone & Camera Controls
- **FR-06.1:** Users can mute/unmute their microphone with immediate visual indicator feedback.
- **FR-06.2:** Users can start/stop their camera stream dynamically without renegotiating the entire session.
- **FR-06.3:** Push-to-talk capability (spacebar hold) when muted.
- **FR-06.4:** Audio level indicator meter displaying real-time speaking activity.

### FR-07: Screen Sharing
- **FR-07.1:** Permitted participants can share an entire screen, specific application window, or browser tab via `navigator.mediaDevices.getDisplayMedia`.
- **FR-07.2:** Screen share streams must be transmitted as a distinct high-resolution, low-framerate video track (1080p @ 5–15 fps for text; 720p/1080p @ 30 fps for motion/video).
- **FR-07.3:** System shall enforce single-presenter or multi-presenter policies controlled by the host.

### FR-08: Real-Time Chat & In-Meeting Reactions
- **FR-08.1:** In-meeting public chat delivered via Socket.IO, broadcast to all current room participants.
- **FR-08.2:** In-meeting direct (private) 1-on-1 messaging between participants.
- **FR-08.3:** Floating lightweight emoji reactions (👍, ❤️, 👏, 🎉, 😮, 😂) that animate transiently over video tiles.
- **FR-08.4:** Chat persistence options: Meeting messages can be persisted to MongoDB for post-meeting review or treated as ephemeral per room setting.

### FR-09: File Upload & Download
- **FR-09.1:** Participants can upload documents, images, and archives during a meeting.
- **FR-09.2:** Strict file validation: maximum file size (e.g., 25MB per file), strict MIME-type and magic-byte validation.
- **FR-09.3:** Files are uploaded directly to private object storage via pre-signed S3/Cloudinary URLs; files are never routed directly through the Node.js application memory buffer.
- **FR-09.4:** File access is protected by time-bound pre-signed download URLs granted only to authenticated room participants.

### FR-10: Collaborative Whiteboard
- **FR-10.1:** Interactive vector canvas supporting freehand drawing, lines, rectangles, circles, text, highlighter, and eraser.
- **FR-10.2:** Whiteboard synchronization across participants with low-latency delta broadcasts via Socket.IO.
- **FR-10.3:** Whiteboard state persistence in MongoDB so late joiners automatically hydrate the current canvas state.
- **FR-10.4:** Export whiteboard state to PNG / SVG / PDF.
- **FR-10.5:** Host control to lock/unlock whiteboard editing permissions.

### FR-11: Host, Co-Host, and Participant Roles
- **FR-11.1:** Role hierarchy: `Host` > `Co-Host` > `Participant` > `Guest`.
- **FR-11.2:** Host can transfer host privileges or designate up to 3 co-hosts.
- **FR-11.3:** Role capabilities matrix:
  - Host: Full room ownership, end meeting for all, configure room security, admit/eject, promote/demote.
  - Co-Host: Admit/eject participants, mute individuals/all, lock whiteboard, manage chat.
  - Participant: Speak, transmit video, share screen (if allowed), chat, collaborate on whiteboard.
  - Guest: Restricted privileges subject to host overrides.

### FR-12: Waiting Room & Admission Controls
- **FR-12.1:** Hosts can toggle "Waiting Room" enabled on meeting creation or on-the-fly.
- **FR-12.2:** When enabled, non-host joiners enter a holding state receiving a "Please wait, the host will let you in soon" visual shell.
- **FR-12.3:** Hosts and co-hosts receive a real-time list of waiting participants with "Admit", "Admit All", or "Deny" actions.

### FR-13: Meeting Scheduling
- **FR-13.1:** Users can schedule upcoming meetings specifying title, description, start time, expected duration, timezone, and security settings (passcode, waiting room, default mute).
- **FR-13.2:** System provides recurring meeting configurations (daily, weekly, custom interval).
- **FR-13.3:** Calendar integration support: Generate standard `.ics` (iCalendar) files and copyable invites.

### FR-14: Meeting History & Analytics
- **FR-14.1:** System records meeting session lifecycle (actual start time, end time, total duration, participant roster with join/leave timestamps).
- **FR-14.2:** Users can inspect past meetings from their personal dashboard.
- **FR-14.3:** Shared files and meeting chat transcripts (if enabled) remain accessible to registered attendees post-meeting.

### FR-15: Secure Meeting Access
- **FR-15.1:** Optional 6-digit numeric or alphanumeric room passcode.
- **FR-15.2:** Signed JWT room tokens required to connect to LiveKit SFU; tokens expire within 10 minutes of issuance and bind user ID, room ID, and granted permissions.
- **FR-15.3:** Prevention of unauthorized re-entry after host ejection (banned user ID / IP lock for the duration of the meeting session).

### FR-16: Participant Management
- **FR-16.1:** Host/Co-host can mute any participant's microphone.
- **FR-16.2:** Host/Co-host can execute "Mute All".
- **FR-16.3:** Host/Co-host can stop another participant's video or screen share.
- **FR-16.4:** Host/Co-host can eject disruptive participants immediately.
- **FR-16.5:** Hand raising queue: Participants can raise hand; host receives ordered list of raised hands with "lower hand" control.

### FR-17: Connection Status & Reconnection
- **FR-17.1:** Real-time visual network health badge per participant (Excellent, Good, Poor, Disconnected) derived from WebRTC stats (packet loss, RTT, jitter).
- **FR-17.2:** Automatic ICE restart and reconnect handling when network switches (e.g., Wi-Fi to cellular).
- **FR-17.3:** Socket.IO automatic reconnection with state reconciliation (re-subscribing to room events and fetching missed messages).

### FR-18: Responsive Interfaces
- **FR-18.1:** Desktop Layout (>1024px): Multi-tile grid (up to 25 tiles per page), floating or docked control bar, collapsible sidebar for chat/participants/whiteboard.
- **FR-18.2:** Tablet Layout (768px–1024px): Adaptive 2x2 or 3x3 grid, touch-friendly control bar, slide-over drawer for secondary panels.
- **FR-18.3:** Mobile Layout (<768px): Focus on Active Speaker or 2x2 grid, bottom sheet panels, simplified one-touch audio/video toggles, screen rotation awareness.

---

## 4. Non-Functional Requirements (NFR)

### NFR-01: Performance & Latency (Design Targets)
- Glass-to-glass media latency target: designed to achieve sub-250ms under typical broadband network conditions (RTT < 50ms), subject to empirical load testing in Phase 17.
- Socket.IO control packet delivery target: designed to operate under 100ms within the same geographic region.
- Initial web application bundle load (LCP) design target: under 2.0 seconds on a standard 4G connection.

### NFR-02: Scalability & Capacity (Planned vs. Verified)
- System architecture design target: planned to support up to 60 concurrent video/audio participants in a single meeting room using LiveKit SFU simulcast and adaptive subscription, subject to Phase 17 load-testing and bandwidth validation (not a guaranteed capability without empirical evidence).
- System shall be architected to support at least 1,000 concurrent active meeting rooms per clustered deployment tier.

### NFR-03: Security & Privacy
- Zero plaintext storage of passwords; Argon2id with memory cost 64MB, iterations 3, parallelism 1.
- All transport communication must enforce TLS 1.3 for HTTPS and WSS; DTLS 1.2 / 1.3 and SRTP for WebRTC media channels.
- Media streams are isolated through SFU routing; unauthorized parties cannot intercept streams without valid server-minted tokens.

### NFR-04: Reliability & Availability
- Planned 99.9% application uptime.
- Stateless Express application tier and Socket.IO cluster backed by Redis adapter, enabling zero-downtime rolling deployments.

### NFR-05: Usability & Accessibility
- Complete compliance with WCAG 2.2 Level AA.
- Minimum color contrast ratio of 4.5:1 for normal text and 3:1 for large text/icons.
- Full keyboard navigation for meeting controls (Mute, Video, Chat toggle, Hand raise).
- Screen-reader friendly semantic ARIA attributes for dynamic status changes (e.g., "John Doe muted their microphone").
