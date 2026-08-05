# GameDeck ChatChains

A ChatChain is a connected sequence of bounded AI conversations. Each conversation has one identity, one role, one custody scope, evidence of what happened, and at most one authorized successor.

## Explained simply

Imagine robots building a LEGO castle:

1. A Builder makes one piece.
2. A Tester checks that exact piece.
3. A Supervisor checks the identities, evidence, and rules.
4. A Watcher checks that nobody duplicated, skipped, or replayed work.

When one robot finishes, it passes a baton and a receipt. The receipt says what was completed, the proof, and the exact next job.

## Three authorities

ChatChain browser operations use three separate sources of truth:

1. **CADOps ledger** — `ops/cadops/ledger.json` says which ticket owns custody, whether it is prepared, accepted, active, completed, uncertain, or quarantined, and which successor is authorized.
2. **Private room registry** — `.cadops-private/chatchains/rooms.json` binds one ChatGPT conversation identity to one CADOps ticket. It has its own append-only event hashes and close receipts. It is ignored by Git because conversation URLs are private operational data.
3. **Live browser targets** — the Chromium DevTools endpoint proves which tabs are actually open, whether a response is generating, and whether the composer contains an unsent draft.

No one source can close a tab by itself. The ledger authorizes custody, the registry identifies the room, and the browser proves the live side effect.

## Core invariant

**Idle is not stale.**

An idle room may still hold accepted, active, review, uncertain, or recovery custody. Automatic cleanup may close a room only when all of these are true:

- the room is registered to exactly one CADOps ticket;
- the ticket is completed;
- the ticket either closed its chain as a Watcher or handed custody to exactly one successor;
- a successor room is bound and verified when a successor is required;
- the successor ticket has accepted, activated, or completed custody;
- the predecessor target still has the same conversation identity;
- the predecessor has no draft and is not generating;
- the room is not protected, duplicated, unmanaged, or uncertain.

Everything else stays open.

## Room registry lifecycle

Initialize the private registry once:

```bash
npm run chatchain:rooms:init
```

Bind the permanent control room:

```bash
npm run chatchain:rooms -- bind \
  --control \
  --url https://chatgpt.com/c/ROOM-WATCH-CONVERSATION \
  --title "GameDeck Room Watch" \
  --actor general-orchestrator
```

Bind a custody room to a prepared, accepted, active, uncertain, or quarantined ticket:

```bash
npm run chatchain:rooms -- bind \
  --ticket T-0007 \
  --url https://chatgpt.com/c/TESTER-CONVERSATION \
  --title "GameDeck independent tester" \
  --actor general-orchestrator
```

After the room is visibly open and correct, verify it:

```bash
npm run chatchain:rooms -- verify \
  --ticket T-0007 \
  --actor general-orchestrator
```

Inspect custody and closure eligibility:

```bash
npm run chatchain:rooms -- status --json
```

The registry rejects duplicate conversation identities, duplicate ticket bindings, ticket-role mismatches, event-chain tampering, and close-receipt tampering.

## Safe baton pass

The mandatory order is:

1. Complete the predecessor ticket and create its immutable receipt.
2. Create exactly one authorized successor ticket with `cadops handoff`.
3. Open a new ChatGPT conversation for that successor.
4. Bind the new room to the successor ticket.
5. Make the successor accept custody.
6. Confirm the room is visibly correct and record `rooms verify`.
7. Start the successor ticket with visible launch evidence.
8. Run the browser handoff using the predecessor and successor **ticket IDs**.
9. Activate and repeatedly verify the successor target.
10. Re-read the CADOps ledger and private room registry immediately before closing.
11. Close exactly one predecessor target.
12. Verify the predecessor disappeared and the successor remains open.
13. Update the private room registry and write a durable private receipt.

Example:

```bash
npm run chatchain:tabs -- handoff \
  --cdp http://127.0.0.1:9222 \
  --predecessor-ticket E-0007 \
  --successor-ticket T-0007 \
  --actor general-orchestrator \
  --json
```

Target IDs may also be supplied, but when both a target ID and URL are present they must identify the same conversation.

## Browser hygiene classifications

The live audit classifies each ChatGPT tab as:

- **protected** — control room, explicitly protected room, or custody that must remain open;
- **busy** — a response is generating or the composer contains a draft;
- **eligible** — ledger and registry prove that custody advanced and the room may close;
- **unmanaged** — the conversation is open but not registered; it is reported and never auto-closed;
- **unknown** — duplicate target, probe failure, inconsistent registry, closed registry room still visible, or another ambiguous state.

Only `eligible` rooms may close automatically.

Audit:

```bash
npm run cadops:browser -- --cdp http://127.0.0.1:9222 --json
```

Preview cleanup without side effects:

```bash
npm run chatchain:tabs -- clean \
  --cdp http://127.0.0.1:9222 \
  --json
```

Apply cleanup:

```bash
npm run cadops:browser:clean -- \
  --cdp http://127.0.0.1:9222 \
  --actor general-orchestrator \
  --json
```

Cleanup closes at most one room by default. Increase `--max-close` only for a reviewed recovery operation.

## Locks and receipts

Browser mutations use an exclusive local lock at `.cadops-private/chatchains/browser.lock`. A second cleanup or handoff process is rejected while the lock exists.

Every cleanup and handoff writes a private receipt under `.cadops-private/chatchains/receipts/` unless `--receipt` supplies another path. Room-close receipts include the exact CADOps ledger event hash and predecessor ticket receipt hash that authorized closure, plus exact closed, skipped, uncertain, and remaining counts. Conversation URLs are not committed to Git.

## Failure and recovery

The predecessor stays open when:

- the successor is missing, ambiguous, unverified, not accepted, or not a ChatGPT conversation;
- predecessor and successor are not the exact linked CADOps tickets;
- either room is unregistered or has inconsistent identity;
- the target ID and URL disagree;
- a room is protected, busy, duplicated, unmanaged, or uninspectable;
- custody changes during the final pre-close recheck;
- the CDP endpoint is unavailable.

An already-absent predecessor does not bypass successor checks: the successor is still activated and readiness-probed before the registry is reconciled. A close request is issued at most once. If dispatch or verification is uncertain, the room registry records uncertainty and the close is not replayed. A recovery operator must inspect current targets and continue under a distinct CADOps recovery identity.

If the browser closes successfully but the registry update fails, the browser receipt still records the verified side effect and marks recovery required.

## Browser requirement

The operator accepts only a loopback Chromium DevTools endpoint such as `http://127.0.0.1:9222`. Remote CDP endpoints are rejected. The tool does not bypass ChatGPT authentication and does not create a conversation by itself.

The real adapter verifies page readiness through the target WebSocket. Merely appearing in `/json/list` is not enough.

## Live Watcher

Run all three checks together:

```bash
npm run cadops:watch:live -- --cdp http://127.0.0.1:9222
```

This validates:

1. the canonical CADOps ledger;
2. the private room registry and its hash chain;
3. the live browser against ledger-derived room policy.

A healthy result contains no critical ledger risk, invalid room binding, eligible predecessor left open, unmanaged room, duplicate conversation target, or unknown browser state.
