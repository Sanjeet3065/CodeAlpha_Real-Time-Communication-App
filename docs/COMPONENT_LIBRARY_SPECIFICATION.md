# CONNECTLY — Complete Component Library Specification
## Production-Grade UI Component Catalog

---

## 1. Specification Standard & Architecture

Every component in the CONNECTLY design system adheres to a strict specification template guaranteeing visual consistency, deterministic state feedback, responsive flexibility, and WCAG 2.2 Level AA accessibility compliance.

---

## 2. Navigation Components (6.1)

### 2.1. Main Navigation Bar (`NavBar`)
- **Purpose:** Primary application header for marketing and public landing pages.
- **Structure:** Left brand mark (logo + "Connectly" in Manrope), center navigation links (Product, Security, Pricing), right auth CTAs ("Sign In" text link + "Get Started" primary button).
- **Dimensions:** Height: `64px` desktop / `56px` mobile. Full width with `max-w-7xl` inner container.
- **Colors:** Background: `#FFFFFF` (80% opacity with `backdrop-blur-md`). Border: `1px solid #E3E1D9`. Text: `#172B3A`.
- **States:** Default, Scrolled (adds subtle shadow `cly-shadow-sm`).
- **Responsive:** Collapses center links into an accessible slide-over mobile drawer (`cly-bp-laptop` 1024px).
- **Accessibility:** Semantic `<header>` and `<nav aria-label="Main Navigation">` with mobile toggle labeled via `aria-expanded` and `aria-controls`.

### 2.2. Dashboard Sidebar (`AppSidebar`)
- **Purpose:** Primary vertical navigation for authenticated workspace (Dashboard, Scheduled, History, Downloads, Settings).
- **Structure:** Top brand emblem, middle vertical navigation list with active indicators, bottom user summary with logout action.
- **Dimensions:** Width: `240px` expanded / `72px` collapsed / hidden on mobile with bottom tab alternative.
- **Typography:** Inter 14px Medium.
- **Colors:** Background: `#FFFFFF`. Border-right: `1px solid #E3E1D9`. Active item background: `#DCEDE8` with `#172B3A` text and `#168B83` 3px left indicator bar. Inactive: `#3D5265` text; hover: `#F7F6F2`.
- **States:** Default, Hover, Active, Focus-visible.
- **Accessibility:** `role="navigation"`, active link marked with `aria-current="page"`.

### 2.3. Mobile Navigation Bar (`MobileTabBar`)
- **Purpose:** Fixed bottom bar providing one-thumb navigation on viewport `< 768px`.
- **Structure:** 4 key destinations: Home, Meetings, Schedule, Profile.
- **Dimensions:** Height: `60px` + safe-area inset bottom.
- **Touch Target:** Minimum `48x48px` bounding area per icon button.
- **Colors:** Background: `#FFFFFF` with top border `1px solid #E3E1D9`.

### 2.4. Breadcrumbs (`Breadcrumbs`)
- **Structure:** Ordered list of route segments separated by Lucide `ChevronRight` (16px).
- **Typography:** Inter 12px Regular; current page is Inter 12px SemiBold (`#172B3A`).
- **Accessibility:** Semantic `<nav aria-label="Breadcrumb">` wrapping `<ol>` with `aria-current="page"` on last leaf.

### 2.5. Tabs (`SegmentedTabs`)
- **Purpose:** Switching sub-views (e.g., Scheduled vs Past Meetings, or Chat vs Participants in meeting drawer).
- **Structure:** Horizontal pill or underline group.
- **Variants:** Underline (dashboard settings), Pill (in-meeting drawer).
- **Pill Dimensions:** Height `36px`, inner padding `4px`.
- **Colors:** Container `#1A2530` (dark) or `#E3E1D9` (light). Active pill `#253746` (dark) or `#FFFFFF` (light).
- **States:** Default, Hover, Active, Focus-visible (`2px solid #168B83`).
- **Accessibility:** WAI-ARIA Tabs pattern (`role="tablist"`, `role="tab"`, `aria-selected="true|false"`). Full arrow-key navigation.

### 2.6. User Profile Menu (`UserMenu`)
- **Structure:** Trigger avatar with chevron down. Dropdown panel showing user display name, email, organization, profile link, theme toggle, and logout button.
- **Dimensions:** Dropdown panel width `220px`, border-radius `8px`.
- **Colors:** Background `#FFFFFF`, border `1px solid #E3E1D9`, shadow `cly-shadow-md`.
- **Accessibility:** `aria-haspopup="menu"`, `aria-expanded="true|false"`. Esc closes menu.

