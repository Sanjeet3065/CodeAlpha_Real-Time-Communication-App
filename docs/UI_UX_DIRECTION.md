# CONNECTLY — UI/UX Design Direction & Design System

## 1. Design Philosophy: Modern Editorial + Premium Collaboration SaaS

CONNECTLY rejects the homogenization of modern AI-generated SaaS interfaces—characterized by oversaturated purple gradients, illegible glassmorphism, floating decorative particles, and gimmicky physics.

Instead, CONNECTLY is styled under an **Editorial + Precision Engineering** aesthetic:
- **Calm, High-Contrast Typography:** Rooted in classic print editorial design, paired with crisp computational geometry.
- **Dual Surface Context:**
  1. **Light Dashboard Shell:** Warm Ivory and Deep Navy provide an airy, thoughtful, distraction-free environment for scheduling, profile management, and reviewing meeting transcripts.
  2. **Elevated Dark Meeting Theater:** An immersive, ultra-low eye-fatigue dark environment (`#101820`) that emphasizes participants' video streams, high-legibility presentation slides, and real-time whiteboard graphics.
- **Subtle, Purposeful Motion:** Micro-interactions that convey state changes (e.g., mute indicator pulse, hand-raising drawer slide, tile rearrangement) without disorienting the user.

---

## 2. Color System & Design Tokens

### 2.1. Color Palette Tokens

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CONNECTLY CORE COLOR PALETTE                          │
├─────────────────────┬───────────┬─────────┬─────────────────────────────────┤
│ Token Name          │ Hex Value │ Role    │ Application Context             │
├─────────────────────┼───────────┼─────────┼─────────────────────────────────┤
│ `color-warm-ivory`  │ `#F7F6F2` │ Surface │ Dashboard canvas, background    │
│ `color-pure-white`  │ `#FFFFFF` │ Surface │ Cards, panels, modal containers │
│ `color-deep-navy`   │ `#172B3A` │ Brand   │ Primary text, headings, badges  │
│ `color-teal-accent` │ `#168B83` │ Accent  │ Primary CTAs, active indicators │
│ `color-soft-mint`   │ `#DCEDE8` │ Accent  │ Subdued badges, highlights      │
│ `color-coral-red`   │ `#D94F4F` │ Danger  │ Leave meeting, mute mic, errors │
│ `color-meeting-dark`│ `#101820` │ Theater │ Video room canvas background    │
│ `color-dark-surface`│ `#253746` │ Theater │ Meeting control dock, sidebars  │
└─────────────────────┴───────────┴─────────┴─────────────────────────────────┘
```

### 2.2. Functional Shades & State Overlays

| Semantic Token | Hex / Alpha | Purpose |
| :--- | :--- | :--- |
| `text-primary-light` | `#172B3A` (100%) | High-contrast dashboard copy |
| `text-muted-light` | `#172B3A` (60%) | Subtitles, timestamps, metadata |
| `border-subtle-light`| `#172B3A` (10%) | Card borders, table dividers |
| `text-primary-dark` | `#FFFFFF` (95%) | In-meeting participant names, controls |
| `text-muted-dark` | `#FFFFFF` (65%) | Latency stats, device selectors |
| `border-subtle-dark` | `#FFFFFF` (12%) | Video tile borders, control docks |
| `state-focus-ring` | `#168B83` (100%) | 2px solid accessible focus outline |

---

## 3. Typography Hierarchy

