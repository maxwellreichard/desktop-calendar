# Changelog

All notable changes to this project will be documented in this file.

---
## [0.4.0] - 2026-05-28

### Added
- **Recurring events** — daily, weekly, monthly, yearly, and custom interval patterns
  - End conditions: forever, end on date, or end after X occurrences
  - Edit/delete just this occurrence or all future occurrences
- **Multi-day events** — set a start and end date on any event
  - Shows `→` on start day and `←` on end day in month and week views
  - Multi-day events appear at the top of the event list
- **Today button** — appears in the nav when viewing a different month, jumps back to current month
- **Holidays** — auto-populated federal holidays for US, Canada, UK, and Australia
  - Toggle countries on/off from the right-click context menu
  - Holidays appear at the bottom of the event list
- **Gruvbox themes** — replaced Dark and Warm themes with Gruvbox Dark and Gruvbox Light Hard

### Fixed
- Context menu now uses smart positioning to avoid clipping at window edges
- Context menu now respects the active theme
- Event pill truncation in month view
- Google Calendar event pills now theme-aware in dark mode

---

## [0.2.0] - 2026-05-21

### Added
- **Google Calendar sync** — full read/write integration via OAuth 2.0
  - Connect/disconnect Google account from context menu
  - Events pulled from Google Calendar displayed as blue pills
  - Create, edit, and delete events sync back to Google Calendar
  - Token refresh handled automatically
  - Local OAuth callback server built into Rust backend
- **Color themes** — four themes with full CSS variable system
  - Default (warm off-white)
  - Dark
  - Warm
  - Cool
  - Theme persists across sessions via localStorage
- **Right-click context menu** on drag handle
  - Theme switcher with visual dots
  - Launch on startup toggle
  - Always on top toggle
  - Google Calendar connect/disconnect + sync now
  - About section with version number
  - Close app
- **Window position memory** — app reopens in the same position
- **Launch on Windows startup** via `tauri-plugin-autostart`
- **Version bump script** — `scripts/bump-version.ps1` updates version in all files, commits, tags, and pushes to GitHub
- **Drag handle** — pill-shaped handle at top center replaces full-window drag

### Changed
- Removed acrylic/vibrancy effect in favor of solid warm off-white background for consistency
- Window starts hidden and fades in after position is restored (no jump)
- Removed `+ event` button from week view — events managed exclusively in day view
- Event pills now truncate with ellipsis when text is too long
- `always on top` enabled by default in `tauri.conf.json`

### Fixed
- Calendar grid day alignment with correct spacer handling
- Window resize animation now guards against null/NaN values
- Google event pill colors now theme-aware via CSS variables
- Duplicate pill CSS rules cleaned up

---

## [0.1.1] - 2026-05-20

### Added
- Version tagging and GitHub push via bump script

---

## [0.1.0] - 2026-05-19

### Added
- Initial release
- Month view calendar with prev/next navigation
- Week view with notes textarea per day
- Day view with to do list, notes, and inline event editor
- Three event types: Personal, Work, Reminder
- Click day → week view, Shift+click → day view
- Shift+click day number in week view → day view
- Smooth fade transitions between views
- Dynamic window resize when switching views
- Events and notes persist via localStorage
- Frameless transparent window with `decorations: false`
- Custom app icon
- Packaged as `.exe` installer and `.msi`
- GitHub repository at https://github.com/maxwellreichard/desktop-calendar
