# CONNECTLY — Monorepo Architecture & Directory Structure

## 1. Monorepo Organization & Philosophy

CONNECTLY is structured as a modular TypeScript monorepo designed for high maintainability, strict separation of concerns, and shared type definitions between the frontend client and backend server.

```
connectly/
├── client/          # Frontend React TypeScript single-page application
├── server/          # Backend Node.js Express & Socket.IO application
├── shared/          # Shared TypeScript interfaces, DTOs, and Zod schemas
├── docs/            # Comprehensive engineering documentation package
├── .gitignore       # Root Git exclusion rules
├── package.json     # Monorepo workspaces manifest (npm / pnpm / yarn)
└── README.md        # Project setup & architecture overview
```

---

## 2. Detailed Directory Breakdown

### 2.1. Client Application (`client/`)
The frontend client is organized following a feature-sliced, modular architecture:

```
client/
├── public/                     # Static public assets (favicons, robots.txt, sounds)
│   ├── sounds/                 # Audio cue assets (chime-join, chime-leave, hand-raise)
│   └── favicon.ico
├── src/
│   ├── assets/                 # SVGs, brand illustrations, logos
│   ├── components/             # Reusable UI primitives (design system)
│   │   ├── ui/                 # Atomic design tokens (buttons, inputs, dialogs, badges)
│   │   ├── layout/             # Header, Sidebar, DashboardShell, MeetingShell
│   │   └── feedback/           # Toast, SkeletonLoader, ConfirmModal
│   ├── features/               # Domain-specific feature modules
│   │   ├── auth/               # LoginForm, RegisterForm, ResetPasswordForm, useAuth
│   │   ├── dashboard/          # QuickActions, UpcomingMeetingsList, MeetingStatsCard
│   │   ├── prejoin/            # DeviceCheckPreview, AudioMeter, PasscodePrompt
│   │   ├── meeting/            # VideoGrid, VideoTile, FloatingControlDock, StageLayout
│   │   ├── chat/               # ChatDrawer, MessageItem, EmojiReactionOverlay
│   │   ├── whiteboard/         # CanvasBoard, Toolbar, StrokeEngine, ColorPalette
│   │   ├── participants/       # ParticipantDrawer, HandRaiseQueue, ModerationMenu
│   │   ├── files/              # SharedFilesDrawer, FileUploadDropzone, FileItem
│   │   └── scheduling/         # ScheduleMeetingModal, CalendarExport
│   ├── hooks/                  # Global custom hooks (useMediaDevices, useKeyboardShortcuts)
│   ├── context/                # React contexts (AuthContext, SocketContext)
│   ├── stores/                 # Zustand state stores (meetingStore, roomSettingsStore)
│   ├── services/               # API clients and LiveKit / Socket.IO adapters
│   │   ├── api.ts              # Axios / Fetch HTTP client with refresh token interceptors
│   │   ├── livekit.ts          # LiveKit Room instance, track handlers, simulcast configs
│   │   └── socket.ts           # Socket.IO client instance and event emitters
│   ├── styles/                 # Tailwind base styles and custom font imports
│   ├── types/                  # Client-specific UI state types
│   ├── utils/                  # Formatters, sound players, error parsers
│   ├── routes/                 # AppRouter, ProtectedRouteGuard, GuestRouteGuard
│   ├── App.tsx                 # Root application entry component
│   └── main.tsx                # DOM mount & TanStack Query client initialization
├── index.html                  # HTML entrypoint with font preloads
├── tailwind.config.ts          # Custom color tokens, font families, animation keyframes
├── tsconfig.json               # Client TypeScript compiler settings
└── vite.config.ts              # Vite bundler configuration & proxy rules
```

---

### 2.2. Server Application (`server/`)
The backend server adheres to a layered architecture (Controller-Service-Repository pattern):

