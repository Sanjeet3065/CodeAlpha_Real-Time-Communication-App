# CONNECTLY — Screen Design Specification (All 23 Major Screens)

## 1. Specification Standards

This document establishes the exhaustive design, layout, content hierarchy, component composition, state variations, and responsive transformations for all **23 core screens** in CONNECTLY.

---

## 2. Public Screens

### Screen 01: Landing Page (`/`)
- **Purpose:** Primary public storefront articulating CONNECTLY's value proposition, security features, editorial aesthetics, and high-capacity WebRTC meeting capabilities.
- **Target User:** Prospective users, enterprise decision-makers, educators, and guests exploring the platform.
- **Main Actions:** Start an instant meeting, enter an existing meeting code, navigate to registration, view product documentation.
- **Header & Nav:** `NavBar` (Logo, Product, Security, Docs, "Sign In" link, "Start Free" CTA button).
- **Content Hierarchy:**
  1. Hero Block: Editorial typography header, subline, dual CTA ("Start Instant Meeting" + "Join with Code" input box), and an interactive meeting room illustration.
  2. Feature Matrix: 4 pillars (High-Density SFU Video, Collaborative Whiteboard, Private File Sharing, Strict Security).
  3. Capacity & Performance Spotlight: Explaining the selective forwarding model and low-latency transport.
  4. Footer: Legal links, terms, privacy, system status link, GitHub repository link.
- **Components:** `NavBar`, `Button`, `TextInput`, `Badge`, `Card`.
- **Primary CTA:** "Start Instant Meeting" (`btn-primary-bg` Teal).
- **Secondary Actions:** "Join with Code", "Sign In".
- **States:** Default, Scrolled Header, Interactive Code Input Focus.
- **Layouts:**
  - Desktop (>1024px): 12-column grid, dual-column hero with text on left, video mock on right.
  - Tablet (768px–1023px): 8-column grid, stacked hero with centered CTAs.
  - Mobile (<768px): 4-column grid, full-width single column, hamburger menu navigation.
- **Accessibility:** Semantic `<main>`, Landmark roles, WCAG 2.2 contrast compliance on ivory background.

### Screen 02: Sign Up (`/register`)
- **Purpose:** Facilitate account creation with email, name, and strong password.
- **Target User:** New users registering for an account.
- **Main Actions:** Input first name, last name, email, password; submit registration; navigate to login.
- **Header & Nav:** Minimal centered logo header with "Already have an account? Sign In" link.
- **Content Hierarchy:** Centered card (`cly-container-sm`) with Manrope H1 ("Create your account"), subtitle, 4 input fields, password strength meter, Terms checkbox, and "Create Account" CTA.
- **Components:** `TextInput`, `PasswordInput`, `Checkbox`, `Button`, `Alert`.
- **Primary CTA:** "Create Account" (Primary Teal Button).
- **States:** Default, Typing with real-time password criteria validation (8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 symbol), Loading (spinner + disabled inputs), Error (validation alert banner).
- **Success Feedback:** Inline transition to "Check your email" confirmation screen.
- **Layouts:** Centered card with 24px padding on mobile / 32px on desktop.

### Screen 03: Login (`/login`)
- **Purpose:** Secure authentication via email and password credentials.
- **Target User:** Returning registered users.
- **Main Actions:** Input email and password; toggle password visibility; click "Forgot Password"; submit form.
- **Header & Nav:** Minimal centered logo header with "Don't have an account? Sign Up" link.
- **Content Hierarchy:** Centered card with Manrope H1 ("Welcome back"), email field, password field with inline "Forgot password?" link, "Remember this device" checkbox, and "Sign In" button.
- **Components:** `TextInput`, `PasswordInput`, `Checkbox`, `Button`, `Alert`.
- **Primary CTA:** "Sign In" (Primary Button).
- **States:** Default, Loading (authenticating session), Error ("Invalid email or password" alert).
- **Success Feedback:** Immediate route transition to `/dashboard`.

### Screen 04: Forgot Password (`/forgot-password`)
- **Purpose:** Initiate self-service password recovery by submitting registered email.
- **Target User:** Users locked out of their accounts.
- **Main Actions:** Enter email address; request reset link; return to login.
- **Content Hierarchy:** Centered card with Manrope H1 ("Reset your password"), instructions, email input, "Send Reset Link" button, and "Back to Login" tertiary button.
- **States:** Default, Loading, Success (swaps form for "Reset link dispatched" confirmation card).

