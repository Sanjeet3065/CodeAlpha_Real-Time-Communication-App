# CONNECTLY — System Architecture & Component Interactions

## 1. Architectural Topology

CONNECTLY employs a decoupled, asynchronous client-server architecture with specialized real-time conduits. High-bandwidth media streams are offloaded to dedicated WebRTC Selective Forwarding Units (LiveKit), while discrete operational signals, state synchronization, and persistent domain transactions are governed by the Express and Socket.IO application tiers.

```mermaid
flowchart TD
    subgraph Clients["Client Tier (Browsers & Devices)"]
        C1["Host Client (React + TS)"]
        C2["Participant Client 1"]
        C3["Participant Client N (Target: Up to 60)"]
    end

    subgraph Edge["Edge & Security Layer"]
        CF["Cloudflare / Reverse Proxy (WAF, SSL/TLS, DDoS)"]
    end

    subgraph AppCluster["Application Tier (Node.js + Express)"]
        API["REST API Router (Auth, Meetings, Files)"]
        SIO["Socket.IO Server (Rooms, State, Whiteboard, Chat)"]
        AUTH["Auth Subsystem (Argon2id, JWT Token Minting)"]
        LK_AUTH["LiveKit Token Service (Signed Grants)"]
    end

    subgraph MediaCluster["Media Routing Tier (LiveKit SFU)"]
        LK1["LiveKit Node (Media Ingestion & Dynacast)"]
        COTURN["STUN / TURN Relay Servers (NAT Traversal)"]
    end

    subgraph DataCluster["Persistence & State Tier"]
        MONGO[("MongoDB Atlas (Users, Meetings, Chat, History)")]
        REDIS[("Redis Cluster (Socket.IO Adapter, Rate Limits)")]
        S3[("Private S3/R2 Bucket (Meeting Files)")]
        CDN["Cloudinary (Profile Media)"]
    end

    C1 & C2 & C3 -->|"HTTPS (API requests)"| CF
    C1 & C2 & C3 -->|"WSS (Socket.IO events)"| CF
    C1 & C2 & C3 <-->|"WebRTC DTLS-SRTP (Audio/Video/Screen)"| LK1
    C1 & C2 & C3 <-->|"STUN/TURN Binding (ICE candidate negotiation)"| COTURN

    CF --> API
    CF --> SIO
    API --> AUTH
    API --> LK_AUTH
    API & SIO --> MONGO
    SIO <--> REDIS
    API --> S3
    API --> CDN
    LK1 <--> LK_AUTH
```

---

## 2. Component Roles & Responsibilities

### 2.1. React Client Application
- **Responsibility:** User presentation, local state orchestration, media stream acquisition, hardware device negotiation, canvas rendering, and user input validation.
- **Key Modules:**
  - `MediaEngine`: Interfaces with `navigator.mediaDevices` and the `LiveKit SDK` to manage track capture, mute states, and audio level monitoring.
  - `RealtimeEngine`: Maintains the persistent Socket.IO connection, room membership, reconnection loops, and event dispatching.
  - `WhiteboardCanvas`: Hardware-accelerated 2D canvas/SVG rendering engine handling pointer events, vector interpolation, and delta dispatch.
  - `LayoutManager`: Dynamically recalculates video grid dimensions, active speaker prominence, and responsive mobile drawers.

### 2.2. Backend REST API (Express.js)
- **Responsibility:** Stateless business logic execution, user authentication, profile lifecycle, meeting scheduling, permission enforcement, and pre-signed storage credential generation.
- **Key Characteristics:**
  - Implements defensive input validation with Zod schemas.
  - Enforces strict rate limits on sensitive endpoints (`/api/auth/*`, `/api/meetings/join`).
  - Completely decoupled from media packet forwarding.

