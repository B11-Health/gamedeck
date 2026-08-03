# GameDeck collaboration handoff

This file is the shared source of truth for parallel GameDeck workstreams. Update it at the end of every bounded task before assigning the next task. Never assign overlapping files or browser surfaces.

## Active handoff

**Handoff ID:** GD-20260803-10
**Updated:** 2026-08-03 06:49 ET
**Repository:** `B11-Health/gamedeck`
**Branch / HEAD:** `main` / current UI and arcade compatibility task
**Primary objective:** Acquire real GameDeck players while keeping the product, repository, branding, and release evidence pristine.

## Discord-free operating model

Treat Discord as unavailable. Do not appeal, replace the account, evade restrictions, or depend on Discord for growth, support, events, onboarding, sponsorship, or product copy. Use GitHub Discussions—especially Discussion #8—as the multiplayer community hub, with GitHub Issues, releases, the repository, YouTube, TikTok, Reddit, email, and the public site as supporting destinations.

## Workstream ownership

### Growth and community

**Scope:** Authenticated browser work only: YouTube, TikTok, Discord, GitHub community surfaces, analytics, and carefully selected external engagement.
**Current task:** Apply the Discord-free operating model across owned browser surfaces. Remove Discord-dependent calls to action from every YouTube description, TikTok caption/profile, Reddit profile/post, and other growth surface; replace each with the relevant GitHub Discussion, issue form, release, repository, or public-site destination. The latest verification still showed a retired Discord invite on at least `dOEuy8g8Bmw` and the scheduled `RetroArch Setup Should Explain Itself` Short.
**Do not touch:** Repository files unless a new handoff explicitly transfers ownership.
**Return:** Exact video IDs checked, final title/description state, save/publication status, remaining blockers, and the next bounded task for another workstream.

### Engineering and integration

**Scope:** Repository integration, accessibility, PWA, public-site conversion, offline behavior, packaging evidence, and merge validation.
**Current status:** Ready for the next bounded task.
**Completed:**
- `74467a6` — full QA and mobile accessibility pass
- `a19a347` — netplay focus restoration and corrected package evidence
- `2bbbe15` — fully offline desktop typography and CSP hardening
- `8118ff1` — self-expiring Playtest Night event strip
- `e495c8d` — bounded multiplayer invitation decoding and decompression limits
- `a7994d3` — runtime provenance and synchronized-lobby trust-boundary documentation
- `9865ccf` — corrected cache-builder size-limit claim and non-breaking hardening step
- `9ae4adf` — bounded GameDeck Live pairing API requests
- `354b919` — enforced streamed runtime-cache byte limits
- `7b7ecba` — promoted and polished the self-expiring Playtest Night strip
- `61a9e93` — post-audit collaboration evidence
- `367138d` — OS-assigned port for collision-free Live smoke tests
- `d3b8aa4` — 44px Playtest Night touch targets
- `2f90e15` — release workflow least-privilege permissions
- Fixed selected-game action-row overflow so Favorite and Remove remain fully visible at the reported 1504×904 viewport.
- Preferred an already-installed verified GameDeck managed runtime over an unrelated external RetroArch core set, and removed `neogeo.zip` BIOS support data from the playable library.
- Boot-probed all 32 installed FinalBurn Neo/Neo Geo game archives against the managed core; all 32 initialized successfully. The external core reproduced one mismatch (`progear.7z`), confirming the routing defect.
- GitHub Discussion #8 corrected to the verified 10:00 PM–midnight ET event time and canonical Discord event URL

**Do not touch:** Browser surfaces currently owned by Growth and community.

### Product and QA

**Scope:** Live desktop behavior, public-site hierarchy, responsive UX, accessibility, focus flow, and real multiplayer regression testing.
**Current status:** Completed the post-`e495c8d` live invitation regression and Playtest Night event QA.
**Verified:**
- Metal Slug 3 synchronized host reached the New York relay and produced a 760-character `GDPLAY1` invitation.
- The same invitation passed the normal join path, reached `ready` as a client, and reported 2/2 players.
- Two isolated GameDeck profiles completed the normal Remote Play handshake with a 1,721-character `GDREMOTE2` invite and a 1,306-character `GDREMOTEANSWER2` response.
- The host accepted Player 2, both profiles showed two players, video attached, and 18 controller-input events reached the host as Player 2.
- `7b7ecba` moves the urgent event into the first viewport, adds precise countdown wording, preserves 40px+ actions, supports reduced motion, and keeps expired state hidden.
**Do not touch:** Authenticated growth/community browser surfaces.
**Return:** Ready to review the next engineering or growth handoff.

### Security and release quality

**Scope:** Read-only review of IPC validation, path safety, renderer boundaries, signaling services, workflows, release packaging, and evidence accuracy.
**Current status:** Completed `e495c8d`, `a7994d3`, and `9865ccf`. The runtime audit now covers 39 unique unpinned upstream assets: two Linux archives, one shared macOS DMG, and 36 architecture-specific macOS core archives. The HTTP lobby trust boundary and compatibility-safe migration plan are documented.
**Current status:** Completed invitation hardening, GameDeck Live pairing hardening, runtime-cache streamed-byte enforcement, the post-audit evidence addendum, CI port stabilization, and release-workflow least privilege.
**Current task:** Ready for the next bounded security, packaging, workflow, or evidence assignment.
**Do not modify:** Growth/community browser surfaces or files owned by another active handoff.
**Return:** Findings or a commit with exact validation and one recommended next task.

