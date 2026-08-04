# GameDeck Play Sessions

Status: implemented Windows integration lane
Branch: `feature/openbor-embedded-play`

## Player experience

Pressing Play opens one GameDeck-owned session surface for every supported console route. The same running process can move among three presentation modes:

- **Docked** — the game is centered inside the GameDeck window at the console's intended display aspect.
- **Fullscreen** — the game fills the display without reserving space for GameDeck chrome. Move the pointer to the top edge to reveal Docked, Fullscreen, Pop out, and Close controls. Escape returns to Docked without ending the game.
- **Pop out** — the same engine process is shown in its native window. Press F10 to return to Docked.

Closing the player ends the owned engine process, stops capture, and restores the library. A second launch is rejected while a Play Session is active.

## Seamless launch contract

1. Validate the library file, firmware, archive health, and arcade dependencies.
2. Resolve the integrated route. GameDeck prefers its managed Libretro core even when a standalone emulator is installed.
3. Show the GameDeck loading curtain before the engine window can surface.
4. Spawn and retain the child process.
5. Snapshot and poll window capture sources, selecting only a stable post-launch candidate.
6. Remove native title-bar and resize chrome on Windows, keep the engine behind GameDeck, and capture the game window.
7. Display a local video-only MediaStream inside GameDeck.
8. Keep audio owned by the game engine. GameDeck never replays loopback audio, preventing echo and doubled volume.
9. Preserve the same process across Docked, Fullscreen, Pop out, F10 return, and Escape-to-Docked.

GameDeck does not persist frames or thumbnails and does not enable Remote Play merely because a local Play Session is active.

## Console aspect profiles

The native engine window and Docked viewport use a console display profile rather than a universal widescreen canvas:

| Profile | Systems |
|---|---|
| 4:3 | Arcade, MAME, NES/FDS, SNES/Satellaview/Sufami, N64, Genesis/32X/Master System/Game Gear/Sega CD, PC Engine, Saturn, Dreamcast, Atari 2600, PS1, PS2, OpenBOR |
| 10:9 | Game Boy / Game Boy Color |
| 3:2 | Game Boy Advance |
| 2:3 | Nintendo DS stacked-screen layout |
| 16:9 | PSP, GameCube, Wii, Wii U |

RetroArch additionally uses `aspect_ratio_index = 22` and `video_aspect_ratio_auto = true`, so the core-provided geometry remains authoritative inside the profile.

## Engine routing

### Managed core route

When the managed RetroArch executable and required core are present, GameDeck uses that route for integrated play even when DuckStation, PCSX2, PPSSPP, Dolphin, or standalone MAME is also installed. This gives the cartridge, disc, handheld, and arcade shelves the same lifecycle and presentation contract.

Installed routes exercised in the Windows QA profile:

- FinalBurn Neo and MAME
- Snes9x and Mesen
- Mupen64Plus-Next
- SameBoy, mGBA, and melonDS DS
- Genesis Plus GX and PicoDrive
- Beetle PCE Fast and Beetle Saturn
- Flycast and Stella
- PCSX-ReARMed, Play!, and PPSSPP
- OpenBOR 3.0 Build 6391

### Standalone capture fallback

When a managed core is unavailable but a known Windows standalone engine exists, GameDeck launches it windowed, owns the process, discovers its game window, and applies the same Docked / Fullscreen / Pop-out surface. This fallback covers configured MAME, DuckStation, PCSX2, PPSSPP, Dolphin, Cemu, and OpenBOR routes. It remains experimental until the exact emulator/game tuple is exercised.

### External fallback

GameDeck falls back to the existing external launch only when the engine cannot be safely captured, firmware or dependencies are missing, source discovery is ambiguous, or the platform cannot expose a safe window source. Wayland remains external-only in this phase.

## OpenBOR launch behavior

Legacy OpenBOR 3.0 does not reliably consume an arbitrary absolute `.pak` command-line argument. GameDeck creates a per-game session directory under user data, stages exactly one pack in its `Paks` folder using a hard link when possible, starts OpenBOR with that session directory as its working directory, and verifies the engine log selected the staged pack. Saves and logs remain isolated per game. The staged pack keeps its original filename so the capture window has a truthful game title.

## Input and audio

- The physical controller remains owned by the engine; GameDeck suppresses its own library navigation while a session is active.
- Managed RetroArch and OpenBOR are configured not to pause when GameDeck owns focus.
- Keyboard players can use Pop out for direct engine-window input.
- Video capture requests `audio: false`; any unexpected audio tracks are stopped immediately and the video element remains muted.
- Native engine audio continues unchanged in Docked, Fullscreen, and Pop out.

## Reliability and security boundaries

- One active Play Session and one owned game process.
- Trusted-main-frame IPC checks on launch and session controls.
- No full-display fallback and no unrelated-window capture.
- Stable two-poll post-launch source discovery.
- Capture and process cleanup on End session, process exit, app shutdown, or failed launch.
- No game, firmware, save, key, frame, or commercial artwork is uploaded.
- Renderer isolation, navigation denial, and sandboxing remain enabled.

## Windows acceptance evidence