### 2.7. Notification Menu (`NotificationPopover`)
- **Structure:** Bell icon trigger with unread badge counter. Popover list showing unread invites, schedule reminders, and "Mark all as read" button.
- **Dimensions:** Max width `360px`, max height `440px` with internal scroll.

---

## 3. Buttons Specification (6.2)

CONNECTLY defines a deterministic 8-button hierarchy:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BUTTON MATRIX SPEC                              │
├──────────────┬───────────┬───────────┬─────────────┬────────────────────────┤
│ Variant      │ Default BG│ Text Color│ Hover BG    │ Applied Role           │
├──────────────┼───────────┼───────────┼─────────────┼────────────────────────┤
│ **Primary**  │ `#168B83` │ `#FFFFFF` │ `#11706A`   │ Main action ("Join")   │
│ **Secondary**│ `#DCEDE8` │ `#172B3A` │ `#C8E2DB`   │ Sub-action ("Cancel")  │
│ **Tertiary** │ Flat/None │ `#172B3A` │ `#F7F6F2`   │ Text action ("Skip")   │
│ **Destruct** │ `#D94F4F` │ `#FFFFFF` │ `#BF3C3C`   │ Danger ("Leave / End") │
│ **Outline**  │ Flat/None │ `#172B3A` │ `#F7F6F2`   │ Bordered 1px `#E3E1D9` │
│ **Icon Btn** │ Variable  │ Variable  │ Variable    │ Toolbars (40x40px min) │
│ **FAB**      │ `#168B83` │ `#FFFFFF` │ `#11706A`   │ Mobile Quick Start     │
│ **Dock Pill**│ `#253746` │ `#FFFFFF` │ `#334A5D`   │ Meeting Controls       │
└──────────────┴───────────┴───────────┴─────────────┴────────────────────────┘
```

### Dimensions & Sizing
- **Small (`sm`):** Height `32px`, padding `0 12px`, typography Inter 12px Medium, radius `6px`.
- **Medium (`md` — Default):** Height `40px`, padding `0 16px`, typography Inter 14px Medium, radius `8px`.
- **Large (`lg`):** Height `48px`, padding `0 24px`, typography Inter 16px SemiBold, radius `8px`. Touch-optimized for mobile.
- **Touch Target Requirement:** All buttons on tablet/mobile must maintain an interactive hit area of at least **`44x44px`** (WCAG 2.2 Target Size Level AA).

### States Implementation
- **Hover:** Smooth background tint shift within `150ms` (`cly-dur-fast`).
- **Active:** Scale transform `scale(0.98)` to provide tactile mechanical response.
- **Focus-Visible:** `2px solid #168B83` with `2px offset`. Visible exclusively during keyboard tab navigation.
- **Disabled:** Background opacity `45%`, cursor `not-allowed`, `aria-disabled="true"`.
- **Loading:** Label is hidden (`opacity: 0`), an inline SVG spinner (`20px`) is centered, and `aria-busy="true"` is set.

---

## 4. Form Components (6.3)

### 4.1. Text Input & Email Input (`TextInput`)
- **Structure:** Label (top), input box with optional left/right Lucide icon, helper text or inline error text below.
- **Dimensions:** Height `40px` (`48px` on mobile), padding `0 12px` (or `0 36px` when icons present), border-radius `8px`.
- **Typography:** Label: Inter 13px Medium (`#172B3A`). Input text: Inter 14px Regular (`#172B3A`). Placeholder: `#6B8092`.
- **Colors:** Background `#FFFFFF`, border `1px solid #E3E1D9`. Focus: border `2px solid #168B83`, shadow `0 0 0 3px rgba(22, 139, 131, 0.15)`.
- **Error State:** Border changes to `2px solid #D94F4F`. Error message rendered below in Inter 12px Medium with `AlertCircle` icon (`#D94F4F`).

### 4.2. Password Input with Reveal Toggle (`PasswordInput`)
- **Structure:** Identical to Text Input with an embedded right-side icon button (`Eye` / `EyeOff` Lucide icons) allowing the user to toggle between `type="password"` and `type="text"`.
- **Accessibility:** Toggle button has `aria-label="Show password"` and `aria-pressed="false|true"`.

