# GameDeck team operating system

GameDeck uses parallel specialist teams, but one product and one evidence standard. The operating system keeps every lane productive, prevents overlapping ownership, turns review findings into owned corrections, and preserves a truthful release history.

The canonical machine-readable state is `ops/team-board.json`. The human execution procedure is `docs/ORCHESTRATOR_RUNBOOK.md`.

## General Orchestrator

The General Orchestrator owns flow, boundaries, and closure—not every implementation. The role must:

- Maintain the critical path and task board.
- Assign exactly one owner lane and one independent reviewer lane to every bounded task.
- Prevent simultaneous ownership of the same file, authenticated surface, or immutable artifact.
- Verify that delegation produced real execution evidence, not only a delivered prompt.
- Keep rejected work in an open remediation loop until the original reviewer verifies the successor.
- Protect `main`; only reviewed, clean, exact commits may enter an integration sequence.
- Keep product, security, compatibility, player experience, QA, growth, analytics, revenue, and partnerships synchronized.
- Move newly unblocked work into execution and escalate stale work before it becomes invisible.

A delivered message is not proof of execution. Valid execution evidence includes active tool use, a changed scoped worktree, a test result, a frozen artifact with a reproducible digest, a live published URL, or a persisted review packet.

## Source of truth

When sources disagree, use this order:

1. Immutable commit, artifact bytes, digest, test output, or live surface evidence
2. `ops/team-board.json`
3. Conversation status or informal summaries

Moving branch names, verbal claims, an open browser tab, and unsent composer text are not immutable evidence.

## Stable lanes and temporary mission teams

Stable lanes preserve expertise and accountability:

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

Temporary mission teams combine lanes around an outcome without changing ownership:

- **Join to Play:** invitation, readiness, connection, input, stream, reconnect, recovery
- **Compatibility Scale:** truthful routes, exact evidence, controller profiles, fallback guidance
- **Trust and Release:** threat review, QA, integration, reproducibility, rollback
- **Adoption and Funding:** testers, proof, privacy-safe metrics, supporters, sponsors, partners

Mission teams coordinate outcomes. Work items still have one owner and one reviewer.

## Task-level dependencies

Dependencies belong on work items, not on entire teams. A lane may prepare schemas, fixtures, research, or drafts while another task is still pending, provided it does not cross an approval or ownership boundary.

This prevents a single contract review from idling growth, analytics, monetization, or partnership research that can proceed safely in parallel.

## Priority and work states

Priorities:

- `P0`: blocks the dependable online-play critical path, trust, or release
- `P1`: materially improves adoption, funding, evidence, or scale
- `P2`: useful leverage that should not displace P0 or P1 execution

States:

- `planned`: useful work exists, but prerequisites or ownership are not ready
- `ready`: all dependencies are complete and the bounded task can be assigned
- `active`: one owner is executing within exclusive scope
- `blocked`: execution cannot continue; the blocker and unblock owner are explicit
- `review`: immutable commit or artifact is under independent review
- `approved`: review passed, but integration or release may still be pending
- `complete`: implementation, review, integration or artifact handoff, and closure are done
- `paused`: intentionally idle; no execution should be inferred

## Definition of ready

A task is ready only when it has:

- A concrete objective and non-goals
- Completed dependencies
- One owner lane and one different reviewer lane
- Exact scope: files, authenticated surfaces, or artifacts
- Required evidence and exit criteria
- A rollback point
- A next action that can begin now
- A clean worktree or artifact-only boundary

The board validator rejects `ready` work with incomplete dependencies.

## Definition of done

A task is done only when:

- The exact scoped result exists
- Required tests and evidence pass
- Review uses an immutable commit or artifact identity
- Rejections, if any, are corrected and reverified by the same reviewer
- The work is integrated or handed off to the named next owner
- Rollback is documented and still possible
- The board and handoff packet match the actual state

“Code written,” “prompt sent,” and “review requested” are not complete states.

## Work-in-progress limits

Default limits are enforced by the validator:

- One `active` work item per owner lane
- Two simultaneous `review` items per reviewer lane

The General Orchestrator may change limits only in the board with an explicit reason. Starting more work is not a substitute for unblocking or finishing existing work.

## Stale-work policy