The current QA profile passed:

- Docked center delta of 0 px across tested systems.
- Console-specific viewport ratios, including 10:9 Game Boy, 3:2 GBA, 2:3 Nintendo DS, 4:3 consoles/arcade, and 16:9 PSP.
- Exactly one live video track and zero live captured-audio tracks.
- Fullscreen controls fully hidden at rest and revealed at the top edge.
- Escape returns Fullscreen to Docked without closing the game.
- Pop out and F10 return preserve the same process.
- Clean process termination and return to the library.

Certification remains exact to the tested Windows runtime, core, content, and controller tuple. macOS, Linux X11, Wayland, motion controls, light guns, touch, and Wii pointer behavior require separate evidence.

---

# Historical design record — superseded by the implementation contract above

The material below is retained for decision history. Statements about proposed phases, external-only routes, loopback audio, or implementation blockers are no longer current.

# GameDeck Embedded Play Sessions

Status: architecture proposal
Branch: architecture/embedded-play-session
Owner: General Orchestrator / Multiplayer Platform

## Product outcome

A player selects a game and remains inside a GameDeck-owned play surface from launch through exit. The session may be shown inside the app, expanded to fullscreen, or deliberately popped out. GameDeck keeps controller navigation, diagnostics, multiplayer, and return-to-library behavior coherent without pretending every emulator can be embedded safely.

North-star measure: from pressing Play to a responsive picture and working controller in the GameDeck play surface in under 10 seconds for supported managed-libretro titles.

## Experience contract

1. Press Play.
2. GameDeck enters a Play Session loading state with the selected artwork, engine, controller readiness, and a cancel action.
3. A supported engine launches in a managed background window.
4. GameDeck discovers and captures that window, renders its video and system audio in the Play Session surface, and forwards local controller input.
5. The player can switch among Embedded, Fullscreen, and Pop-out modes.
6. Guide/Menu or Escape opens a lightweight overlay for Resume, Fullscreen, Multiplayer, Diagnostics, Pop out, and End session.
7. When the emulator exits, GameDeck returns to the same library position and shows a small session summary.

No game, firmware, save, key, or commercial artwork is uploaded by this feature.

## Support tiers

### Tier A - Embedded managed session

Initial target: managed RetroArch/libretro titles.

- GameDeck launches RetroArch windowed with a session-specific config.
- RetroArch Remote RetroPad input is enabled for local P1 and optional P2-P4.
- GameDeck discovers the emulator capture source and acquires a local MediaStream through the existing desktop capture pipeline.
- The renderer displays the stream directly in a video element without a WebRTC network hop.
- GameDeck forwards standard gamepad events through the existing UDP RetroPad packet path.
- System audio uses the existing loopback capture path where the OS supports it.

### Tier B - Integrated external session

Targets standalone emulators that can be launched and tracked but cannot accept GameDeck-owned input reliably.

- GameDeck presents the same loading, diagnostics, overlay, and session-end experience.
- The emulator owns its native window and controller input.
- GameDeck automatically focuses the emulator for play and restores itself on exit.
- Fullscreen uses the emulator's supported flags.
- The UI says External session rather than falsely claiming embedded play.

### Tier C - Standard external fallback

Targets unsupported native PC games, protected launchers, Wayland-restricted capture, and engines whose windows cannot be discovered.

- Preserve the existing launch path.
- Show a concise fallback reason and a Remember for this game option.
- Restore GameDeck and the previous focused title when the process closes.

## Modes

### Embedded

The game video fills the Play Session stage inside GameDeck. Letterboxing is allowed; stretching is not. Pointer UI fades after inactivity. Controller focus is owned by the session.

### Fullscreen

GameDeck calls BrowserWindow.setFullScreen(true) and the play surface fills the display. Fullscreen is a presentation mode of the same session, not a separate launch. Toggle with F11 and a configurable controller chord. Escape or Guide opens the overlay before leaving fullscreen.

### Pop-out

GameDeck stops owning presentation and focuses the emulator's native window without ending the process. The overlay offers Return to GameDeck when capture remains available.

## Runtime state machine

idle -> preparing -> launching -> discovering_source -> capturing -> playing -> paused_overlay -> ending -> ended

Failure states:

- engine_unavailable
- launch_failed
- source_timeout
- capture_denied
- audio_unavailable
- controller_unavailable
- process_exited

Every failure must include a player-readable message, a technical detail field, and one recommended action.

## Proposed process boundary

Create a dedicated play-session manager rather than expanding launchGame into a second state machine.

Main-process responsibilities:

- Validate the requested library file.
- Resolve the engine and support tier.
- Spawn and track the child process without detaching away lifecycle ownership.
- Build session-specific RetroArch config for Tier A.
- Track PID, title, system, timestamps, mode, phase, and errors.
- Discover candidate capture sources after launch.
- Toggle GameDeck fullscreen.
- Stop or detach the session safely.
- Emit play-session-update events.

Renderer responsibilities:

- Render loading, video, overlay, diagnostics, and session summary.
- Acquire the approved capture source through getDisplayMedia.
- Display the local MediaStream directly.
- Poll standard gamepads and send bounded button changes to the main process.
- Never send controller input when an editable field or overlay control owns focus.

