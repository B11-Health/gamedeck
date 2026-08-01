<p align="center">
  <img src="assets/branding/gamedeck-mark-source.png" width="150" alt="GameDeck emblem">
</p>

<h1 align="center">GameDeck</h1>

<p align="center"><strong>Your legally owned game library, presented like the main event.</strong></p>

<p align="center">
  <a href="https://github.com/B11-Health/gamedeck/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/B11-Health/gamedeck/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-72e7ff"></a>
  <img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-9b8cff">
</p>

![GameDeck cinematic library](assets/branding/gamedeck-hero.png)

GameDeck is a cinematic, controller-first desktop launcher for local game collections. It scans files already on your machine, matches each title to a configured emulator, shows clear setup diagnostics, and keeps downloads or archive preparation visible without turning the interface into a file manager.

GameDeck does **not** include ROMs, BIOS files, encryption keys, or commercial game artwork. Bring only games and firmware you are legally entitled to use.

## Highlights

- One local-first library across Windows, macOS, and Linux
- Controller, keyboard, and mouse navigation
- RetroArch core discovery plus standalone DuckStation, PCSX2, PPSSPP, Dolphin, and Cemu routing
- Dedicated MAME and FinalBurn Neo catalog handling with pre-launch ROM-set health checks
- Full arcade names and local year, manufacturer, player, button, and control metadata from installed MAME
- Scoped Xbox/XInput arcade profiles that preserve global emulator settings
- BIOS-aware readiness checks with real setup locations
- Cinematic title details, artwork caching, favorites, and recent plays
- Shelf-first compact mode plus an optional large-format Cinematic view
- Collapsible systems rail and persistent title, recency, console, or size sorting
- Visible download, verification, extraction, speed, and ETA states
- RGSX integration when its optional local runtime is available
- Privacy-respecting community sponsor placements with a user opt-out
- Public donation addresses only; wallet secrets are never part of the app

## Install

Download the appropriate artifact from [Releases](https://github.com/B11-Health/gamedeck/releases):

- Windows: NSIS installer or portable `.exe`
- macOS: universal `.dmg` or `.zip` for Intel and Apple Silicon
- Linux: `.AppImage` or `.deb`

Early unsigned builds may trigger operating-system warnings. Production signing and Apple notarization are tracked in the [release guide](docs/CROSS_PLATFORM.md).

## Development

Requirements: Node.js 20 or newer, npm, and at least one supported emulator.

```bash
git clone https://github.com/B11-Health/gamedeck.git
cd gamedeck
npm ci
npm start
```

Useful commands:

```bash
npm test          # syntax, DOM contract, portability, and asset smoke checks
npm run pack      # unpacked app for the current OS
npm run dist:win  # Windows installer + portable build
npm run dist:mac  # universal macOS DMG + ZIP (run on macOS)
npm run dist:linux
```

GameDeck checks common emulator and library locations automatically. Open **Community → This device** to override the library, RGSX, RetroArch executable, cores, or system/BIOS paths. Path changes apply after restart.

### Arcade libraries

The Arcade Command Center verifies ZIP/7z integrity, uses native MAME verification for standalone-MAME titles, and blocks only the unsafe set instead of entering a download retry loop. Read the [arcade setup guide](docs/ARCADE.md) for compatible set layouts, BIOS/parent lookup, Xbox mappings, artwork folders, and troubleshooting.

### Keyboard shortcuts

- `/` focuses library or catalog search
- `Ctrl+B` toggles the systems rail
- `Ctrl+Shift+D` toggles Cinematic view
- Arrow keys move between systems and games; `Enter` launches the focused title
- <code>`</code> opens the activity console; `Escape` backs out or clears search

Environment overrides are also supported: `GAMEDECK_LIBRARY`, `GAMEDECK_RGSX_ROOT`, `GAMEDECK_EMULATION_ROOT`, `GAMEDECK_RETROARCH`, `GAMEDECK_RETROARCH_CORES`, `GAMEDECK_RETROARCH_SYSTEM`, `GAMEDECK_MAME`, `GAMEDECK_DUCKSTATION`, `GAMEDECK_PCSX2`, `GAMEDECK_PPSSPP`, `GAMEDECK_DOLPHIN`, and `GAMEDECK_CEMU`.

## Community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Check the [roadmap](ROADMAP.md) and [open issues](https://github.com/B11-Health/gamedeck/issues).
- Use the [arcade community launch kit](docs/COMMUNITY_LAUNCH.md) for evidence, screenshots, channel rules, and outreach sequencing.
- Report security problems privately using [SECURITY.md](SECURITY.md).
- See [FUNDING.md](FUNDING.md) and the transparent [sponsorship policy](docs/SPONSORSHIP.md).

GameDeck is not affiliated with Nintendo, Sony, Microsoft, Sega, Valve, RetroArch, or emulator projects referenced for compatibility. Product names belong to their respective owners.
