# GameDeck General Orchestrator runbook

This runbook turns the team board into a repeatable operating loop. It coordinates specialists without turning the General Orchestrator into the implementation owner for every task.

## 1. Observe

Start from immutable state:

- Fetch remote refs before judging branch identity.
- Inspect exact worktree status and HEAD.
- Read `ops/team-board.json`.
- Run `npm run team:pulse`.
- Inspect active, review, blocked, stale, and newly unblocked items.
- Confirm that room claims match commits, artifacts, tests, or live surfaces.

Do not infer execution from a delivered prompt or an open tab.

## 2. Select

Choose work in this order:

1. P0 security, correctness, data-loss, or release blockers
2. P0 critical-path work already active or in review
3. Newly unblocked P0 work
4. P1 work that reduces P0 risk or produces evidence needed for decisions
5. P1 growth, analytics, monetization, and partner work that can proceed without unsupported product claims
6. P2 leverage work

Finish or unblock before starting more work. Respect one active item per owner lane.

## 3. Bound

Before delegation, write the task contract:

- Objective
- Non-goals
- Exact predecessor or base
- Branch and worktree
- Files, surfaces, or artifacts owned
- Tests and evidence
- Reviewer and approval lanes
- Rollback point
- Expected return packet

Do not delegate broad instructions such as “improve multiplayer” without a bounded result.

## 4. Dispatch and verify

After sending the task:

- Approve an Authenticated Shell prompt only when it matches the bounded task.
- Confirm the prompt disappears.
- Confirm actual execution starts.
- Record the first meaningful evidence timestamp.
- Ensure no other active item owns the same file, surface, or artifact.

If execution does not start, the item remains `ready`; it is not `active`.

## 5. Follow the evidence heartbeat

Use meaningful updates only:

- New commit or artifact
- Test output
- Reproducible blocker
- Independent verdict
- Live publication or measured result
- Handoff to the next owner

When a task exceeds its stale threshold:

1. Inspect the exact owner state.
2. Ask for or locate real evidence.
3. If no progress is possible, mark `blocked`, name the blocker, and assign an unblock owner.
4. If the task is no longer the right priority, pause it and release scope.
5. Never reset the evidence timestamp with a generic status message.

## 6. Review and remediation

Reviewers evaluate exact commits or immutable artifacts. A rejection creates a correction loop, not a dead end.

The rejection packet must identify the smallest correction and deterministic retest. The original reviewer owns closure. The rejected object remains immutable; corrections produce a successor commit or artifact.

## 7. Integrate

Before integration:

- Verify exact ancestry and remote identity.
- Verify only approved commits are present.
- Verify exact changed-file scope.
- Run full tests and `git diff --check`.
- Confirm the worktree is clean.
- Review product semantics, privacy, security, compatibility, accessibility, and rollback.
- Preserve hashes and evidence in the handoff.

Do not merge unrelated “helpful” changes into the same integration sequence.

## 8. Learn and re-prioritize

After closure:

- Update actual board state.
- Record escaped risks or unexpected friction.
- Promote tasks whose dependencies are now complete.
- Adjust future tests or contracts when a failure escaped an earlier gate.
- Move the owner to the next highest-priority ready task.

## Current critical path

The first dependable online-play release follows this sequence:

1. `PLAY-001` immutable Runtime contract approval
2. `PLAY-002` pure host and guest readiness model
3. `SEC-001` invitation, discovery, replay, and slot hardening
4. `NET-001` network diagnostics and route fallback
5. `COMPAT-001` evidence-backed route matrix
6. `UX-001` controller-first host and join journey
7. `QA-001` two-to-four-player acceptance harness
8. `REL-001` exact integration and rollback gate

Tasks may run in parallel when their dependencies and scopes allow it.

## Parallel business track

These can begin without waiting for product implementation:

- `ANALYTICS-001`: privacy-safe KPI dictionary
- `MON-001`: supporter, sponsor, grant, and optional relay economics
- `GROWTH-001`: tester cohorts and proof-capture plan

`PARTNER-001` stays planned until compatibility and cost inputs are credible enough to support truthful outreach.

## Mission-team coordination

### Join to Play

Owns invitation through teardown. A change is not acceptable if it improves connection rate while weakening security, input cleanup, accessibility, or truthful recovery.

### Compatibility Scale

Owns the route matrix. It never turns “worked once” into platform-wide support and never treats external launch as embedded support.

### Trust and Release

Owns immutable review, reproducibility, release evidence, and rollback. It can stop a release regardless of schedule pressure.

### Adoption and Funding

Owns acquisition and sustainability. It cannot publish product claims ahead of QA evidence or create incentives that intentionally degrade the free direct path.

## Failure recovery

### Authenticated Shell session terminated

- Preserve the last verified commit, artifact, and test output.
- Do not claim subsequent commands ran.
- Resume through an authorized stable shell or a clean clone.
- Re-run the relevant gate before writing or publishing.
- Record the tool failure separately from product failure.

### Ownership collision

- Stop both tasks before further writes.
- Preserve worktrees.
- Decide the canonical owner and base.
- Move the other task to blocked or re-scope it.
- Never combine work by deleting or absorbing unreviewed changes.

### Reviewer unavailable or stale

- Keep the item in `review` until the threshold.
- Escalate with the exact artifact and requested verdict.
- Reassign only if independence is preserved and the board is updated.
- A new reviewer must review from the immutable beginning, not inherit an unsupported verdict.

### P0 blocked

- Surface it in every pulse.
- Name the unblock owner and smallest next probe.
- Pause lower-priority work in the same lane when it competes for the unblock path.

## Orchestrator pulse

Run:

```bash
npm run team:pulse
```

The pulse must answer:

- What is the current focus?
- What can execute now?
- What planned work just became unblocked?
- What is stale?
- Which P0 risks need immediate escalation?
- Which lanes are at their WIP limits?

For machine-readable output:

```bash
npm run team:pulse:json
```
