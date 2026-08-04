# GameDeck Play UX Contract

Status: implemented Windows player surface

## Modes

### Docked

The selected game replaces the library content inside the GameDeck window. The viewport is centered from measured stage bounds and sized to the console display aspect. Stretching is not allowed. The header provides Docked, Fullscreen, Pop out, and Close.

### Fullscreen

The game stage occupies the full display. GameDeck controls reserve no space and remain off-screen while idle. Moving the pointer to the top edge or focusing a player control reveals the header temporarily. Escape returns to Docked and never ends the game. F11 toggles Docked and Fullscreen.

### Pop out

The same engine process appears in a centered native window with its original title. GameDeck is minimized. F10 returns the session to Docked and reacquires the approved game window.

## Loading and branding

GameDeck shows its own loading curtain before launching the engine and keeps the native engine window behind the player surface. Managed RetroArch disables window decorations, menu loading animation, notifications, and on-screen fonts for the session. The live game frame must not expose an emulator logo, menu, title bar, or notification overlay.

## Input

The physical controller remains owned by the game engine. While a session is active, GameDeck suppresses library gamepad navigation to prevent duplicate actions. Keyboard users can Pop out. Close is explicit; carried-over Escape or controller input cannot terminate a game.

## Audio

The engine remains the only audible source. The captured video is muted and contains no live audio track. Mode changes never start a second sound path.

## Recovery

- Capture loss shows Retry and Pop out without killing a healthy engine.
- Process exit stops tracks and returns to the previous library state.
- A second Play request is rejected until the active session ends.
- Fullscreen exit initiated by the operating system is synchronized back to Docked.
- Pop-out return uses the same process rather than relaunching.

## Accessibility

- Player controls use native buttons and accessible labels.
- Keyboard focus reveals hidden fullscreen controls.
- Escape is a safe fullscreen exit.
- Reduced-motion preferences disable player transition animations.
- Status text is announced through the player live region.

---

# Historical design record — superseded by the implementation contract above

The material below is retained for decision history. Statements about proposed phases, external-only routes, loopback audio, or implementation blockers are no longer current.

# GameDeck Embedded Play Product and UX Specification

Status: product/UX specification for implementation review
Branch: `design/embedded-play-ux`
Base: `0fa427b`
Architecture dependency: `docs/EMBEDDED_PLAY.md`
Owner: Product / UX
Implementation dependency: wait until `qa/discord-free-product` clears or relinquishes overlapping renderer files

## 1. Product outcome

Pressing **Play** should move a player from a selected library card into one coherent Play Session surface. For supported managed engines, the game is presented inside GameDeck. For engines that must own their own window, GameDeck says so plainly and preserves the same launch, diagnostics, session-end, and return-to-library experience.

The experience must feel controller-first without hiding essential controls from keyboard, mouse, touch, or assistive-technology users.

### Experience promise

For a verified embedded title, GameDeck prepares the engine, finds the launched game window, captures only the approved source, displays the game without stretching, forwards supported local controller input, and returns the player to the exact library card when the process ends.

### Truth boundary

GameDeck must never claim that every game, emulator, protected launcher, or operating-system configuration can be embedded. The UI uses the architecture support tiers exactly:

- **Embedded session** — GameDeck owns presentation and supported input.
- **External session** — the emulator or game owns its native window; GameDeck tracks the process and restores the library.
- **External fallback** — GameDeck could not safely embed or integrate the title and uses the existing launch path.

No shipped mockup, loading illustration, empty state, documentation example, or fallback poster may contain copyrighted game imagery. The product may display artwork already supplied or selected locally by the player, but GameDeck ships no commercial game art. Reference designs use abstract system geometry, the GameDeck mark, neutral source-window placeholders, and generic titles such as “Selected game.”

## 2. Experience principles

1. **Start with confidence, not technical noise.** Show the current phase, game title, selected engine, and one useful action.
2. **Tell the truth about presentation.** Use “Embedded” only when GameDeck is displaying the approved capture source. Use “External” whenever the native game window owns presentation.
3. **Never capture by guess.** An ambiguous source requires an explicit, controller-operable choice.
4. **Keep play reversible.** Fullscreen and pop-out change presentation, not the running process.
5. **Protect the session.** Back or Escape never ends a game. Ending requires deliberate confirmation.
6. **Preserve context.** Returning from play restores the exact library view, shelf scroll position, selected system, filters, and focused card.
7. **Degrade calmly.** Missing audio, controller loss, capture loss, and external fallback have understandable recovery paths.
8. **Keep local diagnostics private.** Session diagnostics are concise, copyable, and stripped of private paths, credentials, invitation payloads, window thumbnails, and account data.
9. **Avoid fake certainty.** Do not display invented percentages, estimated latency, or “ready” states before the runtime confirms them.
10. **Do not punish recovery.** A recoverable issue should not automatically terminate a healthy game process.

## 3. State model and visible behavior

The renderer reflects the architecture state machine:

`idle -> preparing -> launching -> discovering_source -> capturing -> playing -> paused_overlay -> ending -> ended`

Failure states are rendered inside the Play Session whenever the session surface already exists. Generic toasts may supplement but must not replace the actionable state.

### 3.1 Play press

When the player activates **Play now**, a card play button, double-click, Enter, or controller A:

1. Store a return anchor containing:
   - stable game ID;
   - normalized file identity as a fallback;
   - selected system and active view;
   - current library query, sort, and artwork/health filter;
   - shelf and content scroll offsets;
   - focused card index as a final fallback;
   - input mode in use when Play was pressed.
2. Mark the source card `aria-busy="true"` and disable duplicate launch activation.
3. Replace the library content with the Play Session surface in the same GameDeck window. Do not open the entire play experience as a modal over the library.
4. Move DOM focus to the Play Session root, not directly to **Cancel launch**, so a carried-over key or button press cannot immediately cancel.
5. Announce once: `Preparing Selected game.`

The library remains mounted or its state remains serialized so return does not trigger a new search, reset a filter, or jump to the top.

### 3.2 Preparing

Purpose: validate the library file, resolve engine capability, create a session record, and prepare a session-specific configuration.

Visible content:

- Kicker: `PLAY SESSION`
- Heading: `Preparing Selected game`
- Detail: `Checking the game, engine, and controller.`
- Metadata: `Managed RetroArch · Embedded verified`, `Standalone emulator · External session`, or the truthful capability result.
- Action: **Cancel launch**

Rules:

- Use an indeterminate progress treatment until a bounded phase estimate exists.
- Do not show a fake percentage.
- Do not cycle through marketing slogans.
- If preparation lasts longer than 4 seconds, add: `Still working. You can cancel without changing your game files.`
- If runtime installation or repair is required, label it directly and reuse the existing transfer/status infrastructure rather than hiding it behind “Preparing.”

### 3.3 Launching

Purpose: spawn and track the selected engine or game process.

Visible content:

- Heading: `Starting the game`
- Detail: `GameDeck is opening Managed RetroArch.`
- Secondary status: `Waiting for the game window.`
- Action: **Cancel launch**

If the capability tier is external, say before focus leaves GameDeck:

> This game plays in its own window. GameDeck will return to this card when the session ends.

Do not briefly label an external launch as embedded while source discovery runs.

### 3.4 Discovering source

Purpose: find a safe post-launch capture candidate for a Tier A session.

Visible content:

- Heading: `Finding the game window`
- Detail: `GameDeck is looking only at windows opened for this session.`
- Bounded helper: `This usually takes a few seconds.`
- Action: **Cancel launch**

At the architecture timeout, transition to **Source timeout**. Never silently capture the full display or an unrelated window.

### 3.5 Source chooser

Show the chooser only when more than one plausible post-launch source remains or confidence is below the architecture threshold.

The chooser is a modal dialog above the session stage. It must not expose unrelated desktop windows. Candidate rows include only approved post-launch candidates supplied by the main process.

Each candidate row contains:

- a generic window icon;
- sanitized window title;
- engine label;
- reason, such as `New window · title match` or `New window · engine match`;
- optional ephemeral preview only after the player requests **Preview source**.

Initial release should not auto-render thumbnails. If a later preview is added, it exists only in memory while the chooser is open and is never persisted, logged, uploaded, or included in diagnostics.

Primary instruction:

> Choose the window that contains your game. GameDeck will capture only the window you approve.

Actions after the candidate list:

1. **Refresh windows**
2. **Play in external window**
3. **Cancel launch**

Selecting a candidate immediately enters `capturing`; it does not require a second generic confirmation. Choosing external mode opens a confirmation sheet explaining the change and offering an unchecked **Remember external mode for this game** option.

### 3.6 Capturing

Purpose: acquire the approved video source and attempt system audio.

Visible content:

- Heading: `Connecting the play surface`
- Detail: `Video is ready. Checking system audio and controls.`
- Status rows:
  - `Video · Connecting / Ready`
  - `Audio · Connecting / Ready / Unavailable`
  - `Controller · Connected / Waiting`

The first decoded video frame moves the session into `playing`. Audio readiness must not block play. A missing controller does not block keyboard-capable titles.

### 3.7 Playing

The game source is the visual priority. Pointer chrome fades after 2.5 seconds of inactivity, but focus indicators and status banners never fade while focused.

The default stage contains:

- live game video for embedded sessions;
- a truthful external-session panel for external sessions;
- a small mode badge while the overlay is open or pointer chrome is visible;
- non-blocking status banners for recoverable problems;
- a focusable session root for keyboard entry.

Do not place permanent GameDeck branding over gameplay. The stage may show a brief, reduced-motion-safe `Embedded session` status at start and then remove it.

### 3.8 Overlay

Guide/Menu or Escape opens the Play Session overlay. The overlay pauses GameDeck input forwarding; it does not claim to pause the game unless the engine explicitly confirms pause support.

The overlay heading is `Play Session` and the supporting line is `{game title} · {mode} · {elapsed time}`.

Required action order:

1. **Resume**
2. **Fullscreen** / **Exit fullscreen**
3. **Multiplayer**
4. **Diagnostics**
5. **Pop out** / **Return to GameDeck**
6. **End session**

Only actions supported by the current capability are enabled. Disabled controls remain discoverable when the reason is useful, with concise description such as `Fullscreen is controlled by this external emulator.` Otherwise omit the action rather than creating a dead end.

`End session` uses the danger style but is never initial focus. Activating it opens a confirmation sheet:

- Heading: `End this play session?`
- Detail: `GameDeck will close the tracked game process and return to your library.`
- Default focus: **Keep playing**
- Destructive action: **End session**

For an external fallback GameDeck cannot safely terminate, use:

> Stop tracking this session?
>
> The game may remain open in its own window.

The destructive action becomes **Stop tracking**. Never promise process termination unless the main process owns it.

### 3.9 Ending and ended

During `ending`, show a non-interactive stage message:

- `Closing the session`
- `Stopping capture and returning to your library.`

The ending state should normally last less than 2 seconds. If process shutdown is still pending after 4 seconds, show **Force close** only when the main process reports that force termination is safe for the tier. Otherwise show **Return to library and keep game open**.

When ended:

1. stop and detach all media tracks;
2. stop GameDeck-owned input forwarding;
3. leave fullscreen before restoring the library;
4. restore the exact library context and focused card;
5. render a concise session summary adjacent to or immediately after the restored card;
6. move DOM focus to the restored card without scrolling it away from the visible shelf.

Summary examples:

- `Played 42 min · Embedded session · Ended normally`
- `Played 18 min · External session · Returned to GameDeck`
- `Session ended unexpectedly after 3 min · Open diagnostics`

The summary must not include local paths, source IDs, process IDs, peer IDs, invitation payloads, or controller serial identifiers. It is a polite status region, not a modal. It dismisses after 12 seconds visually but remains available in the Status Center.

If the exact card no longer exists, restore focus in this order:

1. same game by normalized file identity;
2. nearest surviving card by prior index;
3. selected system button;
4. Library navigation button.


## 4. DOM-level component contract

The exact class names may evolve, but IDs, landmarks, state attributes, focus rules, and accessible relationships should remain stable enough for automated QA.