### 4.3. Search Input (`SearchInput`)
- **Structure:** Left magnifying glass icon (`Search` 16px `#6B8092`), input field, and optional right "Clear" (`X`) button appearing when text is entered.

### 4.4. Select Dropdown (`SelectDropdown`)
- **Structure:** Trigger box with selected label + chevron-down icon. Opens floating popover list of options with active checkmark.
- **Dimensions:** Height `40px`, popover width matches trigger.
- **Keyboard Navigation:** Full arrow-key selection, Enter to commit, Esc to dismiss.

### 4.5. Checkbox & Radio (`Checkbox`, `Radio`)
- **Dimensions:** Hit box `20x20px` with outer padding yielding minimum `44x44px` touch region.
- **Colors:** Unchecked: border `2px solid #E3E1D9`. Checked: background `#168B83`, white checkmark or center pip.

### 4.6. Toggle Switch (`ToggleSwitch`)
- **Purpose:** Binary flags (e.g., "Join with microphone muted", "Waiting room enabled").
- **Dimensions:** Track `44px` width, `24px` height. Thumb `20px` circle.
- **Colors:** Inactive: Track `#E3E1D9`, Thumb `#FFFFFF`. Active: Track `#168B83`, Thumb `#FFFFFF`.
- **Accessibility:** `role="switch"`, `aria-checked="true|false"`.

### 4.7. Date & Time Picker (`DateTimePicker`)
- **Purpose:** Used on Meeting Scheduling screens.
- **Structure:** Native input wrappers with styled popover calendar fallback adhering to design tokens.

---

## 5. General UI Components (6.4)

### 5.1. Cards & Panels (`Card`)
- **Variants:**
  - Standard Card: Background `#FFFFFF`, border `1px solid #E3E1D9`, radius `12px`, padding `20px`, shadow `cly-shadow-sm`.
  - Elevated Card: Background `#FFFFFF`, radius `12px`, padding `24px`, shadow `cly-shadow-md`.
  - Dark Theater Card: Background `#253746`, border `1px solid rgba(255, 255, 255, 0.12)`, radius `12px`, padding `20px`.

### 5.2. Modal Dialogs (`ModalDialog`)
- **Structure:** Backdrop overlay (`cly-overlay-backdrop-light` or `dark`), centered card container (`cly-container-sm` or `md`), header with title and close `X` button, scrollable body, and sticky bottom action footer.
- **Animation:** Enters with `scale(0.95)` to `scale(1.0)` and opacity fade in `250ms` (`cly-ease-out`).
- **Accessibility:** Focus trap inside dialog; initial focus placed on primary input; Esc triggers close; `aria-modal="true"`.

### 5.3. Toast Notifications (`Toast`)
- **Purpose:** Transient system feedback ("Meeting link copied", "Microphone disconnected").
- **Variants:** Success (Teal icon), Warning (Amber icon), Error (Coral Red icon), Info (Navy icon).
- **Placement:** Bottom-right on desktop (`24px` offset); top-center on mobile.
- **Duration:** Auto-dismiss after `4000ms`; pause on hover.
- **Accessibility:** `role="status"` with `aria-live="polite"`.

### 5.4. Badges & Status Indicators (`Badge`)
- **Structure:** Inline pill with 6px dot and text label.
- **Variants:**
  - Host Badge: Background `#DCEDE8`, text `#168B83`, font Inter 11px SemiBold.
  - Co-Host Badge: Background `#E8EBF2`, text `#172B3A`, font Inter 11px SemiBold.
  - Live Status: Green dot (`#168B83`) + "Live" text.
  - Hand Raised Badge: Amber background (`#FEF3C7`), text `#92400E` + `Hand` icon.

### 5.5. Avatars & Avatar Groups (`Avatar`)
- **Dimensions:** Extra Small (`24px`), Small (`32px`), Medium (`40px`), Large (`64px`), Theater Tile Placeholder (`96px`).
- **Fallbacks:** High-contrast two-letter initials rendered in Manrope SemiBold against deterministic user color seeds.

### 5.6. Skeleton Loaders (`Skeleton`)
- **Structure:** Content-shaped block matching text line, avatar, or card shape.
- **Animation:** Subtle shimmer wave (light grey `#E8E6E0` to `#F2F1ED` in light mode; `#1E2B38` to `#283848` in dark mode) looping every `1.5s`.