### Screen 05: Reset Password (`/reset-password`)
- **Purpose:** Set a new password using a verified time-bounded email reset token.
- **Target User:** Users arriving via an email link (`?token=...`).
- **Content Hierarchy:** Centered card with Manrope H1 ("Set new password"), new password field, confirm password field, complexity meter, and "Update Password" button.
- **States:** Default, Token Expired Error (provides one-click link to request a new token), Success (redirects to login with success toast).

---

## 3. Dashboard Screens

### Screen 06: User Dashboard (`/dashboard`)
- **Purpose:** Primary authenticated hub for initiating meetings, inspecting upcoming schedule, viewing recent meeting activity, and accessing downloaded files.
- **Target User:** Authenticated users.
- **Header & Nav:** `AppSidebar` on left; top header with page title ("Dashboard"), quick search, notification bell with badge, and user avatar dropdown.
- **Content Hierarchy:**
  1. Top Quick Action Bar: 3 elevated action cards: "Instant Meeting" (Teal), "Join Meeting" (Ivory/Border), "Schedule Meeting" (Ivory/Border).
  2. Main Content Split:
     - Left (60%): Upcoming Meetings Agenda list with countdown pills, direct "Start" / "Join" buttons, and copy-link icon.
     - Right (40%): 
       - Quick meeting code entry box (`cly-XXX-XXX`).
       - Recent Meeting Activity feed.
       - **Recent Downloads Quick-Access Widget:** Displays the 3 most recently downloaded/shared files, with each item clearly rendering the file name, extension badge, file size, download timestamp, and its **associated meeting name** (e.g., `"Quarterly Architecture Sync"`), plus an inline "Download" icon action and a "View All Downloads" link leading to `/downloads`.
- **Components:** `AppSidebar`, `Card`, `Button`, `Badge`, `TextInput`, `Avatar`.
- **Primary CTA:** "Start Instant Meeting".
- **Empty State:** Friendly illustration with "No upcoming meetings scheduled. Start an instant meeting or schedule one for later."
- **Layouts:** Desktop: 2-column split with fixed sidebar; Tablet: sidebar collapsed to icon strip, 1-column cards; Mobile: sidebar hidden, bottom tab navigation.

### Screen 07: Create Instant Meeting Modal (`/dashboard?action=create`)
- **Purpose:** Configure baseline options and launch a new meeting room instantly.
- **Content Hierarchy:** Modal dialog with title "Start an Instant Meeting", generated meeting code preview (`cly-789-qwa`), toggle switches ("Enable Waiting Room", "Mute participants on entry", "Require Passcode"), and "Start Meeting Now" button.
- **Primary CTA:** "Start Meeting Now".

### Screen 08: Join Meeting by Code Modal (`/dashboard?action=join`)
- **Purpose:** Fast-entry modal allowing users to type or paste a meeting code to join.
- **Content Hierarchy:** Modal dialog with title "Join a Meeting", single 10-character formatted input field with auto-hyphenation (`cly-XXX-XXX`), optional passcode input, and "Continue to Lobby" CTA.

### Screen 09: Meeting Invitation Card / Modal (`/meetings/:id/invite`)
- **Purpose:** Display shareable meeting parameters for distribution.
- **Content Hierarchy:** Formatted invite summary: Meeting Title, Date/Time, Direct URL, Meeting Code, Passcode, one-click "Copy Invitation Text", and "Export to Google / Outlook Calendar (.ics)" buttons.

### Screen 10: Notifications Drawer / Page (`/notifications`)
- **Purpose:** Full feed of user alerts, invites, and system updates.
- **Content Hierarchy:** Tabbed list ("All", "Unread", "Invites"), individual notification items with timestamp, read/unread status dot, and action buttons ("Accept Invite", "Decline").
- **Empty State:** "You're all caught up! No unread notifications."

---

## 4. Meeting Screens (Highest Priority)

