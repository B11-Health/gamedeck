# GameDeck Premium UIUX Release Kit

Verified production reference: `main@31e606c`
Community playtest: GitHub Issue #9

## Verified release story

GameDeck now gives each supported console family a distinct cinematic environment while keeping the selected-game controls stable and usable. The release also improves system classification, archive validation, firmware guidance, managed-runtime selection, and arcade launch repair.

Verified evidence:

- full repository test gate passed on production `main`;
- CADOps Builder, Tester, Supervisor, and Watcher chain closed successfully;
- Electron spotlight geometry passed at 1440, 1080, 820, and 480 pixels;
- all six spotlight actions remained visible and at least 44 pixels tall;
- reduced-motion behavior was verified;
- classifier, runtime, archive, arcade, and smoke tests passed.

## Announcement

GameDeck just received a major UI and game-reliability upgrade.

Console shelves now carry their own cinematic atmosphere, the selected-game spotlight stays stable across desktop and narrow windows, and Play, Multiplayer, Save, Artwork, Details, and Remove remain accessible instead of getting clipped.

Under the surface, GameDeck now does a better job identifying mixed console libraries, validating damaged archives, explaining missing firmware, selecting managed runtimes, and repairing reproducible arcade launch failures.

This release is on `main` at `31e606c`. Community testing is open in GitHub Issue #9.

## Claims boundary

Do not claim universal compatibility, perfect support for every ROM set, or successful testing on hardware and operating systems not represented by evidence. Do not imply that GameDeck supplies commercial games, BIOS files, encryption keys, or copyrighted game data.

## Community call to action

Test the new console environments, narrow-window spotlight controls, controller navigation, reduced-motion behavior, and legally owned games. Report operating system, display size, controller model, system, file extension, exact visible result, and reproducibility. Never upload ROMs, BIOS files, private paths, keys, saves, or personal data.

## Content angles

1. **Every shelf has a world** — cinematic console identity without copying console brands or game artwork.
2. **Controls that do not disappear** — six selected-game actions remain visible across tested widths.
3. **Truthful launch recovery** — damaged archives and missing firmware produce useful guidance instead of false success.
4. **Controller-first polish** — larger actions, stable focus, responsive geometry, and reduced-motion support.
5. **Built in public** — exact commits, tests, receipts, and an open community playtest.
