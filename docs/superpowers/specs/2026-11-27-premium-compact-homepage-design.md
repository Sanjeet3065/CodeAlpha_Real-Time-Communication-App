# CONNECTLY Premium Compact Homepage Design Specification

**Date:** 2026-11-27  
**Route:** `/` (`LandingPage` and `client/src/components/landing/*`)  
**Status:** Approved by user (`ok`)

## 1. Design Objectives

1. **Compact 3-Slide Vertical Cadence:** Reduce `/` from ~5,881px (6 verbose sections + large 5-column footer) to **~1,900px–2,250px** (2–3 desktop viewports) while preserving breathing room and clear editorial hierarchy.
2. **Remove Instant-Meeting & Join-Code Controls from Homepage:** Remove the `Start Instant Meeting` button and the `Enter code (cly-xxx-xxx) | Join` input bar from the public Hero section. Keep `/dashboard` and `/join/:code` flows completely untouched for authenticated and direct-link workflows.
3. **Visual-First Bento Cards (Zero Text Walls):** Replace text-heavy spec cards with bespoke **UI miniature preview cards** (Adaptive Video Stage, Collaborative Vector Canvas, Private Room Vault) paired only with a crisp title and a concise 5–8 word caption.
4. **Strict Stone & Carbon Matte Parity:** Maintain light (`#F3F2EE` / `#FAF9F6` / `#2F6F68` / `#DDDAD0`) and dark (`#141619` / `#1C1F24` / `#5FA399` / `#2B3038`) matte palettes via `ThemeToggle` with zero neon glows, gradient text, or `backdrop-blur`.

## 2. Three-Slide Architecture

| Slide | Component | Anchor | Purpose & Visual Composition |
| :--- | :--- | :--- | :--- |
| Header | `NavBar` | — | Sticky top bar with logo, concise 2-link nav (`Studio` `#studio`, `Security` `#trust`), `ThemeToggle`, `Sign In`, and `Get Started` (or `Open Workspace` when signed in). Retains `MobileNavigationDrawer`. |
| **Slide 1** | `HeroSection` | Top | Editorial asymmetric split: concise overline, clean `Manrope` 2-line display headline, 1-sentence subtitle, dual CTAs (`Get Started` / `Open Workspace` + `Explore Studio`), and 3 hairline trust specs on the left; an interactive-looking **Matte Carbon Studio Preview** (live speaker ring, waveform bars, synced mini vector canvas tile, minimal pill dock) on the right. |
| **Slide 2** | `FeatureGrid` | `#studio` | **3-Card UI-Miniature Bento Grid**: (1) **Adaptive Video Stage** miniature 2×2 grid + quality badge; (2) **Vector Whiteboard** miniature SVG curves + snapped node wireframe + dual named cursors; (3) **Private Room Vault** miniature signed file card + waiting-room host `Admit` control. Concise heading + <=8-word captions only. |
| **Slide 3** | `ConversionBanner` + `Footer` | `#trust` | Single cohesive dark **Carbon Spotlight CTA card** (`Create Workspace` / `Open Workspace` + `Security Brief` modal trigger) with 3 crisp architectural specs (`DTLS-SRTP Encrypted`, `60-Peer Adaptive SFU`, `Zero Third-Party Trackers`), followed seamlessly by a quiet single-row footer (`CONNECTLY`, copyright, and `Privacy · Terms · Security` buttons wired to `PhaseNoticeModal`). |

## 3. Data & Component Contracts

- Pure landing copy and anchor metadata live in `client/src/components/landing/landingContent.ts` so they remain strongly typed, verifiable via `node --test`, and consistent across `NavBar`, `HeroSection`, `FeatureGrid`, `ConversionBanner`, and `Footer`.
- Legacy verbose sections (`ArchitectureSpotlight.tsx`, `HowItWorksSection.tsx`, `SecurityTrustSection.tsx`) have no external callers outside `LandingPage.tsx` and are removed so the bundle stays lean and free of dead code.
- `PhaseNoticeModal.tsx` remains fully preserved and accessible (`role="dialog"`, Escape/Tab focus management) for footer legal/security notices and the Slide 3 security brief.
