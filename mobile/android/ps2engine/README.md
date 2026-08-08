# GameDeck embedded PlayStation 2 engine

This Android library embeds the ARM64 PCSX2-derived engine from ARMSX2 2.6.6.4 inside the GameDeck APK. It is not installed or launched as a second application.

The module contains:

- ARM64 4 KB and 16 KB page-size native cores
- The required shader and game-database resources
- The standard SDL Android input/audio bridge
- A small GameDeck-owned Java facade
- GPLv3 license and corresponding-source information

GameDeck owns the player-facing activity, preparation flow, controller presentation, dependency orchestration, and exit behavior. ARMSX2 setup, library, and navigation screens are not included in the launch experience.

No game images or proprietary console firmware are bundled in this module.