```html
<section
  id="playSession"
  class="play-session hidden"
  data-phase="idle"
  data-mode="embedded"
  data-tier="embedded-verified"
  aria-labelledby="playSessionTitle"
  aria-describedby="playSessionStatus"
  tabindex="-1">

  <header class="play-session-header">
    <div class="play-session-identity">
      <span id="playSessionKicker">PLAY SESSION</span>
      <h1 id="playSessionTitle">Selected game</h1>
      <p id="playSessionMeta">Managed RetroArch · Embedded verified</p>
    </div>
    <button id="playSessionOverlayOpen" type="button"
      aria-label="Open Play Session controls">Menu</button>
  </header>

  <div id="playSessionStage" class="play-session-stage"
    aria-label="Play surface for Selected game">
    <video id="playSessionVideo" autoplay playsinline
      aria-label="Live game video for Selected game"></video>
    <div id="playSessionExternal" class="play-session-external hidden"
      role="status"></div>
    <div id="playSessionPhase" class="play-session-phase"></div>
    <div id="playSessionBanner" class="play-session-banner hidden"
      role="status" aria-live="polite" aria-atomic="true"></div>
  </div>

  <p id="playSessionStatus" class="sr-only"
    role="status" aria-live="polite" aria-atomic="true"></p>

  <button id="playSessionCancel" type="button">Cancel launch</button>
</section>

<section id="playSessionOverlay" class="play-session-overlay hidden"
  role="dialog" aria-modal="true"
  aria-labelledby="playSessionOverlayTitle"
  aria-describedby="playSessionOverlayMeta">
  <div class="play-session-overlay-card">
    <h2 id="playSessionOverlayTitle">Play Session</h2>
    <p id="playSessionOverlayMeta"></p>
    <nav class="play-session-actions" aria-label="Play Session controls">
      <button id="playSessionResume" type="button">Resume</button>
      <button id="playSessionFullscreen" type="button">Fullscreen</button>
      <button id="playSessionMultiplayer" type="button">Multiplayer</button>
      <button id="playSessionDiagnostics" type="button"
        aria-expanded="false" aria-controls="playSessionDiagnosticsPanel">Diagnostics</button>
      <button id="playSessionPopout" type="button">Pop out</button>
      <button id="playSessionEnd" type="button">End session</button>
    </nav>
  </div>
</section>

<section id="playSessionSourceChooser" class="source-chooser hidden"
  role="dialog" aria-modal="true"
  aria-labelledby="sourceChooserTitle"
  aria-describedby="sourceChooserHelp">
  <h2 id="sourceChooserTitle">Choose the game window</h2>
  <p id="sourceChooserHelp"></p>
  <div id="sourceChooserList" role="radiogroup"
    aria-label="Available game windows"></div>
  <button id="sourceChooserRefresh" type="button">Refresh windows</button>
  <button id="sourceChooserExternal" type="button">Play in external window</button>
  <button id="sourceChooserCancel" type="button">Cancel launch</button>
</section>

<aside id="playSessionDiagnosticsPanel" class="session-diagnostics hidden"
  aria-labelledby="sessionDiagnosticsTitle" tabindex="-1">
  <h2 id="sessionDiagnosticsTitle">Session diagnostics</h2>
  <div id="sessionDiagnosticsSummary" role="status"></div>
  <dl id="sessionDiagnosticsFacts"></dl>
  <div class="session-diagnostics-actions">
    <button id="sessionRetryCapture" type="button">Retry capture</button>
    <button id="sessionCopyDiagnostics" type="button">Copy safe report</button>
    <button id="sessionDiagnosticsClose" type="button">Back to controls</button>
  </div>
</aside>

<section id="playSessionEndConfirm" class="session-confirm hidden"
  role="alertdialog" aria-modal="true"
  aria-labelledby="sessionEndTitle"
  aria-describedby="sessionEndDetail">
  <h2 id="sessionEndTitle">End this play session?</h2>
  <p id="sessionEndDetail"></p>
  <button id="sessionKeepPlaying" type="button">Keep playing</button>
  <button id="sessionConfirmEnd" type="button">End session</button>
</section>

<section id="playSessionSummary" class="session-summary hidden"
  role="status" aria-live="polite" aria-atomic="true"
  aria-labelledby="sessionSummaryTitle">
  <h2 id="sessionSummaryTitle">Session complete</h2>
  <p id="sessionSummaryText"></p>
  <button id="sessionSummaryDiagnostics" type="button">Open diagnostics</button>
  <button id="sessionSummaryDismiss" type="button">Dismiss</button>
</section>
```

### 4.1 State attributes

The renderer uses stable state attributes for styling and QA rather than inferring state from copy:

- `#playSession[data-phase]`: `preparing`, `launching`, `discovering-source`, `capturing`, `playing`, `paused-overlay`, `ending`, `ended`, `error`.
- `#playSession[data-mode]`: `embedded`, `fullscreen`, `external`, `popout`.
- `#playSession[data-tier]`: `embedded-verified`, `embedded-experimental`, `integrated-external`, `external-only`.
- `body.play-session-active` while a session owns the primary renderer surface.
- `body.play-session-overlay-open` while a session dialog or drawer owns focus.

Only one `aria-modal="true"` surface may be visible at a time. Opening Diagnostics from the overlay changes the active focus surface; it must not create nested modal focus traps.

### 4.2 Component inventory

| Component | Purpose | Required states |
|---|---|---|
| `PlaySessionRoot` | Primary replacement for library content while a session is active | hidden, loading, active, ending, error |
| `PlaySessionHeader` | Game title, tier/mode, menu access | compact, pointer-visible, fullscreen-hidden |
| `PlaySessionStage` | Aspect-ratio-safe video/external presentation | embedded, fullscreen, external, popout-return |
| `SessionPhaseCard` | Preparing, launching, discovery, capture, and terminal state copy | progress, delayed, failure |
| `SessionStatusBanner` | Non-blocking controller/audio/capture recovery | info, warning, success, persistent |
| `PlaySessionOverlay` | Controller-first command surface | base, capability-disabled, fullscreen |
| `SessionActionList` | Ordered Resume/Fullscreen/Multiplayer/Diagnostics/Pop out/End controls | vertical, two-column-wide |
| `SourceChooser` | Explicit approval for ambiguous capture candidates | loading, candidates, empty, refresh-error |
| `SourceCandidate` | One sanitized candidate window | recommended, selected, unavailable |
| `SessionDiagnosticsPanel` | Safe runtime facts and recovery actions | summary, narrow, capture-error, external |
| `EndSessionConfirm` | Destructive confirmation | owned-process, external-tracking |
| `ExternalSessionPanel` | Truthful status while native window owns play | focused, background, process-ended |
| `PopoutReturnBanner` | Re-enter GameDeck capture/presentation | available, reacquiring, unavailable |
| `SessionSummary` | Concise result after return | normal, external, crash, incomplete |

## 5. Focus model

### 5.1 Session entry

- Save `document.activeElement` and the stable library return anchor before changing the view.
- Focus `#playSession` after it is visible.
- The first Tab stop during preparing and launching is **Cancel launch**.
- Controller navigation does not require DOM focus on the cancel button; the session root remains the controller context.
- Ignore activation input still held from the Play press until every button/key involved has returned to an unpressed state or 500 ms has elapsed, whichever is later.

### 5.2 Playing

When the overlay is closed:

- DOM focus stays on `#playSession` or `#playSessionStage`.
- Gamepad input is forwarded only in the `playing` phase and only when no editable field, chooser, overlay, confirmation, or diagnostics surface owns focus.
- Tab exposes the visible **Open Play Session controls** button.
- No invisible focusable controls may sit over the video.
- Pointer-hidden chrome must become visible before focus moves into it.

### 5.3 Overlay focus order

On open, save the previous focused element and focus **Resume**. The sequential focus order is exactly:

1. Resume
2. Fullscreen / Exit fullscreen
3. Multiplayer
4. Diagnostics
5. Pop out / Return to GameDeck
6. End session

Controller directional navigation wraps. Keyboard Tab does not wrap semantically, but focus is trapped within the modal; Shift+Tab reverses. Disabled actions are skipped by focus while their reason remains associated through `aria-describedby` when shown.

Closing the overlay restores focus to the session stage. Closing a confirmation restores focus to the control that opened it. Closing Diagnostics restores focus to **Diagnostics**.

### 5.4 Source chooser focus

