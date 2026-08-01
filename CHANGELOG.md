# Changelog

All notable GameDeck releases are documented here.

## [Unreleased]

- Added a one-click launch doctor that installs missing shared arcade dependencies, validates available routes, and automatically resumes the original launch.

- Added managed repair-on-play for damaged arcade archives with an exact RGSX source, including re-audit and automatic relaunch.

- Added ordered-token artwork matching and premium GameDeck-original fallback posters for titles without a trustworthy source cover.

- Validated Saturn `.m3u` members before launch and kept automation sessions alive when the visible window is closed.

- Added cached official thumbnail directory indexes and safe cross-repository matching for translated, abbreviated, and neighboring-console filenames.

- Split exact filename artwork identity from clean metadata identity, added revision/region aliases, the official Libretro CDN, and throttled background cover enrichment.

- Changed Library and Discover cards to preview on single click and act only through Play, Enter/A, or double-click; corrected nested-control semantics.

- Added actionable Ready and Needs Attention transfer states, issue routing, library focus, and dismissible finished items.

- Replaced the raw Activity log with a structured Status Center, issue/success filters, grouped repeats, and copyable diagnostics.

- Added a clear-search affordance and immediate refresh/scanning feedback in the global header.

- Added live path health, device-readiness summaries, and accurate unsaved-change states to Community settings.

- Added an input-aware control legend, controller-mode focus feedback, and clear Favorites terminology throughout the library.

- Replaced the rotating loading spinner with a calm four-stage startup panel for library, launcher, artwork, and control readiness.
- Added context-aware hero actions that continue the latest playable game, choose a surprise title, or open setup when needed.
- Added immediate opening-state feedback on game cards and a visible metadata-source badge in the selected-game spotlight.
- Added Satellaview `.bs` ROM discovery and more resilient installed-game matching for catalog entries that include paths.
- Library shelves now remember focused titles and scroll position when switching views or consoles.
- Added per-console Discover memory, cached catalog switching, title-state filters, installed counts, and source-aware feature details.
- Added a zero-hassle ready check for game-library, emulator, artwork, and controller status with direct setup actions.
- Added a controller-friendly **Surprise me** action for selecting a random playable game from the current shelf.
- Added manual cover correction and one-click metadata refresh from the selected-game spotlight.
- Fixed persisted artwork cache discovery when cleaned titles differ from original ROM filenames.
- Added a persistent **Missing artwork** library filter so incomplete covers are easy to find and repair.
- Removed a duplicate full-library scan during startup and made UI captures wait for explicit renderer readiness.
- Fixed settings precedence so explicit `GAMEDECK_*` environment variables now reliably override saved paths.
- Added local JSON sidecar metadata support for complete descriptions, release details, genre, developer, publisher, rating, and player counts.
- Expanded artwork discovery across adjacent images, artwork, boxart, covers, and media folders using both filename and cleaned title matches.
- Added a prominent in-app support rally with one-click donation-address copy, sponsorship inquiry, and funding transparency actions.
- Added an Arcade Command Center for MAME and FinalBurn Neo with verified, attention, artwork, and controller status at a glance.
- Added cached ZIP/7z integrity checks and native MAME `-verifyroms` validation, with exact launch blocking for damaged or incomplete sets.
- Added full arcade title and machine metadata from the installed MAME database.
- Added standalone MAME discovery and launch routing for current sets, while retaining compatible RetroArch-core fallbacks.
- Added a scoped RetroArch XInput profile for two Xbox controllers and Windows MAME `winhybrid` input routing.
- Added local MAME flyer, snapshot, title, cabinet, and marquee artwork matching plus priority artwork loading for arcade shelves.
- Added an in-app arcade readiness community update, setup guide, and policy-aware community launch kit.

## 1.1.0 — 2026-07-31

- Added a shelf-first compact layout that exposes complete game and catalog rows at common laptop sizes.
- Preserved the original large-format presentation as a persistent Cinematic mode.
- Added a collapsible systems rail with remembered state and icon-only navigation.
- Added persistent sorting by title, recent play, console, or file size with live result counts.
- Added tailored empty states for search, favorites, recent plays, individual consoles, and new libraries.
- Improved keyboard behavior, active-view semantics, skip navigation, focus handling, and minimum-window responsiveness.
- Added configurable capture dimensions for repeatable desktop UI regression checks.

## 1.0.1 — 2026-07-31

- Enabled the public EVM donation card for Ethereum, Base, and Polygon.
- Added visible network labeling and one-click address copying.
- Added automated checks that reject secret wallet fields from public donation configuration.
- Kept all wallet secrets and encrypted keystore material outside the repository and application bundle.

## 1.0.0 — 2026-07-31

- First official cross-platform GameDeck release for Windows, macOS, and Linux.
- Added the cinematic library, emulator diagnostics, RGSX integration, sponsor framework, community settings, and release automation.