The typographic system pairs three specialized Google Web Fonts:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TYPOGRAPHY ARCHITECTURE                            │
├───────────────┬─────────────────┬──────────────┬────────────────────────────┤
│ Font Family   │ Role            │ Weights      │ Exemplar Use               │
├───────────────┼─────────────────┼──────────────┼────────────────────────────┤
│ **Manrope**   │ Display & Titles│ SemiBold(600)│ H1 Page Titles, Modals     │
│               │                 │ Bold(700)    │ Hero banners, Feature headers│
│ **Inter**     │ UI & Body Text  │ Regular(400) │ Paragraphs, chat bubbles,  │
│               │                 │ Medium(500)  │ form inputs, button labels │
│ **JetBrains** │ Data & Metrics  │ Regular(400) │ Meeting codes (`cly-789`), │
│ **Mono**      │                 │ Medium(500)  │ timestamps, bitrates, logs │
└───────────────┴─────────────────┴──────────────┴────────────────────────────┘
```

### Type Scale
- **Display 1 (Hero):** Manrope 40px / Line-height 1.2 / Weight 700
- **Heading 1:** Manrope 28px / Line-height 1.3 / Weight 600
- **Heading 2:** Manrope 22px / Line-height 1.35 / Weight 600
- **Heading 3:** Manrope 18px / Line-height 1.4 / Weight 600
- **Body Large:** Inter 16px / Line-height 1.5 / Weight 400
- **Body Regular:** Inter 14px / Line-height 1.5 / Weight 400
- **Body Small:** Inter 12px / Line-height 1.4 / Weight 500
- **Mono Code/Metric:** JetBrains Mono 13px / Line-height 1.4 / Weight 500

---

## 4. UI Layout Shells: Dual-Surface Conception

### 4.1. Dashboard Surface (Warm Ivory Shell)
- **Aesthetic:** Clean editorial publication. Crisp horizontal lines, generous whitespace, subtle 1px border lines, zero heavy drop-shadows.
- **Top Navigation Bar:** Logo, Scheduled Meetings link, Analytics, User Avatar with status pill.
- **Main Area:**
  - Left column: Quick Actions (Start Instant Meeting, Join Meeting by Code, Schedule Meeting).
  - Right column: Upcoming agenda calendar and recent meeting history cards.

### 4.2. In-Meeting Surface (Dark Theater Shell)
- **Aesthetic:** Dark low-fatigue cinema canvas (`#101820`). Video streams are treated with cinematic framing, subtle 1px rounded border outlines, and dark frosted background surfaces (`#253746`).
- **Layout Regions:**
  - **Header Bar (Top):** Meeting title, JetBrains Mono meeting code with one-click copy, active session timer, connection health indicator badge.
  - **Stage Area (Center):** Dynamic CSS Grid / Flexbox video canvas. Automatically transitions between:
    - *Gallery Grid:* Equal-size tiles (supports 2x2, 3x3, 4x4 up to 25 tiles per page).
    - *Speaker Stage:* Dominant active speaker or screen share occupies 75% of the viewport; remaining participants stacked in a horizontal or vertical filmstrip.
    - *Whiteboard Stage:* Vector canvas occupies primary stage; participant video tiles pinned as miniature floating heads along the right border.
  - **Floating Dock Bar (Bottom Center):** Pill-shaped elevated container (`#253746`) with high-contrast icon buttons:
    - Microphone toggle (with dynamic audio level border)
    - Camera toggle
    - Screen share toggle
    - Whiteboard toggle
    - Chat toggle (with unread badge counter)
    - Participant list toggle (with hand-raise counter)
    - More settings menu
    - End / Leave Meeting button (`#D94F4F` Coral Red)
  - **Slide-Over Panel (Right):** Collapsible tabbed drawer for Chat, Participants, Waiting Room, Shared Files, and Whiteboard Tools.

---

## 5. Component States & Accessibility Standards

Every interactive component across the application must provide deterministic visual feedback across 6 fundamental states:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SIX COMPONENT STATES                               │
├──────────────┬──────────────────────────────────────────────────────────────┤
│ State        │ Visual Treatment & Accessibility Behavior                    │
├──────────────┼──────────────────────────────────────────────────────────────┤
│ **Default**  │ Crisp contrast, distinct boundary, clear affordance          │
│ **Hover**    │ 8% surface tint shift, pointer cursor, tooltip appearance    │
│ **Focus**    │ 2px solid `#168B83` outline with 2px offset (WCAG 2.2 AA)    │
│ **Active**   │ Scale transform down (0.98), pressed state elevation         │
│ **Disabled** │ Opacity 45%, `cursor: not-allowed`, `aria-disabled="true"`   │
│ **Loading**  │ Smooth skeleton shimmer or embedded spinner; inert inputs   │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

### Accessibility (WCAG 2.2 Level AA Mandate)
- **Contrast Ratios:** Text-to-background contrast exceeds `4.5:1` for normal text and `3:1` for large text and UI icon controls.
- **Keyboard Navigation:** Complete meeting operation is achievable without a mouse:
  - `M`: Toggle microphone mute
  - `V`: Toggle camera
  - `C`: Toggle chat drawer
  - `P`: Toggle participant drawer
  - `H`: Raise / lower hand
  - `Spacebar (Hold)`: Push-to-talk momentary un-mute
- **Screen Reader Announcements:** Dynamic `aria-live="polite"` regions announce participant joins, leaves, hand raises, and chat notifications.

---

## 6. Prohibited Anti-Patterns

To maintain professional engineering standards, the following patterns are strictly banned:
- ❌ **No Random Glassmorphism:** Heavy blurred backdrops (`backdrop-blur-2xl`) that destroy rendering performance on mobile/low-end GPUs.
- ❌ **No Gimmicky Gradients:** Oversaturated multi-color linear gradients (e.g., purple-to-orange).
- ❌ **No Floating Particle Physics:** Starfield canvases or background particles floating across screens.
- ❌ **No Jarring Layout Shifts:** When video tiles join or leave, use Motion's `layout` physics to interpolate tile dimensions smoothly.
- ❌ **No Fake Stats / Testimonials:** No pseudo-marketing clutter on functional application pages.

---

## 7. Phase 01 Boundary Declaration

> **STRICT NOTICE:** The UI/UX specifications detailed in this document are design guidelines, architectural tokens, and requirements created for **Phase 02 (UI/UX Design System)** execution. In accordance with Phase 01 constraints, **zero frontend components, Tailwind classes, or HTML/JSX code shall be implemented in this phase.**