- Focus the first recommended candidate, not **Play in external window**.
- Up/Down moves between candidates.
- Left/Right does not change the selected source.
- A or Enter selects the focused candidate.
- B or Escape closes no process; it returns to discovery once. A second explicit action is required to invoke **Cancel launch**.
- After **Refresh windows**, retain the selected source when it still exists; otherwise focus the new highest-confidence candidate.
- If no candidates remain, focus **Refresh windows** and announce `No game windows found.` once.

### 5.5 Diagnostics focus

Diagnostics is a single active panel, not a modal nested inside another modal. Opening it temporarily replaces the overlay action card within the same dialog container.

Focus order:

1. diagnostics panel heading target (`tabindex="-1"`, programmatically focused);
2. first available recovery action;
3. **Copy safe report**;
4. **Back to controls**.

Static definition-list facts are not made focusable. On narrow screens, the same order applies even when sections become disclosure rows.

### 5.6 Return focus

After the session ends, restore the view and scroll offsets first, render the target card second, then focus the target with `{ preventScroll: true }`. Call `scrollIntoView({ block: 'nearest', inline: 'nearest' })` only when the restored card is outside the visible content viewport.

The session summary appears after the card in reading order but does not steal focus. If a crash requires immediate action, announce the summary and expose **Open diagnostics**; still keep focus on the card unless the player explicitly opens diagnostics.


## 6. Controller map

Use the standard Gamepad mapping where available. Labels adapt to the connected controller family, but behavior remains consistent.

| Input | Playing | Overlay / chooser / diagnostics |
|---|---|---|
| D-pad / left stick | Forwarded to game for Tier A | Move focus spatially or vertically |
| A / Cross / primary | Forwarded to game | Activate focused control |
| B / Circle / back | Forwarded to game | Close top surface or Resume; never end session |
| Guide, when exposed | Open overlay; never forwarded by default | Close overlay and Resume |
| Menu / Start | Open overlay when Guide is unavailable | Close overlay and Resume |
| View / Select | Forwarded when required by the game | No destructive shortcut |
| LB / RB | Forwarded to game | Move between diagnostics sections only if sections exist |
| Menu + Y, held 250 ms | Toggle fullscreen without ending or relaunching | Toggle fullscreen and retain current overlay focus |

Rules:

- Reserve Guide/Menu for GameDeck only after the Play Session becomes active.
- If a game requires the Menu/Start button, expose a per-session control remap in Diagnostics; do not silently make the game unplayable.
- Apply a 250 ms chord grace period so Menu can participate in the fullscreen chord without flashing the overlay first.
- Direction repeat uses the current library convention: initial delay about 330 ms; repeat about every 145 ms, unless usability QA proves a change is needed.
- Ignore held buttons for at least 500 ms on session entry, overlay open, source-list refresh, and focus restoration.
- When a controller disconnects, stop forwarding immediately and clear all held-button state so reconnection cannot synthesize stuck input.
- Controller navigation uses the rendered visual order. Do not create a hidden alternate order for gamepads.
- A destructive action always requires a confirmation surface; there is no hold-to-end shortcut in Phase 1.

## 7. Keyboard and pointer behavior

| Input | Behavior |
|---|---|
| Escape | Open overlay from play. Close the top subpanel first. From the base overlay, Resume. Never directly end the session. In fullscreen, open the overlay before any fullscreen exit. |
| F11 | Toggle GameDeck fullscreen for supported embedded sessions without restarting. For external sessions, announce that fullscreen is controlled by the external game when GameDeck cannot toggle it. |
| Enter / Space | Activate focused controls. Space must not scroll while the session surface owns focus. |
| Arrow keys | Navigate overlays, source rows, confirmations, and diagnostics. They are not forwarded to the game while a GameDeck surface is open. |
| Tab / Shift+Tab | Native sequential focus within the active dialog surface. |
| Alt+Tab / Command+Tab | Preserve the session. On return, verify capture and show a status banner only if recovery is needed. |
| Double-click video | Toggle fullscreen only when pointer input is active and the action is also available through the overlay. |
| Pointer movement | Reveal lightweight chrome; hide it after 2.5 seconds of inactivity while playing. |
| Right-click | No hidden session menu in Phase 1. |

Editable fields, selects, and textareas always suspend gamepad forwarding and global letter-key shortcuts.

## 8. Presentation modes

### 8.1 Embedded

- Video uses `object-fit: contain`.
- Never stretch, crop by default, or force a source into 16:9.
- Letterbox and pillarbox bars use the Play Session background, not a blurred copy of the game frame.
- The stage remains the same DOM node through fullscreen transitions so media tracks are not replaced.
- The video element is not interactive by itself; all controls live in the overlay or visible pointer chrome.

### 8.2 Fullscreen

- Fullscreen is a presentation state of the same session.
- Overlay controls remain available.
- Entering or leaving fullscreen must not restart the process, reacquire the source, reset elapsed time, or drop controller state.
- The first overlay announcement after a toggle is `Fullscreen on` or `Fullscreen off`; do not announce every layout mutation.
- On multi-display systems, use the display containing the GameDeck window unless the player explicitly chooses another display in future settings.
- When the overlay opens in fullscreen, preserve enough of the game stage to make it clear the session is still running; do not replace the entire screen with an unrelated settings page.

### 8.3 Pop-out

Pop-out means the native emulator or game window becomes the presentation surface while GameDeck keeps tracking the same process.

Before pop-out, show a brief confirmation only when GameDeck-owned input will stop:

> The game will move to its own window. Its native controls will take over until you return.

Actions:

- **Pop out**
- **Stay embedded**

After pop-out:

- focus the native game window;
- stop GameDeck input forwarding before native input becomes active;
- keep capture alive only when needed for a quick return and when the architecture reports that doing so is safe;
- show a compact GameDeck return surface when GameDeck regains focus;
- offer **Return to GameDeck**, **Diagnostics**, and **End session**;
- never launch a second process.

Returning to GameDeck attempts to reuse the existing approved source. If the source is gone, enter source discovery and show `The game is still running. GameDeck needs to find its window again.`

### 8.4 Integrated external

The external presentation panel inside GameDeck says:

- Heading: `Playing in an external window`
- Detail: `{engine name} owns this game window and controller input.`
- Status: `GameDeck is tracking the session and will restore your library when it closes.`
- Actions: **Bring game to front**, **Diagnostics**, **Stop tracking / End session** as supported.

Do not show an empty black “embedded” stage or pretend capture is active. Do not use `video` terminology for a Tier B session unless GameDeck is actually capturing it.

### 8.5 Standard external fallback

When capability resolution or capture restrictions require the existing launch path, disclose the reason before launch when possible:

- `This game uses a protected or unsupported window.`
- `Window capture is unavailable in this desktop session.`
- `This emulator has not been verified for embedded controls.`

Then say:

> GameDeck will open the game normally and return to this card when the process closes.

Actions:

- **Open externally**
- **Cancel**
- Optional unchecked setting: **Remember external mode for this game**

The remembered choice is reversible from game details or Diagnostics. Never default the checkbox to checked.

