# GameDeck Android

This module packages GameDeck's shared desktop renderer with an Android platform bridge. The Android UI is not a separate reduced product: Library, Discover, Community, metadata, artwork, favorites, recents, downloads, and responsive presentation use the same renderer contracts as desktop.

## Current development build

`0.4.5-console` includes:

- portrait and landscape layouts designed independently for phones;
- GPU-composited WebView rendering and a reduced-effects mobile performance profile;
- complete browseable public title indexes in Discover, with lawful local imports kept separate from verified downloads;
- one-time verified GameDeck Console provisioning followed by direct one-tap title launch;
- automatic per-system core selection, verified core downloads, and reusable local game staging;
- persistent compact navigation and Android safe-area handling;
- local library scanning through the Storage Access Framework;
- adjacent artwork and JSON metadata discovery;
- an automatic managed Discover provider with one-tap **Get** installation for lawful catalog entries;
- persistent native download jobs with queued, running, progress, verify, complete, paused, retry, and error states;
- a private managed library exposed to compatible game engines through a read-only content provider;
- controller-first spatial navigation with D-pad and analog input;
- A select, B back, X favorite, Y details, L1/R1 tab switching, L2/R2 paging, Start multiplayer, and Select menu;
- held-direction repeat timing, visible controller focus, controller hints, pressed-state animation, and native haptic feedback;
- touch targets and active feedback tuned separately from controller focus;
- GameDeck Live preserved as a separate remote receiver route.

RGSX remains an internal provider. Users do not select an RGSX folder or configure the provider.

## Runtime boundary

The Android app can browse, install, organize, and expose managed content. A compatible external RetroArch package is currently the only launch route. The embedded libretro host, verified Android core set, firmware provisioning, direct `GDREMOTE2` guest mode, and synchronized netplay remain separate implementation gates.

GameDeck does not bundle commercial games, copyrighted firmware, encryption keys, or unauthorized download sources. Managed catalog entries must be homebrew, public-domain, freely redistributable, or supplied through a user-authorized lawful source.

## Fast Termux workflow

The recommended iteration loop is on-device Termux, using one stable debug keystore and wireless ADB to reinstall the app without cloud-build signature conflicts.

From the repository root:

```bash
cd mobile/android
bash termux/setup.sh
source "$HOME/.config/gamedeck/android-env.sh"
bash termux/dev.sh install-run
```

`setup.sh` installs Java 17, Gradle, native ARM64 `aapt2`, Android tools, Android SDK 36, and a stable debug keystore. It patches the SDK build-tools directory to use Termux-native Android binaries.

Pair wireless ADB once from Android **Developer options → Wireless debugging**:

```bash
adb pair 127.0.0.1:PAIRING_PORT
adb connect 127.0.0.1:DEBUG_PORT
```

The ports change whenever wireless debugging is restarted. After pairing, the normal commands are:

```bash
bash termux/dev.sh build
bash termux/dev.sh install-run
bash termux/dev.sh qa
bash termux/dev.sh logs
bash termux/dev.sh watch
```

`install-run` performs an incremental build, replaces the existing debug app, and launches it. `qa` captures portrait and landscape screenshots, window focus, package state, APK checksum, and logcat evidence. `watch` rebuilds and relaunches whenever Android or shared renderer files change.

Without wireless ADB, `install` opens the Android Package Installer as a fallback.

## Desktop build environment

Requirements:

- JDK 17 or newer
- Android SDK 36
- Gradle 9.6 or compatible environment

```bash
cd mobile/android
gradle :app:assembleDebug
```

The APK is generated at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Validation gates

Pull-request validation includes:

- clean API 36 installation and cold launch;
- renderer-ready and crash scanning;
- portrait and landscape visual screenshots;
- verified Library, Discover, Community, scrolling, and overflow-menu states;
- real Discover **Get** activation through the rendered button, managed-file checksum verification, and persistence after restart;
- controller focus visibility, spatial movement, L1/R1 navigation, Select menu, B back, and landscape retention.

The QA fixture is activated only by a marker inside the debuggable app's private sandbox and is inactive for normal installations.
