# CONNECTLY Premium Compact Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign CONNECTLY's `/` homepage into a tight, 3-slide Stone & Carbon matte visual experience that removes Hero instant-meeting/code-entry bloat and replaces verbose text cards with UI-miniature Bento previews.

**Architecture:** Extract strongly typed homepage navigation, Bento preview metadata, trust badges, and legal policy items into `landingContent.ts` backed by Node unit tests, then rebuild `HeroSection`, `FeatureGrid` (`#studio`), `ConversionBanner` (`#trust`), `Footer`, `NavBar`, and `LandingPage` around 3 editorial screens (~1,900px–2,250px height) while deleting orphaned legacy sections (`ArchitectureSpotlight`, `HowItWorksSection`, `SecurityTrustSection`).

**Tech Stack:** React 18, TypeScript (strict, `noUnusedLocals`), Tailwind CSS v3 (Stone `#F3F2EE` / `#FAF9F6` / `#2F6F68` and Carbon `#141619` / `#1C1F24` / `#5FA399`), Lucide React, Node native test runner (`node --experimental-strip-types --test`).

**Spec:** `docs/superpowers/specs/2026-11-27-premium-compact-homepage-design.md`

## Global Constraints

- Compact vertical rhythm targeting **2–3 desktop viewports (~1,900px–2,250px total height)**, zero overlapping multi-paragraph marketing sections.
- Zero `Start Instant Meeting` button and zero `Enter code (cly-xxx-xxx) | Join` form on `/`.
- Every Bento card leads with a **bespoke interactive-looking UI miniature** and at most a concise title plus 5–8 word caption.
- Dual-mode **Stone & Carbon Matte** parity (`#F3F2EE` / `#FAF9F6` light; `#141619` / `#1C1F24` dark; `#2F6F68` / `#5FA399` pine-teal accent), zero neon glows or `backdrop-blur`.
- Preserve `PhaseNoticeModal` accessibility (`role="dialog"`, Escape/Tab focus trap) and keep `/dashboard` and `/join/:code` routes untouched.

## Review Focus

- **Code-join or instant-meeting regression:** verify zero instant-meeting or `cly-xxx-xxx` code forms appear on `/` while `/dashboard` and `/join/:code` routes remain unaffected.
- **Unreachable or broken anchor navigation:** verify every `NavBar` link (`#studio`, `#trust`) matches a rendered section DOM `id` on `/`.
- **Card copy bloat creeping back:** enforce hard word-count limits (<= 9 words) on Slide 2 Bento captions via unit test so cards never revert to text walls.
- **Orphaned unused imports / TypeScript build failures:** verify `tsc --noEmit`, `eslint .`, `tsc -b && vite build`, and `phase17Sprint01.test.ts` all pass after cleanup.
- **Dark & Light matte parity:** ensure every new miniature surface defines paired light Stone and dark Carbon tokens without hardcoded glaring whites or broken contrast.

---

### Task 1: Typed Homepage Content Contract & Invariant Tests

**Files:**
- Create: `client/src/components/landing/landingContent.ts`
- Test: `client/src/components/landing/landingContent.test.ts`

- [ ] **Step 1: Write the failing test (`landingContent.test.ts`)**

Test that `LANDING_NAV_LINKS`, `HERO_TRUST_PILLS`, `STUDIO_BENTO_CARDS`, `CARBON_SPOTLIGHT_SPECS`, and `FOOTER_POLICY_LINKS`:
1. Keep at most 2 concise top-level section anchors matching `#studio` and `#trust`.
2. Contain zero references to instant meeting, meeting code prompts (`cly-`, `Enter code`), or legacy sections (`#features`, `#architecture`, `#how-it-works`).
3. Define exactly 3 Slide 2 Bento cards (`video-stage`, `vector-canvas`, `room-vault`), each with a non-empty title (`<= 4` words) and caption (`<= 9` words).
4. Expose 3 footer notice links targeting `'Privacy'`, `'Terms'`, and `'Security'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=client`  
Expected: FAIL (`Cannot find module './landingContent.ts'`).

- [ ] **Step 3: Implement `landingContent.ts`**

Create strongly typed exported arrays and helper `countWords(text: string): number` satisfying all invariants.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=client`  
Expected: PASS (0 failed across client suite including `phase17Sprint01.test.ts`).

---

### Task 2: Slide 1 (`NavBar` & `HeroSection`) Editorial Redesign

**Files:**
- Modify: `client/src/components/landing/NavBar.tsx`
- Overwrite: `client/src/components/landing/HeroSection.tsx`

- [ ] **Step 1: Update `NavBar.tsx` navigation anchors**

Wire `navLinks` to `LANDING_NAV_LINKS` (`Studio` `#studio`, `Security` `#trust`) while keeping `ThemeToggle`, `Sign In` / `Get Started` (or `Dashboard` when signed in), and `MobileNavigationDrawer`.