## 9. Aspect ratio and display scaling

### 9.1 16:9 windows and displays

- The play stage occupies the maximum available area after safe application chrome.
- Target stage ratio is determined by the source, not by the app window.
- A 4:3 source is centered with side bars.
- A 16:9 source fills the stage without crop.
- Integer scaling is not required for Phase 1, but the video must remain sharp enough for readable source UI at common 720p and 1080p captures.
- Overlay action card width is capped so it does not span the full screen; target 520–680 CSS px depending on text scaling.

### 9.2 Ultrawide windows and displays

- Keep the source centered and uncropped by default.
- Use outer horizontal space for the overlay action column and diagnostics panel only while those surfaces are open.
- Never stretch a 16:9 game to 21:9 or 32:9.
- On ultrawide fullscreen, the overlay may use a two-column layout: actions on the nearer side, diagnostics summary on the other. DOM focus order remains the linear action order defined above.
- Status banners have a maximum line length and remain near the stage, not at the far edge of the display.

### 9.3 Small desktop and narrow windows

At widths below approximately 760 CSS px, or when text zoom creates equivalent constraint:

- the stage stays first in document order;
- the overlay becomes a bottom sheet or full-height single-column dialog;
- action buttons stack and fill the available width;
- all controls remain at least 44 by 44 CSS px;
- diagnostics facts become grouped disclosure rows, initially opening the section containing the current issue;
- technical details wrap with `overflow-wrap: anywhere` and never create horizontal scrolling;
- source candidates show title and match reason on separate lines;
- no game video thumbnail is required in diagnostics;
- the session summary becomes an inline card after the restored library card.

Phone-sized rendering is a diagnostic/responsive fallback for narrow GameDeck windows, not a promise that desktop embedded play runs as a mobile-web product. On a phone-width receiver or remote diagnostic view, controls may explain the desktop session but must not imply local embedded process ownership.

### 9.4 Minimum viable viewport

At 320 CSS px width and 200% text zoom:

- the active dialog remains operable without horizontal scrolling;
- at least one primary action and the heading are visible without requiring precision scrolling;
- destructive confirmation actions do not overlap;
- video may reduce in height, but controls and status copy take precedence over preserving a cinematic composition.

## 10. Accessibility contract

### 10.1 Names, roles, and descriptions

Required accessible names:

| Element | Accessible name |
|---|---|
| Session root | `Play Session for {game title}` through heading relationship |
| Stage | `Play surface for {game title}` |
| Video | `Live game video for {game title}` |
| Overlay opener | `Open Play Session controls` |
| Fullscreen button | `Enter fullscreen` or `Exit fullscreen` |
| Multiplayer button | `Open multiplayer for {game title}` |
| Diagnostics button | `Open session diagnostics` |
| Pop-out button | `Play in external window` or `Return to GameDeck` |
| End button | `End play session` or `Stop tracking external session` |
| Source list | `Available game windows` |
| Source candidate | `{sanitized title}, {engine}, {match reason}` |
| Controller banner | `Controller disconnected` or `Controller reconnected` |
| Audio banner | `System audio unavailable` |
| Capture banner | `Game picture lost` |
| Summary | `Session complete for {game title}` |

Visible labels should normally match accessible names. Hidden clarification is acceptable for mode-dependent actions, but do not replace visible copy with opaque icon-only controls.

### 10.2 Live regions

- `#playSessionStatus` is one polite atomic live region for phase changes.
- `#playSessionBanner` is one polite atomic live region for recoverable runtime changes.
- The crash/process-exit summary may use `role="alert"` only when user action is required; normal process exit remains polite.
- Do not place elapsed time in a live region.
- Do not announce every progress poll, frame, focus move, or controller packet.
- Deduplicate identical announcements for at least 5 seconds.

### 10.3 Target sizes and spacing

- Every interactive target is at least 44 by 44 CSS px.
- Adjacent destructive and safe actions have at least 8 CSS px separation; 12 px is preferred.
- Source candidates have a minimum 56 px row height for title plus reason.
- Icon-only controls require an accessible name and a visible tooltip after keyboard focus or pointer hover.
- Focus rings are never clipped by stage overflow, modal masks, or rounded containers.
- Focus contrast must meet at least 3:1 against adjacent colors; text follows WCAG AA contrast.

### 10.4 Reduced motion

When `prefers-reduced-motion: reduce` is active or an in-app reduced-motion setting is enabled:

- remove stage zooms, parallax, pulsing glows, animated scan lines, and moving ambient geometry;
- replace overlay slides with an immediate appearance or a simple opacity change of no more than 100 ms;
- make progress indicators static or use a non-moving state label;
- do not auto-pan artwork or game video;
- fullscreen and return transitions have no decorative animation;
- status changes remain visible through copy and icon changes, not motion alone.

No essential timing or focus behavior may depend on animation completion.

### 10.5 Color, sound, and haptics

- Never use color alone to communicate connected, unavailable, external, or failed states.
- GameDeck UI sounds are off by default during active play to avoid mixing with game audio.
- Optional controller haptics for overlay open/close are out of scope for Phase 1.
- An audio-unavailable state must be visible; do not rely on the absence of sound as the only signal.


## 11. Failure and recovery states

Every failure surface includes:

1. player-readable heading;
2. one-sentence explanation;
3. technical detail suitable for local diagnostics;
4. one recommended primary action;
5. a safe exit path.

The technical detail is collapsed by default and sanitized before display or copy.

### 11.1 Controller disconnected

Trigger: the active Gamepad disappears or stops reporting while GameDeck owns Tier A input.

Immediate behavior:

- stop forwarding all controller events;
- clear held-button state;
- keep the game process and capture running;
- show a persistent non-modal banner;
- do not force the overlay open unless no alternate input is available and the player tries to interact.

Copy:

- Heading: `Controller disconnected`
- Detail: `Reconnect it to keep playing. GameDeck has stopped controller input so no buttons remain held.`
- Actions: **Open controls** and, when keyboard fallback is known to work, **Keep playing with keyboard**.

On reconnection:

- require all buttons to be released before forwarding resumes;
- announce `Controller reconnected. Press a button to continue.`;
- dismiss the banner only after a clean input edge;
- do not auto-assign a different physical pad to Player 1 if multiple controllers are present without an explicit choice.

### 11.2 System audio unavailable

Trigger: video capture succeeds but system-audio capture is unsupported, denied, or absent.

Behavior:

- continue the session with video and controls;
- show one non-blocking warning banner for at least 8 seconds;
- keep an `Audio · Unavailable` fact in Diagnostics;
- never label the whole session failed.

Copy:

- Heading: `Game audio is unavailable here`
- Detail: `The game is still playable. This desktop session did not provide system audio to GameDeck.`
- Primary action: **Continue without audio**
- Secondary action: **Open diagnostics**

Do not say “muted” unless GameDeck knows the source is intentionally muted. Do not promise that changing volume will fix an unsupported loopback path.