### 2.3. Authentication Subsystem
- **Responsibility:** Cryptographic identity verification, password hashing, credential issue, and session revocation.
- **Token Model:**
  - **Access Token:** Short-lived (15 minutes) signed JWT containing `userId`, `email`, and `globalRole`. Sent via secure, HTTP-only, `SameSite=Lax` cookie.
  - **Refresh Token:** Long-lived (7 days) cryptographically random UUID or signed JWT stored in a dedicated MongoDB `Session` collection with fingerprinting (User-Agent, IP hash). Supports immediate server-side revocation and token rotation on every refresh.
  - **LiveKit Room Token:** Short-lived (10 minutes) JWT signed with `LIVEKIT_API_SECRET` specifying exact `roomJoin`, `roomName`, `identity`, `canPublish`, and `canSubscribe` claims.

### 2.4. Database Tier (MongoDB Atlas)
- **Responsibility:** Authoritative persistent storage for non-transient platform data.
- **Collections:** `users`, `meetings`, `participants`, `messages`, `files`, `whiteboard_snapshots`, `notifications`, `meeting_history`, and `sessions`.
- **Durability:** WiredTiger engine with replica sets, automatic failover, point-in-time recovery, and encrypted data at rest.

### 2.5. Socket.IO Real-Time Server
- **Responsibility:** Low-latency state synchronization, user presence, room coordination, in-meeting chat, floating emoji broadcast, waiting room management, and collaborative whiteboard vector streaming.
- **Scaling:** Multiplexed via `@socket.io/redis-adapter` across multiple Node.js instances to allow horizontal clustering.

### 2.6. LiveKit SFU (Selective Forwarding Unit)
- **Responsibility:** Ingestion, transcoding-free routing, and forwarding of WebRTC audio, video, and screen share RTP streams.
- **Key Features:**
  - **Simulcast Ingestion:** Ingests high, medium, and low quality video layers from each publisher.
  - **Dynacast:** Automatically requests publishers to drop video layers if no downstream subscriber needs them.
  - **Adaptive Streaming:** Downgrades subscriber track quality dynamically if receiver bandwidth or CPU throttles.
  - **Active Speaker Detection:** Calculates energy levels from audio RTP header extensions (`urn:ietf:params:rtp-hdrext:ssrc-audio-level`) and broadcasts dominant speaker events.

### 2.7. Private Storage Tier (AWS S3 / Cloudflare R2)
- **Responsibility:** Secure, durable hosting of files exchanged during meetings.
- **Security Boundary:** Zero public read or write access. Uploads and downloads are exclusively facilitated through time-delimited, single-use Pre-Signed URLs verified by the backend API.

---

## 3. End-to-End Communication Flows

### 3.1. Meeting Creation & Join Flow

```mermaid
sequenceDiagram
    autonumber
    actor Host as Host Client
    participant API as Express API
    participant DB as MongoDB
    participant SIO as Socket.IO Server
    participant LK as LiveKit SFU

    Host->>API: POST /api/meetings (Title, Settings, Passcode)
    API->>DB: Insert Meeting Record (status: 'scheduled' / 'active')
    API-->>Host: 201 Created (Meeting ID: cly-789-qwa)

    Host->>API: POST /api/meetings/cly-789-qwa/join (Pre-join check)
    API->>DB: Validate user, check if waiting room enabled (Host bypasses)
    API->>API: Mint LiveKit Token (canPublish: true, canSubscribe: true, role: 'host')
    API-->>Host: Return { livekitToken, socketAuthToken, roomConfig }

    Host->>SIO: Connect with socketAuthToken & Join Room 'cly-789-qwa'
    SIO->>SIO: Register socket into room namespace
    SIO-->>Host: ACK (Room joined, current roster, initial state)

    Host->>LK: Connect to LiveKit SFU with livekitToken
    LK-->>Host: Connection Established (PeerConnection connected)
    Host->>LK: Publish Local Microphone & Camera Tracks (Simulcast)
```

