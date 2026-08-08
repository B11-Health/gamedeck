# Libretro API notice

GameDeck implements its own libretro frontend. It does **not** vendor the RetroArch frontend.

Vendored file:

- `mobile/android/app/src/main/cpp/include/libretro.h`
- Upstream: `libretro/libretro-common`
- Upstream revision: `5c01bc2b6efc5d565107f8e1eebbd967c3c59465`
- License: MIT, as stated in the header itself.

RetroArch is GPLv3 and is used only as an architectural reference during development. No
RetroArch GPL source is copied into the GameDeck native host. Individual libretro cores have
their own licenses and must be reviewed before GameDeck redistributes their binaries.
