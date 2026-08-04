# OpenBOR in GameDeck

GameDeck treats OpenBOR as a first-class local system. The Discover view reads the existing RGSX `OpenBOR (Archive)` catalog, downloads selected `.pak` files into `roms/openbor`, and launches each pack by passing its absolute path directly to OpenBOR.

## Engine discovery

GameDeck checks these locations in order:

1. `GAMEDECK_OPENBOR` environment variable.
2. Any `OpenBOR.exe` below the GameDeck user-data `runtime/openbor` directory.
3. `RGSX/emulators/openbor/OpenBOR.exe`.
4. The operating-system application path.

The Windows compatibility lane is currently validated with official OpenBOR v3.0 Build 6391. Pack compatibility still depends on the engine generation expected by each pack.

## Transfer safety

RGSX writes direct game files into their final library folder while downloading. GameDeck excludes any file associated with a running managed transfer from library scans and catalog installation checks. A direct launch request for that path is rejected until the transfer completes.

## Multiplayer

OpenBOR is currently a local standalone-engine route. It is not part of GameDeck's verified synchronized Libretro netplay set. Local multiplayer supported by an individual OpenBOR pack remains available through the engine itself.
