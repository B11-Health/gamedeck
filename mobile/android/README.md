# GameDeck Android desktop-parity preview

This module is the Android platform adapter for GameDeck. Android packages the repository's shared desktop renderer (`src/index.html`, `src/app.js`, `src/styles.css`, streaming, netplay, branding, and system-theme assets) rather than maintaining a separate reduced product UI.

## Current preview

The `0.3.1-parity-preview` provides:

- the same Library, Discover, Multiplayer, Activity, and System renderer used by desktop GameDeck;
- Android Storage Access Framework folder selection with persisted, folder-scoped access;
- local scanning with the same system IDs, aliases, extensions, labels, favorites, and recent-play model;
- local cover-art discovery from adjacent files and common `images`, `artwork`, `boxart`, `covers`, and `media` folders;
- local JSON metadata sidecars for descriptions, release dates, years, genres, players, ratings, developers, publishers, regions, and editions;
- automatic artwork and Discover catalog lookup through GameDeck's internal Libretro-thumbnail provider mapping, without exposing provider setup to users;
- responsive phone, tablet, landscape, touch, keyboard, and controller presentation around the shared desktop renderer;
- the existing GameDeck Live LAN receiver as a separate Remote route;
- truthful runtime classification: `integrated_external` when a compatible RetroArch package is detected, otherwise `blocked` with `android_embedded_runtime_pending`.

## Desktop contract mapping

Android supplies a native-backed `window.deck` platform adapter to the shared renderer:

| Desktop contract | Android implementation |
| --- | --- |
| `library()` / `rescan()` | Secure document-tree scan, system classification, artwork, metadata, favorites, and recents |
| `artwork()` | Local artwork first, then automatic provider lookup |
| `gameDetails()` | Local sidecar metadata with truthful local fallback copy |
| `catalogSystems()` / `catalogGames()` | Automatic Discover catalog and installed-title matching |
| `favorite()` | Android preferences with full-library refresh |
| `launch()` | Truthful experimental external route or stable blocked reason |
| `runtimeStatus()` | Android runtime components and reason code |
| `chooseDirectory()` | Android system folder picker |
| GameDeck Live | Existing LAN host URL loaded in the receiver WebView |

No game, BIOS, save, key, library inventory, or private path is uploaded by this module. Online artwork/catalog requests contain only public system/title identifiers.

## Explicit limitations

Shared renderer parity does not imply runtime parity. This preview does not yet bundle:

- an embedded libretro host or signed Android core set;
- firmware provisioning or managed repair transfers;
- direct `GDREMOTE2` WebRTC guest signaling and RetroPad input;
- exact-match synchronized netplay;
- production signing or Play-distribution AAB output.

Unsupported controls remain visible only where required by the shared renderer and return stable, truthful Android reason codes.

## Validation

The Android workflow builds the exact pull-request revision, installs it on a clean API 36 emulator, completes the full desktop startup transition, and uses a private debug-only fixture to verify that the renderer displays a title, cover artwork, description, year, and genre. The fixture is activated only by a marker inside the debuggable app's private sandbox and is inactive for normal users.

## Build

Requirements:

- JDK 17 or newer
- Android SDK 36
- Gradle 9.6 or compatible wrapper environment

```bash
cd mobile/android
gradle :app:assembleDebug
```

The debug APK is generated under `app/build/outputs/apk/debug/`.

## Legal and trust boundary

GameDeck does not include commercial games, copyrighted firmware, encryption keys, or commercial artwork. Users must provide only files they are legally entitled to use. Discovery providers remain internal implementation details and must preserve the same ownership, privacy, and guest-isolation boundaries as desktop GameDeck.
