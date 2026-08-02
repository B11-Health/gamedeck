# GameDeck 1.2.0 End-to-End Validation Report

**Report date:** August 2, 2026
**Current branch:** `main`
**Runtime validation commit:** `77d0f3971e88f1c1294ace6353a25c97b771443d`
**Official v1.2.0 release commit:** `250bbd7bc3b929fe49205ee6c0695654426f49b2`
**Primary platform:** Windows 11 x64 (`10.0.26200`)
**Test hardware:** AMD Ryzen AI 5 340 with Radeon 840M, 15.3 GiB RAM
**Runtime:** Node.js 22.19.0, Electron 43.2.0, GameDeck 1.2.0

## Executive verdict

GameDeck 1.2.0 passes the tested desktop installation, library, responsive UI, streaming, and Remote Play Together paths. The application scanned 221 games, exposed 22 configured systems, detected an Xbox controller, launched Street Fighter II through FinalBurn Neo, established an encrypted two-client Remote Play session, delivered 1152×720 guest video, and forwarded native Player 2 input without renderer or activity errors.

The highest-impact issue found during this pass was that the original WebRTC offer and answer strings exceeded Discord's normal 2,000-character message limit. The product now serializes plain SDP objects, restricts media negotiation to VP8 and Opus, and applies built-in Brotli compression. The verified offer is 1,733 characters and the verified answer is 1,320 characters.

## Result summary

| Area | Result | Evidence |
|---|---:|---|
| JavaScript syntax and product smoke suite | PASS | `npm test`; all main, preload, renderer, streaming, multiplayer, mobile-web, and DOM contracts passed |
| Library scan | PASS | 221 games discovered |
| System routing | PASS | 22 of 22 configured systems reported ready in the source-machine validation environment |
| Controller detection | PASS | Xbox Wireless Controller detected |
| Responsive header | PASS | No header overlap or document overflow at 1500, 1280, 1120, or 980 px |
| Navigation | PASS | Library, Discover, Favorites, Recent, and Community activated correctly |
| Search and clear | PASS | “Street Fighter” reduced the view to nine games; Clear restored the query |
| Header overflow accessibility | PASS | Menu opened, exposed Setup/Status/Refresh/Tutorial, and closed through Escape/click-away behavior |
| Arcade launch | PASS | Street Fighter II: The World Warrior loaded through FinalBurn Neo with no missing files |
| GameDeck Live capture | PASS | RetroArch game window captured at the balanced profile with audio enabled |
| Remote Play host | PASS | Private session created for SF2; host showed two players after pairing |
| Remote Play invitation | PASS | `GDREMOTE2` offer: 1,733 characters, 267 below Discord's limit |
| Remote Play response | PASS | `GDREMOTEANSWER2` response: 1,320 characters, 680 below Discord's limit |
| Guest media | PASS | Remote video ready state 4 at 1152×720 |
| Guest input | PASS | 18 input transitions received; latest input attributed to Player 2 |
| Renderer/activity health | PASS | No errors reported by either isolated client |
| Mobile receiver source contracts | PASS | PWA, Android WebView, and iOS SwiftUI/WKWebView sources included and smoke-checked |
| Official cross-platform release | PASS | Windows installer/portable, universal macOS DMG/ZIP, and Linux AppImage/DEB published from `250bbd7`; SHA-256 digests recorded below |
| Production code signing | NOT CONFIGURED | Windows artifacts are unsigned and may trigger SmartScreen |
| Direct WebRTC on restrictive NAT | CONDITIONAL | Direct STUN path works; symmetric/corporate NAT may require a future TURN relay |
| Discord account and community | PASS | `gamedeckhq` is email-verified; the **GameDeck Community** server, permanent invite, and starter channels are live |
| YouTube channel and launch funnel | PASS | Branded `@PlayGameDeck` channel; tutorial, trailer, two public Shorts, one scheduled Short, Start Here playlist, Shorts playlist, public banner/avatar, and entire-video watermark verified |
| Social distribution | PASS / LIMITED | Release and Shorts posts published in verified Discord channels; Reddit remains unauthenticated, TikTok requires manual age-gate completion, and X/LinkedIn remain unauthenticated |
| Android/iOS store binaries | PLATFORM BUILD REQUIRED | Source-complete clients exist; signed store artifacts require Android/macOS signing environments |

## Detailed validation

### 1. Installation and managed runtime

