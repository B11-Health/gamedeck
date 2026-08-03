# GameDeck Embedded Play Compatibility Certification Matrix

Status: Phase 1 certification plan
Branch: `qa/embedded-play-compatibility`
Base: `0fa427b3816d531658c30736c6b6054a8dedc5fc`
Owner: Compatibility Lab / Universal Game Integration

Scope: evidence and certification only. This document changes no launch, capture, input, runtime, support claim, or public surface.

## 1. Certification rule

GameDeck certifies an exact tuple, never an emulator brand in the abstract:

`engine build + core/route + OS/session type + graphics path + controller class + presentation mode + audio result + multiplayer mode`.

An untested tuple is **Unknown**, never implicitly compatible. A route becomes **Embedded verified** only after every mandatory platform and reliability gate for that tuple passes. Evidence labels:

- **Hard evidence:** behavior or configuration directly present in source, or a result explicitly recorded by committed QA.
- **Proposed:** the certification policy or adapter behavior required by this plan.
- **Assumption:** a reasonable expectation not yet supported by a live run.
- **Unknown:** requires live testing and cannot support a compatibility claim.

The architecture requires a GameDeck-owned play surface, truthful external fallback, explicit failure states, post-launch source discovery, bounded input, and separate local capture and Remote Play states (`docs/EMBEDDED_PLAY.md:7-23`, `docs/EMBEDDED_PLAY.md:25-54`, `docs/EMBEDDED_PLAY.md:70-84`, `docs/EMBEDDED_PLAY.md:123-150`).

## 2. Support-tier summary

| Route | Proposed Phase 1 tier | Phase 1 ceiling | Primary blocker |
|---|---|---|---|
| Managed RetroArch/libretro | **Embedded verified candidate** | Exact Windows tuples may pass; global verification still requires macOS, X11, and Wayland | Play-session manager and embedded evidence do not yet exist |
| User-installed RetroArch | **Integrated external** | External launch only in Phase 1; a future experimental adapter requires separate explicit certification | GameDeck cannot assume configuration, input, window, version, or lifecycle ownership |
| Standalone MAME | **Integrated external** | Integrated external | No GameDeck-owned input sink or lifecycle-owned adapter |
| Dolphin | **Integrated external** | Integrated external | No safe input sink; motion/pointer classes unresolved |
| PCSX2 | **Integrated external** | Integrated external | No safe input sink; pressure input and multitap unresolved |
| PPSSPP | **Integrated external** | Integrated external | No safe input sink; local multi-controller semantics unresolved |
| Native PC executable / not represented | **External only**; **Blocked** when protected or unsafe | External fallback only | No route registry, process profile, capture policy, capacity source, or input adapter |

Existing Windows multiplayer evidence covers RetroArch/FinalBurn Neo launch and Remote RetroPad forwarding, not the proposed embedded local surface (`docs/FULL_QA_2026-08-02.md:56-87`, `docs/FULL_QA_2026-08-02.md:123-131`). Fresh native macOS and Linux execution is explicitly absent (`docs/FULL_QA_2026-08-02.md:164-168`).

## 3. Shared capture, audio, presentation, and lifecycle rules

### Capture discovery

Current capture enumerates Electron `desktopCapturer` window and screen sources (`main.js:348-364`). Current automatic preference is a displayed-name regex for known emulators, followed by a screen and then any source (`src/streaming.js:90-107`, `src/streaming.js:312-327`). This proves enumeration, not correct game-window selection.

Every embedded candidate must instead:

1. Snapshot sources before launch.
2. Spawn and retain ownership of the process.
3. Poll post-launch sources for no more than eight seconds.
4. Correlate candidates with executable identity, process creation time, engine label, and child-process transitions.
5. Select automatically only when unambiguous.
6. Otherwise show a controller-operable source chooser.
7. Never silently fall back to an unrelated display.

This matches the architecture contract (`docs/EMBEDDED_PLAY.md:123-131`).

### Audio expectations

The current handler requests loopback audio when enabled (`main.js:366-378`) and retries video-only when capture with audio fails (`src/streaming.js:192-249`). That proves a requested path and fallback, not universal support.

