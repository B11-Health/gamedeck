# Cross-platform release guide

GameDeck uses Electron and electron-builder. Each production artifact is built on its target operating system in GitHub Actions.

## Windows

`npm run dist:win` produces an x64 NSIS installer and portable executable. Public releases should be Authenticode-signed. Configure the certificate through electron-builder's supported signing environment variables or a hardware-backed signing service.

## macOS

`npm run dist:mac` produces a universal Intel/Apple Silicon DMG and ZIP. Public distribution requires an Apple Developer ID Application certificate and notarization credentials. macOS signing and notarization must run on macOS.

## Linux

`npm run dist:linux` produces x64 AppImage and Debian packages. Test on a current Ubuntu LTS release and at least one non-Debian distribution before promoting a release.

## Release process

1. Update the version and changelog.
2. Run `npm ci && npm test` on all target platforms.
3. Tag the release as `vX.Y.Z` and push the tag.
4. GitHub Actions builds each target and creates the release from its artifacts.
5. Verify signatures, launch every artifact, test a controller, scan a temporary library, and inspect the BIOS/setup states.
6. Publish SHA-256 checksums and release notes, including known unsigned-build warnings when applicable.

The workflow can build unsigned artifacts without secrets. Unsigned packages are suitable for QA, not a polished public launch.