---

## 6. Meeting Room Components (6.5)

### 6.1. Video Participant Tile (`VideoTile`)
- **Structure:** Video `<video>` element filling container (`object-fit: cover`), bottom-left display name pill with mic status icon, bottom-right connection quality bars (1–4 bars), top-right hand-raise indicator.
- **Dimensions:** Dynamically calculated based on grid formula. Aspect ratio standard `16:9` (desktop) or `4:3` (compact mobile). Radius `12px` or `16px`.
- **Muted State:** Small red mic icon with strikethrough in display name pill.
- **Camera Off State:** Video element hidden; centered 96px circular avatar with user initials.

### 6.2. Active Speaker Tile (`ActiveSpeakerTile`)
- **Structure:** VideoTile wrapped in an energetic accent outline.
- **Border Treatment:** `3px solid #168B83` (Teal) with a subtle animated drop-shadow pulse (`box-shadow: 0 0 12px rgba(22, 139, 131, 0.40)`) triggering when audio level exceeds a provisional baseline threshold of `-35 dBFS`. *(Note: `-35 dBFS` is a provisional engineering baseline subject to implementation testing and acoustic calibration across diverse microphones and room noise levels, not an immutable constant).*

### 6.3. Meeting Control Dock (`MeetingDock`)
- **Structure:** Elevated floating pill anchored `24px` above the bottom viewport edge.
- **Dimensions:** Height `60px`, padding `0 16px`, gap `8px`, border-radius `9999px`.
- **Surface:** `#253746` with `1px solid rgba(255, 255, 255, 0.12)` and `cly-shadow-theater`.
- **Button Grouping:**
  1. Media Toggles: Microphone (with audio meter ring), Camera.
  2. Collaboration Toggles: Screen Share, Whiteboard, Chat (with unread badge), People (with hand-raise counter).
  3. Utility Toggles: Reactions Menu, More Settings (`...`).
  4. End Action: Separated by a 1px vertical divider; Coral Red "Leave" / "End" pill button.

### 6.4. Connection Quality Indicator (`NetworkHealthBadge`)
- **Structure:** 4 vertical bars indicating WebRTC connection strength:
  - 4 bars (Green `#168B83`): Excellent (<50ms RTT, 0% packet loss).
  - 3 bars (Green `#168B83`): Good (<120ms RTT, <1% packet loss).
  - 2 bars (Amber `#FBBF24`): Fair (<250ms RTT, <3% packet loss).
  - 1 bar (Red `#D94F4F`): Poor (>250ms RTT, >5% packet loss).
- **Tooltip:** Hovering reveals exact RTT, jitter, and downlink bitrate in JetBrains Mono.

---

## 7. Collaboration Components (6.6)

### 7.1. In-Meeting Chat Drawer (`ChatDrawer`)
- **Structure:** Fixed right slide-over panel (width `360px` desktop / `100%` mobile), top header with tab selector ("Everyone" vs "Direct"), message list feed, and bottom composer box.
- **Message Item:**
  - Sender name + timestamp (JetBrains Mono 11px).
  - Message bubble: Public `#253746` text `#FFFFFF`. Direct message tagged with distinct badge ("Direct Message to You").
- **Composer Box:** Auto-expanding textarea, emoji picker trigger, file attachment clip trigger, send button.

### 7.2. Collaborative Whiteboard Toolbar (`WhiteboardDock`)
- **Structure:** Floating vertical or horizontal dock pinned to the left edge of the whiteboard stage.
- **Tools Included:** Select/Pointer, Freehand Pen, Line, Rectangle, Ellipse, Text box, Sticky Note, Eraser, Clear All (Host only), Lock Canvas (Host only), Export PNG.
- **Color Palette Popover:** 8 curated swatches matching design system (`#172B3A`, `#168B83`, `#D94F4F`, `#253746`, `#FFFFFF`, `#F59E0B`, `#8B5CF6`, `#10B981`) + stroke width slider (2px, 4px, 8px).

### 7.3. File Attachment Card (`FileItem`)
- **Structure:** File type icon (`FileText`, `Image`, `Archive`), file name (Inter 13px SemiBold), file size in JetBrains Mono (e.g., `4.2 MB`), uploader name, and a "Download" icon button.
- **Upload Progress Bar:** Animated linear progress indicator (`#168B83`) during pre-signed S3 upload with percentage readout.