| Platform | Phase 1 expectation | Certification requirement | Default fallback |
|---|---|---|---|
| Windows 11 | Expected candidate | Stereo output, no microphone substitution, A/V sync threshold, recovery after fullscreen and alt-tab | `EMBEDDED_AUDIO_UNAVAILABLE`; player-approved video-only or external play |
| Current macOS | Conditional / unknown | Permission flow, restart behavior, loopback, A/V sync, source recovery | `EMBEDDED_AUDIO_PERMISSION_REQUIRED` or `EMBEDDED_AUDIO_UNAVAILABLE` |
| Linux X11 | Conditional / unknown | Native X11 run, PulseAudio/PipeWire path, A/V sync, device-change recovery | `EMBEDDED_AUDIO_UNAVAILABLE` |
| Linux Wayland | Experimental / unknown | Portal selection, PipeWire audio, source identity and recovery | `EMBEDDED_WAYLAND_RESTRICTED`; external fallback |

### Presentation and process ownership

Embedded and Fullscreen must reuse one capture session; fullscreen changes GameDeck presentation rather than restarting the emulator (`docs/EMBEDDED_PLAY.md:56-65`). Pop-out focuses the same emulator window and permits return only while capture remains valid (`docs/EMBEDDED_PLAY.md:66-69`). A dedicated manager must retain the child PID, own capture/input cleanup, and restore library focus (`docs/EMBEDDED_PLAY.md:86-121`).

The current local path spawns detached, calls `unref()`, and does not retain lifecycle ownership (`main.js:1798-1861`). Current Remote Play retains a process reference and exit listener but marks readiness by timer and remains Libretro-gated (`main.js:1675-1755`). These are evidence inputs, not certification.


## 4. Stable failure and fallback reasons

| Reason code | Player-facing copy | Required fallback |
|---|---|---|
| `EMBEDDED_ENGINE_UNAVAILABLE` | This game engine is not available for an embedded session. | Open setup or use existing external launch |
| `EMBEDDED_RUNTIME_UNVERIFIED` | This RetroArch or core build has not been certified for embedded play. | Use integrated external launch; do not expose embedded consent |
| `EMBEDDED_PROCESS_UNTRACKED` | GameDeck could not safely track the game process. | End capture attempt and launch externally |
| `EMBEDDED_LAUNCH_FAILED` | The game engine did not start. | Return to library with retry and sanitized detail |
| `EMBEDDED_SOURCE_NOT_FOUND` | GameDeck could not find the game window. | Source chooser, then external fallback |
| `EMBEDDED_SOURCE_AMBIGUOUS` | More than one possible game window was found. | Require explicit selection; never silently choose a display |
| `EMBEDDED_CAPTURE_PERMISSION_REQUIRED` | Allow screen recording for GameDeck, then try again. | OS guidance; do not claim capture is active |
| `EMBEDDED_CAPTURE_DENIED` | Screen capture was not allowed. | External play |
| `EMBEDDED_SOURCE_LOST` | The captured game window closed or changed. | Stop tracks; offer reselect, pop-out, or end |
| `EMBEDDED_AUDIO_PERMISSION_REQUIRED` | Game audio needs operating-system permission. | Permission guidance or accepted video-only mode |
| `EMBEDDED_AUDIO_UNAVAILABLE` | GameDeck could not capture game audio on this device. | Accepted video-only mode or external play |
| `EMBEDDED_INPUT_UNSUPPORTED` | GameDeck cannot safely forward this controller to this engine. | Emulator-owned input in an integrated external session |
| `EMBEDDED_INPUT_CONFIG_CONFLICT` | The emulator controller configuration conflicts with GameDeck input. | Do not overwrite user config; launch externally |
| `EMBEDDED_CONTROLLER_UNAVAILABLE` | No supported controller is available. | Connect a controller or use external play |
| `EMBEDDED_FULLSCREEN_UNCONFIRMED` | Fullscreen could not be completed without interrupting the session. | Remain embedded or pop out |
| `EMBEDDED_POP_OUT_UNAVAILABLE` | The emulator window cannot be safely presented outside GameDeck. | Remain embedded or end |
| `EMBEDDED_PROCESS_EXITED` | The game closed. | Stop capture/input and restore library position |
| `EMBEDDED_CRASHED` | The game engine stopped unexpectedly. | Stop capture/input, restore GameDeck, offer diagnostics |
| `EMBEDDED_WAYLAND_RESTRICTED` | This Wayland session does not expose a safe game-window capture path. | Integrated external or external-only fallback |
| `EMBEDDED_REMOTE_PLAY_CONFLICT` | Remote Play cannot start until this local session is safely shared or ended. | Keep one process; never start a duplicate |
| `EMBEDDED_ROUTE_NOT_REPRESENTED` | This title does not have an embedded-play profile. | Existing external launch |
| `EMBEDDED_PROTECTED_CONTENT_BLOCKED` | Embedded capture or synthetic input is not allowed for this protected title. | Publisher-supported external play only |

