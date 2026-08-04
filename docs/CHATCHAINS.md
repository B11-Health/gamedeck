# GameDeck ChatChains

A ChatChain is a connected sequence of bounded AI conversations. Each conversation has one identity, one role, one custody scope, evidence of what happened, and at most one authorized successor.

## Explained simply

Imagine robots building a LEGO castle:

1. A Builder makes one piece.
2. A Tester checks that exact piece.
3. A Supervisor checks the identities, evidence, and rules.
4. A Watcher checks that nobody duplicated, skipped, or replayed work.

When a worker finishes, it passes a baton and a receipt to the next worker. The receipt says what was completed, the proof, and the exact next job.

## Why separate chats

One giant conversation can mix responsibilities, repeat actions, lose constraints, or accumulate stale context. ChatChains keep work replaceable and traceable:

- every chat has a unique CADOps identity;
- only one chat holds accepted or active custody for a lane;
- completion requires an exact receipt;
- the successor must be explicitly authorized;
- uncertain work is quarantined and recovered under a new identity;
- a Watcher checks continuity and replay protection.

## Tab lifecycle rule

When a successor chat is opened, the predecessor tab must close only after the successor is proven to be a distinct, open ChatGPT conversation.

The order is mandatory:

1. Identify the exact predecessor target and conversation.
2. Identify the exact successor target and conversation.
3. Confirm the target IDs and conversation IDs are different.
4. Activate the successor tab.
5. Verify the same successor target remains at the same `https://chatgpt.com/c/<conversation-id>` URL for repeated polls.
6. Re-check both identities immediately before the side effect.
7. Request closure of exactly the predecessor target.
8. Verify the predecessor disappeared and the successor remains open.
9. Emit a machine-readable receipt.

The predecessor stays open when:

- the successor is missing, ambiguous, not a conversation, or not stable;
- predecessor and successor resolve to the same conversation;
- the predecessor is protected;
- either target changes identity before closure;
- the browser-control endpoint is unavailable.

A close request is issued at most once. If the connection ends after dispatch or closure cannot be verified, the result is `uncertain`. Do not resend the close request. Record recovery instead.

## Continuous browser hygiene

CADOps treats browser-tab sprawl as an operational defect. The live browser should contain only:

- one permanent **GameDeck Room Watch** control tab;
- one tab for each accepted, active, or review custody item that still needs interaction;
- a verified successor during an in-progress handoff;
- a tab with a non-empty draft or a response that is still generating.

Everything else is stale. The Watcher audits the CDP session at every live pulse and closes stale tabs after rechecking them immediately before closure. The cleaner fails closed: Room Watch, explicit protected targets, explicit protected conversations, drafts, generating responses, and targets whose activity cannot be inspected are never automatically closed.

A clean result means there are no idle, unprotected ChatGPT conversation tabs. A tab is not kept merely because its work was once important; its immutable CADOps receipt and Git evidence survive after the tab closes.

Live audit:

```bash
npm run cadops:browser -- --cdp http://127.0.0.1:9944 --json
```

Apply safe cleanup:

```bash
npm run cadops:browser:clean -- --cdp http://127.0.0.1:9944 --protected-url https://chatgpt.com/c/ROOM-WATCH-ID --json
```

Run ledger and browser Watchers together:

```bash
npm run cadops:watch:live -- --cdp http://127.0.0.1:9944
```

The audit exits nonzero when stale or uninspectable tabs remain. Cleanup emits exact closed, skipped, uncertain, and remaining counts. A close request is never retried when its result is uncertain.

## Browser requirement

The operator uses a Chromium DevTools HTTP endpoint, normally bound only to localhost. It does not bypass ChatGPT authentication and it does not create a conversation by itself. It rotates two already-open, authenticated conversation tabs.

No browser endpoint is assumed. If no endpoint is active, the command fails safely and leaves existing tabs alone.

## Commands

List open ChatGPT conversation targets:

```bash
npm run chatchain:tabs -- status --cdp http://127.0.0.1:9222
```

Preview a handoff without side effects:

```bash
npm run chatchain:tabs -- handoff   --cdp http://127.0.0.1:9222   --predecessor-url https://chatgpt.com/c/OLD-CONVERSATION   --successor-url https://chatgpt.com/c/NEW-CONVERSATION   --dry-run
```

Close the exact predecessor after successor verification:

```bash
npm run chatchain:tabs -- handoff   --cdp http://127.0.0.1:9222   --predecessor-target OLD-TARGET-ID   --successor-target NEW-TARGET-ID   --receipt ops/chatchains/E-0005-tab-receipt.json   --json
```

Target IDs are safer than URLs when several tabs could show the same conversation. Use `--protected-target ID` to prevent a specific predecessor from closing.

## Receipt outcomes

- `closed`: successor remained verified and the predecessor disappeared.
- `already-closed`: successor is verified and the predecessor was already absent; no close was sent.
- `planned`: dry-run validation passed; no browser side effect occurred.
- `uncertain`: a close may have happened or post-close continuity could not be proved; recovery is required and no retry is allowed.

## Relationship to CADOps

The browser receipt is operational evidence. The CADOps ledger remains the authority for Builder, Tester, Supervisor, Watcher, quarantine, and recovery identities. Closing a predecessor tab does not erase its receipt, Git history, or chain record.