### 11.3 Capture lost

Trigger: the approved video track ends, freezes beyond the confirmed threshold, or the source disappears while the process remains alive.

Immediate behavior:

- stop GameDeck-owned input forwarding unless the player deliberately chooses external mode;
- preserve the process;
- reveal a blocking recovery surface over the stage;
- announce once using an assertive alert because blind input would be unsafe.

Copy:

- Heading: `Game picture lost`
- Detail: `The game is still running, but GameDeck can no longer see its window.`
- Primary action: **Find game window**
- Secondary action: **Play in external window**
- Safe exit: **End session** or **Stop tracking**, depending on process ownership.

`Find game window` returns to bounded source discovery. If one high-confidence replacement is found, show it as a single confirmation instead of silently switching. If multiple candidates exist, open the source chooser.

### 11.4 Process crash or unexpected exit

Trigger: tracked process exits outside a user-requested end sequence or reports a failure code.

Behavior:

- stop capture and input immediately;
- leave fullscreen;
- return to the exact library card;
- show the crash summary adjacent to that card;
- make safe diagnostics available;
- do not auto-relaunch.

Copy:

- Heading: `The game closed unexpectedly`
- Detail: `GameDeck returned you to the library. Your game files were not changed.`
- Actions: **Open diagnostics**, **Try again**, **Dismiss**

Show **Try again** only when the engine/runtime remains available and no repeated-crash suppression is active. After two unexpected exits for the same title in 10 minutes, replace **Try again** with **Review setup** and avoid a restart loop.

Do not claim saves are safe unless the engine confirms save completion. The generic assurance is limited to GameDeck not changing the game files as part of recovery.

### 11.5 Source timeout

Trigger: source discovery reaches the architecture timeout without a safe automatic choice.

Copy:

- Heading: `Game window not found`
- Detail: `The game may be open, but GameDeck could not safely identify its window.`
- Primary action: **Choose a window** when candidates exist, otherwise **Look again**
- Secondary action: **Play in external window**
- Safe exit: **Cancel session**

If no candidates exist, do not show an empty radio group. Explain possible causes in Diagnostics only:

- game still starting;
- capture permission unavailable;
- Wayland or protected window restriction;
- engine opened no new window;
- process ended before capture.

### 11.6 Capture denied

Copy:

- Heading: `Window capture was not allowed`
- Detail: `GameDeck cannot show the game inside the app without permission to capture its window.`
- Primary action: **Try capture again**
- Secondary action: **Play in external window**
- Optional platform action: **Open system settings**, only when the app can open the exact relevant settings surface.

Never instruct the player to disable operating-system security or capture the entire display as a workaround.

### 11.7 Launch failed

Copy:

- Heading: `The game did not start`
- Detail: use the most specific player-safe reason available, such as `Managed RetroArch is not ready` or `The selected game file is no longer available.`
- Primary action: **Review setup** or **Try again**, selected from the failure class.
- Secondary action: **Open diagnostics**
- Safe exit: **Back to library**

Do not show raw stack traces in the main surface.

### 11.8 Engine unavailable

Copy:

- Heading: `Game engine needs attention`
- Detail: `{engine name} is missing, damaged, or not ready for this title.`
- Primary action: **Repair engine** when a managed repair path exists, otherwise **Review setup**
- Safe exit: **Back to library**

If an external engine is available as a fallback, state the tradeoff:

> You can open this game externally, but embedded controls and capture will not be available.

### 11.9 Multiplayer unavailable

The overlay's **Multiplayer** action may be unavailable while the local session remains healthy.

Copy associated with the disabled state:

- `Multiplayer is not available for this session mode.`
- `Finish source recovery before opening Multiplayer.`
- `This engine has not been verified for synchronized or remote multiplayer.`

Never end or restart the local session merely to open the Multiplayer surface unless the player explicitly chooses a mode that requires it.

## 12. Diagnostics experience

Diagnostics answers three questions in this order:

1. Is the game process still running?
2. Is GameDeck receiving picture, audio, and controller input?
3. What can the player do next?

### 12.1 Player-facing facts

Show these facts when available:

- Session mode: Embedded, Fullscreen, Pop-out, or External
- Compatibility tier: Embedded verified, Embedded experimental, Integrated external, or External only
- Engine label and version, when safe
- Process state: Starting, Running, Exited, or Untracked
- Video: Connecting, Ready, Lost, or Not used
- Audio: Connecting, Ready, Unavailable, or Not used
- Controller: Connected, Disconnected, Keyboard fallback, or Native external input
- Elapsed session time
- Last transition: player-readable phase and local time
- Recommended action

Technical details may additionally include a sanitized error code, capture-source category, operating system, application version, and whether recovery has been attempted. Do not expose raw source IDs, PIDs, filesystem paths, usernames, machine names, network addresses, invite strings, access tokens, or full command lines.

### 12.2 Safe report

**Copy safe report** produces plain text with:

- GameDeck version
- OS and architecture
- session tier and mode
- engine label/version
- phase timeline with relative durations
- picture/audio/controller statuses
- sanitized error code and recommended action
- whether fullscreen, pop-out, or recovery was attempted

The report explicitly omits game file paths, source-window thumbnails, source IDs, process IDs, credentials, network addresses, multiplayer invitations, and personal account information.

Copy confirmation: `Safe session report copied.`

### 12.3 Narrow diagnostics behavior

Below the narrow breakpoint, group facts into three disclosure sections:

1. **Session** — mode, tier, engine, process
2. **Picture and sound** — video, audio, source recovery
3. **Controls and next step** — controller, input ownership, recommended action

The section containing the active problem opens by default. Only one section needs to be open at a time, but closing all sections is allowed. Disclosure buttons are at least 44 px tall and use `aria-expanded` plus `aria-controls`.

## 13. Copy language system

### 13.1 Voice

- Calm, direct, and specific.
- Prefer verbs the player recognizes: `Starting`, `Finding`, `Connecting`, `Playing`, `Returning`.
- Name the owner of an action: `GameDeck is finding the game window`; `{engine} owns this external window`.
- Use “window,” “picture,” “sound,” and “controller” in primary copy. Reserve “capture source,” “media track,” and process terminology for Diagnostics.
- Avoid blame: do not say `You denied permission` or `Your controller failed`.
- Avoid false universality: never say `Play any game inside GameDeck`.
- Avoid false pause claims: use `Play Session controls open` unless pause is confirmed.
- Avoid network language for local capture: do not call the embedded video a stream unless discussing GameDeck Live or Remote Play.

### 13.2 Preferred copy table