Failure records may contain engine version, reason code, phase, elapsed time, and sanitized capability results. They must not contain game/BIOS/save contents, raw private paths, frames, thumbnails, invitations, tokens, controller serials, or account identifiers. The architecture requires approved-source selection, no persisted frames, renderer isolation, bounded input, and capture termination on process exit (`docs/EMBEDDED_PLAY.md:142-150`).

## 5. Route certification dossiers

### 5.1 Managed RetroArch/libretro

**Proposed tier:** Embedded verified candidate.

- **Process and arguments — hard evidence:** Managed paths differ by platform: macOS uses a managed app bundle; Windows and Linux use a managed runtime root (`runtime-manager.js:33-50`). The manifest identifies RetroArch 1.22.2 and 17 cores; Windows archives are pinned while Linux/macOS inputs remain incompletely pinned (`config/runtime-manifest.json:1-54`, `config/runtime-manifest.json:58-95`, `config/runtime-manifest.json:98-214`, `docs/CROSS_PLATFORM.md:31-39`). Current local Libretro launch is `-f`, optional managed config, optional append config, `-L <core> <content>` (`main.js:1835-1848`). The base managed config currently sets fullscreen and pause behavior (`runtime-manager.js:262-274`).
- **Proposed session behavior:** Use a GameDeck-owned session append config that makes RetroArch windowed, prevents duplicate physical input for owned slots, enables localhost Remote RetroPad, and leaves the base config unchanged.
- **Capture evidence/risk:** Current matching searches for `retroarch` by displayed name (`src/streaming.js:312-324`). This can select menus, stale instances, or unrelated windows. Require retained-PID and post-launch correlation.
- **Current input / safest sink:** Browser Gamepad/keyboard becomes 16 digital RetroPad changes (`src/netplay.js:713-742`, `src/netplay.js:1049-1075`); main sends 20-byte `RETRO_DEVICE_JOYPAD` packets over localhost UDP (`main.js:1601-1648`). Reuse this sink for embedded P1 and later P2-P4. No privileged helper is required; a session config is required.
- **Audio:** Windows expected candidate; macOS and X11 conditional; Wayland experimental, all subject to live evidence.
- **Fullscreen/pop-out/exit:** Same PID and stream across embedded/fullscreen; pop-out focuses the same native window; exit stops media/input within one second and restores prior library focus. Current detached launch does not satisfy ownership (`main.js:1848-1853`).
- **Controller/live matrix:** Xbox, DualSense, Switch Pro, generic XInput/SDL as P1; Xbox paired with each as P2; pre-launch, hot-plug, held disconnect, reconnect, overlay, alt-tab, fullscreen, pop-out, source loss, exit, and Remote Play conflict.
- **Security:** Capture only approved process-correlated source; bounded session/slot input to localhost; local embedded play does not enable viewers; no content, firmware, saves, keys, or frames enter evidence.
- **Unknowns:** First-frame time, measured latency, audio by OS, source identity across transitions, P1 duplicate suppression, device ordering, display sleep, 20-cycle stability, and Remote Play reuse.
- **Failure/fallback:** `EMBEDDED_SOURCE_NOT_FOUND`, `EMBEDDED_AUDIO_UNAVAILABLE`, `EMBEDDED_CONTROLLER_UNAVAILABLE`, `EMBEDDED_SOURCE_LOST`, or `EMBEDDED_REMOTE_PLAY_CONFLICT`; fall back to current external RetroArch launch.

### 5.2 User-installed RetroArch

**Proposed tier:** Integrated external in Phase 1. A future experimental adapter is permitted only after separate explicit certification.