## Latest bounded engineering return

HANDOFF ID: GD-20260803-10
OBJECTIVE: Restore full selected-game actions and make the installed arcade collection use the verified compatible core.
DONE: Corrected action flex sizing; detected and preferred complete managed runtimes; excluded the Neo Geo BIOS archive from playable titles.
CHANGED FILES / SURFACES: `main.js`, `src/styles.css`, `scripts/smoke-test.mjs`.
TESTS AND RESULTS: Full `npm test` passed; live 1504×904 DOM check found no clipped action; live runtime diagnostics selected the managed RetroArch/core paths; 32/32 installed arcade games boot-probed successfully.
OPEN RISKS OR BLOCKERS: Broader non-arcade launch coverage was not re-run in this bounded task.
NEXT OWNER: Product and QA.
NEXT BOUNDED TASK: Recheck the selected-game spotlight at minimum supported window sizes and perform a normal user-visible Progear launch/exit cycle.
OWNED FILES / SURFACES: None after this return.
DO NOT TOUCH: Authenticated growth/community browser surfaces.
EXPECTED RETURN: Exact viewport matrix, launch result, and any remaining visual or controller regressions.

## Latest bounded collection return

HANDOFF ID: GD-20260803-11
OBJECTIVE: Put mixed Sega and Nintendo disc libraries under the correct systems and surface valid local test games that were previously omitted.
DONE: Added archive-content classification for shared Genesis/Master System/Game Gear folders, RVZ/ISO system detection for shared GameCube/Wii folders, Sega 32X support with PicoDrive, PSP CHD support, managed-runtime precedence, and truthful NO GAMES labels for empty systems.
CHANGED FILES / SURFACES: `main.js`, `library-system-classifier.js`, `src/app.js`, `config/runtime-manifest.json`, `package.json`, tests, cross-platform docs, and README.
TESTS AND RESULTS: Full `npm test` passed; live library scan reported 236 playable entries; Genesis 10, Master System 10, Game Gear 10, Sega 32X 2, PSP 4, and Wii 1 were classified correctly; Genesis, Master System, Game Gear, Sega 32X, Nintendo 64, and PSP representative boot probes passed; spotlight Favorite and Remove remained unclipped.
OPEN RISKS OR BLOCKERS: No valid local MAME, GameCube, or Wii U game files exist, so those systems are labeled NO GAMES instead of being presented as populated. One local PS2 source archive for 50 Cent: Bulletproof is truncated; a partial extraction was removed and the archive was not added as playable. N64DD images were intentionally left hidden because the required IPL firmware is absent and a live probe failed.
NEXT OWNER: Product and QA.
NEXT BOUNDED TASK: Add an explicit, rights-safe test-content onboarding flow for empty systems, with user acknowledgement for any non-commercial-only downloads.
OWNED FILES / SURFACES: None after this return.
DO NOT TOUCH: Authenticated growth/community browser surfaces.
EXPECTED RETURN: Provenance, license/terms, exact downloaded asset, launch result, and removal path for each optional test title.


HANDOFF ID: GD-20260803-11
OBJECTIVE: Remove every reproducible broken-game launch from the current local collection and stop damaged archives from being presented as playable.
DONE: Restored the required Famicom Disk System, Satellaview, Sufami Turbo, Sega CD, Saturn, Dreamcast, PlayStation, and PPSSPP support files from the user's existing local firmware pack; separated FDS, Satellaview, and Sufami Turbo into truthful shelves; required complete regional Sega CD and Saturn firmware; added a cached launch-time ZIP/7Z/RAR integrity gate; preserved two irrecoverably truncated Nintendo DS archives in a quarantine folder outside the library.
CHANGED FILES / SURFACES: `main.js`, `README.md`, `scripts/library-system-classifier.test.mjs`, `scripts/smoke-test.mjs`; local runtime firmware and local quarantine state were repaired without adding ROMs or BIOS files to Git.
TESTS AND RESULTS: Full `npm test` passed. 143 archive integrity checks found 141 valid and exactly two truncated NDS archives, both quarantined. All 30 CHD images passed full CHD verification. Core initialization covered the entire resulting 234-game collection: 163 first-pass successes plus 71 successful targeted reprobes after firmware restoration, with no failing title remaining in the live library. Exact standalone routes passed 8/8 across PS1, PS2, PSP, and Wii. Live library scan reports 234 games and all populated systems ready.
OPEN RISKS OR BLOCKERS: No valid local backup was found for the quarantined Chrono Trigger DS and Pokemon HeartGold archives, so they remain preserved but intentionally absent from the playable shelf. MAME, GameCube, and Wii U have no local games to validate.
NEXT OWNER: Product and independent QA.
NEXT BOUNDED TASK: Merge with the selected-game spotlight stability branch, then repeat a visible launch/exit cycle for one title per populated system on the integration commit.
OWNED FILES / SURFACES: None after return.
DO NOT TOUCH: Authenticated growth/community browser surfaces or the quarantined source archives without an explicit replacement decision.
EXPECTED RETURN: Integrated commit hash, one-title-per-system launch matrix, and any remaining emulator-specific presentation issues.

