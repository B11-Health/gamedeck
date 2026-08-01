# Changelog

All notable GameDeck releases are documented here.

## [Unreleased]

- Added a zero-hassle ready check for game-library, emulator, artwork, and controller status with direct setup actions.
- Added a controller-friendly **Surprise me** action for selecting a random playable game from the current shelf.
- Added manual cover correction and one-click metadata refresh from the selected-game spotlight.
- Fixed persisted artwork cache discovery when cleaned titles differ from original ROM filenames.
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
