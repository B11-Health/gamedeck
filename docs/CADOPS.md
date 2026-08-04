# GameDeck CADOps

GameDeck uses Custodial Agentic DevOps (CADOps) to make multi-agent work auditable, non-replayable, and independently checked. The implementation is a repository-local custody ledger and command-line control plane. It does not grant repository, publication, spending, deployment, or authenticated-surface authority by itself.

## Roles

Every ticket belongs to exactly one lane:

| Lane | Role | Permitted responsibility |
| --- | --- | --- |
| `E` | Builder | Produce one bounded implementation or content artifact. |
| `T` | Tester | Challenge the exact Builder artifact from the outside; do not modify it. |
| `M` | Supervisor | Verify identities, receipts, hashes, custody, priority, and authorization. |
| `W` | Watcher | Detect stale lanes, missing handoffs, uncertain execution, and recovery needs. |

The default custody chain is `E -> T -> M -> W`. A Watcher may start a new `E`, `T`, `M`, or `W` chain after continuity checks. Only a Watcher ticket may close a chain.

## Ticket identities

Normal identities are monotonic per lane:

```text
E-0001
T-0001
M-0001
W-0001
```

An uncertain identity is never replayed. Recovery uses a new identity:

```text
E-0001-RECOVERY-OPERATOR-NAME-0001
```

The original ticket, events, uncertainty record, quarantine record, and evidence remain in the ledger.

## Ledger integrity

The canonical ledger is `ops/cadops/ledger.json`.

Each mutation:

- validates the existing ledger before operating,
- creates a new immutable event identity,
- links the event to the previous event hash,
- calculates a SHA-256 hash over canonical JSON,
- validates the resulting ledger,
- writes it through an atomic temporary-file rename.

Completion receipts contain the ticket and lane, actor, objective, outcome, exact software version, timestamps, launch evidence, predecessor receipt hash, checks, artifact identities, authorized successor lanes, and chain disposition.

Artifact evidence is calculated from the canonical Git blob at the resolved commit, not from checkout-transformed working-tree bytes. Each new artifact entry records the exact commit, Git object format, blob object ID, canonical byte length, and SHA-256 digest. This keeps receipts stable across Windows CRLF and Unix LF checkouts and rejects untracked or uncommitted artifacts.

The ledger is committed to Git. Git history is not replaced by the ledger; both are required evidence.

## Lifecycle

A normal bounded cycle is:

```text
prepared -> accepted -> active -> completed -> successor prepared
```

A ticket becomes `active` only after visible launch evidence is recorded. A completed ticket can hand custody to exactly one policy-authorized successor. Duplicate starts, completions, and handoffs are rejected.

When execution may already have happened:

```text
prepared|accepted|active -> uncertain -> quarantined -> distinct recovery prepared
```

Do not reset the old status, reuse the old ticket, or resend the old side effect.

## Commands

Initialize once:

```bash
npm run cadops -- init
```

Create and run Builder custody:

```bash
npm run cadops -- issue \
  --lane E \
  --objective "Implement one bounded change" \
  --assignee builder-runtime-01 \
  --authorized-by general-orchestrator

npm run cadops -- accept --ticket E-0001 --actor builder-runtime-01

npm run cadops -- start \
  --ticket E-0001 \
  --actor builder-runtime-01 \
  --launch-evidence "Authenticated Shell active in gamedeck-runtime-worktree"

npm run cadops -- complete \
  --ticket E-0001 \
  --actor builder-runtime-01 \
  --outcome pass \
  --summary "Implemented the approved pure module." \
  --software-version 0123456789abcdef \
  --artifact src/example.js \
  --check "npm test passed" \
  --check "git diff --check passed"
```

Hand the exact receipt to independent testing:

```bash
npm run cadops -- handoff \
  --ticket E-0001 \
  --lane T \
  --objective "Black-box test E-0001 exact artifact" \
  --assignee independent-qa-01 \
  --authorized-by general-orchestrator
```

Handle uncertainty without replay:

```bash
npm run cadops -- uncertain \
  --ticket E-0002 \
  --actor watcher-01 \
  --reason "Connection ended after dispatch; completion is not disproven."

npm run cadops -- quarantine \
  --ticket E-0002 \
  --actor watcher-01 \
  --reason "Original identity must not be replayed."

npm run cadops -- recover \
  --ticket E-0002 \
  --operator recovery-operator-01 \
  --authorized-by watcher-01
```

Inspect the system:

```bash
npm run cadops:validate
npm run cadops:watch
npm run cadops:status
npm run cadops -- show --ticket E-0001
```

Add `--json` for machine-readable output. Repeat `--artifact` and `--check` as needed.

## Watcher findings

The Watcher reports:

- broken ledger or event-chain integrity,
- stale accepted or active custody,
- uncertain or quarantined work without a recovery identity,
- completed work that did not pass custody or explicitly close,
- successors that were prepared but never visibly accepted,
- newer active work bypassing an older unresolved ticket.

Critical findings make `cadops:watch` exit nonzero. Warnings remain visible but do not fail the command.

## Repository gate

`npm test` runs:

1. CADOps state-machine and adversarial tests.
2. Canonical ledger validation.
3. Canonical Watcher health.
4. Existing repository, orchestration, runtime, and smoke gates.

CADOps does not replace independent review. A Builder receipt authorizes only the next declared lane; it is not self-approval and is not permission to merge.
