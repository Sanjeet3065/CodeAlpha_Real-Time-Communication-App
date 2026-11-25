# CONNECTLY — Responsive Design & Viewport Guidelines

## 1. Responsive Philosophy & Device Viewport Hierarchy

CONNECTLY employs an adaptive responsive design system that guarantees high utility across all device form factors without sacrificing usability, video performance, or accessibility. The design system specifically rejects simplistic CSS scaling; interfaces undergo structural transformations tailored to screen size and input method.

---

## 2. Breakpoint Matrix (7 Viewport Tiers)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BREAKPOINT SPECIFICATION                          │
├─────────────────────┬──────────────┬──────────────┬─────────────────────────┤
│ Viewport Tier       │ Range (px)   │ Grid Columns │ Primary Form Factor     │
├─────────────────────┼──────────────┼──────────────┼─────────────────────────┤
│ **Large Desktop**   │ `≥ 1440px`   │ 12 Columns   │ 27"+ 4K / QHD Monitors  │
│ **Standard Desktop**│ `1280–1439px`│ 12 Columns   │ Standard 24" Monitors   │
│ **Laptop**          │ `1024–1279px`│ 12 Columns   │ 13"–15" MacBooks, PCs   │
│ **Tablet Landscape**│ `840–1023px` │ 8 Columns    │ iPad Landscape, Surface │
│ **Tablet Portrait** │ `768–839px`  │ 8 Columns    │ iPad Portrait           │
│ **Mobile Landscape**│ `480–767px`  │ 4 Columns    │ Rotated Phones          │
│ **Mobile Portrait** │ `< 480px`    │ 4 Columns    │ Smartphones (iPhone/And)│
└─────────────────────┴──────────────┴──────────────┴─────────────────────────┘
```

---

## 3. Structural Layout Transformations

### 3.1. Dashboard Navigation Transformations
- **Large & Standard Desktop (`≥ 1280px`):** Fixed left vertical sidebar (`240px` width) displaying brand mark, navigation labels with icons, active page pills, and bottom user card.
- **Laptop (`1024px–1279px`):** Collapsible sidebar defaulting to `240px` but collapsible to an icon-only rail (`72px`) via toggle button.
- **Tablet (`768px–1023px`):** Compact `72px` icon rail. Labels appear as floating tooltips on hover/focus.
- **Mobile (`< 768px`):** Sidebar is completely hidden. Replaced by a fixed bottom `MobileTabBar` (`60px` height + safe-area padding) with 4 primary destinations (Home, Meetings, Schedule, Profile). Secondary navigation items accessible via an "Account & More" bottom sheet.

### 3.2. Modal Dialog Transformations
- **Desktop (`≥ 1024px`):** Centered floating cards with fixed maximum widths (`cly-container-sm` = `640px` or `cly-container-md` = `768px`), elevated with `cly-shadow-lg`, inner padding `32px`.
- **Tablet (`768px–1023px`):** Centered card occupying `80%` of viewport width.
- **Mobile (`< 768px`):** Dialogs transform into **Bottom Sheets** anchored to the bottom edge. Height is flexible (`max-h-[85vh]`), featuring a top drag handle pill (`36x4px`), scrollable body, and sticky bottom action buttons.

### 3.3. Side Drawers (Chat, Participants, Files)
- **Desktop (`≥ 1024px`):** Fixed slide-over drawer (`360px` width) pinned to the right edge. Pushes the main video stage or whiteboard canvas horizontally without obscuring controls.
- **Tablet (`768px–1023px`):** Overlay drawer (`320px` width) with `cly-shadow-lg` sliding over the right 40% of the stage with a subtle dimmed backdrop.
- **Mobile (`< 768px`):** Full-screen overlay or `90vh` bottom sheet with top navigation header and close button.

---

## 4. Responsive Video Grid Transformations

Managing up to 60 participants requires strict adaptive layout rules based on available screen real estate:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RESPONSIVE VIDEO GRID TILES                           │
├─────────────────────┬───────────────────┬───────────────────────────────────┤
│ Viewport Tier       │ Max Visible Tiles │ Tile Layout Geometry              │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ **Large Desktop**   │ Up to 25 tiles    │ 5x5 Grid (Paginated for > 25)     │
│ **Standard Desktop**│ Up to 16 tiles    │ 4x4 Grid                          │
│ **Laptop**          │ Up to 12 tiles    │ 4x3 Grid                          │
│ **Tablet Landscape**│ Up to 9 tiles     │ 3x3 Grid                          │
│ **Tablet Portrait** │ Up to 4–6 tiles   │ 2x2 or 2x3 Grid                   │
│ **Mobile Landscape**│ Up to 4 tiles     │ 2x2 Grid                          │
│ **Mobile Portrait** │ 1–2 tiles         │ Active Speaker Focus or 2x1 Stack │
└─────────────────────┴───────────────────┴───────────────────────────────────┘
```

### Video Pagination & Optimization Policy:
- When the total room roster exceeds the maximum visible tile threshold for the current viewport, the client automatically displays pagination dots (`Page 1 of 3`) at the bottom of the stage.
- Non-visible participants are un-subscribed from high-resolution video streams on the LiveKit SFU to preserve mobile CPU and cellular bandwidth.

---

## 5. Mobile In-Meeting Control Dock

The meeting dock adapts dynamically to maintain thumb accessibility while preventing accidental disconnects:

- **Desktop Dock:** Full floating pill (`height: 60px`) showing all 9 controls (Mic, Camera, Screen Share, Whiteboard, Chat, People, Reactions, Settings, Leave).
- **Mobile Dock:** Compact floating pill (`height: 52px`) prioritizing immediate essentials:
  1. Microphone Toggle (Large icon)
  2. Camera Toggle (Large icon)
  3. Chat Button (with unread badge)
  4. More Options (`...` icon opening full action sheet: Screen Share, Whiteboard, Hand Raise, People, Settings)
  5. Coral Red "Leave" Icon Button (Separated by divider with confirmation sheet)

---

## 6. Touch Targets & Accessibility Compliance (WCAG 2.2 AA)

To satisfy **WCAG 2.2 Success Criterion 2.5.8 (Target Size - Minimum)**:
- Every interactive element (buttons, tabs, inputs, icon toggles) on tablet and mobile viewports must maintain an interactive hit area of at least **`44 x 44 CSS pixels`**.
- Where visual design calls for a smaller icon (e.g., a `20px` close icon), transparent padding (`padding: 12px`) is added to expand the bounding hit area to $\ge 44\text{px}$.
- Adjacent clickable elements maintain a minimum spacing gap of `8px` (`cly-space-2`) to prevent mis-clicks.

---

## 7. Overflow & Viewport Boundaries

- **Zero Horizontal Scrolling:** All screen layouts are bounded by `max-w-full overflow-x-hidden`.
- **Safe Area Insets:** All mobile layouts respect iOS/Android safe area insets via `padding-bottom: env(safe-area-inset-bottom)` to prevent home indicators from overlapping floating docks.
