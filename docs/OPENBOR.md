# OpenBOR in GameDeck

GameDeck treats OpenBOR as a first-class local system. Discover reads the RGSX `OpenBOR (Archive)` catalog and installs selected `.pak` files into `roms/openbor`. Play normally opens a GameDeck-owned session with Docked, Fullscreen, and Pop-out presentation. If integrated capture is unavailable, GameDeck falls back to the deterministic isolated native fullscreen route rather than launching an arbitrary pack path.

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

## Launch presentation and saves

On Windows, each isolated session receives a pack-specific OpenBOR configuration that requests native fullscreen-desktop rendering, preserves the game's aspect ratio, and uses the SDL renderer for legacy Build 6391 compatibility. GameDeck hands focus to the native game window, minimizes its own window while the game is active, and restores itself when OpenBOR exits. If native fullscreen cannot initialize, GameDeck leaves the engine's render surface untouched and centers the native window as a fallback.

The selected `.pak` is normally hard-linked into the session, so the game is not duplicated. GameDeck falls back to copying only when the file system cannot create a hard link. Per-game OpenBOR settings and controller mappings persist in that game's session, while GameDeck re-enforces only the presentation fields needed for reliable fullscreen and aspect preservation.

## Transfer safety

RGSX writes direct game files into their final library folder while downloading. GameDeck excludes files associated with running managed transfers from scans and catalog installation checks. A direct launch request for an active transfer is rejected until the job completes.

## Multiplayer

OpenBOR is not part of GameDeck's synchronized Libretro netplay set. Local multiplayer supported by an individual pack remains available through the engine itself.