```
server/
├── src/
│   ├── config/                 # Environment validation, database & storage configs
│   │   ├── env.ts              # Zod validation schema for process.env
│   │   ├── database.ts         # Mongoose connection & connection pool management
│   │   ├── livekit.ts          # LiveKit Server SDK client configuration
│   │   ├── redis.ts            # Redis connection client for Socket.IO adapter
│   │   └── storage.ts          # AWS S3 / Cloudflare R2 S3Client instance
│   ├── controllers/            # HTTP Request/Response handlers
│   │   ├── auth.controller.ts
│   │   ├── users.controller.ts
│   │   ├── meetings.controller.ts
│   │   ├── participants.controller.ts
│   │   ├── messages.controller.ts
│   │   ├── files.controller.ts
│   │   ├── whiteboard.controller.ts
│   │   └── history.controller.ts
│   ├── services/               # Core business logic and external integrations
│   │   ├── auth.service.ts     # Password hashing, token minting, session validation
│   │   ├── meeting.service.ts  # Room generation, status checks, participant tracking
│   │   ├── livekit.service.ts  # Token generation (AccessToken grants), webhook ingestion
│   │   ├── storage.service.ts  # Pre-signed upload & download URL generator
│   │   └── mail.service.ts     # Password reset email delivery
│   ├── models/                 # Mongoose schema definitions
│   │   ├── User.model.ts
│   │   ├── Session.model.ts
│   │   ├── Meeting.model.ts
│   │   ├── Participant.model.ts
│   │   ├── Message.model.ts
│   │   ├── SharedFile.model.ts
│   │   ├── WhiteboardSnapshot.model.ts
│   │   ├── Notification.model.ts
│   │   └── MeetingHistory.model.ts
│   ├── realtime/               # Socket.IO handlers and event routers
│   │   ├── index.ts            # Socket.IO server initialization & Redis adapter
│   │   ├── middlewares/        # Socket authentication & rate-limiting middleware
│   │   └── handlers/           # Modular Socket event handlers
│   │       ├── room.handler.ts # Joining, leaving, presence, heartbeat
│   │       ├── waiting.handler.ts # Admission queue, permit, deny
│   │       ├── chat.handler.ts # Text messages, reactions
│   │       ├── hand.handler.ts # Hand raising queue
│   │       ├── whiteboard.handler.ts # Canvas delta broadcasting
│   │       └── moderation.handler.ts # Remote mute, mute-all, ejection
│   ├── middlewares/            # Express middlewares
│   │   ├── authenticate.ts     # JWT extraction and verification
│   │   ├── authorize.ts        # RBAC role guards (host, co-host, participant)
│   │   ├── validate.ts         # Zod schema validation middleware
│   │   ├── rateLimiter.ts      # Endpoint rate limiters
│   │   ├── security.ts         # Helmet & CORS configuration
│   │   └── errorHandler.ts     # Global centralized error handler
│   ├── utils/                  # Token utilities, cryptographic helpers, logger (Pino)
│   ├── app.ts                  # Express application factory & middleware pipeline
│   └── index.ts                # HTTP + WebSocket server bootstrap
├── tsconfig.json               # Backend TypeScript configuration
└── package.json
```

---

### 2.3. Shared Module (`shared/`)
Contains contracts shared between client and server to prevent drift:

```
shared/
├── src/
│   ├── schemas/                # Shared Zod validation schemas
│   │   ├── auth.schema.ts      # Registration, login, reset schemas
│   │   ├── meeting.schema.ts   # Meeting create, join, update schemas
│   │   ├── chat.schema.ts      # Message create, reaction schemas
│   │   └── file.schema.ts      # File upload validation schemas
│   ├── types/                  # Shared TypeScript interfaces & types
│   │   ├── user.types.ts       # UserDTO, UserPreferences
│   │   ├── meeting.types.ts    # MeetingDTO, MeetingRole, RoomSettings
│   │   ├── participant.types.ts# ParticipantDTO, ParticipantStatus
│   │   ├── realtime.types.ts   # Socket.IO Event names, ClientToServer, ServerToClient
│   │   └── whiteboard.types.ts # StrokeElement, CanvasSnapshot
│   └── index.ts                # Module exports
├── tsconfig.json
└── package.json
```

---

### 2.4. Documentation Package (`docs/`)
Authoritative system specifications created in Phase 01:
- `PROJECT_OVERVIEW.md`
- `REQUIREMENTS.md`
- `TECH_STACK.md`
- `SYSTEM_ARCHITECTURE.md`
- `DATABASE_DESIGN.md`
- `API_SPECIFICATION.md`
- `REALTIME_ARCHITECTURE.md`
- `SECURITY_PLAN.md`
- `UI_UX_DIRECTION.md`
- `ROUTE_MAP.md`
- `PROJECT_STRUCTURE.md`
- `TESTING_STRATEGY.md`
- `DEPLOYMENT_ARCHITECTURE.md`
- `TECHNICAL_DECISIONS.md`
- `PHASE_01_ACCEPTANCE.md`

---

## 3. Strict Phase 01 Boundary

> **MANDATE:** No folders, files, or application code under `client/`, `server/`, or `shared/` are generated during Phase 01. The workspace remains exclusively dedicated to planning artifacts under `docs/` until Phase 01 is formally reviewed and accepted.