| Situation | Use | Avoid |
|---|---|---|
| Start | `Preparing Selected game` | `Booting universal embedded mode` |
| Discovery | `Finding the game window` | `Scanning your desktop` |
| Capture | `Connecting the play surface` | `Streaming locally` |
| Embedded success | `Playing inside GameDeck` | `Every game now runs in GameDeck` |
| External tier | `Playing in an external window` | `Embedding failed` |
| Audio missing | `Game audio is unavailable here` | `Audio broken` |
| Controller missing | `Controller disconnected` | `Input device error 04` |
| Capture lost | `Game picture lost` | `MediaStreamTrack ended` |
| Timeout | `Game window not found` | `desktopCapturer timeout` |
| Normal end | `Session complete` | `Process terminated` |
| Crash | `The game closed unexpectedly` | `Fatal child exception` |
| Pop-out | `Play in external window` | `Detach renderer` |
| Return | `Return to GameDeck` | `Reattach capture` |

### 13.3 Status announcement cadence

- Announce the phase only when it changes.
- Announce delayed status at 4 seconds, then no more than once every 8 seconds unless the recommended action changes.
- Do not repeat `Still working` indefinitely.
- A successful transition clears the prior warning visually and announces a short recovery message, such as `Game picture restored.`

## 14. Return-to-library contract

The exact return anchor is captured before launch and survives all presentation changes.

Required restored state:

- active top-level view;
- selected system;
- system-rail scroll position;
- library content scroll position;
- search query;
- sort and filter values;
- focused game card;
- card's visual selected state;
- prior controller/pointer input mode;
- open/closed state of non-modal library detail surfaces that can be safely restored.

Do not reopen a modal that was closed by entering the Play Session. Do not restore stale destructive confirmations.

### 14.1 Session summary contents

Required:

- game title;
- rounded elapsed duration;
- Embedded or External mode;
- end reason: normal, player ended, external process closed, capture failed, or unexpected exit;
- one action only when needed: **Open diagnostics**.

Optional, only when confirmed:

- `Controller reconnected once`
- `Played without system audio`
- `Returned from pop-out`

Never include achievements, performance scores, game progress, or save claims unless a future game integration explicitly provides them.

### 14.2 Summary persistence

- Visual summary stays for 12 seconds or until dismissed.
- It pauses its auto-dismiss timer while keyboard focus or pointer hover is inside it.
- It remains in the Status Center for the current app session.
- It is not uploaded and does not create a cloud history.
- If a new Play Session begins, the previous inline summary is dismissed but may remain in local Status Center history.


## 15. Multiplayer entry from an active session

The overlay's **Multiplayer** action opens the existing multiplayer experience without ending, relaunching, or replacing the tracked local process.

Required behavior:

- preserve the Play Session as the background context;
- suspend local game input while Multiplayer controls own focus;
- pass the current game/session identity to the multiplayer surface rather than relying on whichever library card is globally focused;
- return focus to **Multiplayer** in the Play Session overlay when the multiplayer surface closes;
- resume game input only after the overlay itself closes;
- keep local embedded capture distinct from GameDeck Live and Remote Play state;
- never start remote viewers merely because the local Play Session is embedded.

If the chosen multiplayer path requires a presentation or input-mode change, explain it before applying it. Example:

> Remote Play will share this session with invited players. Your local embedded game remains active.

For synchronized netplay that requires a restart or exact-match launch contract, use:

> Synchronized netplay starts a new coordinated session. Your current session must end first.

Actions are **End and set up netplay** and **Keep playing**. The safe action receives initial focus.

## 16. Privacy, security, and content boundaries

- Capture only a source approved through the architecture contract.
- Never use full-display capture as a silent fallback.
- Never persist source thumbnails or gameplay frames.
- Never include a gameplay frame in a crash report, diagnostic copy, or session summary.
- Never send local embedded capture over a network unless the player separately starts a Remote Play or GameDeck Live action.
- Keep GameDeck renderer sandboxing, context isolation, navigation denial, and no-Node guarantees intact.
- Treat candidate window titles as potentially sensitive: sanitize, truncate visually, and omit them from copied reports unless they match a known engine label or game title already visible in the library.
- Do not expose process IDs or native window handles in the renderer DOM.
- Rate-limit GameDeck-owned input and suspend it whenever UI controls own focus.
- End local capture when the tracked process exits, even if the renderer is not visible.
- Do not use copyrighted game imagery in shipped placeholders, tests, screenshots, or documentation examples.
- Do not make a universal embedding claim in UI, onboarding, release notes, or accessibility labels.

## 17. Acceptance measurements and gates

These measurements are QA evidence for the feature. They do not require behavioral telemetry, account correlation, cloud analytics, or gameplay recording.

### 17.1 Phase-transition gates

For an Embedded verified managed-libretro title on the reference Windows system:

- Play activation produces visible `preparing` feedback within 250 ms at the 95th percentile across 20 launches.
- The session reaches the first decoded frame within 10 seconds at the 90th percentile across 20 warm-runtime launches.
- No phase remains visually silent for more than 1 second.
- Each phase change produces no more than one screen-reader announcement.
- Duplicate Play activation while launching produces one session, one process, and no duplicate capture request.

For Integrated external and External-only titles:

- truthful external copy appears before GameDeck gives focus to the native window;
- no embedded badge or live-video label is shown;
- the existing launch path remains usable when embedded capability is unavailable.

### 17.2 Controller gates

Using Xbox, DualSense, Switch Pro, and one generic standard-mapping controller where available:

- Guide or Menu opens the overlay in no more than 300 ms after a clean button edge.
- A activates every overlay, source chooser, diagnostic, and confirmation control.
- B closes the top UI surface and never ends a session.
- held input from Play does not activate **Resume**, **Cancel launch**, or a source candidate.
- controller disconnect stops forwarding within one polling interval and never leaves a held gameplay button active.
- reconnection requires a clean release before input resumes.
- all required actions are reachable without mouse or keyboard.
- the Menu + Y fullscreen chord does not flash the overlay or forward an unintended Menu press to the game.

### 17.3 Keyboard and focus gates

- Play Session entry focus lands on the session root.
- Escape always opens or closes the top Play Session surface and never directly terminates the process.
- F11 toggles supported GameDeck fullscreen without relaunch or source reacquisition.
- Tab and Shift+Tab remain trapped in the active dialog and visit controls in the specified order.
- closing Overlay, Diagnostics, Source Chooser, Multiplayer, or End confirmation restores focus to the initiating control.
- session end restores focus to the exact library card with `preventScroll` behavior.
- if the card is gone, fallback focus follows the documented four-step order.
- no hidden or pointer-transparent element receives focus.

### 17.4 Accessibility gates

- Every interactive target is at least 44 by 44 CSS px at 100% and 200% zoom.
- All controls have programmatically determinable accessible names that match their visible action.
- dialog heading and description relationships pass automated accessibility checks.
- only one modal surface is exposed at a time.
- no live region announces elapsed time or repeated polling.
- color is never the sole signal for connection or failure status.
- focus indicators meet 3:1 contrast and remain visible against gameplay, letterbox bars, and modal surfaces.
- at 320 CSS px width and 200% text zoom, active controls remain operable without horizontal page scrolling.
- with reduced motion enabled, no pulsing, parallax, stage zoom, or sliding transition remains.

