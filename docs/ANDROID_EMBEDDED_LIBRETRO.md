# GameDeck embedded libretro runtime

GameDeck Android is migrating from launching the separately installed RetroArch application to
an in-process GameDeck frontend that implements the MIT-licensed libretro API.

## Licensing boundary

- GameDeck remains MIT.
- `libretro.h` is MIT and is vendored with its license notice intact.
- RetroArch is GPLv3 and is not copied into this frontend.
- Every core is a separate work with its own license. A core may only be bundled after its exact
  source revision, license, notices, and redistribution requirements are recorded.

## Current native host

The native host dynamically loads an ARM64 libretro core from GameDeck private storage and owns:

- core lifecycle and ABI validation;
- software video frames (`0RGB1555`, `RGB565`, `XRGB8888`) through `ANativeWindow`;
- stereo PCM through a native ring buffer and Android `AudioTrack`;
- physical controller and touch-to-RetroPad input;
- system/save directories and persistent save RAM;
- core variable defaults, logging, geometry changes, and clean shutdown.

Hardware-rendered cores that require OpenGL/Vulkan are deliberately rejected by the first host.
They remain on the compatibility fallback until GameDeck implements the libretro hardware render
callback and context lifecycle.

## Rebuilding the native library

```bash
bash scripts/build-android-libretro-host.sh
```

The script supports Termux clang directly and the official Android NDK on CI hosts. The packaged
library is 16 KiB page-size compatible for current Android devices.
