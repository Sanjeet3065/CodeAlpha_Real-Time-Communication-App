# CONNECTLY — Meeting Room Experience & Design Specification
## Core Product Theater Architecture (Highest Priority)

---

## 1. Meeting Theater Philosophy: Low-Fatigue Immersion

The meeting room is the core product experience of CONNECTLY. Designed for sessions lasting from 15 minutes to multiple hours, the interface uses an ultra-low-eye-fatigue dark palette centered on `#101820` (Dark Canvas) with elevated control elements on `#253746` (Elevated Surface).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MEETING ROOM MASTER SHELL                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ Header: Title • Meeting Code [cly-789] • Timer 00:24:18 • Health [••••]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                                                             │
│                           MAIN VIDEO STAGE                                  │
│                 (Adaptive Grid • 1 to 60 Participants)                      │
│                                                                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Floating Dock: [Mic] [Cam] | [Share] [Board] [Chat (3)] [People (14)] | [End]│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Main Layout Regions

### 2.1. Meeting Header Bar (Top)
- **Dimensions:** Height: `56px`, horizontal padding: `24px`.
- **Surfaces:** Floating or docked with `#101820` (80% opacity + `backdrop-blur-md`).
- **Left Elements:**
  - Meeting Title (Manrope 16px SemiBold `#FFFFFF`).
  - Meeting Code Chip (`cly-789-qwa` in JetBrains Mono 12px with one-click copy button).
  - Security Shield Icon: Tooltip reveals "Meeting Protected: Waiting Room Active, TLS 1.3 Transport Encrypted".
- **Center Elements:**
  - Active Session Stopwatch (`00:24:18` in JetBrains Mono 13px Medium `#8A9FA8`).
- **Right Elements:**
  - Network Health Indicator (4 bars, tooltip with RTT/packet loss metrics).
  - Layout Mode Selector Dropdown (Gallery Grid vs. Speaker Focus).
  - Fullscreen Toggle icon.

### 2.2. Main Video Stage (Center Viewport)
- **Dimensions:** Fills `100%` viewport width minus open side drawer width (`360px`).
- **Stage Flexibility:** Powered by CSS Grid / Flexbox with auto-fit aspect-ratio calculations (`16:9` default).
- **Background:** `#101820` solid.

### 2.3. Floating Meeting Dock (Bottom Center)
- **Position:** Anchored `24px` above viewport bottom edge.
- **Surface:** `#253746` with `1px solid rgba(255, 255, 255, 0.12)`, radius `9999px`, shadow `cly-shadow-theater`.
- **Dimensions:** Height `60px`, padding `0 16px`, gap `8px`.
- **Button Grouping:**
  1. *Audio/Video Cluster:* Microphone (with green audio level ring), Camera toggle.
  2. *Collaboration Cluster:* Screen Share, Whiteboard, Chat (with unread badge pill), Participants (with hand-raise counter).
  3. *Utility Cluster:* Reactions Menu, More Options (`...`).
  4. *Session Exit Cluster:* Separated by vertical divider (`1px solid rgba(255, 255, 255, 0.15)`); Coral Red (`#D94F4F`) "Leave" / "End" pill button.

---

## 3. Adaptive Participant Grid Layouts (1 to 60 Participants)