### 3.2. Waiting Room & Participant Admission Flow

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Participant
    participant API as Express API
    participant SIO as Socket.IO Server
    actor Host as Host Client
    participant LK as LiveKit SFU

    Guest->>API: POST /api/meetings/:id/join (Passcode, Display Name)
    API-->>Guest: 200 OK (Status: 'WAITING_ROOM', waitingToken)

    Guest->>SIO: Connect & Join 'waiting:meetingId' room
    SIO->>Host: Emit 'waiting-room:participant-queued' { guestId, name }
    Host->>Host: Render Admission Dialog Pill

    Host->>SIO: Emit 'host:admit-participant' { guestId }
    SIO->>API: Internal admission approval / token minting
    SIO->>Guest: Emit 'waiting-room:admitted' { livekitToken, socketRoomToken }

    Guest->>SIO: Leave 'waiting:meetingId', Join 'room:meetingId'
    SIO->>Host: Emit 'participant:joined' { guestId, name, role: 'participant' }
    Guest->>LK: Connect to LiveKit SFU & Publish Tracks
```

### 3.3. File Upload & Secure Download Flow

```mermaid
sequenceDiagram
    autonumber
    actor Uploader as Participant A
    participant API as Express API
    participant S3 as S3 / Cloudflare R2
    participant SIO as Socket.IO Server
    actor Downloader as Participant B

    Uploader->>API: POST /api/meetings/:id/files/presign-upload (fileName, fileSize, mimeType)
    API->>API: Validate file extension, size <= 25MB, whitelist MIME
    API->>S3: Generate S3 Pre-Signed PUT URL (valid 15m)
    API-->>Uploader: Return { presignedUrl, fileKey, fileId }

    Uploader->>S3: PUT file binary directly to S3 with pre-signed URL
    S3-->>Uploader: 200 OK (Upload confirmed)

    Uploader->>API: POST /api/meetings/:id/files/confirm (fileId, fileKey)
    API->>API: Verify object metadata in S3 & persist record to MongoDB
    API-->>Uploader: 201 Created

    Uploader->>SIO: Emit 'chat:file-shared' { fileId, fileName, size, uploaderName }
    SIO->>Downloader: Broadcast 'chat:file-shared'

    Downloader->>API: GET /api/meetings/:id/files/:fileId/presign-download
    API->>API: Verify Downloader is authenticated active participant of meeting
    API->>S3: Generate S3 Pre-Signed GET URL (valid 5m)
    API-->>Downloader: Return { downloadUrl }
    Downloader->>S3: GET direct file download via pre-signed URL
```

### 3.4. Whiteboard Collaborative Delta Flow

```mermaid
sequenceDiagram
    autonumber
    actor Drawer as Drawing Client
    participant SIO as Socket.IO Server
    participant DB as MongoDB
    actor Peer as Receiving Client

    Drawer->>Drawer: User draws vector stroke on HTML5 Canvas
    Drawer->>SIO: Emit 'whiteboard:draw-stroke' { strokeId, tool, points, color, width }
    SIO->>Peer: Broadcast 'whiteboard:stroke-added' { ...payload }
    Peer->>Peer: Rasterize delta stroke on local Canvas

    Note over SIO,DB: Periodic Snapshot Consolidation
    SIO->>DB: Debounced flush of vector collection or canvas snapshot every 30s
```

---

## 4. Failure Isolation & Graceful Degradation

| Failure Domain | Architectural Impact | Automatic Recovery Mechanism |
| :--- | :--- | :--- |
| **LiveKit SFU Node Glitch** | Media tracks temporarily freeze or disconnect. | Client detects `ConnectionState.Reconnecting`. LiveKit SDK attempts ICE restart; fallback to secondary SFU node if clustered. |
| **Socket.IO Worker Crash** | Signaling, chat, and whiteboard drop momentarily. | Client automatically reconnects with exponential backoff. `@socket.io/redis-adapter` re-routes socket traffic to surviving instances. Client emits state-resync on reconnect. |
| **Severe Downlink Congestion** | High packet loss (>10%), latency spike (>400ms). | LiveKit Dynacast steps video layer from High (720p) -> Mid (360p) -> Low (180p) -> Pauses non-speaking video tiles. Audio packets prioritized via Opus DTX. |
| **Client Camera Hardware Failure** | Media stream throws `NotReadableError` or track muting. | Client catches error, notifies user with descriptive banner, disables video button, and maintains audio-only session. |
| **Database Unavailability** | REST operations fail (scheduling, profile updates). | In-flight meetings remain connected because LiveKit and Socket.IO maintain active in-memory room sessions. |