Default evidence heartbeat limits:

- `active`: 24 hours
- `review`: 12 hours
- `blocked`: 24 hours

The pulse reports stale tasks. A stale task must be refreshed with real evidence, moved to `blocked` with an unblock owner, reassigned, or paused. Generic status messages do not reset the evidence clock.

## Bounded task contract

Every task declares:

- Exact objective and non-goals
- Priority and state
- Dependencies
- Owner lane, independent reviewer lane, and any required approval lanes
- Base commit or immutable predecessor
- Branch and worktree when repository work is involved
- Authorized files, authenticated surfaces, or artifacts
- Required tests and evidence
- Exit criteria
- Rollback point
- Return format and next action

Repository tasks use a dedicated clean worktree unless the General Orchestrator verifies that the current workspace is exclusively owned and clean.

## Baton protocol

A completion is not closed until the next owner receives this packet:

```text
HANDOFF ID:
WORK ITEM:
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

The sender verifies that the packet was submitted, persisted, and acted on. An unsent composer, closed tab, empty response, or generic acknowledgment is not a handoff.

## Rejection and remediation loop

A reviewer may not end work with only `REJECT`. Every rejection includes:

- Severity
- Exact commit or artifact identity
- Exact section, field, file, or invariant
- Deterministic reproduction or failing probe
- Product, compatibility, accessibility, privacy, or security impact
- Smallest acceptable correction
- Correction owner
- Required retest

The correction owner publishes a new commit or immutable artifact without rewriting the rejected object. The original reviewer remains responsible through re-verification. Integration does not accept partially corrected work.

## Authenticated Shell protocol

After delegation:

1. Open the exact target conversation, not a stale identifier.
2. Detect visible `Allow / Deny` Authenticated Shell prompts.
3. Approve only when the task and scope are authorized.
4. Distinguish shell prompts from unrelated notification prompts.
5. Confirm the prompt disappeared.
6. Confirm real execution began.
7. Recheck after major handoffs because prompts may appear later.
8. If the shell session dies, preserve the last immutable evidence, mark the task honestly, and resume through an authorized stable shell or clean clone without expanding scope.

General permission to use Authenticated Shell does not grant permission to merge, spend, publish, create accounts, contact partners, delete unrelated files, or modify product code outside the task contract.

## Repository and integration rules

- `main` is protected conceptually even when branch protection is unavailable.
- Review exact commits, never moving branch names alone.
- Integration branches contain only approved sequences.
- Every gate includes ancestry, remote identity, exact diff scope, `npm test`, `git diff --check`, clean worktree, rollback, and product-semantic review.
- Unrelated untracked paths are never deleted or absorbed without a separate handoff.
- Private ChatGPT room URLs, credentials, invitation payloads, personal data, and secrets are never committed.

## Evidence standard

Claims are separated into:

- **Verified:** reproduced from exact bytes, commits, live surfaces, or test output
- **Directional:** useful signal with known limitations
- **Unknown:** not measured or independently confirmed

No team reports a post, deployment, account, test, player session, compatibility claim, revenue figure, cost, or partner commitment without direct evidence.

## Communication rhythm

Communication is event-driven rather than meeting-heavy:

- Owner update after a meaningful artifact, test, blocker, or handoff
- Reviewer update immediately after a reproducible blocker
- Cross-lane pulse after delegation, major transition, rejection, integration, or stale alert
- Every active lane always has a next action or an explicit blocker owner
- Completed teams pull the highest-priority ready item within their capability

## Program health metrics

Pipeline health:

- Time from delegation to verified execution
- Time in active, blocked, and review states
- Percentage of rejections with complete remediation packets
- Time from rejection to verified correction
- Ownership-collision count
- Stale or unsent handoff count
- Exact-commit review rate
- Clean integration success rate
- Escaped regression count
- Percentage of active lanes with a concrete next action
- P0 throughput and critical-path age

Product and business metrics are defined in `docs/ONLINE_PLAY_PROGRAM.md` and must preserve local-first privacy.

## Commands

```bash
npm run team:board
npm run team:pulse
npm run team:pulse:json
npm test
```

`team:board` validates the operating contract. `team:pulse` prints focus, executable work, newly unblocked work, stale tasks, and P0 risks.
