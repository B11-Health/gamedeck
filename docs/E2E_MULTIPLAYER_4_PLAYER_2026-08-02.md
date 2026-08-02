# GameDeck multiplayer E2E QA — 2026-08-02

## Result

**PASS — 33/33 checks** across static regression coverage, live renderer behavior, synchronized relay hosting, Remote Play capture/invitation, and Couch Co-op launch. No renderer exceptions were recorded.

## Test environment

- Windows desktop Electron development build
- GameDeck 1.2 working tree
- RetroArch with FinalBurn Neo
- 1504 × 904 renderer viewport
- New York RetroArch relay

## Test games

### Metal Slug 3

Used as the two-player compatibility target. GameDeck correctly displayed a four-slot lobby while keeping only P1 and P2 playable. P3 and P4 were marked **LOCKED** in Couch Co-op, Remote Play, synchronized setup, and active-session states.

Verified local identifiers:

- Game ID: `D5B6-0499-CA84`
- Core ID: `22A0-AE11-DCE0`
- Core: FinalBurn Neo

### Dungeons & Dragons: Shadow over Mystara

Automatically discovered from the installed library as a native four-player target. P1 through P4 were available, and both Remote Play and synchronized player selectors exposed 2, 3, and 4 players.

## Coverage

- Four lobby positions rendered consistently
- Native two-player limit enforced for Metal Slug 3
- Four connected-controller simulation capped at Metal Slug 3's two-player limit
- Native four-player title unlocked all four positions
- Game/core match ID copying
- `GDPLAY1` synchronized invitation routing
- `GDREMOTE2` Remote Play invitation routing
- `GDREMOTEANSWER2` host-response routing
- Invalid clipboard content rejection
- New York synchronized relay publication
- Synchronized invitation generation and clipboard copy
- Remote Play game launch, capture startup, and P2 invitation generation
- Laptop-height setup and active-session layouts without overflow
- Couch Co-op button launch through RetroArch and FinalBurn Neo
- Session shutdown and emulator cleanup
- Zero renderer exceptions

## Live session evidence

### Synchronized netplay

- Relay state reached `ready`
- Relay region: New York
- Invitation prefix: `GDPLAY1.`
- Invitation length: 760 characters
- Active lobby remained fully visible without internal scrolling

### Remote Play Together

- Host state reached `ready`
- GameDeck Live capture completed
- Encrypted P2 invitation generated
- Invitation length: 1,718 characters
- Active lobby remained fully visible without internal scrolling

### Couch Co-op

The UI closed after launch and reported success. The resulting process used RetroArch, the FinalBurn Neo core, the GameDeck arcade controller profile, and the installed `mslug3.zip` archive.

## Defects found and fixed during QA

1. The initial player rail rendered only the native game count. It now always presents four positions and visibly locks unsupported slots.
2. The four-player setup view overflowed a 904px-high desktop viewport. A height-aware compact layout now keeps setup and active sessions fully visible.
3. The first Remote Play assertion sampled the launching phase before capture and invitation creation. The E2E condition now waits for the invitation or an actionable error.
4. Screenshot review found that the active room retained the setup card, duplicated the game title, preserved a stale scroll position, and exposed too many controls. Active sessions now reset to the top and use one dedicated live dashboard.
5. The Remote Play host exposed **Connect this player** before a response existed. The action now appears only after a response code is pasted or typed.

## Post-matrix visual regression review

The final Metal Slug 3 setup and live states were rechecked at 1504 × 904 after the hierarchy changes:

- setup shows one primary action, one quiet paste-invite utility, collapsed session options, one game title, and no overflow
- synchronized and Remote Play live states hide the setup card and diagnostics
- the active player rail remains visible with P3 and P4 marked as a two-player-game limit
- the player counter uses singular **PLAYER** at one participant
- the live Remote Play state exposes only End Session, Copy Invite, and a quiet Discord link until a response is available

## Privacy

The committed QA evidence excludes temporary passwords, full invitations, peer/session identifiers, and machine-specific absolute paths.