### Screen 11: Main Meeting Room (`/meeting/:meetingCode`)
- **Purpose:** Fullscreen real-time conference theater supporting multi-user video/audio, screen sharing, and collaboration.
- **Theme:** Dark Meeting Theater (`#101820` canvas).
- **Header:** Meeting title, JetBrains Mono meeting code with copy icon, session elapsed timer (`00:24:18`), connection health badge, and "Security Settings" shield icon.
- **Main Stage:** Adaptive video grid dynamically resizing based on participant count (1 to 60 target).
- **Dock Bar:** Floating bottom pill dock containing Microphone, Camera, Screen Share, Whiteboard, Chat, Participants, Reactions, More Options, and Leave Meeting.
- **Components:** `VideoTile`, `ActiveSpeakerTile`, `MeetingDock`, `NetworkHealthBadge`, `ChatDrawer`.

### Screen 12: Pre-Join Lobby & Waiting Room (`/join/:meetingCode`)
- **Purpose:** Pre-flight device check and holding area before admission into the conference.
- **Left Stage:** Live camera preview window with audio volume meter, microphone selector, camera selector, and background blur toggle.
- **Right Panel:** Meeting title, host name, display name input (for guests), passcode input (if required), and "Join Meeting" CTA.
- **Waiting Room State:** If waiting room is active, clicking Join transitions the card into a pulsing holding state: "Please wait, the host will let you in soon" with animated subtle mint pulse.

### Screen 13: Participants Drawer (`In-Meeting > People`)
- **Purpose:** Manage and inspect the active room roster.
- **Content Hierarchy:** Top search filter, participant counter ("14 / 60"), Hand-Raise Priority Queue (ordered list of users with raised hands), Active Participant List with role badges (`Host`, `Co-Host`, `Participant`), and Host Moderation Bar ("Mute All", "Lock Room").
- **Participant Item Actions (Host only):** Hover menu with "Mute Microphone", "Turn Off Camera", "Make Co-Host", "Remove from Meeting".

### Screen 14: Chat Drawer (`In-Meeting > Chat`)
- **Purpose:** Text-based discussion and ephemeral emoji reactions during the meeting.
- **Content Hierarchy:** Header with tab filter ("Everyone" vs "Direct Message"), scrollable message list with auto-scroll down, and bottom message composer.
- **Composer:** Input box, Lucide `Smile` trigger (opens emoji popover), `Paperclip` file attach trigger, and send button.

### Screen 15: Screen Sharing Stage (`In-Meeting > ScreenShare`)
- **Purpose:** High-resolution presentation view.
- **Stage Layout:** Shared presentation screen occupies 80% of viewport width; participant video feeds automatically reflow into a clean horizontal or vertical filmstrip.
- **Presenter Bar:** Floating pill indicator for the presenter: "You are sharing your screen (Stop Sharing)".

### Screen 16: File Sharing Drawer (`In-Meeting > Files`)
- **Purpose:** Exchange documents securely during active conference sessions.
- **Content Hierarchy:** Drag-and-drop file upload zone (validates 25MB limit), list of shared files with file type icons, size in JetBrains Mono, uploader name, and secure "Download" button (triggers pre-signed URL).

### Screen 17: Collaborative Whiteboard (`In-Meeting > Whiteboard`)
- **Purpose:** Real-time synchronized drawing canvas.
- **Canvas Stage:** Vector drawing surface occupying main stage.
- **Whiteboard Dock:** Floating vertical tool strip on left edge (Select, Pen, Shapes, Text, Eraser, Clear, Lock Canvas, Export PNG).
- **Header:** "Collaborative Whiteboard — Editing Live" with lock status badge.

---

## 5. Account & History Screens

### Screen 18: Schedule Meeting (`/meetings/schedule`)
- **Purpose:** Create future calendar meetings with customized access policies and recurrence.
- **Target User:** Authenticated users.
- **Main Actions:** Input meeting title, select date and time, configure recurrence, toggle waiting room/passcode, schedule meeting.
- **Content Hierarchy:** Multi-section form: Meeting Title, Description, Date picker, Time picker, Duration dropdown, Recurrence rules, Passcode generator, Waiting Room toggle, and Default Mute toggle. Sticky bottom footer with "Schedule Meeting" and "Cancel" buttons.
- **Components:** `TextInput`, `DateTimePicker`, `SelectDropdown`, `ToggleSwitch`, `Button`.
- **Primary CTA:** "Schedule Meeting" (`btn-primary-bg`).
- **States:** Default, Submitting, Success (generates `.ics` download modal).