- **Process/arguments:** Discovery uses an override, standard Windows paths, `/Applications/RetroArch.app`, or Linux `PATH`; nearby/standard core directories are discovered (`main.js:73-97`). Detected user paths may become defaults when a managed bundle is not active (`main.js:99-110`). Argument shape matches the Libretro launch above (`main.js:1835-1848`).
- **Capture risk:** Same name-based `retroarch` rule, with greater variance from custom drivers, titles, wrappers, multiple installs, and existing sessions.
- **Input/sink:** Phase 1 leaves input entirely under the user-configured RetroArch instance and exposes no embedded-input consent. A future experimental adapter may evaluate Remote RetroPad only after separate certification; it must never edit the user's primary configuration and may use only a GameDeck-owned append config.
- **Audio/presentation:** Phase 1 uses the emulator's external window and native audio path on Windows, macOS, X11, and Wayland. GameDeck does not acquire an embedded capture source, expose embedded consent, or assume fullscreen/pop-out ownership; existing or wrapper-owned processes must not be silently adopted.
- **Controller evidence:** Phase 1 verifies only truthful external launch, native controller ownership, process observation, and return-to-GameDeck behavior. A future experimental adapter would require the full Windows matrix against minimum and current supported versions, clean defaults, one non-default driver profile, and independent native runs elsewhere.
- **Security:** Do not overwrite user config, terminate unrelated processes, or capture pre-existing windows without approval. Redact paths.
- **Unknowns:** Version floor, forks, core ABI, driver behavior, config precedence, source naming, port conflict, audio, and cleanup.
- **Failure/fallback:** `EMBEDDED_RUNTIME_UNVERIFIED`, `EMBEDDED_INPUT_CONFIG_CONFLICT`, or `EMBEDDED_PROCESS_UNTRACKED`; always use integrated external launch in Phase 1 and do not offer embedded consent.


### 5.3 Standalone MAME

**Proposed tier:** Integrated external. **Selected lowest-risk post-RetroArch adapter.**

- **Process/arguments:** MAME discovery supports override, Windows install paths or `PATH`, macOS app bundle, and Linux `PATH` (`main.js:81-88`). The MAME system prefers standalone (`main.js:279`, `main.js:693-702`). Current arguments are `<shortName> -rompath <paths> -joystick`, Windows-only `-joystickprovider winhybrid`, `-skip_gameinfo -noconfirm_quit -nowindow` (`main.js:1842-1848`). GameDeck can parse MAME `-listxml` player count, buttons, control type, and ways (`main.js:574-609`).
- **Capture:** Current matching searches names containing `mame`. Window identity under `-nowindow`, renderer transitions, and full-screen capture are unknown; require retained PID and live correlation.
- **Current input/safest sink:** MAME owns local joystick input. Safest future sink is a session-scoped virtual standard gamepad through MAME's normal provider, never process injection or arbitrary keyboard synthesis.
- **Configuration/helper:** Capacity metadata requires no mutation. Deterministic slots may need a GameDeck-owned controller profile. Synthetic devices likely need signed/privileged helpers on Windows, macOS, and Linux `uinput`; none belongs in Phase 1.
- **Audio/presentation:** All OS audio results are conditional. Phase 1 remains Integrated external: MAME owns its native window/input; GameDeck tracks status and restores itself on exit.
- **Controller evidence:** Four standard controller classes on digital titles; separate fixtures for analog stick, dial, trackball, light gun, pedals, and unusual cabinets. Metadata identifies controls but does not prove support.
- **Security:** Use MAME's public input/metadata surfaces; never inject memory, modify archives, or install helpers without explicit review.
- **Unknowns:** Window naming, first frame, loopback audio, exit/source loss, virtual-device order, P2-P4 mapping, atypical controls, X11/Wayland behavior, 20 cycles.
- **Failure/fallback:** `EMBEDDED_INPUT_UNSUPPORTED` or `EMBEDDED_SOURCE_NOT_FOUND`; retain MAME-owned Integrated external play.

### 5.4 Dolphin

**Proposed tier:** Integrated external.

- **Process/arguments:** Discovery supports override, Windows path, `/Applications/Dolphin.app`, and Linux `PATH` (`main.js:186-190`). GameCube/Wii prefer standalone Dolphin and launch with `-b -e <content>` (`main.js:283-284`, `main.js:1844-1848`).
- **Capture:** Current name match is `dolphin`. Main/render-window transitions, exclusive fullscreen, title changes, multiple windows, and graphics-backend differences are unknown.
- **Input/sink:** Current input is Dolphin-owned. Safest future sink is a session-scoped virtual standard gamepad with a GameDeck-owned temporary profile. GameCube controls and Wii motion/pointer/extensions are separate capabilities.
- **Configuration/helper:** Deterministic ports likely require a temporary profile; synthetic devices likely require a signed/privileged helper.
- **Audio/presentation:** Conditional on every OS. Dolphin remains native-window Integrated external; current detached launch lacks lifecycle ownership (`main.js:1848-1853`).
- **Controller evidence:** Four standard classes for GameCube input. Wii Remote, motion, pointer, and mixed devices remain Blocked or External only until dedicated evidence exists.
- **Security:** No memory injection, hidden hooks, permanent user-profile overwrite, or claim that Standard Gamepad tests cover Wii peripherals.
- **Unknowns:** CLI stability, process tree, source identity, graphics backends, audio, port order, Wii classes, helper behavior, source loss, crash recovery.
- **Failure/fallback:** `EMBEDDED_INPUT_UNSUPPORTED`, `EMBEDDED_SOURCE_AMBIGUOUS`, or `EMBEDDED_FULLSCREEN_UNCONFIRMED`; continue Integrated external.