> [!IMPORTANT]
> The platform is architected to accommodate meetings of up to 60 participants. However, rendering 60 simultaneous high-resolution video streams on a single screen is neither visually legible nor computationally viable on consumer hardware. The system enforces an **adaptive visibility and pagination strategy**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ADAPTIVE PARTICIPANT GRID MATRIX                      │
├───────────────────┬──────────────┬──────────────┬───────────────────────────┤
│ Participant Count │ Grid Geometry│ Aspect Ratio │ Stage Presentation        │
├───────────────────┼──────────────┼──────────────┼───────────────────────────┤
│ **1 User (Solo)** │ 1 Tile       │ 16:9 Center  │ Centered self-preview     │
│ **2 Users**       │ 1x2 or 2x1   │ 16:9 Equal   │ Side-by-side or stacked   │
│ **3–4 Users**     │ 2x2 Grid     │ 16:9 Equal   │ Quad layout               │
│ **5–9 Users**     │ 3x3 Grid     │ 16:9 Equal   │ 3 rows of 3               │
│ **10–16 Users**   │ 4x4 Grid     │ 16:9 Compact │ 4 rows of 4               │
│ **17–25 Users**   │ 5x5 Grid     │ 16:9 Compact │ Maximum single desktop pg │
│ **26–60 Users**   │ Paginated    │ Adaptive     │ Top 16–25 active + pages  │
└───────────────────┴──────────────┴──────────────┴───────────────────────────┘
```

### 3.1. Active Speaker Prioritization & Pagination for Large Meetings (>16 Users)
- **Dominant Speaker Auto-Promote:** The active speaker (detected via LiveKit audio level analysis) is automatically placed on the current visible page.
- **Pagination Controls:** Bottom pagination dots (`Page 1 of 3` with chevron navigation) allow browsing the remaining roster.
- **Bandwidth Optimization (Dynacast):** The LiveKit SFU automatically pauses video downlink tracks for participants on non-visible pages. The resulting client downstream bandwidth (provisional architectural target estimated at under 3.5 Mbps) represents a design goal rather than a guaranteed or measured performance metric. Formal bandwidth verification and empirical profiling will be conducted during **Phase 17 – Testing, Optimization & Responsiveness**.

---

## 4. Participant Roles & Permission Boundaries

The interface deterministically adapts its controls based on the user's granted role:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ROLE PERMISSION MATRIX IN UI                       │
├───────────────────────────┬──────────────┬──────────────┬───────────────────┤
│ Feature / UI Control      │ Host         │ Co-Host      │ Participant       │
├───────────────────────────┼──────────────┼──────────────┼───────────────────┤
│ "End Meeting for All"     │ Visible (Red)│ Hidden       │ Hidden            │
│ "Leave Meeting"           │ Visible      │ Visible      │ Visible (Red)     │
│ "Admit / Deny" in Waiting │ Visible      │ Visible      │ Hidden            │
│ "Mute All" Button         │ Visible      │ Visible      │ Hidden            │
│ Eject Participant Menu    │ Visible      │ Visible      │ Hidden            │
│ Make / Remove Co-Host     │ Visible      │ Hidden       │ Hidden            │
│ Lock / Unlock Whiteboard  │ Visible      │ Visible      │ Hidden (Indicator)│
│ Screen Share Toggle       │ Visible      │ Visible      │ Subject to Host   │
└───────────────────────────┴──────────────┴──────────────┴───────────────────┘
```

---

## 5. Visual State Specifications (12 Meeting States)

1. **Connecting State:** Center spinner with text "Establishing secure WebRTC session to LiveKit SFU..." on `#101820` canvas.
2. **Waiting Room State:** Pulsing mint card: "Please wait, the host will admit you soon" with camera/mic test toggles.
3. **Active Meeting State:** Normal conference operation with live video grid and active dock.
4. **Microphone Muted State:** Red mic icon with slash in dock and on tile display pill; tooltip: "Microphone muted (Press Space to talk)".
5. **Camera Disabled State:** Camera icon in dock has slash; video tile displays a 96px circular avatar with user initials.
6. **Active Speaker Speaking State:** Active speaker tile receives `3px solid #168B83` border with subtle `12px` drop-shadow glow (triggering when audio level exceeds a provisional `-35 dBFS` baseline, calibrated and tuned during implementation).
7. **Screen Sharing State (Viewer):** Presentation window occupies 80% stage width; participant video feeds stack in vertical right filmstrip.
8. **Screen Sharing State (Presenter):** Floating pill: "You are sharing your screen (Stop Sharing)" with green pulse dot.
9. **Network Unstable State:** Yellow banner drops from header: "Network connection degraded. Video quality reduced to preserve audio."
10. **Reconnecting State:** Full-screen translucent blur (`#101820` at 80% opacity) with spinning reconnect indicator: "Reconnecting to room... (Attempt 2 of 5)".
11. **Meeting Locked State:** Header shield icon displays padlock badge; waiting room admission disabled.
12. **Meeting Ended State:** Center card on Warm Ivory canvas: "This meeting has ended by the host. Duration: 48m 12s" with button "Return to Dashboard".
