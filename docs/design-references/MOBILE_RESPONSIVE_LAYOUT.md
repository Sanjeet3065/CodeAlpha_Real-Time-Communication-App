# CONNECTLY — Design Reference: Mobile Responsive Layouts
## Structural ASCII Wireframe & Spatial Layout Blueprint

> [!NOTE]
> **Design Reference Classification:** This document is an architectural **structural text wireframe (ASCII wireframe)** specifying layout regions, spatial alignment, visual hierarchy, and component relationships for mobile viewports (< 768px). It is **not** an image-rendered or graphical UI mockup. Responsive styling execution occurs in Phase 03/04.

```
MOBILE DASHBOARD (< 480px)                    MOBILE MEETING THEATER (< 480px)
┌─────────────────────────────┐               ┌─────────────────────────────┐
│ [=] CONNECTLY      [Bell(3)]│               │ [cly-789]  [00:24:18]   [•] │
├─────────────────────────────┤               ├─────────────────────────────┤
│ Good morning, Sarah         │               │                             │
│                             │               │                             │
│ ┌─────────────────────────┐ │               │      ACTIVE SPEAKER         │
│ │ [Video] Start Instant   │ │               │         (70% height)        │
│ │ [ Start Meeting Now ]   │ │               │                             │
│ └─────────────────────────┘ │               │  [Dr. Sarah Chen (Host)]    │
│ ┌─────────────────────────┐ │               ├─────────────────────────────┤
│ │ [Code] Join Meeting     │ │               │ [Marcus Vance] (Thumb 30%)  │
│ │ [ Enter Code ] [ Join ] │ │               ├─────────────────────────────┤
│ └─────────────────────────┘ │               │  [< 1 of 6 >]               │
│                             │               │ ┌─────────────────────────┐ │
│ RECENT DOWNLOADS            │               │ │ [Mic] [Cam] [Chat][+][X]│ │
│ ┌─────────────────────────┐ │               │ └─────────────────────────┘ │
│ │ arch_specs.pdf (4.8MB)  │ │               └─────────────────────────────┘
│ │ Mtg: Architecture Sync │ │
│ │ [ Download Again ]      │ │               MOBILE CHAT BOTTOM SHEET
│ └─────────────────────────┘ │               ┌─────────────────────────────┐
├─────────────────────────────┤               │ [--- Drag Handle ---]       │
│ [Home] [Meetings] [Profile] │               │ IN-MEETING CHAT (Everyone)  │
└─────────────────────────────┘               │ Sarah: Look at diagram      │
                                              │ Marcus: Reviewing now       │
                                              │ [Input message...] [Send]   │
                                              └─────────────────────────────┘
```
