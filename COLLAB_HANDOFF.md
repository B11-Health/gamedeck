# GameDeck collaboration handoff

This file is the repository-level source of truth for parallel GameDeck work. Private teammate-room URLs, credentials, browser target IDs, and local ChatChain receipts do not belong here. The machine-readable ownership board is `ops/team-board.json`.

## Active handoff

**Handoff ID:** GD-20260804-ANALYTICS-TRUTH-RECONCILE
**Updated:** 2026-08-04 07:49 ET
**Repository:** `B11-Health/gamedeck`
**Verified production branch / base:** `main` / `8cfd5a75e44f73d1da904ce85a3a5b3ba1f9d0ff`
**Active bounded branch:** `ops/reconcile-analytics-truth-v1`
**Primary objective:** Reconcile repository operating truth to the merged privacy-safe analytics evidence without modifying product, runtime, UI, networking, publication, or authenticated community surfaces.

## Current product truth

- `origin/main@8cfd5a75e44f73d1da904ce85a3a5b3ba1f9d0ff` includes the CADOps and ChatChain safeguards, console and Aurora UIUX sequences, OpenBOR catalog and launch support, Team Operating System v3, the least-privilege release-permission regression gate, and the privacy-safe multiplayer KPI contract.
- ANALYTICS-001 is complete. Implementation commit `4d2604eba2f40be05fb592010f98222d18018178` defines 16 aggregate or opt-in metrics across eight stages and rejects six privacy-breaking mutations. Custody closed and merged at `8cfd5a75e44f73d1da904ce85a3a5b3ba1f9d0ff`.
- PLAY-001 remains the highest-priority unresolved item. Runtime implementation stays blocked until all required reviewers evaluate identical immutable contract bytes and return synchronized verdicts.
- The currently verified Runtime contract remains V1.0.4: contract SHA-256 `89f9dc4d7881e3263c22527278362395d8a16c3e595e8a36dc596316f3e937ef`; manifest SHA-256 `7147b3669dfbd65cf95f8e0c0e7e65fff852cd89c0c63a65618570d901e1998e`; foundation `7c42367d085bd79871b796123fcf704d2c327de9`; base `9d038f7215d031004acf70c6055308090620f745`. V1.0.5 must not be promoted without exact bytes, lengths, hashes, lineage, and reviewer linkage.
- The dedicated `fix/openbor-window-rendering` worktree contains active uncommitted product work. It is outside this task and must not be edited, staged, cleaned, absorbed, reviewed as immutable, or rotated by Program Operations.
- No contract or planning artifact authorizes Electron, main-process, preload, renderer, capture, controller, networking, consent, certification, audio, publication, spending, or partner side effects by itself.

## Current ownership

### Program Operations and Integration

**Status:** Active bounded truth reconciliation
**Branch:** `ops/reconcile-analytics-truth-v1`
**Owned scope:**

- `COLLAB_HANDOFF.md`
- `ops/team-board.json`
- append-only CADOps custody in `ops/cadops/ledger.json`

**Do not touch:** Product/runtime/UI/network files, the active OpenBOR worktree, marketing publication, account settings, private room data, or another lane's worktree.

**Required return:** Exact immutable commit, focused board/pulse checks, full `npm test`, `git diff --check`, independent Tester and Supervisor approval, Watcher closure, clean push, and merge only if `origin/main` remains the reviewed base.

### Runtime contract

**Status:** P0 review / implementation hold
**Unblock condition:** Every required reviewer names the same immutable bytes and hashes, contradictions are resolved through a new immutable artifact, and the General Orchestrator issues a fresh bounded implementation handoff.

### OpenBOR window rendering

**Status:** Active work owned elsewhere
**Boundary:** Preserve its uncommitted worktree exactly. This handoff makes no quality, completion, test, or merge claim about that branch.

### Analytics, growth, and monetization

- Privacy-safe analytics design is merged; telemetry remains disabled and separately gated.
- MON-001 may use the merged metric contract to separate verified costs, assumptions, and unknown demand. No spending, pricing promise, or product commitment is authorized.
- GROWTH-001 may use the metric contract for truthful proof planning. No publication, unsupported availability claim, or unnecessary personal-data collection is authorized.

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
3. Allow the existing OpenBOR window-rendering owner to finish, test, and submit its own immutable custody packet without interference.
4. Use the merged analytics contract as a review input for MON-001 and GROWTH-001 while preserving privacy, claim, spending, and publication boundaries.