### 5.5 PCSX2

**Proposed tier:** Integrated external.

- **Process/arguments:** Discovery supports override, Windows path, `/Applications/PCSX2.app`, and Linux `PATH` (`main.js:174-179`). PS2 launches standalone with `-fullscreen -batch -- <content>` (`main.js:281`, `main.js:1844-1848`).
- **Capture:** Current name match is `pcsx2`; setup dialogs, render windows, exclusive fullscreen, and title changes may be ambiguous.
- **Input/sink:** Current input is PCSX2-owned. Safest future sink is a session-scoped virtual standard gamepad and temporary mapping profile. Digital, analog, pressure-sensitive buttons, and multitap are separate capabilities.
- **Configuration/helper:** Temporary deterministic profile and likely signed/privileged helper; never overwrite user profile.
- **Audio/presentation:** Conditional/unknown on all OSes. Current fullscreen/batch route remains Integrated external until tracked lifecycle and capture pass.
- **Controller evidence:** Four standard classes for basic digital/analog fixtures; pressure and multitap remain uncertified. BIOS/setup is observed only as lifecycle state; BIOS contents are never inspected.
- **Security:** No process injection, BIOS inspection, permanent mutation, or protected-content workaround.
- **Unknowns:** CLI compatibility, setup interruption, process/window identity, renderer backends, audio, pressure, multitap, order, focus, source loss, exit, cycles.
- **Failure/fallback:** `EMBEDDED_INPUT_UNSUPPORTED`, `EMBEDDED_SOURCE_AMBIGUOUS`, or `EMBEDDED_PROCESS_UNTRACKED`; continue Integrated external.

### 5.6 PPSSPP

**Proposed tier:** Integrated external.

- **Process/arguments:** Discovery supports override, Windows path, `/Applications/PPSSPPSDL.app`, and Linux `PATH` (`main.js:180-185`). PSP launches standalone with only the selected content path appended (`main.js:282`, `main.js:1844-1848`).
- **Capture:** Current name match is `ppsspp`; SDL/native variants, fullscreen, and source naming are unknown.
- **Input/sink:** Current input is PPSSPP-owned. Safest future sink is a session-scoped virtual standard gamepad with temporary mapping. PSP network multiplayer must not be treated as local same-instance capacity.
- **Configuration/helper:** Temporary mapping may be needed; synthetic input likely needs a signed/privileged helper.
- **Audio/presentation:** Conditional/unknown everywhere. Remain Integrated external until lifecycle/capture/input certification exists.
- **Controller evidence:** All four classes for one local slot, reconnect, alt-tab, source loss, and exit. Additional local slots remain Unknown.
- **Security:** No process injection, permanent mutation, or false equivalence between network multiplayer and couch capacity.
- **Unknowns:** CLI, SDL window identity, fullscreen, audio, local capacity, mapping, helper enumeration, source loss, exit, cycles.
- **Failure/fallback:** `EMBEDDED_INPUT_UNSUPPORTED` or `EMBEDDED_SOURCE_NOT_FOUND`; continue Integrated external.

### 5.7 Native PC executable / not represented

**Proposed tier:** External only; Blocked when DRM, anti-cheat, publisher policy, or OS protections conflict with capture or synthetic input.

