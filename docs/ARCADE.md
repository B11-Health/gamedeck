# Arcade setup: MAME, FinalBurn Neo, controllers, and artwork

GameDeck treats an arcade ROM set as a versioned collection, not as a generic game file. Before launch it checks the archive, chooses the appropriate runtime, and explains any problem without deleting or repeatedly downloading the user's file.

GameDeck does not include ROMs, BIOS files, encryption keys, or commercial artwork. Use only files you are legally entitled to use.

## Recommended routes

| Library | Preferred runtime | Best archive layout | GameDeck behavior |
|---|---|---|---|
| FinalBurn Neo | RetroArch with `fbneo_libretro` | Full non-merged sets matched to the installed core | Runs through RetroArch with a dedicated XInput controller override |
| Current MAME | Standalone MAME | Sets matched to the installed MAME version | Uses the game's short name, the local ROM path, `winhybrid` input on Windows, and native MAME verification |
| MAME fallback | Matching RetroArch MAME core | Sets matched to that exact core/version | Used only when standalone MAME is unavailable and a compatible core is installed |

ZIP is the safest portable choice. GameDeck can inspect ZIP and 7z containers, but archive names and the files inside them still have to match the emulator's database. Do not rename arcade archives to display names; GameDeck obtains the readable title from the installed MAME database.

The official Libretro guidance explains why arcade sets must match the chosen core and recommends full non-merged sets for the simplest setup: <https://docs.libretro.com/guides/arcade-getting-started/>.

## What the health check means

The Arcade Command Center has three states:

- **Preflight clear** — the container passed an integrity test. For a standalone MAME title, MAME also reported that the set is good. For FinalBurn Neo, this does not prove that the archive version matches the installed core.
- **Needs attention** — the archive is truncated, unreadable, or MAME reports required files or BIOS content missing. Launch is blocked for that title only.
- **Unchecked** — GameDeck has not completed a scan for the current file fingerprint yet.

Results are cached by path, size, and modification time. Replacing or repairing a file invalidates its old result automatically. **Scan ROM-set health** forces a fresh pass.

GameDeck never treats a failed launch as permission to redownload, replace, move, or delete a ROM set.

## BIOS and parent-set lookup

For FinalBurn Neo, keep required BIOS or parent archives in one of the locations searched by the core:

1. the folder containing the game archive;
2. `system/fbneo` under RetroArch's configured system directory; or
3. the configured RetroArch system directory itself.

For standalone MAME, keep required parent and device/BIOS sets inside a directory included in MAME's ROM path. GameDeck adds the selected title's folder and related configured arcade locations to the launch-time ROM path.

Never extract or merge a set merely to silence a missing-file message. First confirm that the set version, dependency layout, and emulator version belong together.

## Xbox controller profile

On Windows, GameDeck detects a paired Xbox controller and launches arcade games through XInput. The app's arcade reference layout is:

| Xbox control | Arcade action |
|---|---|
| View | Coin / Select |
| Menu | Start |
| D-pad or left stick | Movement |
| A, B, X, Y | Buttons 1–4 |
| LB, RB | Buttons 5–6 |

RetroArch receives a small GameDeck-owned override that enables XInput, controller autodetection, player-one index `0`, player-two index `1`, and analog-to-digital movement for both players. It does not overwrite the user's global RetroArch configuration.

Standalone MAME launches with joystick input enabled. On Windows, GameDeck selects MAME's `winhybrid` joystick provider so XInput controllers work while other supported controller types can remain available. A game's own input map can still be customized from MAME's input menu.

If a paired controller is shown as **wake to play**, press any button once so the browser gamepad layer can claim an active slot for GameDeck's navigation UI.

## Artwork matching

GameDeck uses the installed MAME title database to turn short names such as `sf2ce` into readable titles before searching for artwork. It checks local artwork first, then the existing metadata cache.

Recognized standalone MAME artwork folders include:

- `snap`
- `titles`
- `flyers`
- `cabinets`
- `marquees`

Artwork in MAME media folders should use the arcade short name. GameDeck uses the resolved display title for metadata-provider and cache matching. Consistent database names improve matching with Libretro thumbnail repositories. Keep artwork you do not have redistribution rights for outside the GameDeck repository and installer.

## Troubleshooting order

1. Open **Arcade Command Center** and run **Scan ROM-set health**.
2. Read the exact status under the focused game; do not infer that every failure is a BIOS problem.
3. Confirm the selected route: **MAME** for a current MAME set, **FBNeo** for a matching FinalBurn Neo set.
4. Confirm that the archive file name has not been changed from the emulator short name.
5. Confirm the archive/core version match and whether the set is merged, split, or non-merged.
6. Put required BIOS/parent archives in the documented search path without unpacking them.
7. Re-scan. If it remains red, generate an emulator log and include the short name, emulator/core version, set layout, and health-check text in a bug report. Never attach ROM or BIOS files.

## Useful upstream references

- [Libretro: Getting started with arcade emulation](https://docs.libretro.com/guides/arcade-getting-started/)
- [Libretro: FinalBurn Neo](https://docs.libretro.com/library/fbneo/)
- [Libretro: Controller autoconfiguration](https://docs.libretro.com/guides/controller-autoconfiguration/)
- [MAME command-line reference](https://docs.mamedev.org/commandline/commandline-all.html)
- [Libretro database and naming metadata](https://github.com/libretro/libretro-database)
