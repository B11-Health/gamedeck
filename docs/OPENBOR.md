# OpenBOR in GameDeck

GameDeck treats OpenBOR as a first-class local system. Discover reads the RGSX `OpenBOR (Archive)` catalog and installs selected `.pak` files into `roms/openbor`.

## Engine discovery

GameDeck checks these locations in order:

1. `GAMEDECK_OPENBOR` environment variable.
2. Any `OpenBOR.exe` below the GameDeck user-data `runtime/openbor` directory.
3. `RGSX/emulators/openbor/OpenBOR.exe`.
4. The operating-system application path.

The Windows compatibility lane is validated with official OpenBOR v3.0 Build 6391. Pack compatibility still depends on the engine generation expected by each pack.

## Per-game launch contract

Legacy OpenBOR 3.0 does not reliably load an arbitrary absolute pack path from its command line. GameDeck therefore creates a stable per-game session directory under user data:

- `openbor-games/<game-key>/Paks`
- `openbor-games/<game-key>/Saves`
- `openbor-games/<game-key>/Logs`
- `openbor-games/<game-key>/ScreenShots`

Exactly one pack is staged in `Paks`, retaining its original filename. GameDeck uses a hard link when possible and copies only when linking is unavailable. A manifest tracks the source path, size, and modification time so unchanged packs are reused safely. OpenBOR starts with the session directory as its working directory and no pack argument. The runtime log must identify the staged pack before the route is considered ready.

This prevents the generic OpenBOR menu from appearing instead of the selected game and keeps saves/logs isolated per title.

## GameDeck Play

OpenBOR uses the same Play Session surface as managed console cores:

- **Docked** inside GameDeck at a centered 4:3 viewport.
- **Fullscreen** with hidden controls that appear at the top edge; Escape returns to Docked.
- **Pop out** to the native game-titled window; F10 returns to GameDeck.

GameDeck removes native window chrome while Docked or Fullscreen and restores a centered native window for Pop out. Only one owned OpenBOR process may exist. The engine supplies the single audio path; GameDeck captures video only, preventing doubled sound.

## Transfer safety

RGSX writes direct game files into their final library folder while downloading. GameDeck excludes files associated with running managed transfers from scans and catalog installation checks. A direct launch request for an active transfer is rejected until the job completes.

## Multiplayer

OpenBOR is not part of GameDeck's synchronized Libretro netplay set. Local multiplayer supported by an individual pack remains available through the engine itself.