### Screen 19: Meeting History (`/meetings/history`)
- **Purpose:** Comprehensive record of past meetings attended or hosted.
- **Target User:** Authenticated users reviewing past collaboration sessions.
- **Main Actions:** Search past meetings, filter by date range, inspect participant roster, view attendance durations, export session transcripts, navigate to detailed session summary.
- **Content Hierarchy:**
  1. Header with title ("Meeting History"), search input, date-range picker.
  2. Paginated data table showing:
     - Meeting Title & Meeting Code (`cly-789-qwa`)
     - Date & Start Time
     - Total Duration (e.g., `54m 16s` in JetBrains Mono)
     - Total Attendees count
     - Actions: "View Summary" button linking to Screen 20 (`/meetings/history/:id`).
- **Components:** `AppSidebar`, `SearchInput`, `Card`, `Button`, `Badge`.
- **Primary CTA:** "View Summary".
- **Empty State:** "No past meetings found. Completed meetings will appear here automatically."

### Screen 20: Session Summary Detail (`/meetings/history/:id`)
- **Purpose:** In-depth post-meeting analytical breakdown and asset summary for a specific concluded meeting instance.
- **Target User:** Host or attendees reviewing past meeting attendance logs, duration metrics, and session assets.
- **Main Actions:** Inspect attendee roster, verify join/leave timestamps, view duration seconds, inspect and download files shared during the meeting, copy meeting details.
- **Content Hierarchy:**
  1. Header: Meeting Title, Meeting Code (`cly-789-qwa`), Start/End timestamps, and "Back to History" breadcrumb.
  2. Summary Metrics Row: 3 metric cards (Total Duration e.g. `54m 16s`, Total Unique Participants e.g. `14`, Shared Files Count e.g. `3`).
  3. Attendee Roster Table: Participant Name, Role Badge (`Host`, `Co-Host`, `Participant`), Join Time, Leave Time, Total Attendance Duration.
  4. Session Shared Files Section: File cards with file name, type, size, uploader name, and direct "Download" pre-signed URL button.
- **Components:** `Breadcrumbs`, `Card`, `Badge`, `Button`, `Avatar`.
- **Primary CTA:** "Download Files Archive".

### Screen 21: User Profile (`/profile`)
- **Purpose:** Manage personal account details, credentials, and public persona.
- **Target User:** Authenticated users.
- **Main Actions:** Upload avatar, update display name, change password, inspect verified email.
- **Content Hierarchy:** Card layout: Avatar upload/crop component (Cloudinary integration), display name, full name, email address badge ("Verified"), password update section, and "Save Changes" primary button.
- **Components:** `Avatar`, `TextInput`, `PasswordInput`, `Button`, `Toast`.
- **Primary CTA:** "Save Changes".

### Screen 22: Account Settings (`/settings`)
- **Purpose:** Configure platform defaults and hardware preferences.
- **Target User:** Authenticated users.
- **Main Actions:** Select default audio/video input devices, set meeting join defaults, configure notification preferences.
- **Content Hierarchy:** Tabbed categories:
  1. Audio & Video Defaults: Preferred microphone selector, default camera selector, "Join with microphone muted" toggle, "Join with camera off" toggle.
  2. Appearance: Theme selection (Default: Modern Editorial Light Dashboard + Dark Meeting Theater).
  3. Notifications: Email reminders, audio chimes on participant join/leave.
- **Components:** `SegmentedTabs`, `SelectDropdown`, `ToggleSwitch`, `Button`.
- **Primary CTA:** "Save Preferences".

### Screen 23: Downloads & Shared Files (`/downloads`)
- **Purpose:** Centralized, dedicated repository allowing users to search, filter, and download all private documents and media shared during meetings they participated in.
- **Target User:** Authenticated users seeking files exchanged in past or ongoing collaboration sessions.
- **Main User Actions:**
  - Search downloaded and shared files by file name or keyword.
  - Filter files by **Associated Meeting Name**, file type (`PDF`, `Documents`, `Spreadsheets`, `Images`, `Archives`), and date range.
  - Sort table by Date Shared (newest/oldest), File Name (A–Z), or File Size.
  - Download file directly via secure, time-bounded (5-minute) pre-signed S3 GET URL.
  - Click on the associated meeting name to navigate directly to that meeting's history summary.
