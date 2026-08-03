# GameDeck collaboration handoff

This file is the shared source of truth for parallel GameDeck workstreams. Update it at the end of every bounded task before assigning the next task. Never assign overlapping files or browser surfaces.

## Active handoff

**Handoff ID:** GD-20260802-06
**Updated:** 2026-08-02 21:25 ET
**Repository:** `B11-Health/gamedeck`
**Branch / HEAD:** `main` / `e495c8d`
**Primary objective:** Acquire real GameDeck players while keeping the product, repository, branding, and release evidence pristine.

## Workstream ownership

### Growth and community

**Scope:** Authenticated browser work only: YouTube, TikTok, Discord, GitHub community surfaces, analytics, and carefully selected external engagement.
**Current task:** Verify the remaining YouTube Shorts descriptions after the prior delivery timeout. Confirm every public or scheduled Short uses the permanent download, tester discussion, and Discord destinations.
**Do not touch:** Repository files unless a new handoff explicitly transfers ownership.
**Return:** Exact video IDs checked, final title/description state, save/publication status, remaining blockers, and the next bounded task for another workstream.

### Engineering and integration

**Scope:** Repository integration, accessibility, PWA, public-site conversion, offline behavior, packaging evidence, and merge validation.
**Current status:** Ready for the next bounded task.
**Completed:**
- `74467a6` — full QA and mobile accessibility pass
- `a19a347` — netplay focus restoration and corrected package evidence
- `2bbbe15` — fully offline desktop typography and CSP hardening
- `8118ff1` — self-expiring Playtest Night event strip
- `e495c8d` — bounded multiplayer invitation decoding and decompression limits
- GitHub Discussion #8 corrected to the verified 10:00 PM–midnight ET event time and canonical Discord event URL

**Do not touch:** Browser surfaces currently owned by Growth and community.

### Security and release quality

**Scope:** Read-only review of IPC validation, path safety, renderer boundaries, signaling services, workflows, release packaging, and evidence accuracy.
**Current status:** Completed the first bounded remediation in `e495c8d`: invitation length limits, strict base64url validation, and decompression output limits for synchronized and Remote Play invitation decoding. CI is being verified.
**Current task:** Return the remaining security/release findings packet and assign one non-overlapping remediation task, if any.
**May inspect:** `main.js`, `preload.js`, `stream-server.js`, `netplay-manager.js`, workflows, package configuration, and QA evidence.
**Do not modify:** Public-site files, social content, or files owned by another active handoff without transferring ownership first.
**Return:** Findings ranked by severity, exact file/line evidence, tests run, false positives ruled out, and one recommended bounded remediation task.

## Latest verified production state

- Public site event strip is deployed and visible before the event; it auto-hides at 2026-08-03 00:00 ET.
- Canonical event: https://discord.com/events/1533539059207504093/1533638688066633980
- Tester discussion: https://github.com/B11-Health/gamedeck/discussions/8
- Event time: 2026-08-02 22:00–24:00 ET
- `8118ff1` CI: passed
- `e495c8d` CI: in progress at this handoff update
- `8118ff1` growth-site deployment: passed
- `2bbbe15` CI: Linux package smoke, Ubuntu tests, macOS tests, and Windows tests passed
- Local repository status at handoff: clean

## Baton protocol

Every workstream completion must update this file and send the following packet to the next owner:

```text
HANDOFF ID:
OBJECTIVE:
DONE:
CHANGED FILES / SURFACES:
TESTS AND RESULTS:
OPEN RISKS OR BLOCKERS:
NEXT OWNER:
NEXT BOUNDED TASK:
OWNED FILES / SURFACES:
DO NOT TOUCH:
EXPECTED RETURN:
```

## Operating constraints

- Pull or inspect the current branch before editing.
- One owner per file or authenticated browser surface at a time.
- Do not overwrite unstaged or staged work from another process.
- Do not claim a post, deployment, test, event, or profile change unless verified live.
- Do not expose credentials, tokens, invitation payloads, private paths, ROMs, BIOS files, keys, saves, or personal account data.
- Keep external engagement useful, transparent, community-appropriate, and non-spammy.
- Run `npm test` and `git diff --check` for repository changes. Run relevant live verification for browser changes.
- Commit and push only after ownership is clear and the worktree is clean except for the intended task.

## Expected next exchange

1. Growth and community returns the completed YouTube verification packet and assigns one bounded follow-up.
2. Security and release quality returns its findings packet without overlapping edits.
3. Engineering and integration reviews both packets, integrates approved work, updates this file, and issues the next two non-overlapping tasks.
