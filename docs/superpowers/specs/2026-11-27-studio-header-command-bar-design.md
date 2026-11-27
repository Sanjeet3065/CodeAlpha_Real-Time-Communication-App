# Studio Header & Command Search Bar — Design Spec

**Date:** 2026-11-27
**Status:** Approved (`start kro`)

## Intent
Optimize the dashboard top bar (`DashboardHeader`) to look cohesive, balanced, and studio-grade in both dark matte (`#1C1F24`) and light warm-alabaster (`#FAF9F6`) themes, while turning the header search input into an actually useful command & meeting finder.

## What Changes
1. **Spacious `h-10` Command Search Bar (`DashboardHeader` + `headerCommandSearch.ts`)**
   - Center the search input (`h-10`, `rounded-xl`, `max-w-lg`) between left page title and right utility dock with crisp matte contrast and teal focus ring.
   - Replace stale `"Search meetings, files, and actions..."` copy with `"Search meetings, room code, or action..."`.
   - Show an OS-appropriate shortcut keycap (`Ctrl K` on Windows/Linux, `⌘K` on macOS) and a Clear (`×`) button when text is entered.
   - Power the dropdown via pure helper functions (`buildHeaderSearchResults`, `extractMeetingCodeFromSearch`) supporting:
     - **Direct Join (`Join Room`):** detects `cly-xxx-xxx` codes or invite URLs via `validateMeetingCode` for 1-click lobby entry.
     - **Live Meeting Lookup (`Meetings`):** fetches & caches upcoming scheduled meetings and recent (48h) calls when search opens (30s TTL cache, graceful silent fallback on error) — upcoming navigates to `/lobby/:code`, recent history navigates to `/meetings`.
     - **Grouped Actions & Navigation:** crisp rows grouped under `Join Room`, `Meetings`, `Actions`, and `Navigation` without noisy divider clutter.
2. **Cohesive `h-10` Right Utility Bar (`ThemeToggle`, `Help`, `Notifications`, `AccountMenu`)**
   - Unify `ThemeToggle`, `Help`, and `NotificationsPopover` inside a single `h-10` studio utility dock (`p-1 rounded-xl`) with matching `h-8` controls so icon buttons no longer look disconnected next to a bordered `Auto` pill.
   - Align `AccountMenu` trigger pill to `h-10` with subtle border, `w-7 h-7` accent avatar, truncated display name, and chevron.
   - Fix dark-mode contrast defects in `NotificationsPopover` (ring around unread badge + count pill) and `HelpModal` (security banner).

## Non-Goals / Constraints
- Preserve existing accessibility attributes (`role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-label` contracts on all controls).
- Preserve `ThemeToggle` `compact` and `segmented` variants on Auth/PreJoin/Settings pages.
- No server-side changes or new dependencies.