The release workflow packages the verified RetroArch application, the compatible Libretro core bundle, and the archive helper. The final build from commit `77d0f39` was launched with a new isolated profile. Its embedded runtime installed into the profile-owned GameDeck directory and reached `ready`, `100%`, with no activity errors. The packaged UI then passed the 1500, 1280, 1120, and 980 px header checks, exposed the published tutorial action, returned keyboard focus after Escape, and reported zero renderer errors.

Official v1.2.0 release artifacts published from `250bbd7bc3b929fe49205ee6c0695654426f49b2`:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `GameDeck-Setup-1.2.0-x64.exe` | 539,670,662 | `6677c63e871915d1dc001866d36255e126963bb3cc057be0c9c847af28ad0654` |
| `GameDeck-Portable-1.2.0-x64.exe` | 539,462,459 | `eaeb1336db3bf643621c843d4fcfde4e379868422e161bea72cff92c029de634` |
| `GameDeck-1.2.0-mac-universal.dmg` | 988,036,017 | `c005bb0ee33697e7619d931b3ff7783ec65eabc38f061998823c2b348744e3a3` |
| `GameDeck-1.2.0-mac-universal.zip` | 986,791,905 | `5d54c3139c7cb8ea0e3da9d6703862ecd458a35d868daf2ee3f2537efa672aaf` |
| `GameDeck-1.2.0-linux-x86_64.AppImage` | 590,297,612 | `01f4cef6f9c1bbab907adc9425e927439a0c1b532d23735fbe9c6bfb05029cb5` |
| `GameDeck-1.2.0-linux-amd64.deb` | 561,237,536 | `1a960af1d164037e256b7a0aef2d93f1c09856cb5628ba43f2bb32bf154eefcd` |

Per-platform checksum manifests are attached to the GitHub release. Windows Authenticode, Apple code signing/notarization, and Linux package signing are not configured; operating-system warnings remain possible.

GameDeck does not bundle commercial games or copyrighted console firmware. BIOS-dependent systems continue to guide the user toward firmware they legally own.

### 2. Library and interface

The live collection contained 221 games across 22 systems. The two-tier header retained only Play Online, Go Live, and More as primary actions while keeping library count, engine state, transfers, and controller status visible below. The header did not overlap or create horizontal document scrolling at GameDeck's 980 px minimum or the tested larger widths.

All primary views activated correctly. Search, clear search, selected-game details, artwork actions, safe removal affordances, and setup/status routing remained operational. No renderer errors were recorded.

### 3. Arcade execution

The validated arcade title was **Street Fighter II: The World Warrior (World 910522)** using FinalBurn Neo. The core located the installed `sf2` set, reported no missing files, initialized the driver, and started the game successfully.

### 4. Remote Play Together

Two isolated GameDeck instances were used as host and guest.

1. The host selected SF2 and started Remote Play Together.
2. GameDeck opened RetroArch with Remote RetroPad enabled for Player 2.
3. GameDeck Live captured the running game window.
4. A compressed `GDREMOTE2` offer was generated.
5. The guest pasted the offer and generated a compressed `GDREMOTEANSWER2` response.
6. The host accepted the response.
7. The host and guest both displayed two players.
8. The guest received 1152×720 video.
9. Keyboard/gamepad transitions traversed the WebRTC data channel and reached the host's localhost RetroArch UDP input queue.

Measured code sizes:

- Host offer: **1,733 characters**
- Guest response: **1,320 characters**

Measured input/media evidence:

- Guest video ready state: **4**
- Guest video dimensions: **1152×720**
- Input transitions received: **18**
- Last remote player: **Player 2**
- Host errors: **0**
- Guest errors: **0**

Only the host needs the game. The invite does not transfer the ROM, BIOS, save files, or commercial content.

### 5. GameDeck Live

The host captured the active RetroArch FinalBurn Neo window with audio enabled through Electron/Chromium capture APIs. The local receiver server generated a six-digit pairing code and LAN receiver URL. No OBS, WebSocket, or third-party WebRTC runtime dependency is included in the product dependency set.

### 6. Mobile clients

The repository contains:

- Installable browser/PWA receiver
- Android WebView shell
- iOS SwiftUI/WKWebView shell

The source and packaging contracts passed on Windows. Native signing and store packaging were not represented as complete because they require Android and macOS signing toolchains and store credentials.

### 7. Credential and Discord workflow

The Discord identity is verified and operational:

- Project mailbox: verified; the address is intentionally omitted from public evidence
- Display name: `GameDeck`
- Username: `gamedeckhq`
- Age eligibility: confirmed during registration; the birth date is not stored in the repository
- Credential target present in Windows Credential Manager: `GameDeck-Discord`

