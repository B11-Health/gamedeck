# OpenBOR in GameDeck

GameDeck treats OpenBOR as a first-class local system. The Discover view reads the existing RGSX `OpenBOR (Archive)` catalog and downloads selected `.pak` files into `roms/openbor`. At launch, GameDeck prepares a persistent isolated session containing exactly the selected pack, then starts OpenBOR from that session so the intended game is selected deterministically.

## Engine discovery

GameDeck checks these locations in order:

1. `GAMEDECK_OPENBOR` environment variable.
2. Any `OpenBOR.exe` below the GameDeck user-data `runtime/openbor` directory.
3. `RGSX/emulators/openbor/OpenBOR.exe`.
4. The operating-system application path.

The Windows compatibility lane is currently validated with official OpenBOR v3.0 Build 6391. Pack compatibility still depends on the engine generation expected by each pack.

## Launch presentation and saves

On Windows, each isolated session receives a pack-specific OpenBOR configuration that requests native fullscreen-desktop rendering, preserves the game's aspect ratio, and uses the SDL renderer for legacy Build 6391 compatibility. GameDeck hands focus to the native game window, minimizes its own window while the game is active, and restores itself when OpenBOR exits. If native fullscreen cannot initialize, GameDeck leaves the engine's render surface untouched and centers the native window as a fallback.

The selected `.pak` is normally hard-linked into the session, so the game is not duplicated. GameDeck falls back to copying only when the file system cannot create a hard link. Per-game OpenBOR settings and controller mappings persist in that game's session, while GameDeck re-enforces only the presentation fields needed for reliable fullscreen and aspect preservation.

## Transfer safety

RGSX writes direct game files into their final library folder while downloading. GameDeck excludes any file associated with a running managed transfer from library scans and catalog installation checks. A direct launch request for that path is rejected until the transfer completes.

## Multiplayer

OpenBOR is currently a local standalone-engine route. It is not part of GameDeck's verified synchronized Libretro netplay set. Local multiplayer supported by an individual OpenBOR pack remains available through the engine itself.
