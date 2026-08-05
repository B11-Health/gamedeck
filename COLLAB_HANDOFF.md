# GameDeck collaboration handoff

This file is the repository-level source of truth for parallel GameDeck work. Private teammate-room URLs, credentials, browser target IDs, and local ChatChain receipts do not belong here. The machine-readable ownership board is `ops/team-board.json`.

## Active handoff

**Handoff ID:** GD-20260804-GROWTH-TRUTH-RECONCILE
**Updated:** 2026-08-04 11:53 ET
**Repository:** `B11-Health/gamedeck`
**Verified production branch / base:** `main` / `571a3594d8a11a0fee64eade55eb6ab8dcdea5d5`
**Active bounded branch:** `ops/reconcile-growth-truth-v1`
**Primary objective:** Reconcile repository operating truth to the merged draft-only multiplayer tester recruitment evidence without modifying product, runtime, UI, networking, publication, or authenticated community surfaces.

## Current product truth

- `origin/main@571a3594d8a11a0fee64eade55eb6ab8dcdea5d5` includes the CADOps and ChatChain safeguards, console and Aurora UIUX sequences, OpenBOR catalog and window handoff support, Team Operating System v3, release-permission regression protection, privacy-safe multiplayer metrics, and the draft-only tester recruitment contract.
- GROWTH-001 is complete as a reviewed draft artifact. Implementation commit `b3494c34e142de9e6983bbd5ce513614fbd96dbd` defines six evidence dimensions and rejects seven safety mutations. Custody closed and merged at `571a3594d8a11a0fee64eade55eb6ab8dcdea5d5`; publication and measured response remain separately gated and unknown.
- ANALYTICS-001 remains complete at `8cfd5a75e44f73d1da904ce85a3a5b3ba1f9d0ff`; telemetry remains disabled and separately gated.
- PLAY-001 remains the highest-priority unresolved item. Runtime implementation stays blocked until all required reviewers evaluate identical immutable contract bytes and return synchronized verdicts.
- The currently verified Runtime contract remains V1.0.4: contract SHA-256 `89f9dc4d7881e3263c22527278362395d8a16c3e595e8a36dc596316f3e937ef`; manifest SHA-256 `7147b3669dfbd65cf95f8e0c0e7e65fff852cd89c0c63a65618570d901e1998e`; foundation `7c42367d085bd79871b796123fcf704d2c327de9`; base `9d038f7215d031004acf70c6055308090620f745`. V1.0.5 must not be promoted without exact bytes, lengths, hashes, lineage, and reviewer linkage.
- Active uncommitted product work exists in `fix/embedded-play-restoration-current-main`, `fix/openbor-window-rendering`, and `fix/seamless-play-openbor-controller`. These worktrees are outside this task and must not be edited, staged, cleaned, absorbed, reviewed as immutable, or rotated by Program Operations.
- No contract or planning artifact authorizes Electron, main-process, preload, renderer, capture, controller, networking, consent, certification, audio, publication, spending, or partner side effects by itself.

## Current ownership

### Program Operations and Integration

**Status:** Active bounded truth reconciliation
**Branch:** `ops/reconcile-growth-truth-v1`
**Owned scope:**

- `COLLAB_HANDOFF.md`
- `ops/team-board.json`
- `scripts/orchestrator-pulse.test.mjs`
- append-only CADOps custody in `ops/cadops/ledger.json`

**Do not touch:** Product/runtime/UI/network files, any active product worktree, marketing publication, account settings, private room data, or another lane's worktree.

**Required return:** Exact immutable commit, focused board/pulse checks, full `npm test`, `git diff --check`, independent Tester and Supervisor approval, Watcher closure, clean push, and merge only if `origin/main` remains the reviewed base.

### Runtime contract

**Status:** P0 review / implementation hold
**Unblock condition:** Every required reviewer names the same immutable bytes and hashes, contradictions are resolved through a new immutable artifact, and the General Orchestrator issues a fresh bounded implementation handoff.

### Active product worktrees

**Status:** Owned elsewhere and uncommitted
**Boundary:** Preserve `fix/embedded-play-restoration-current-main`, `fix/openbor-window-rendering`, and `fix/seamless-play-openbor-controller` exactly. This handoff makes no quality, completion, test, or merge claim about those branches.

### Analytics, growth, and monetization

- Privacy-safe analytics design is merged; telemetry remains disabled and separately gated.
- MON-001 may use the merged metric contract to separate verified costs, assumptions, and unknown demand. No spending, pricing promise, or product commitment is authorized.
- GROWTH-001 is complete as a machine-checked draft contract. Any post, account change, paid promotion, footage publication, reward, private outreach, or measured-response claim requires a separate custody chain and fresh approval.

## Operating model

The ten canonical lanes are defined in `ops/team-board.json` and `docs/TEAM_OPERATING_SYSTEM.md`. Every active task requires one owner, an independent reviewer, exclusive scope, exact evidence, a rollback point, and a concrete next action. Rejection is a handoff, not an endpoint: preserve the failed identity, issue a bounded correction, and retest under a distinct identity when execution was uncertain.

## ChatChain and browser custody

The canonical CADOps ledger authorizes custody. The private room registry binds a conversation identity to a ticket. A live loopback Chromium DevTools endpoint proves browser state. No predecessor tab may close unless a distinct successor is ledger-authorized, bound, visibly verified, accepted or active, and rechecked immediately before closure. Missing registry or CDP evidence means no tab rotation.

## Discord-free operating model

Discord is not a required product, onboarding, support, event, signaling, sponsorship, or growth dependency. Use GitHub Discussions, Issues, releases, the repository, the public site, YouTube, TikTok, Reddit, email, or another explicitly approved channel. Publication and authenticated-surface changes require separate ownership and evidence.

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

- Verify exact base, ancestry, remote identity, and active worktree ownership.
- Run all focused tests and full `npm test`.
- Run `git diff --check`.
- Confirm a clean worktree after commit.
- Review only the exact immutable commit.
- Push only the bounded branch.
- Merge only exact independently approved work and recheck `origin/main` immediately before integration.

## Next sequence

1. Independently review and close this operating-truth reconciliation.
2. Advance PLAY-001 only against exact immutable Runtime evidence; preserve uncertainty rather than promoting V1.0.5 by report alone.
3. Preserve all active product worktrees and let their owners return immutable custody packets without interference.
4. Start any tester-recruitment publication only through a separate approval chain that revalidates exact claims, CTA, privacy copy, and channel authorization.
5. Execute MON-001 as a design-only cost and trust model with no spending or pricing commitment.
