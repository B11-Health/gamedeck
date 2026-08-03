# Cross-platform release guide

GameDeck uses Electron and electron-builder. Each production artifact is built on its target operating system in GitHub Actions.

## Windows

`npm run dist:win` produces an x64 NSIS installer and portable executable. Public releases should be Authenticode-signed. Configure the certificate through electron-builder's supported signing environment variables or a hardware-backed signing service.

## macOS

`npm run dist:mac` produces a universal Intel/Apple Silicon DMG and ZIP. Public distribution requires an Apple Developer ID Application certificate and notarization credentials. macOS signing and notarization must run on macOS.

## Linux

`npm run dist:linux` produces x64 AppImage and Debian packages. Test on a current Ubuntu LTS release and at least one non-Debian distribution before promoting a release.

## Managed runtime provenance

GameDeck accepts managed-runtime downloads only over HTTPS from hosts listed in `config/runtime-manifest.json`. The installed app rejects both advertised and actually streamed asset sizes over 1 GB. The release cache builder currently rejects an advertised response total over 1 GB, records SHA-256 digests, and verifies pinned downloads; it does not yet independently stop an unbounded stream when an upstream response omits or understates its length. Downloaded or bundled bytes are hashed before extraction. These controls protect transport and detect changed bytes, but the strength of the provenance check depends on where the expected digest came from.

### Current trust modes

| Source | Verification behavior | Provenance strength |
| --- | --- | --- |
| A `sha256` value committed in `config/runtime-manifest.json` | The build and installed app reject any different bytes. | Independently reviewable, repository-pinned input. |
| A digest in the packaged `runtime-cache/cache-index.json` | The installed app verifies that extraction uses the same bytes downloaded by the release build. | Protects package integrity after the build, but does not independently authenticate the build-time download. |
| A digest previously stored in the local `runtime-state.json` | The first unpinned fallback download is accepted and recorded; later changes are rejected. | Trust on first use for that installation. |

### Assets without committed SHA-256 pins

Windows x64 is fully manifest-pinned: both `RetroArch.7z` and `RetroArch_cores.7z` have committed SHA-256 values.

The following required release inputs currently have no committed digest:

- **Linux x64:** `stable/1.22.2/linux/x86_64/RetroArch.7z` and `stable/1.22.2/linux/x86_64/RetroArch_cores.7z`.
- **macOS x64 and arm64:** the shared `stable/1.22.2/apple/osx/universal/RetroArch_Metal.dmg` entry is unpinned in both platform specifications.
- **macOS core sets:** 17 x64 URLs under `nightly/apple/osx/x86_64/latest` and 17 arm64 URLs under `nightly/apple/osx/arm64/latest` are unpinned. Each architecture downloads these exact filenames: `snes9x_libretro.dylib.zip`, `mesen_libretro.dylib.zip`, `mupen64plus_next_libretro.dylib.zip`, `sameboy_libretro.dylib.zip`, `mgba_libretro.dylib.zip`, `melondsds_libretro.dylib.zip`, `genesis_plus_gx_libretro.dylib.zip`, `mednafen_pce_fast_libretro.dylib.zip`, `mednafen_saturn_libretro.dylib.zip`, `flycast_libretro.dylib.zip`, `stella_libretro.dylib.zip`, `fbneo_libretro.dylib.zip`, `mame_libretro.dylib.zip`, `pcsx_rearmed_libretro.dylib.zip`, `play_libretro.dylib.zip`, `ppsspp_libretro.dylib.zip`, and `dolphin_libretro.dylib.zip`.

This is 37 unique unpinned upstream assets: two Linux archives, one universal macOS DMG, and 34 architecture-specific macOS core archives. The DMG appears in both macOS platform entries but resolves to the same upstream object.

Until every required input is pinned, release reviewers should retain each platform's generated `cache-index.json`, compare its asset URLs and digests with the build log, and preserve it with the release evidence. Release-level SHA-256 files authenticate the finished GameDeck packages; they do not replace input provenance for the embedded runtime.

### Non-breaking migration plan

1. **Close the cache-builder size gap without changing provenance behavior.** Add the installed app’s streamed-byte counter to `scripts/prepare-runtime-cache.mjs`, so a response that omits or understates `Content-Length` still fails above 1 GB.
2. **Capture reviewed digests without changing runtime behavior.** On each target runner, download the current required inputs once, retain the artifacts, and review the generated URL, size, and SHA-256 inventory.
3. **Pin the stable archives first.** Add committed digests for the two Linux archives and the universal macOS DMG. Existing manifests and installed clients already understand component-level `sha256` values.
4. **Extend the core-set schema compatibly.** Allow each core-set file to carry a digest, either as `{ name, sha256 }` entries or through a filename-to-digest map. Keep string entries valid during one transition release so older manifests and development workflows continue to work.
5. **Stop depending on an unreviewed moving target.** Prefer versioned or dated macOS core URLs. If upstream only provides `latest`, keep the URL but require the committed digest so an upstream replacement fails closed until maintainers review and update it.
6. **Add a release gate.** After all supported clients understand per-file core hashes, fail production builds when any required runtime input lacks a committed digest or does not match it. Development builds may retain an explicit opt-in trust-on-first-use path.
7. **Publish provenance with the release.** Preserve the resolved runtime manifest, cache index, package SHA-256 files, and build attestation together. Signing and notarization authenticate the finished package; the pinned runtime inventory authenticates what was placed inside it.

## Managed runtime provenance

GameDeck release builds run the target-specific runtime cache step before packaging. Each bundled file is hashed into a platform `cache-index.json`, and the packaged runtime manager verifies that digest before extraction. Windows also commits SHA-256 values for both managed archives directly in `config/runtime-manifest.json`.

Linux and macOS do not yet have committed hashes for all required upstream assets. Linux's two versioned archives and the macOS universal DMG are build-time pinned by the generated cache index. The 17 core archives for each macOS architecture also use mutable `nightly/.../latest` URLs. A source/development install without the bundled cache uses a locally persisted trust-on-first-use digest.

See [Runtime provenance and multiplayer trust boundaries](RUNTIME_PROVENANCE.md) for the exact asset matrix, verification order, release implications, and the non-breaking migration plan to committed per-asset hashes.

## Release process

1. Update the version and changelog.
2. Run `npm ci && npm test` on all target platforms.
3. Tag the release as `vX.Y.Z` and push the tag.
4. GitHub Actions builds each target and creates the release from its artifacts.
5. Verify signatures, launch every artifact, test a controller, scan a temporary library, and inspect the BIOS/setup states.
6. Publish SHA-256 checksums and release notes, including known unsigned-build warnings when applicable.

The workflow can build unsigned artifacts without secrets. Unsigned packages are suitable for QA, not a polished public launch.
