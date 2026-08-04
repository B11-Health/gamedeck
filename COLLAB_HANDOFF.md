# GameDeck collaboration handoff

This file is the repository-level source of truth for parallel GameDeck work. Private teammate-room URLs and credentials do not belong here. The machine-readable ownership board is `ops/team-board.json`.

## Active handoff

**Handoff ID:** GD-20260803-UIUX-CADOPS
**Updated:** 2026-08-03 20:22 ET
**Repository:** `B11-Health/gamedeck`
**Production branch / HEAD:** `main` / `4633f2eb00bd2be19b7b07914cd395d6e972d8ca`
**Active integration branch:** `integration/uiux-console-cadops`
**Primary objective:** Make GameDeck the most dependable local-first platform for playing legally owned games with friends while improving the internal multi-team delivery system.

## Current product truth

- CADOps and the team operating system are on `main` at `4633f2e`; the first complete Builder/Tester/Supervisor/Watcher chain is closed with valid receipts.
- The approved console-theme, spotlight-layout, arcade-routing, and launch-repair sequence at `99c474b` is being integrated onto current `main` in `integration/uiux-console-cadops`.
- Embedded/Runtime design work is contract-gated. V1.0.3 is invalid and superseded. V1.0.5 is the latest reported pure-design artifact; Security approval is recorded, but implementation may start only after the General Orchestrator independently confirms all required reviewer receipts and issues a fresh bounded handoff.
- `feature/runtime-lifecycle-normalizer` and its dedicated worktree exist at `62f3b3c` but remain clean: no module, test, package change, commit, push, or implementation verdict exists.
- The shared repository worktree contains an unrelated untracked `gamedeck-console-themes-complete/` directory. Do not delete, stage, absorb, or modify it without a separate ownership handoff.
- No Runtime contract authorizes Electron, main, preload, renderer, capture, controller, network, consent, certification, audio, or player-visible side effects by itself.

## Operating model

The ten canonical lanes are defined in `ops/team-board.json` and `docs/TEAM_OPERATING_SYSTEM.md`:

1. Program Operations and Integration
2. Multiplayer Platform and Network Reliability
3. Universal Game Compatibility Lab
4. Multiplayer Player Experience
5. Security and Privacy
6. QA, Reliability, and Observability
7. Growth and Community
8. Ethical Monetization
9. Privacy-Preserving Analytics
10. Partnerships and Ecosystem

Every active task has one owner, one reviewer, an exclusive scope, a rollback point, required evidence, and a concrete next action.

## Current ownership

### Program Operations and Integration

**Status:** Integrated on `main`
**Branch:** `main@4633f2e`
**Scope:**

- `COLLAB_HANDOFF.md`
- `docs/TEAM_OPERATING_SYSTEM.md`
- `docs/ONLINE_PLAY_PROGRAM.md`
- `ops/team-board.json`
- `scripts/team-board-validate.mjs`
- `scripts/team-board-validate.test.mjs`
- `package.json` only for board validation registration

**Required return:** Clean commit, push, full repository gate, exact diff, and independent review.

### Runtime lifecycle contract and pure implementation

**Status:** Contract review / implementation hold
**Do not touch:** Production imports, Electron, main, preload, renderer, capture, input, networking, consent, audio, or player-visible behavior.
**Unblock condition:** Exact V1.0.5 attachment/manifest identity plus synchronized approval receipts from Security, Compatibility, Player Experience, and Integration QA, followed by a new bounded implementation handoff.

### Console themes integration

**Status:** Active CADOps integration
**Source:** `integration/console-themes-complete@99c474b`
**Integration:** `integration/uiux-console-cadops` from `main@4633f2e`
**Required return:** Combined CADOps and product test gate, visual/player-semantic review, clean exact commit, rollback, and Watcher-authorized merge.

### Multiplayer program

**Status:** Ready for staffing
**Program:** `docs/ONLINE_PLAY_PROGRAM.md`
**First work:** Universal route contract, host/guest preflight, invitation replay/slot hardening, authenticated discovery, NAT/relay diagnostics, reconnect, and two-to-four-player acceptance evidence.

### Growth, monetization, analytics, and partnerships

**Status:** Ready for bounded assignments after the product evidence plan is synchronized.
**Boundary:** No unsupported claims, spam, private-data collection, spending, partner commitments, account creation, publication, or authenticated-surface mutation without explicit ownership and evidence requirements.

## Discord-free operating model

Treat Discord as unavailable for required product, onboarding, support, event, signaling, community, sponsorship, or growth flows. Replace Discord dependencies with GitHub Discussions, Issues, releases, the repository, the public site, YouTube, TikTok, Reddit, email, or another explicitly approved private exchange path. Documentation that still mentions Discord must be corrected through a bounded content task.

## Rejection and remediation rule

A rejection is a handoff, not an endpoint. It must include severity, exact object identity, evidence, deterministic probe, impact, smallest correction, owner, and retest. The correction owner publishes a new immutable commit or artifact. The rejecting reviewer remains responsible through re-verification.

## Authenticated Shell rule

Authenticated Shell prompts are approved when the delegated task and scope are authorized. After approval, the General Orchestrator must still verify that the prompt disappeared and real execution began. Desktop-notification prompts are not shell permissions and should normally be dismissed.

## Baton packet

```text
HANDOFF ID:
OBJECTIVE:
DONE:
CHANGED FILES / SURFACES / ARTIFACTS:
EXACT COMMIT OR DIGEST:
TESTS AND RESULTS:
OPEN RISKS OR BLOCKERS:
NEXT OWNER:
NEXT BOUNDED TASK:
OWNED SCOPE:
DO NOT TOUCH:
EXPECTED RETURN:
ROLLBACK POINT:
```

## Mandatory repository gate

For every repository change:

- Verify exact base and remote identity.
- Run `npm test`.
- Run `git diff --check`.
- Confirm the worktree is clean after commit.
- Review only the exact immutable commit.
- Confirm rollback.
- Push only the bounded branch.
- Do not merge `main` without an independent integration verdict.

## Next sequence

1. Complete and independently review `ops/team-operating-system-v2`.
2. Staff the Multiplayer Platform, Compatibility, Player Experience, Security, and QA lanes against `docs/ONLINE_PLAY_PROGRAM.md`.
3. Independently verify all V1.0.5 approval receipts before deciding whether the clean Runtime implementation lane may restart.
4. Review `integration/console-themes-complete@99c474b` separately.
5. Launch Growth, Monetization, Analytics, and Partnerships against verified multiplayer evidence and explicit trust boundaries.