- **Process/arguments:** The current system registry contains console/arcade routes only (`main.js:263-285`). `launchGame` requires a recognized registered system (`main.js:1798-1801`), and generic standalone launch still depends on registered `exe` and `args` (`main.js:693-702`, `main.js:1844-1848`).
- **Capture:** Current regex names known emulators, not arbitrary titles (`src/streaming.js:90-107`, `src/streaming.js:312-327`). Silent screen fallback is unacceptable.
- **Input/sink:** No current native-PC adapter. A future profile must declare executable/process transitions, source rules, capacity, input API, and protection policy. Safest generic sink is a session-scoped virtual standard gamepad, never process injection.
- **Configuration/helper:** Per-title profiles and signed/privileged virtual-device helper likely required. Protected titles remain Blocked.
- **Audio/presentation:** Unknown on all platforms. Only existing external launch is eligible. Native reparenting and unsigned window-management addons are explicit non-goals (`docs/EMBEDDED_PLAY.md:230-236`).
- **Controller evidence:** No generic certification; every approved profile needs exact controller, capacity, capture, audio, focus, fullscreen, lifecycle, suspend/resume, DRM, and anti-cheat evidence.
- **Security:** Fail closed; no protected-window capture, anti-cheat disabling, code injection, credential scraping, or private-title/path leakage.
- **Unknowns:** Every adapter property.
- **Failure/fallback:** `EMBEDDED_ROUTE_NOT_REPRESENTED` or `EMBEDDED_PROTECTED_CONTENT_BLOCKED`; publisher-supported external play only.


## 6. Prioritized managed-libretro reference matrix

Reference assets must be GameDeck-owned, openly licensed for the test, or owner-supplied and legally possessed. No asset is committed or redistributed merely because it is used for certification.

| Priority | System/core | Purpose | Phase 1 input scope | Required evidence | Promotion rule |
|---|---|---|---|---|---|
| P0 | Arcade / FinalBurn Neo | Reuse existing Windows launch and Remote RetroPad evidence; deterministic digital P1/P2 | 16 digital RetroPad buttons | First frame, 1080p60, latency, audio, four controller classes, P1/P2, fullscreen, pop-out, source loss, exit, 20 cycles | First Windows candidate tuple after all gates pass |
| P0 | SNES / Snes9x | Independent 2D digital core without arcade append-config dependency | Digital P1/P2 | Full Windows matrix | Required before claiming behavior is not FBNeo-specific |
| P0 | NES / Mesen | Independent digital core and low-resolution scaling case | Digital P1/P2 | Full Windows matrix plus letterbox/integer-scaling check | Required before route-level Windows candidate status |
| P1 | Genesis / Genesis Plus GX | Different controller mapping and aspect behavior | Digital P1/P2 | Controller mapping, audio, fullscreen, 20 cycles | Expansion after P0 |
| P1 | Game Boy / SameBoy | Single-player low-resolution rapid lifecycle fixture | Digital P1 | Launch time, scaling, audio, source loss, 20 cycles | Reliability expansion |
| P1 | Game Boy Advance / mGBA | Single-player performance/scaling fixture | Digital P1 | 1080p60 presentation, latency, audio, lifecycle | Reliability expansion |
| Deferred | N64 / Mupen64Plus Next | Analog-heavy and four-port route | Not certifiable under digital-only Phase 1 | Analog protocol, dead zones, triggers, four-player evidence | Phase 2+ |
| Deferred | Nintendo DS / melonDS DS | Dual-screen/touch input | Not certifiable under digital-only Phase 1 | Layout, touch/pointer, scaling | Later capability phase |
| Deferred | Saturn, Dreamcast, PS1, PS2, PSP, GameCube/Wii Libretro cores | BIOS, performance, analog, renderer, or special-device complexity | No inherited certification | Exact per-core live tests | Later certification |

The managed manifest proves inventory, not runtime compatibility (`config/runtime-manifest.json:15-54`, `config/runtime-manifest.json:58-95`, `config/runtime-manifest.json:98-214`).

## 7. Windows 11 reference certification matrix

### Reference environment

- Clean Windows 11 x64 profile.
- Packaged GameDeck build and managed RetroArch 1.22.2 from pinned Windows assets.
- 1920x1080 at 60 Hz.
- Hardware-accelerated GPU path recorded; repeat on NVIDIA, AMD, and Intel where available.
- Wired controller run first; Bluetooth DualSense/Switch Pro results recorded separately.
- No game, firmware, save, key, private path, frame, or identifier in committed evidence.

Windows is initial reference because committed live evidence and pinned provenance are Windows-specific (`docs/FULL_QA_2026-08-02.md:56-87`, `config/runtime-manifest.json:15-54`). It does not substitute for other OSes.

### Controller matrix