- [ ] **Step 2: Redesign `HeroSection.tsx` cleanly**

Remove `meetingCode`, `handleCodeChange`, `handleJoinSubmit`, `Start Instant Meeting`, and the code-entry form. Replace props with `{ onPrimaryAction, onExploreStudio, isAuthenticated }`. Left column presents minimal overline, tight `Manrope` 2-line display headline, one concise sentence, dual CTAs (`Get Started` / `Open Workspace` + `Explore Studio`), and 3 hairline `HERO_TRUST_PILLS`. Right column renders an elevated **Matte Carbon Studio Preview** (`#1C1F24` frame / `#141619` interior) showing an active presenter tile with `#5FA399` voice ring & waveform beside a live synced **Shared Vector Sketch** tile and clean minimal control dock.

---

### Task 3: Slide 2 (`FeatureGrid`) UI-Miniature Bento Cards

**Files:**
- Overwrite: `client/src/components/landing/FeatureGrid.tsx`

- [ ] **Step 1: Build Slide 2 (`id="studio"`) 3-card Bento Grid**

Render 3 balanced desktop columns (`lg:grid-cols-3 gap-5`) driven by `STUDIO_BENTO_CARDS`:
- **Adaptive Video Stage:** miniature 2×2 conference grid (`AR`, `SL`, `MK`, `+12`), matte speaking outline, live equalizer bars, and crisp quality badge (`1080p · SFU`).
- **Vector Whiteboard:** miniature SVG dot-grid canvas with smooth Bezier vector spline, snapped wireframe nodes, tool rail, and dual labeled cursors (`Maya`, `Devon`).
- **Private Room Vault:** miniature session lock bar, signed shared file card (`Architecture_Spec.pdf · Signed`), and waiting-room host control (`Guest · Admit`).
Keep text strictly to each card's crisp title + `<= 8`-word caption with zero spec bullets.

---

### Task 4: Slide 3 (`ConversionBanner` & Minimal `Footer`) + `LandingPage` Composition

**Files:**
- Overwrite: `client/src/components/landing/ConversionBanner.tsx`
- Overwrite: `client/src/components/landing/Footer.tsx`
- Overwrite: `client/src/pages/LandingPage.tsx`
- Delete orphaned legacy files: `ArchitectureSpotlight.tsx`, `HowItWorksSection.tsx`, `SecurityTrustSection.tsx`

- [ ] **Step 1: Implement `ConversionBanner.tsx` (`id="trust"`)**

Cohesive matte Carbon spotlight card (`#1C1F24` border `#2B3038`) with subtle kicker, concise headline, 3 inline `CARBON_SPOTLIGHT_SPECS`, primary CTA (`Create Workspace` / `Open Workspace`), and secondary modal button (`Security Architecture` invoking `onOpenSecurityNotice`).

- [ ] **Step 2: Slim `Footer.tsx` to quiet single-row editorial bar**

Render single responsive row with CONNECTLY monogram/wordmark, copyright year, and `FOOTER_POLICY_LINKS` (`Privacy`, `Terms`, `Security`) invoking `onOpenNotice` so `PhaseNoticeModal` stays accessible.

- [ ] **Step 3: Compose 3-slide `LandingPage.tsx` and delete unused sections**

Render `NavBar` + `HeroSection` + `FeatureGrid` + `ConversionBanner` + `Footer` + `PhaseNoticeModal`. Delete `ArchitectureSpotlight.tsx`, `HowItWorksSection.tsx`, and `SecurityTrustSection.tsx`.

---

### Task 5: Full Verification, Git Push, and Live Platform Checks

- [ ] **Step 1: Run client & server checks**

Run: `npm run lint --workspace=client && npm run typecheck --workspace=client && npm test --workspace=client && npm run build --workspace=client && npm run typecheck --workspace=server`  
Expected: All commands exit 0 with zero errors or unused imports.

- [ ] **Step 2: Commit & push ONLY intended files to `origin/main`**

Stage explicitly (`docs/superpowers/...`, `client/src/components/landing/...`, `client/src/pages/LandingPage.tsx` — never `.env`, `.agents/`, `client/vite.config.js`, `client/.vite/`, `skills-lock.json`, `supabase/.temp/`), commit cleanly, and push to `origin/main`.

- [ ] **Step 3: Verify GitHub CI, Vercel live site, Render backend, and browser view**

Wait for GitHub Actions CI run on the new commit SHA (`conclusion: success`), verify `https://connectly-meet.vercel.app/` serves the updated bundle strings cleanly (`Studio`, `Explore Studio`, zero `Start Instant Meeting` / `Enter code`), verify Render `/health` + `/ready`, and refresh/check Chrome tab cleanly.
