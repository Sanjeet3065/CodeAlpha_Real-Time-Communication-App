# CONNECTLY — Animation, Motion & Micro-Interaction Guidelines

## 1. Motion Philosophy: Purposeful Mechanical Feedback

CONNECTLY treats motion not as decorative flourish, but as a functional communication channel. Every animation exists to:
1. Confirm a direct user action (mechanical feedback).
2. Direct visual attention to critical state changes (active speaker shift, incoming chat).
3. Orient the user spatially during layout transitions (drawer slide-in, modal scale).
4. Preserve client CPU and GPU cycles for WebRTC media decoding.

---

## 2. Global Motion Constants & Easing Curves

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MOTION TIMING CONSTANTS                           │
├──────────────┬──────────┬─────────────────────────────┬─────────────────────┤
│ Token Name   │ Duration │ Easing Curve                │ Motion Profile      │
├──────────────┼──────────┼─────────────────────────────┼─────────────────────┤
│ `dur-instant`│ `75ms`   │ `ease-out`                  │ Button press state  │
│ `dur-fast`   │ `150ms`  │ `cubic-bezier(0.16,1,0.3,1)`│ Hover tints, toggles│
│ `dur-base`   │ `250ms`  │ `cubic-bezier(0.16,1,0.3,1)`│ Modals, accordions  │
│ `dur-slow`   │ `350ms`  │ `cubic-bezier(0.16,1,0.3,1)`│ Drawers, grid reflow│
│ `dur-ambient`│ `1500ms` │ `linear`                    │ Skeleton shimmer    │
└──────────────┴──────────┴─────────────────────────────┴─────────────────────┘
```

- **Primary Editorial Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` — A custom spring-inspired deceleration curve that arrives crisply without bouncy oscillations.
- **Exit Easing:** `cubic-bezier(0.4, 0, 1, 1)` — Accelerates off-screen rapidly to minimize user wait time.

---

## 3. Micro-Interaction Catalog

### 3.1. Button Press Mechanical Feedback
- **Trigger:** `onPointerDown` / `onKeyDown(Space|Enter)`
- **Duration:** `75ms` (`cly-dur-instant`)
- **Transformation:** `transform: scale(0.98)`
- **Purpose:** Mimics a physical mechanical button switch.
- **Reduced-Motion Fallback:** Instantaneous color shift without scale transformation.

### 3.2. Modal Dialog Entrance & Exit
- **Trigger:** Modal launch / dismiss
- **Duration:** Entrance: `250ms`; Exit: `150ms`
- **Transformation:**
  - Entrance: `opacity: 0` ➔ `1`, `transform: scale(0.95)` ➔ `scale(1.0)`
  - Exit: `opacity: 1` ➔ `0`, `transform: scale(1.0)` ➔ `scale(0.97)`
- **Backdrop:** Fades from `opacity: 0` to `opacity: 1` in `200ms`.
- **Purpose:** Establishes spatial depth and focuses focus-trap within the card.
- **Reduced-Motion Fallback:** Simple cross-fade (`opacity: 0` to `1`) without scale.

### 3.3. Right Slide-Over Drawers (Chat, People, Files)
- **Trigger:** Toggling dock icon button
- **Duration:** `300ms` (`cly-dur-slow`)
- **Transformation:** `translateX(100%)` ➔ `translateX(0%)`
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
- **Purpose:** Slides in from the right edge while smoothly contracting the main video stage width via CSS Flexbox flex-grow.
- **Reduced-Motion Fallback:** Instant appearance with 100ms fade.

### 3.4. Video Grid Reflow on Join / Leave
- **Trigger:** Participant joins, leaves, or turns camera on/off
- **Duration:** `350ms`
- **Mechanism:** Powered by Motion's `layout` prop. Video tile CSS Grid slots re-calculate dimensions and interpolate smoothly to their new coordinates.
- **Purpose:** Eliminates jarring visual jumps when participants enter or leave a 60-user meeting.
- **Reduced-Motion Fallback:** Instant jump to new grid coordinates.

### 3.5. Active Speaker Audio Level Pulse
- **Trigger:** WebRTC audio energy level exceeds a provisional baseline threshold of `-35 dBFS` (subject to empirical calibration, noise-floor adaptation, and hardware tuning during implementation).
- **Duration:** `150ms` attack, `300ms` decay
- **Transformation:** `box-shadow: 0 0 0 3px #168B83, 0 0 12px rgba(22, 139, 131, 0.40)`
- **Purpose:** Visually confirms who is currently speaking across a grid of up to 25 visible tiles.
- **Reduced-Motion Fallback:** Static solid 3px border (`#168B83`) without drop-shadow bloom.

### 3.6. Floating Emoji Reactions
- **Trigger:** Participant clicks an emoji reaction (`👍`, `❤️`, `🎉`, `👏`)
- **Duration:** `2500ms`
- **Trajectory:** Rises vertically from the sender's video tile (or bottom-right dock) upwards `180px`, drifting horizontally $\pm 24\text{px}$ using a sine wave, fading to `opacity: 0` over the final `500ms`.
- **Throttling:** Max 3 concurrent reactions per user per 5 seconds to prevent visual clutter and CPU overhead.
- **Reduced-Motion Fallback:** Emoji appears as a static badge over the tile for 2000ms, then fades.

### 3.7. Toast Notification Transition
- **Trigger:** Event dispatch (e.g., "Link copied")
- **Duration:** `250ms` entrance, `200ms` exit
- **Transformation:** `translateY(16px)` ➔ `translateY(0)` with opacity fade.

### 3.8. Skeleton Loader Shimmer
- **Trigger:** Active data-fetching state
- **Duration:** `1500ms` infinite loop
- **Mechanism:** Linear gradient sliding horizontally (`translateX(-100%)` to `translateX(100%)`).

---

## 4. Accessibility & Reduced-Motion Mandate

CONNECTLY enforces strict compliance with **WCAG 2.2 Success Criterion 2.3.3 (Animation from Interactions)**:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

When reduced motion is active:
- All scale, slide, and floating trajectory transforms are disabled.
- Essential state changes transition via instantaneous cut or subtle opacity fades ($\le 100\text{ms}$).
- Floating emoji animations are replaced by stationary status badges.
