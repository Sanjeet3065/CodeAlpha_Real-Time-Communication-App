# CONNECTLY — Accessibility & Inclusive Design Guidelines
## WCAG 2.2 Level AA Design Specification

---

## 1. Accessibility Commitment & Architectural Scope

CONNECTLY establishes **WCAG 2.2 Level AA** as its mandatory accessibility baseline across all platforms and form factors.

> [!IMPORTANT]
> This document specifies the **design, semantic requirements, and interaction rules** for WCAG 2.2 Level AA compliance. Actual verification and compliance testing will be executed during **Phase 17 – Testing, Optimization & Responsiveness** using automated Axe-Core suites and manual screen-reader evaluations.

---

## 2. Keyboard Navigation & Focus Management

### 2.1. Global Navigation & Tab Order
- All interactive controls (links, buttons, form inputs, tabs, video toggles) are reachable via standard sequential keyboard navigation (`Tab` and `Shift+Tab`).
- Logical tab order strictly follows visual reading order (left-to-right, top-to-bottom).
- Hidden or off-screen elements (e.g., closed drawers, collapsed mobile sidebars) are removed from the accessibility tree via `inert` or `tabindex="-1"`.

### 2.2. Focus Appearance (WCAG 2.2 SC 2.4.11 & 2.4.12)
- **Visual Design:** An unambiguous, high-contrast focus outline appears whenever an element receives keyboard focus:
  - Light Theme: `2px solid #168B83` with a `2px offset` (Contrast ratio: `3.74:1` against ivory canvas).
  - Dark Meeting Theater: `2px solid #2EC4B6` with a `2px offset` (Contrast ratio: `11.8:1` against `#101820` canvas).
- Focus rings are styled via `:focus-visible` so mouse clicks do not produce distracting outlines.

### 2.3. Modal & Drawer Focus Trapping
- Opening a modal dialog (`ModalDialog`) or side panel (`ChatDrawer`) automatically sets focus to the first interactive element inside the container (e.g., the search box or close button).
- Keyboard focus is strictly trapped inside the active container; tabbing past the last element loops focus back to the first.
- Pressing `Escape` immediately closes the container and **returns focus** to the trigger element that launched it.

---

## 3. Dedicated Meeting Room Keyboard Shortcuts

To enable mouse-free operation during real-time collaboration sessions, the following keyboard shortcuts are specified:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MEETING ROOM KEYBOARD SHORTCUTS                       │
├───────────────┬───────────────────────────────┬─────────────────────────────┤
│ Shortcut Key  │ Action Executed               │ Accessibility Announcement  │
├───────────────┼───────────────────────────────┼─────────────────────────────┤
│ `M`           │ Toggle Microphone Mute        │ "Microphone muted / unmuted"│
│ `V`           │ Toggle Camera Stream          │ "Camera turned on / off"    │
│ `C`           │ Toggle Chat Drawer            │ "Chat drawer opened / closed"│
│ `P`           │ Toggle Participants Drawer    │ "People drawer opened / closed"│
│ `H`           │ Raise / Lower Hand            │ "Hand raised / lowered"     │
│ `S`           │ Toggle Screen Sharing         │ "Screen sharing started/stop"│
│ `W`           │ Toggle Whiteboard             │ "Whiteboard opened / closed"│
│ `Space (Hold)`│ Push-to-Talk (Unmute while held)│ "Temporary audio unmuted" │
│ `?`           │ Open Keyboard Shortcuts Modal │ "Keyboard shortcuts help"   │
└───────────────┴───────────────────────────────┴─────────────────────────────┘
```

Shortcuts are automatically disabled when the user is actively typing inside an `<input>`, `<textarea>`, or content-editable field.

---

## 4. Screen Reader Announcements (`aria-live` Regions)

Real-time video conferencing involves dynamic events that must be communicated to assistive technology without interrupting ongoing screen reading:

1. **Polite Notification Region (`aria-live="polite"`):**
   - Participant joins or leaves: `"Marcus Vance joined the meeting"`.
   - Raised hands: `"Sarah Chen raised her hand"`.
   - Incoming chat messages: `"New message from Alex: Please check the PDF"`.
2. **Assertive Alert Region (`aria-live="assertive"`):**
   - Host moderation actions: `"You have been muted by the host"`.
   - Critical connection alerts: `"Network connection unstable. Reconnecting..."`.
   - Ejection notices: `"You have been removed from the meeting by the host"`.

---

## 5. Touch Target Sizing (WCAG 2.2 SC 2.5.8)

On touch-driven devices (tablets and smartphones):
- Every button, tab, checkbox, and toolbar control must have an interactive hit target of at least **`44 x 44 CSS pixels`**.
- Where visual constraints require smaller icon graphics (e.g., `20px` dock icons), transparent margins/padding are enforced via CSS to guarantee the bounding box exceeds `44x44px`.
- Adjacent interactive elements must maintain at least `8px` of separation.

---

## 6. Color Contrast & Redundant Encoding

- **Zero Color-Only Communication:** Statuses are never communicated by color alone. Every colored badge includes an icon and textual label:
  - Active: Green circle (`#168B83`) + Checkmark icon + Text "Active"
  - Muted: Red circle (`#D94F4F`) + MicOff icon + Text "Muted"
  - Warning: Amber circle (`#FBBF24`) + AlertTriangle icon + Text "Reconnecting"
- **Contrast Ratios:**
  - Normal body text: $\ge 4.5:1$ against background.
  - Large headings ($\ge 18\text{pt}$ or $\ge 14\text{pt}$ bold): $\ge 3:1$.
  - Essential graphical UI boundaries (input borders, active dock toggles): $\ge 3:1$.