| Controller class | P1 tests | P1/P2 tests | Required observations | Pass condition |
|---|---|---|---|---|
| Xbox / XInput | Pre-connected, hot-plug, disconnect while held, reconnect | Xbox P1 + each other class P2 | Button identity, d-pad, overlay reservation, no duplicate input | Every digital control maps correctly; no stuck/duplicate input |
| DualSense | USB, then Bluetooth | Xbox P1 + DualSense P2 | Standard Gamepad map, Guide handling, reconnect identity | Digital map passes; touch/gyro not claimed |
| Switch Pro | USB, then Bluetooth | Xbox P1 + Switch Pro P2 | Face-button semantics, d-pad, reconnect | No silent Xbox-layout assumption |
| Generic XInput/SDL | Known XInput-compatible and SDL-mapped device when available | Xbox P1 + generic P2 | Completeness, duplicate IDs, hot-plug order | Unsupported map fails truthfully rather than forwarding wrong input |

### Scenario and threshold matrix

| ID | Scenario | Method | Pass threshold | Failure reason |
|---|---|---|---|---|
| W01 | Launch to responsive picture | Timestamp Play, spawn, discovery, first frame, first controller response | Responsive frame and P1 within 10 seconds for each P0 tuple | `EMBEDDED_LAUNCH_FAILED`, `EMBEDDED_SOURCE_NOT_FOUND`, or `EMBEDDED_CONTROLLER_UNAVAILABLE` |
| W02 | 1080p60 | Ten-minute capture; record dimensions, frames, drops, CPU/GPU | 1920x1080 where supported; >=59 average rendered fps; no sustained interval below 55; <=1% drops | `EMBEDDED_CAPTURE_PERFORMANCE_INSUFFICIENT` |
| W03 | Added local capture latency | 240 fps camera or GameDeck-owned instrumented fixture; compare native vs embedded over >=30 samples | Added latency <50 ms at p95; raw and derived values recorded | `EMBEDDED_LATENCY_EXCEEDED` |
| W04 | Audio/A-V sync | Tone/flash fixture or legally usable reference over ten minutes | Stereo present; offset within +/-80 ms; no dropout >250 ms; no microphone substitution | `EMBEDDED_AUDIO_UNAVAILABLE` |
| W05 | Alt-tab/focus | Alt-tab out/back ten times, including held input and overlay | Video/audio recover <=2 s; held input released; same PID | `EMBEDDED_SOURCE_LOST` or `EMBEDDED_INPUT_FOCUS_LOST` |
| W06 | Fullscreen switching | Toggle GameDeck fullscreen/back twenty times | Same PID/session; no restart; picture/audio recover <=2 s; exit remains reachable | `EMBEDDED_FULLSCREEN_UNCONFIRMED` |
| W07 | Pop-out/return | Pop out and return ten times | Same PID; capture resumes when supported; never two input owners | `EMBEDDED_POP_OUT_UNAVAILABLE` |
| W08 | Controller disconnect | Disconnect each controller while a mapped button is held | Held state clears <=250 ms; banner appears; reconnect preserves other slots | `EMBEDDED_CONTROLLER_UNAVAILABLE` |
| W09 | Source loss | End/change capture track/source | Capture/input stop <=1 s; no unrelated display selected; reselect/pop-out/end offered | `EMBEDDED_SOURCE_LOST` |
| W10 | Crash recovery | Terminate only owned emulator through test harness | Library focus restored <=2 s; tracks/timers/sockets/input end; sanitized crash detail | `EMBEDDED_CRASHED` |
| W11 | 20 launch/end cycles | Play 30 s, End, idle 10 s, repeat | 20/20; no orphan/active track; no monotonic listener/socket growth; final idle RSS within 15% or 150 MiB of cycle-one idle, whichever larger | `EMBEDDED_RESOURCE_LEAK` |
| W12 | Couch P1/P2 | Xbox P1 paired with each remaining class on P0 2P fixtures | Stable order, independent input, no duplicate physical/forwarded input | `EMBEDDED_INPUT_CONFIG_CONFLICT` |
| W13 | Remote Play coexistence | Attempt during embedded, pop-out, and after end | Phase 1 may block safely; must never start duplicate emulator/source/input owner. Later sharing must reuse same PID/capture | `EMBEDDED_REMOTE_PLAY_CONFLICT` |
| W14 | Normal exit | Exit through supported emulator quit path | Capture/input end <=1 s; prior card/scroll restore; summary records normal exit | `EMBEDDED_PROCESS_EXITED` |