The credential secret was not read, printed, committed, or copied into the report. A separate ACL-restricted metadata record is stored outside the repository at `%APPDATA%\GameDeck\accounts\discord.json`; it contains account and community identifiers but no password field.

Discord email verification completed successfully. The **GameDeck Community** server was created with the official GameDeck icon and the following initial structure:

- `#general`
- `#announcements`
- `#remote-play`
- `#support`
- `#showcase`
- `General` voice channel

The launch/tutorial message is published in `#general` and `#announcements`. The permanent invite is:

- `https://discord.gg/eS7d4VqTT`

The app now includes a first-class Discord community hub with direct routing to `#remote-play`, `#announcements`, `#support`, and `#showcase`. Remote Play host invitations and guest responses can be formatted as paste-ready Discord messages; the renderer checks the 2,000-character limit and falls back to the raw encrypted code when needed.

The community hub was validated in the real Electron renderer at 1500, 1120, and 980 px. All actions remained visible, cards did not overlap, and neither the document nor body produced horizontal overflow.

### 8. Tutorial, Shorts, and publication

A 100.66-second, 1280×720 VP9/Opus tutorial was produced from real GameDeck UI states and the validated SF2 Remote Play session. It includes narration, a custom 1280×720 thumbnail, chapters, repository links, and ownership/privacy guidance. YouTube reported **Checks complete. No issues found**.

Verified YouTube surfaces:

- Channel: `https://www.youtube.com/@PlayGameDeck`
- Tutorial: `https://youtu.be/vY-fFVu2ClM`
- Launch trailer: `https://youtu.be/0nCHy9WsEpQ`
- Public Short — one beautiful library: `https://youtube.com/shorts/ndETcPuCOyE`
- Public Short — better than folders: `https://youtube.com/shorts/dOEuy8g8Bmw`
- Scheduled Short — setup should explain itself: `https://youtube.com/shorts/ZZ-hHyyj5Lw`, August 3, 2026 at 12:00 PM Eastern
- Start Here playlist: `https://www.youtube.com/playlist?list=PLG-ejeCsa-AI`
- Shorts playlist: `https://www.youtube.com/playlist?list=PLCbffYifS8R8`

The channel profile has a public GameDeck banner and avatar, canonical website/GitHub/Discord links, an enabled Home tab, public Videos/Shorts/Playlists shelves, and a watermark configured for the entire video. Every video description links internally to both playlists. YouTube one-time channel verification remains required before external description links and related-video controls become clickable.

The public GameDeck site embeds both live Shorts and links to the playlists without behavioral click telemetry. Reddit remained unauthenticated behind a humanity challenge. TikTok Google sign-in reached the official age gate, which requires manual owner completion; no automation bypass or fabricated post was used. X and LinkedIn remained unauthenticated.

### 9. Security and privacy checks


- No credential files exist inside the Git repository.
- Remote Play invitations expire and bind to a session, player slot, and random token.
- WebRTC media and data channels are encrypted in transit.
- RetroArch input forwarding is localhost-only after the WebRTC channel reaches the host.
- Commercial games and firmware are not bundled.
- Removed games use the operating system Trash or Recycle Bin after confirmation.
- Production signing and notarization remain explicit release requirements for desktop artifacts.

## Growth and distribution validation

The Community screen now includes an opt-in share panel with feedback-first Reddit copy, short-form caption copy, 30-second-tour playlist routing, and GitHub routing. It was checked in the real Electron renderer at wide and minimum desktop widths with no horizontal overflow, hidden actions, or card collisions.

The repeatable short-form renderer produced a 30.00-second H.264/AAC master at 1080×1920, 30 fps, square pixels, with burned-in product messaging, an SRT caption file, and platform-ready caption copy. Generated media is stored under ignored `dist/social/` rather than committed to Git.

## Known limitations and follow-up

1. Configure a production Windows code-signing certificate and Apple notarization identity.
2. Add a GameDeck-managed TURN fallback for restrictive NAT environments.
3. Build and sign Android and iOS artifacts on their native toolchains.
4. Continue Discord moderation setup, roles, rules, and onboarding as membership grows.
5. Complete Reddit authentication, the TikTok age gate, and YouTube one-time channel verification through the owner-controlled interfaces before using those gated features.
6. Authenticate the intended X and LinkedIn identities before publishing there.
7. Continue clean-VM installer coverage in CI for each desktop operating system.

## Reproduction commands

```bash
npm test
npm run pack
npm run dist:win
npm run video:short
npm run video:campaign
```

The Remote Play test uses two isolated Electron profiles and the installed SF2 test title. The formal report intentionally excludes passwords, full session codes, and persistent authentication tokens.