### 17.5 Source-selection gates

- automatic selection occurs only for one architecture-approved high-confidence candidate.
- ambiguous candidates always open the chooser.
- unrelated pre-existing windows never appear in the candidate list.
- the chooser is fully operable by controller and keyboard.
- source refresh preserves focus when the candidate survives.
- selecting external mode never launches a second process.
- no candidate thumbnail, title, or source ID is persisted after the chooser closes.

### 17.6 Mode-switching gates

Across 20 repeated cycles for a supported title:

- Embedded -> Fullscreen -> Embedded preserves the same process, media stream, elapsed timer, and controller assignment.
- Embedded -> Pop-out -> Return preserves the same process.
- Return uses the existing approved source when still valid; otherwise it enters explicit recovery.
- mode switching causes zero orphaned emulator processes.
- overlay access remains available in fullscreen.
- a 4:3 source remains uncropped in 16:9 and ultrawide windows.
- a 16:9 source is never stretched to ultrawide.

### 17.7 Recovery gates

- Audio unavailable reaches `playing` with visible warning and no launch failure.
- Controller disconnect preserves video/process and shows the persistent recovery banner.
- Capture loss stops forwarded input, preserves the process, and exposes **Find game window**, **Play in external window**, and a safe exit.
- Source timeout never captures the entire screen or an unrelated window.
- Unexpected process exit stops all media tracks and input listeners before library return.
- Two repeated crashes suppress automatic retry loops and route to setup/diagnostics.
- End session stops GameDeck-owned capture and leaves no active tracks, timers, sockets, or session listeners.
- External fallback copy never promises that GameDeck can terminate an unowned process.

### 17.8 Return and summary gates

Test return from Library, Favorites, Recent, a filtered system shelf, a search result, and a scrolled grid:

- active view, selected system, query, sort, filter, and scroll position are restored;
- focus returns to the exact card or documented fallback;
- the card remains visible;
- the session summary is announced once but does not steal focus;
- summary duration is rounded and accurate within one minute;
- summary contains no private path, process/source identifier, network information, or copyrighted image;
- normal, external, player-ended, capture-failed, and crash end reasons produce truthful distinct summaries.

### 17.9 Responsive and visual gates

Verify at minimum:

- 1920x1080, 1440x900, 1280x720, 820x900, 390x844, and one 3440x1440 ultrawide viewport;
- 100%, 150%, and 200% text zoom;
- default motion and reduced motion;
- controller, keyboard, and pointer input modes.

Pass conditions:

- no horizontal application scroll at narrow widths;
- no clipped focus ring;
- no action overlap;
- no letterbox text or status placed outside the visible safe area;
- diagnostic details wrap without expanding the stage beyond the viewport;
- source video remains contained and uncropped by default;
- no shipped placeholder contains commercial game art or a recognizable game screenshot.

### 17.10 Performance evidence

Report rather than guess:

- Play press to first visible phase;
- process spawn to first candidate;
- candidate approval to first decoded frame;
- controller edge to forwarded packet under the existing input path;
- fullscreen toggle duration;
- capture recovery duration;
- CPU/GPU impact at 720p60 and 1080p60 on reference hardware;
- media-track, listener, timer, and process counts after 20 launch/end cycles.

Targets inherited from the architecture are first frame under 10 seconds, local display latency under 50 ms on the reference Windows system, and 60 fps at 1080p where source and hardware support it. Product copy must not expose these as guarantees until compatibility QA has evidence for the specific engine/platform combination.

## 18. Explicit non-goals

- Embedding every arbitrary game or emulator window.
- Native window reparenting as the cross-platform default.
- Capturing DRM, anti-cheat, or protected content.
- Replacing GameDeck Live with local embedded capture.
- Starting Remote Play automatically.
- Capturing full displays to avoid source ambiguity.
- Gameplay recording, screenshots, achievements, save-state management, or game-progress analysis.
- Shipping commercial game art in placeholders or examples.
- Mobile-native process embedding.
- A destructive controller shortcut.
- Redesigning the existing multiplayer flows beyond the focus and session-context bridge needed by the overlay.

## 19. Renderer ownership request after `qa/discord-free-product` clears

Product / UX should request bounded write ownership of exactly these renderer files for implementation:

1. `src/index.html` — Play Session landmarks, dialogs, live regions, source chooser, diagnostics, summary, and the new renderer module include.
2. `src/styles.css` — stage layout, aspect-ratio containment, fullscreen and ultrawide modes, 44 px targets, focus visuals, narrow diagnostics, and reduced-motion rules.
3. `src/app.js` — intercept Play into the session start contract, capture/restore the library return anchor, arbitrate global controller/keyboard input, and render the post-session summary.
4. `src/play-session.js` **(new)** — Play Session state renderer, focus management, overlay, source chooser, capture attachment, recovery surfaces, mode switching, diagnostics presentation, and cleanup.
5. `src/streaming.js` — narrowly extract or expose reusable local capture acquisition without starting GameDeck Live signaling; preserve strict separation between embedded capture and network streaming.
6. `src/netplay.js` — accept active-session context and a return-focus target when Multiplayer opens from the Play Session overlay.

Do not request `main.js`, `preload.js`, `netplay-manager.js`, or `stream-server.js` as Product / UX ownership. The architecture, multiplayer, and security owners should implement and review the process lifecycle, IPC bridge, source filtering, input bounds, and termination semantics there.

Before implementation begins:

- rebase this design branch onto the integration commit that clears `qa/discord-free-product`;
- confirm none of the six renderer files is actively owned by another lane;
- obtain the final IPC capability/status schema from the Embedded Play architecture owner;
- obtain Security approval for capture consent, safe diagnostics fields, and source-title sanitization;
- obtain QA agreement on stable state attributes and acceptance fixtures.

## 20. Re-review checklist

Product / UX requests re-review from:

- **Embedded Play architecture owner:** state names, capability tiers, source-selection contract, pop-out semantics, and process-ownership language.
- **Multiplayer Platform / Network Reliability:** active-session Multiplayer handoff, input suspension, and separation from GameDeck Live/Remote Play.
- **Security / Release:** approved-source consent, no full-display fallback, diagnostics redaction, capture cleanup, external-process termination language, and packaging constraints.
- **Compatibility Lab:** tier labels, verified/experimental wording, external fallback reasons, controller families, 16:9/ultrawide behavior, and platform-specific audio/capture limitations.
- **Accessibility / QA:** focus restoration, controller map, keyboard Escape/F11 behavior, live-region cadence, 44 px targets, 200% zoom, reduced motion, narrow diagnostics, and measurable gates.
- **General Orchestrator:** renderer file ownership after `qa/discord-free-product` clears and confirmation that no overlapping implementation begins before that handoff.

Approval should be recorded against this document before renderer implementation. Reviewers should identify any copy that overstates embedding, capture, pause, termination, audio, controller, or save guarantees.