The architecture supplies the 10-second goal, same-session presentation rules, no-orphan/no-leak requirements, under-50-ms target, and 1080p60 target (`docs/EMBEDDED_PLAY.md:198-228`). The detailed thresholds above are proposed gates, not existing evidence.

## 8. macOS, X11, and Wayland expansion matrix

| Environment | Mandatory additions | Blocker until passed |
|---|---|---|
| Current macOS, Apple Silicon | First-run screen-recording permission/restart, managed provenance, Metal capture, system audio, Spaces fullscreen, activation, USB/Bluetooth mappings, sleep/wake | No native execution; managed DMG/core assets incompletely pinned |
| Linux X11, current Ubuntu LTS | AppImage/deb launch, X11 window identity, PulseAudio/PipeWire variants, SDL mapping, focus/display sleep, process groups | No native execution or audio/capture evidence; Linux archives unpinned |
| Linux Wayland, current Ubuntu LTS | XDG portal chooser, PipeWire video/audio, permission persistence, compositor source loss, no silent display fallback, mapping | Safe per-window capture may be unavailable; external fallback remains first-class |

Packaging definitions are not runtime compatibility evidence (`docs/CROSS_PLATFORM.md:1-15`).

## 9. Smallest Phase 1 QA suite

1. Managed Windows RetroArch 1.22.2 with the exact pinned core archive.
2. Three P0 tuples: FinalBurn Neo, Snes9x, and Mesen, using legally controlled reference assets.
3. All four controller classes as P1; Xbox paired with each remaining class as P2.
4. W01-W14, including safe Remote Play conflict behavior.
5. One clean packaged profile and one second clean profile to detect state leakage.
6. Sanitizer review proving reports contain no private paths, content, firmware, saves, invitations, frames, or controller serials.
7. Independent QA rerun of every failed-then-fixed scenario.

Passing permits only a **Windows managed RetroArch Embedded verified candidate** statement for exact P0 tuples. It does not certify user RetroArch, other cores, standalone emulators, native PC, macOS, X11, Wayland, analog/motion/touch/light-gun input, or four-player local input.

## 10. Lowest-risk post-RetroArch adapter

**Standalone MAME** is selected. GameDeck already has cross-platform executable discovery, explicit standalone launch mode, deterministic arguments, and source-name recognition. It is the only inspected standalone route with authoritative per-title player/control metadata through `-listxml`. Its safest future input boundary can remain outside the process through a session-scoped virtual standard gamepad using MAME's joystick layer. The main unresolved risk is deterministic cross-platform virtual-device and slot assignment, which can be developed behind a disabled capability flag without changing support claims. Dolphin, PCSX2, and PPSSPP need similar helper work but lack MAME's capacity/control metadata advantage.

## 11. Promotion and fallback gates

- No route is promoted from source inspection alone.
- No Windows result is reused for macOS, X11, or Wayland.
- No core or controller inherits another tuple's result.
- Video-only capture is Conditional and requires explicit acceptance.
- Source ambiguity requires user selection or external fallback.
- Process tracking failure cancels embedded capture.
- Remote Play and embedded play require one explicit process/capture/input owner.
- Protected native titles fail closed without bypass guidance.
- Reports include exact versions, reason codes, method, thresholds, and sanitized evidence.
- Launch, discovery, capture, input, runtime, Electron, or OS changes invalidate affected evidence until regression passes.

## 12. Current blockers

1. Play-session manager, capability result, source correlator, local input owner, and renderer surface are architecture only (`docs/EMBEDDED_PLAY.md:86-121`, `docs/EMBEDDED_PLAY.md:170-196`).
2. Current local launches detach and do not own lifecycle (`main.js:1798-1861`).
3. Automatic source selection is name-based and may fall back to a display (`src/streaming.js:90-107`, `main.js:366-374`).
4. Input forwarding is digital RetroPad only and was built for Remote Play guests, not embedded local P1 (`main.js:1601-1648`, `src/netplay.js:713-742`).
5. Windows live evidence does not measure embedded latency or system audio.
6. Fresh macOS, X11, and Wayland execution is absent (`docs/FULL_QA_2026-08-02.md:164-168`).
7. Linux/macOS managed-runtime provenance is incomplete (`docs/CROSS_PLATFORM.md:31-39`).
8. Standalone emulators have no safe GameDeck-owned input sink.
9. Native PC executables are not represented and require separate profile/security design.

Until these blockers are resolved, the truthful default remains the existing external launch path with the reason codes above.
