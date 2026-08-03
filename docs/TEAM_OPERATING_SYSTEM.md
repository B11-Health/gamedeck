# GameDeck team operating system

GameDeck uses parallel specialist teams, but one product. The operating system exists to keep every lane productive, prevent overlapping edits, turn review findings into owned corrections, and preserve a truthful release history.

## General Orchestrator

The General Orchestrator owns coordination, not every implementation. The role must:

- Maintain the dependency board in `ops/team-board.json`.
- Assign one owner and one independent reviewer to every bounded task.
- Prevent simultaneous ownership of the same file, authenticated surface, or immutable artifact.
- Inspect the exact teammate room after delegation, approve any Authenticated Shell prompt, and verify real execution began.
- Keep rejected work in an open remediation loop until the same reviewer verifies the successor.
- Protect `main`; only reviewed, clean, exact commits may enter an integration branch.
- Keep product, security, compatibility, player experience, growth, and revenue expectations synchronized.

A delivered message is not proof of execution. Valid execution evidence includes active tool use, a changed scoped worktree, a test result, a frozen artifact with a reproducible digest, or a persisted review packet.

## Team topology

The canonical lanes are:

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

Each lane has a mission, owner role, reviewer role, dependencies, evidence requirements, and next bounded action in the machine-readable board.

## Work item states

- `planned`: useful work exists, but prerequisites or ownership are not ready.
- `ready`: bounded scope can be assigned.
- `active`: one owner is executing within an exclusive scope.
- `blocked`: execution cannot continue; the blocker and unblock owner must be explicit.
- `review`: immutable commit or artifact is under independent review.
- `approved`: review passed, but integration or release may still be pending.
- `complete`: the bounded task, review, integration, and handoff are closed.
- `paused`: intentionally idle; no ownership or execution should be inferred.

## Bounded task contract

Every task must declare:

- Exact objective and non-goals
- Base commit or immutable predecessor
- Branch and worktree, when repository work is involved
- Authorized files, authenticated surfaces, or artifacts
- Required tests and evidence
- Independent reviewer
- Rollback point
- Return format and next owner

Repository tasks must use a dedicated clean worktree unless the General Orchestrator verifies that the current workspace is exclusively owned and clean.

## Baton protocol

A completion is not closed until the next owner receives this packet:

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

The sender must verify the packet was submitted, persisted, and acted on. An unsent composer, closed tab, empty response, or generic acknowledgment is not a handoff.

## Rejection and remediation loop

A reviewer may not end work with only `REJECT`. Every rejection must include:

- Severity
- Exact commit or artifact identity
- Exact section, field, file, or invariant
- Deterministic reproduction or failing probe
- Product or security impact
- Smallest acceptable correction
- Correction owner
- Required retest

The correction owner publishes a new commit or immutable artifact without rewriting the rejected object. The original reviewer remains responsible through re-verification. Integration does not accept partially corrected work.

## Authenticated Shell protocol

After every delegation:

1. Open the exact conversation URL, not a stale target identifier.
2. Detect visible `Allow / Deny` Authenticated Shell prompts.
3. Approve the prompt when the task is authorized.
4. Distinguish shell prompts from unrelated desktop-notification prompts such as `Allow / Not now`.
5. Confirm the prompt disappeared.
6. Confirm actual execution began.
7. Recheck after major handoffs because prompts may appear later.

A general permission to use Authenticated Shell does not expand file scope, merge authority, spending authority, publication authority, or product-side-effect authority.

## Repository and integration rules

- `main` is protected conceptually even when branch protection is not available.
- Review exact commits, never moving branch names alone.
- Integration branches contain only approved sequences.
- Every integration gate includes ancestry, remote identity, exact diff scope, `npm test`, `git diff --check`, clean worktree, rollback, and product-semantic review.
- Unrelated untracked paths are never deleted or absorbed without a separate ownership handoff.
- Private ChatGPT room URLs, credentials, invitation payloads, personal data, and secrets must not be committed.

## Evidence standard

Claims are separated into:

- **Verified:** reproduced from exact bytes, commits, live surfaces, or test output.
- **Directional:** useful signal with known limitations.
- **Unknown:** not yet measured or independently confirmed.

No team may report a post, deployment, account, test, player session, compatibility claim, revenue figure, or partner commitment without direct evidence.

## Communication rhythm

- Owners report after a meaningful artifact, test, blocker, or handoff—not after every command.
- Reviewers send early blockers as soon as they are reproducible.
- The General Orchestrator runs a cross-lane pulse after delegation and major transitions.
- Every active lane must always have a next action or an explicit blocked owner.
- Completed teams pull the next highest-priority unblocked task from the dependency board.

## Program health metrics

Pipeline health is measured by:

- Time from delegation to verified execution
- Percentage of rejections with a complete remediation packet
- Time from rejection to verified correction
- Ownership-collision count
- Stale or unsent handoff count
- Exact-commit review rate
- Clean integration success rate
- Escaped regression count
- Percentage of active lanes with a concrete next action

The product metrics for online play are defined in `docs/ONLINE_PLAY_PROGRAM.md`.
