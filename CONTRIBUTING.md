# Contributing to GameDeck

Thanks for helping build a better couch-first game library.

## Ground rules

- Do not submit ROMs, BIOS files, keys, copyrighted game art, download sources, or instructions intended to bypass ownership or access controls.
- Keep emulator integrations optional and preserve local-first behavior.
- Never add analytics, remote scripts, personalized ads, or wallet secrets.
- Respect unrelated files and explain platform-specific assumptions.

## Workflow

1. Search existing issues and open a focused issue for significant changes.
2. Fork the repository and create a descriptive branch.
3. Run `npm ci`, then `npm test` before and after your change.
4. For UI work, include before/after screenshots and test controller focus as well as mouse/keyboard input.
5. Open a pull request using the template. Keep changes small enough to review.

## Definition of done

- Windows, macOS, and Linux paths remain portable.
- Missing emulators, cores, BIOS files, and libraries produce actionable states instead of loops.
- Renderer code receives only the narrow APIs exposed through `preload.js`.
- New external links use the validated main-process handler.
- User-facing copy distinguishes installed, downloaded, preparing, and ready states.
- Documentation and tests cover changed behavior.

By contributing, you agree that your contribution is licensed under the MIT License.
