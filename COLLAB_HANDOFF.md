# GameDeck collaboration handoff

This file is the shared source of truth for parallel GameDeck workstreams. Update it at the end of every bounded task before assigning the next task. Never assign overlapping files or browser surfaces.

## Active handoff

**Handoff ID:** GD-20260802-08
**Updated:** 2026-08-02 21:42 ET
**Repository:** `B11-Health/gamedeck`
**Branch / HEAD:** `main` / `7b7ecba`
**Primary objective:** Acquire real GameDeck players while keeping the product, repository, branding, and release evidence pristine.

## Workstream ownership

### Growth and community

**Scope:** Authenticated browser work only: YouTube, TikTok, Discord, GitHub community surfaces, analytics, and carefully selected external engagement.
**Current task:** Finish YouTube Shorts link normalization. The scheduled `RetroArch Setup Should Explain Itself` Short still displayed the retired Discord invite during the latest verification; confirm and save the permanent community link plus download and tester discussion on every public or scheduled Short.
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
- `a7994d3` — runtime provenance and synchronized-lobby trust-boundary documentation
- `9865ccf` — corrected cache-builder size-limit claim and non-breaking hardening step
- `9ae4adf` — bounded GameDeck Live pairing API requests
- `354b919` — enforced streamed runtime-cache byte limits
- `7b7ecba` — promoted and polished the self-expiring Playtest Night strip
- GitHub Discussion #8 corrected to the verified 10:00 PM–midnight ET event time and canonical Discord event URL

**Do not touch:** Browser surfaces currently owned by Growth and community.

### Product and QA

**Scope:** Live desktop behavior, public-site hierarchy, responsive UX, accessibility, focus flow, and real multiplayer regression testing.
**Current status:** Completed the post-`e495c8d` live invitation regression and Playtest Night event QA.
**Verified:**
- Metal Slug 3 synchronized host reached the New York relay and produced a 760-character `GDPLAY1` invitation.
- The same invitation passed the normal join path, reached `ready` as a client, and reported 2/2 players.
- Two isolated GameDeck profiles completed the normal Remote Play handshake with a 1,721-character `GDREMOTE2` invite and a 1,306-character `GDREMOTEANSWER2` response.
- The host accepted Player 2, both profiles showed two players, video attached, and 18 controller-input events reached the host as Player 2.
- `7b7ecba` moves the urgent event into the first viewport, adds precise countdown wording, preserves 40px+ actions, supports reduced motion, and keeps expired state hidden.
**Do not touch:** Authenticated growth/community browser surfaces.
**Return:** Ready to review the next engineering or growth handoff.

### Security and release quality

**Scope:** Read-only review of IPC validation, path safety, renderer boundaries, signaling services, workflows, release packaging, and evidence accuracy.
**Current status:** Completed `e495c8d`, `a7994d3`, and `9865ccf`. The runtime audit verified 37 unique unpinned upstream assets: two Linux archives, one shared macOS DMG, and 34 architecture-specific macOS core archives. The HTTP lobby trust boundary and compatibility-safe migration plan are documented.
**Current task:** Add a concise post-audit evidence addendum covering invitation limits, the successful live GDPLAY1/Remote Play regressions, pairing request limits, streamed runtime-cache limits, and the Playtest Night responsive/accessibility QA.
**Owned files:** `docs/FULL_QA_2026-08-02.md` and `docs/e2e-results/GameDeck-Full-QA-2026-08-02.json` only.
**Do not modify:** `site/*`, `src/*`, `main.js`, `netplay-manager.js`, `stream-server.js`, runtime-cache scripts, workflows, or social content.
**Return:** One documentation-only commit, exact assertions added, `npm test`, `git diff --check`, and the next non-overlapping task.

## Latest verified production state

- Public site event strip is visible in the first viewport before and during the event; it auto-hides at 2026-08-03 00:00 ET.
- Canonical event: https://discord.com/events/1533539059207504093/1533638688066633980
- Tester discussion: https://github.com/B11-Health/gamedeck/discussions/8
- Event time: 2026-08-02 22:00–24:00 ET
- `8118ff1` CI: passed
- `e495c8d` CI: passed
- `a7994d3` documentation task: reviewed against the manifest and runtime code
- `9865ccf` local `npm test` and repository audit: passed
- `354b919` pairing/runtime stream-limit tests and full repository gate: passed
- `7b7ecba` desktop/tablet/phone event-state matrix and full `npm test`: passed
- Post-`e495c8d` live GDPLAY1 and two-profile Remote Play regressions: passed
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

1. Security and release quality returns the documentation-only QA evidence addendum.
2. Growth and community returns the completed YouTube verification packet and assigns one bounded follow-up.
3. Product/QA reviews both packets, integrates approved work, updates this file, and issues the next non-overlapping tasks.