- **Page Layout:** Standard Dashboard layout with `AppSidebar` on left; main content area with header, filter bar, data table, and pagination footer.
- **Header:** Manrope H1 ("Downloads & Shared Files"), descriptive subtitle ("Access documents and files shared during your meetings"), and top-right storage usage badge (`"24 files • 118.4 MB total"`).
- **Navigation:** Accessible via `AppSidebar` item "Downloads" (marked with `aria-current="page"` when active).
- **Content Hierarchy:**
  1. **Filter & Search Bar:**
     - Left: `SearchInput` with placeholder `"Search files by name..."`.
     - Center: `SelectDropdown` for **Associated Meeting** (e.g., `"All Meetings"`, `"Quarterly Architecture Sync"`, `"Frontend Review"`).
     - Right: `SelectDropdown` for **File Type** (`All`, `PDF`, `Doc`, `Sheet`, `Archive`, `Image`).
  2. **Downloads Data Table:**
     - Column 1: **File Name & Type** (Lucide file icon, file title e.g. `architecture_specs_v2.pdf`, MIME badge).
     - Column 2: **Associated Meeting Name** (Rendered as high-contrast link e.g., `"Quarterly Architecture Sync"`, linking to `/meetings/history/cly-789-qwa`).
     - Column 3: **File Size** (Rendered in JetBrains Mono 13px, e.g., `4.8 MB`).
     - Column 4: **Shared / Download Date** (Timestamp, e.g., `Nov 15, 2026 • 10:14 AM`).
     - Column 5: **Shared By** (Avatar + User Name snapshot, e.g., `Dr. Sarah Chen`).
     - Column 6: **Action** (Primary "Download" outline icon button with Lucide `Download` icon).
  3. **Pagination Footer:** `"Showing 1–10 of 24 files"`, with previous/next page buttons.
- **Components:** `AppSidebar`, `SearchInput`, `SelectDropdown`, `Card`, `Button`, `Badge`, `Skeleton`.
- **Primary CTA:** "Download" (generates pre-signed S3 URL and triggers browser file save).
- **Secondary Actions:** "Clear Filters", "View Meeting History".
- **Empty State:** Friendly illustration with text: *"No files downloaded or shared yet. Documents shared in meetings you attend will automatically be accessible here."* Secondary CTA button: `"View Scheduled Meetings"`.
- **Loading State:** 5 skeleton table rows with shimmering placeholder blocks for file icons, meeting names, and download buttons.
- **Error State:** Warning alert banner: *"Unable to retrieve shared files list. Check your network connection. [Retry Button]"*.
- **Success Feedback:** Clicking Download triggers a subtle toast: *"Generating secure download link for architecture_specs_v2.pdf..."* followed by native browser download initiation.
- **Desktop Layout (`≥ 1024px`):** Full 12-column table displaying all 6 columns with hover highlight on table rows (`surface-card-hover`).
- **Tablet Layout (`768px–1023px`):** 8-column layout; collapses "Shared By" into a compact avatar badge; retains File Name, Associated Meeting Name, Size, and Download CTA.
- **Mobile Layout (`< 768px`):** Transforms from a table into a stacked card list. Each card displays:
  - Top: File icon + File Name (Inter 14px SemiBold).
  - Badge: Associated Meeting Name chip (`#DCEDE8` background with `#172B3A` text).
  - Metadata row: Size (`4.8 MB`) • Date (`Nov 15`).
  - Full-width touch-optimized "Download File" button ($\ge 44\text{px}$ hit target).
- **Accessibility Requirements:**
  - Table marked with standard accessible semantics (`<table role="table">`, `<th scope="col">`).
  - Download buttons include explicit screen-reader labels: `aria-label="Download architecture_specs_v2.pdf from Quarterly Architecture Sync"`.
  - Filter dropdowns have explicit `aria-label` tags and full keyboard arrow navigation.
