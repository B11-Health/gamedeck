# GameDeck Android standalone foundation

This module is the Android platform adapter for GameDeck. It is intentionally built around the repository's existing product contracts rather than as an unrelated mobile launcher.

## Current vertical slice

The `0.2.0-alpha` foundation provides:

- a bundled, local-first GameDeck shell that opens without a desktop host;
- Android Storage Access Framework folder selection with persisted, folder-scoped access;
- an on-device library scanner using the same GameDeck system IDs, folder aliases, file extensions, and core labels as desktop;
- controller-first navigation for D-pad, analog stick, A/B/X/Y, Start, Select, and shoulder buttons;
- the existing GameDeck Live LAN receiver as a separate Remote surface;
- truthful runtime classification: `integrated_external` when an installed RetroArch package is detected, otherwise `blocked` with `android_embedded_runtime_pending`;
- optional, read-only RGSX catalog detection without making RGSX a dependency for normal library browsing.

This slice does **not** claim that Android has reached desktop parity. The APK does not yet bundle an embedded libretro host, verified core set, firmware repair adapter, RGSX transfer process, or direct `GDREMOTE2` guest adapter.

## Contract mapping

The WebView exposes an Android-backed subset of the desktop `window.deck` interface:

| Contract | Android foundation |
| --- | --- |
| `library()` / `rescan()` | Secure document-tree scan and GameDeck system classification |
| `favorite()` | Local Android preferences |
| `launch()` | Truthful experimental external route or a stable blocked reason |
| `runtimeStatus()` | Android platform/runtime components and reason code |
| `chooseDirectory()` | Storage Access Framework picker |
| RGSX status | Optional local catalog inspection only |
| GameDeck Live | Existing LAN host URL loaded in the receiver WebView |

No game, BIOS, save, key, library inventory, or private path is uploaded by this module.

## Architecture boundaries

- `SystemRegistry` mirrors desktop IDs and routes but does not guess when a file extension is ambiguous.
- `LibraryRepository` reads only the user-selected tree URI and caps one scan at 5,000 recognized files and 16 directory levels.
- `AndroidRuntimeManager` distinguishes embedded, external, and blocked routes. An installed external app is never reported as verified embedded support.
- `RgsxProvider` inspects `systems_list.json` from a user-selected RGSX tree. Downloads, BIOS restoration, and repair remain disabled until a native adapter has independent evidence.
- `MainActivity` owns Android intents, lifecycle, controller input, and switching between the local shell and GameDeck Live receiver.
- `DeckBridge` is the narrow platform boundary presented to bundled JavaScript.

## Planned bounded slices

1. Pure Android readiness and route model aligned to the approved GameDeck Runtime contract.
2. Embedded libretro host with one verified core and one homebrew fixture.
3. Signed, checksum-pinned Android core bundle and first-launch provisioning.
4. RGSX native transfer/repair adapter with resumable state and local-only data boundaries.
5. `GDREMOTE2` WebRTC guest adapter using the existing invite, expiry, media, and RetroPad input contracts.
6. Exact-match synchronized netplay and evidence-backed compatibility tuples.
7. Android CI, signed APK/AAB output, clean-device installation, controller walkthrough, and release checksums.

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

GameDeck does not include commercial games, copyrighted firmware, encryption keys, or commercial artwork. Users must provide only files they are legally entitled to use. RGSX remains optional and must preserve the same ownership, provider, and privacy boundaries as desktop GameDeck.
