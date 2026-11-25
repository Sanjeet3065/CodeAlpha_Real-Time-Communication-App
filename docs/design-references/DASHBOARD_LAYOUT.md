# CONNECTLY — Design Reference: User Dashboard Layout
## Structural ASCII Wireframe & Spatial Layout Blueprint

> [!NOTE]
> **Design Reference Classification:** This document is an architectural **structural text wireframe (ASCII wireframe)** specifying layout regions, spatial alignment, visual hierarchy, and component relationships. It is **not** an image-rendered or graphical UI mockup. Visual implementation with full styling tokens occurs in Phase 03/04.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CONNECTLY   [Search meetings & files...]        [Help (?)]  [Bell (3)]  [User: Dr. Sarah Chen (v)]│
├──────────────┬───────────────────────────────────────────────────────────────────────────────────┤
│ [Dashboard*] │  Good morning, Dr. Sarah                                                          │
│ [Scheduled]  │  Tuesday, November 17, 2026 • 3 meetings on your agenda today                     │
│ [History]    │                                                                                   │
│ [Downloads]  │  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐     │
│ [Settings]   │  │  INSTANT MEETING     │  │  JOIN WITH CODE      │  │  SCHEDULE MEETING    │     │
│              │  │  [Video Camera Icon] │  │  [Keypad Icon]       │  │  [Calendar Icon]     │     │
│              │  │  Start an instant    │  │  Enter a 10-char     │  │  Plan ahead with     │     │
│              │  │  collaboration room  │  │  meeting room code   │  │  custom access rules │     │
│              │  │  [ Start Now (Teal) ]│  │  [ Join Room ]       │  │  [ Schedule ]        │     │
│              │  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘     │
│              │                                                                                   │
│              │  UPCOMING MEETINGS (TODAY)                          RECENT ACTIVITY & DOWNLOADS   │
│              │  ┌──────────────────────────────────────────────┐   ┌──────────────────────────┐  │
│              │  │ 10:00 AM • In 15 mins   [Waiting Room: ON]   │   │ PAST MEETING SYNC        │  │
│              │  │ Quarterly Architecture & Roadmap Sync        │   │ Engineering Sync         │  │
│              │  │ Code: cly-789-qwa • 14 invited               │   │ Yesterday • 48 mins      │  │
│              │  │ [Copy Invite Link]       [ START MEETING ]   │   │ 12 participants attended │  │
│              │  ├──────────────────────────────────────────────┤   │ [View Session Summary]   │  │
│              │  │ 02:30 PM • In 4 hours                        │   ├──────────────────────────┤  │
│              │  │ Client Feedback & Design Token Alignment     │   │ RECENT DOWNLOADED FILES  │  │
│              │  │ Code: cly-441-pzm • 6 invited                │   │ ┌──────────────────────┐ │  │
│              │  │ [Copy Invite Link]       [ Start Meeting ]   │   │ │ [PDF] arch_specs.pdf │ │  │
│              │  └──────────────────────────────────────────────┘   │ │ Size: 4.8 MB         │ │  │
│              │                                                     │ │ Meeting: Arch Sync   │ │  │
│              │                                                     │ │ [ Download Again ]   │ │  │
│              │                                                     │ └──────────────────────┘ │  │
│              │                                                     │ [View All in Downloads]  │  │
│              │                                                     └──────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────────────────────────────────────────┘
```