Suggested IPC surface:

- play-session-capabilities(file)
- play-session-start(file, options)
- play-session-status()
- play-session-sources()
- play-session-select-source(sourceId)
- play-session-input(payload)
- play-session-set-fullscreen(enabled)
- play-session-pop-out()
- play-session-stop(reason)
- onPlaySessionUpdate(callback)

## Capture-source discovery

1. Snapshot available window sources before launch.
2. Spawn the emulator.
3. Poll desktopCapturer sources for up to eight seconds.
4. Prefer a new window source whose name matches the game title, engine label, or known emulator title.
5. If exactly one new non-GameDeck window appears, select it.
6. If discovery is ambiguous, show a controller-operable source chooser.
7. Never silently capture an unrelated window or full screen.

## Local input rules

- Tier A owns controller input inside GameDeck.
- Use the existing 0-15 RetroPad button mapping and a bounded queue.
- Add analog axes only after digital controls pass compatibility QA.
- Suppress duplicate input by launching RetroArch with local physical input disabled for the GameDeck-owned player slots.
- A controller disconnect pauses input forwarding and opens a non-blocking status banner.
- Guide/Menu is reserved for the GameDeck overlay and is not forwarded by default.

## Security and privacy boundaries

- Capture only a user-approved source selected from post-launch candidates.
- Do not persist thumbnails or frames.
- Do not enable remote viewers merely because an embedded session is active.
- Local embedded capture and GameDeck Live are separate states even when they share primitives.
- Keep contextIsolation, sandboxing, navigation denial, and no-node renderer guarantees.
- Limit input event rates and payload sizes.
- End capture when the tracked process exits.

## Compatibility matrix

Each engine receives one of:

- Embedded verified
- Embedded experimental
- Integrated external
- External only
- Blocked

Minimum certification dimensions:

- Windows 11, macOS current, Linux X11, Linux Wayland
- NVIDIA, AMD, Intel graphics where available
- Xbox, DualSense, Switch Pro, generic XInput/SDL controller
- video latency, audio availability, fullscreen switching, alt-tab recovery, process exit, crash recovery
- couch P1/P2 and Remote Play coexistence

## Delivery phases

### Phase 0 - architecture and instrumentation

- Define the play-session manager and capability result.
- Add process lifecycle ownership and source discovery diagnostics.
- No player-visible default behavior change.

### Phase 1 - managed RetroArch prototype

- One embedded local player.
- Window capture and system audio.
- Embedded/fullscreen/pop-out.
- Digital controller mapping.
- Automatic external fallback.

### Phase 2 - multiplayer convergence

- P2-P4 local forwarding.
- Reuse the same session for Remote Play guests.
- One overlay for local and online players.

### Phase 3 - compatibility expansion

- Certify standalone emulators individually.
- Add platform-specific adapters only behind capability checks.
- Never make unsafe native-window reparenting the cross-platform default.

## Acceptance gates for Phase 1

Functional:

- Supported managed-libretro game renders inside GameDeck within 10 seconds.
- P1 controller can navigate and play without the emulator window focused.
- Embedded to fullscreen and back does not restart the game.
- Pop-out and return preserve the same process.
- Closing the game returns to the previously focused library card.
- Unsupported engines use the existing launch path with a truthful fallback message.

Reliability:

- No orphaned emulator after End session.
- No capture continues after process exit.
- Repeated launch/end cycles do not leak tracks, timers, sockets, or listeners.
- Alt-tab, display sleep, controller disconnect, and source loss have understandable recovery.

Performance:

- Local capture adds no network transport.
- Target display latency under 50 ms on the reference Windows system.
- 60 fps at 1080p where the source and hardware support it.
- CPU and GPU impact are reported during QA rather than guessed.

Accessibility:

- Play Session controls are keyboard and controller operable.
- Fullscreen exit and End session are always reachable.
- Overlay controls have accessible names and 44 px targets.
- Reduced-motion mode disables animated session transitions.

## Explicit non-goals for the first release

- Embedding every arbitrary Windows game window through SetParent.
- Shipping unsigned native window-management addons.
- Capturing DRM-protected or anti-cheat-protected games.
- Hiding unsupported behavior behind a universal compatibility claim.
- Replacing the existing external launch path before the embedded path is proven.

## Team boundaries

Multiplayer Platform / Network Reliability:

- Own play-session manager, RetroPad forwarding reuse, lifecycle, and capture-source contract.

Compatibility Lab:

- Own engine certification, controller matrix, latency evidence, and fallback classification.

Product / UX:

- Own loading stage, play overlay, mode switching, return-to-library, and error language.

Security / Release:

- Own capture consent, renderer boundaries, process termination, rate limits, packaging, and release gates.

QA:

- Independently verify every acceptance gate on clean profiles and supported platforms.

## Integration rule

Do not begin renderer implementation until the active Discord-free product branch is integrated or relinquishes overlapping files. Backend and architecture work may proceed in parallel on non-overlapping files, with a fresh rebase and full QA before integration.