## Latest console-theme integration return

HANDOFF ID: GD-20260803-12
OBJECTIVE: Integrate console-themed environmental artwork into the real GameDeck Library UI so each shelf has an immediate visual identity without sacrificing readability or control stability.
DONE: Added eight original vector background families and mapped every supported system to a console-appropriate theme. The selected-game spotlight now uses the system environment instead of enlarging box art, while the active system row, body ambience, facts, borders, and actions inherit the matching accent. Preserved the cover image as the game-specific foreground art and added a cross-fade for theme changes.
CHANGED FILES / SURFACES: `assets/system-themes/*`, `src/app.js`, `src/styles.css`, `scripts/smoke-test.mjs`, `README.md`.
TESTS AND RESULTS: Full `npm test` passed. Live Electron/CDP verification at 1504x904 confirmed all eight SVGs load. Theme switching passed for SNES, N64, NDS, Genesis, Sega CD, Saturn, Dreamcast, PS1, PS2, PSP, FinalBurn Neo, Atari 2600, and PC Engine. Favorite, Remove, and every spotlight action remained inside the panel. Long-title stress checks at 1504x904, 1280x800, and 1024x768 held identical spotlight height and button position with no horizontal overflow.
OPEN RISKS OR BLOCKERS: The themes are intentionally original hardware-era abstractions rather than trademarked console renders or commercial game art. Final visual tuning may still be desirable after review on HDR and low-contrast displays.
NEXT OWNER: Product design and independent UI QA.
NEXT BOUNDED TASK: Review each hardware family at normal, compact, and reduced-motion settings, then stage the theme commit with the spotlight layout and collection fixes.
OWNED FILES / SURFACES: None after return.
DO NOT TOUCH: Embedded Play security policy files or authenticated public growth surfaces.
EXPECTED RETURN: Integration commit hash, visual acceptance notes by hardware family, and any bounded contrast or crop corrections.

## Latest verified production state

- Public site event strip is visible in the first viewport before and during the event; it auto-hides at 2026-08-03 00:00 ET.
- Canonical event: https://discord.com/events/1533539059207504093/1533638688066633980
- Tester discussion: https://github.com/B11-Health/gamedeck/discussions/8
- Event time: 2026-08-02 22:00–24:00 ET
- `8118ff1` CI: passed
- `e495c8d` CI: passed
- `a7994d3` documentation task: reviewed against the manifest and runtime code
- `9865ccf` local `npm test` and repository audit: passed
- `354b919` runtime stream-limit tests and full repository gate: passed
- `9ae4adf` GameDeck Live pairing security regression: passed
- `7b7ecba` desktop/tablet/phone event-state matrix and full `npm test`: passed
- `61a9e93` evidence CI initially failed from a fixed-port collision; `367138d` moved the Live smoke server to an OS-assigned port and restored green CI
- `d3b8aa4` CI and growth-site deployment: passed
- `2f90e15` release-workflow least-privilege CI: passed
- Post-`e495c8d` live GDPLAY1 and two-profile Remote Play regressions: passed
- `8118ff1` growth-site deployment: passed
- `2bbbe15` CI: Linux package smoke, Ubuntu tests, macOS tests, and Windows tests passed
- Local repository status at handoff: clean

## Baton protocol

Every workstream completion must update this file and send the following packet to the next owner:

```text
HANDOFF ID:
OBJECTIVE:
DONE:
CHANGED FILES / SURFACES:
TESTS AND RESULTS:
OPEN RISKS OR BLOCKERS:
NEXT OWNER:
NEXT BOUNDED TASK:
OWNED FILES / SURFACES:
DO NOT TOUCH:
EXPECTED RETURN:
```

## Operating constraints

- Pull or inspect the current branch before editing.
- One owner per file or authenticated browser surface at a time.
- Do not overwrite unstaged or staged work from another process.
- Do not claim a post, deployment, test, event, or profile change unless verified live.
- Do not expose credentials, tokens, invitation payloads, private paths, ROMs, BIOS files, keys, saves, or personal account data.
- Keep external engagement useful, transparent, community-appropriate, and non-spammy.
- Run `npm test` and `git diff --check` for repository changes. Run relevant live verification for browser changes.
- Commit and push only after ownership is clear and the worktree is clean except for the intended task.

## Expected next exchange

1. Growth and community returns the Discord-free browser-surface audit with exact surface IDs, old destinations, replacements, and save/publication verification.
2. Product/QA reviews the browser return and checks that public-site/product copy no longer relies on Discord before assigning repository changes.
3. Engineering and security remain available for the next non-overlapping integration or release task.
