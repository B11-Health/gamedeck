# Program Operations handoff — GROWTH-001

**Work item:** GROWTH-001 — Prepare verified multiplayer tester recruitment

**Owner lane:** Growth and Community

**Reviewer lane:** QA, Reliability, and Observability

**Approval lanes:** Security and Privacy; Program Operations

**Base:** `1cbec11d13ee923cdaa0825748aac5e88965a903`

**Branch:** `growth/growth-001-tester-recruitment`

**Implementation commit:** `b266916d0c88af0a9f72b18bf6a4858347dc7e14`

**Successor handoff commit:** Assigned when this handoff is committed; the exact immutable hash is supplied in the Program Operations return-room message.

## Objective

Create a truthful multiplayer recruitment and proof-capture program covering OS, broad region, controller, network/NAT, accessibility, player count, and game-route diversity. Provide privacy-safe consent copy, one canonical CTA path, a structured report form, cohort gaps, a proof checklist, a publication approval gate, and a 30-day content/community calendar that uses only verified evidence.

## Done

- Built the full tester-recruitment and proof-capture program.
- Defined the current hard-evidence boundary and explicit forbidden claims.
- Defined cohort gaps and minimum evidence goals.
- Set Discussion #8 as the coordination CTA and the multiplayer issue form as the evidence CTA.
- Expanded the multiplayer session form with release/commit, OS, broad region, network route, NAT context, launch route, controllers, accessibility, player topology, outcome, time-to-play bucket, reconnect, sanitized diagnostics, and separate optional publication permissions.
- Added issue-picker links for tester coordination, release feedback, and private security reporting.
- Added public-report privacy language and separate media/credit permission language.
- Created a 30-day calendar for August 4–September 2, 2026.
- Created ready-to-review drafts for GitHub, YouTube, TikTok, Reddit, Issue #9, the public site, proof recaps, and asset consent.
- Captured a machine-readable public evidence snapshot.
- Aligned README, growth playbook, Remote Play guidance, brand-system guidance, launch kit, and social copy with the GitHub-first flow.
- Retained the old Discord guide only as an archive/migration notice; no replacement account or server is proposed.

## Changed scope

- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/multiplayer_session.yml`
- `README.md`
- `docs/BRAND_SYSTEM.md`
- `docs/DISCORD_COMMUNITY.md`
- `docs/GROWTH_001_TESTER_RECRUITMENT.md`
- `docs/GROWTH_PLAYBOOK.md`
- `docs/PRIVACY.md`
- `docs/REMOTE_PLAY.md`
- `marketing/GROWTH_LAUNCH_KIT.md`
- `marketing/growth/GROWTH_001_30_DAY_CALENDAR.md`
- `marketing/growth/GROWTH_001_CHANNEL_DRAFTS.md`
- `marketing/social/COPY.md`
- `marketing/social/README.md`
- `ops/growth/GROWTH-001-public-evidence-2026-08-03.json`
- `ops/growth/GROWTH-001-HANDOFF.md`

`ops/team-board.json` is explicitly excluded. Program Operations owns its current successor at commit `2fd2f41c0f0597ee0a46726f26e68c5b14a467e0`.

No product, runtime, renderer, network, release workflow, or authenticated social account code is in scope.

## Live URLs verified

- Public site: https://b11-health.github.io/gamedeck/
- Repository: https://github.com/B11-Health/gamedeck
- Latest release: https://github.com/B11-Health/gamedeck/releases/tag/v1.2.0
- Tester Discussion #8: https://github.com/B11-Health/gamedeck/discussions/8
- Release feedback Discussion #7: https://github.com/B11-Health/gamedeck/discussions/7
- Community playtest Issue #9: https://github.com/B11-Health/gamedeck/issues/9
- Multiplayer report form: https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml
- Compatibility report form: https://github.com/B11-Health/gamedeck/issues/new?template=compatibility_report.yml
- YouTube: https://www.youtube.com/@PlayGameDeck
- TikTok: https://www.tiktok.com/@playgamedeck
- Reddit profile: https://www.reddit.com/user/Apprehensive-Roll303/
- Filtered Reddit launch post: https://www.reddit.com/r/SideProject/comments/1vduuxm/gamedeck_opensource_controllerfirst_home_for/

## Public-surface actions

- Performed a read-only audit of the public site, GitHub Discussions, Issues, Releases, YouTube, TikTok, and Reddit.
- Published no posts, comments, profile changes, releases, account changes, or compatibility claims.
- Prepared drafts only; every authenticated publication remains behind QA, Privacy/Security, Brand, Program Operations, and maintainer approval.
- Confirmed GitHub Discussion #8 is the primary tester-coordination path, GitHub Issues are the structured report/support path, and GitHub Releases are the download/checksum path.
- In owned Growth documentation, `docs/DISCORD_COMMUNITY.md` is now an archive/migration notice and the former Discord banner is marked legacy/do-not-deploy. Discord is not represented as a product, support, recruitment, or publication dependency.

## Exact evidence

- `origin/main` matched `1cbec11d13ee923cdaa0825748aac5e88965a903` at task start.
- Discussion #8 was live and pinned, with one observed participant and two maintainer-authored comments.
- Issue #9 was the only open non-PR issue and had zero comments at the snapshot.
- GitHub public API snapshot: zero stars, one fork, zero watchers.
- v1.2.0 was live with Windows, macOS, Linux, checksum, and update-metadata assets; primary installer download counters were 0–1 and are classified as directional only.
- YouTube displayed six public videos with small point-in-time counts: 36, 15, 10, 2, 1, and 0 views.
- TikTok displayed two videos, zero followers, zero likes, and a puzzle/load error during audit.
- Reddit profile branding displayed GameDeck; the SideProject launch post was removed by Reddit filters.
- Published QA evidence remains Windows-heavy: FinalBurn Neo arcade, one New York synchronized 2/2 run, and one two-profile Remote Play run with 1152×720 guest video and 18 Player 2 input transitions.
- No fresh native macOS/Linux multiplayer, physical cross-OS pair, restrictive-NAT fallback, or real three/four-human online session is claimed.

Machine-readable snapshot: `ops/growth/GROWTH-001-public-evidence-2026-08-03.json`.

## Metrics needed from Analytics

- External Discussion #8 participants, excluding maintainers/bots
- Qualified reports / all submitted reports
- Playable reports / attempted connections
- First-failure taxonomy
- Time-to-play and reconnect buckets
- Cohort coverage by OS, region, controller, network, accessibility, route, mode, and player count
- Small-number suppression rules
- Report completeness and sanitization rates
- Optional credit/media consent rates
- Approved proof assets / submitted assets
- Reply-to-report elapsed time
- Platform-provided aggregate views, watch time, comments, and directional release counters
- Clear labels for hard evidence, directional signal, estimate, and unknown

No metric may require precise identity, IP storage, game-library inventory, fingerprinting, cross-app tracking, or advertising profiling.

## Dependencies

- QA/Observability reviews exact claims, cohort assignments, and issue-form evidence fields.
- Security/Privacy reviews consent, sanitization, public-report risk, and small-cohort rules.
- Analytics publishes numerator/denominator/source/retention definitions and anti-gaming safeguards.
- Multiplayer Platform and Compatibility publish an exact supported-route/failure taxonomy for assigning testers.
- Brand/Evidence reviewer approves proof cards, clips, screenshots, and channel copy.
- Program Operations approves publication order, collision boundaries, and the next task.
- Maintainer approval is required before publishing or changing authenticated channel surfaces.

## Risks

- Volunteer samples are small and self-selected.
- Public GitHub reports can expose sensitive data if users ignore warnings.
- Copyrighted files or footage could be attached.
- Unsigned artifacts can reduce participation.
- Restrictive NAT failures can be mistaken for user error.
- Platform filters can block recruitment.
- Directional counters can be mistaken for users or traction.
- Unapproved media/username reuse can violate consent.

## Next owner and task

**Next owner:** QA, Reliability, and Observability

**Next task:** Independently review the exact implementation commit. Validate that every requested field is necessary, cohort assignments match actual mode/route support, failure categories are actionable, claim language matches existing QA evidence, and the issue form does not create an unsafe public-data path. Return APPROVE or a bounded remediation packet. Security/Privacy and Program Operations then approve the publication gate and exact first post.

After approval, Growth should execute the next evidence-backed task: publish only the refreshed Discussion #8 recruitment ask, verify the live copy/URL, record an observed metrics baseline, and immediately assign the first empty cohort cells to volunteers. Do not publish the 30-day calendar as a batch.

## Do not touch

- Product/runtime/UI/network code
- Multiplayer protocol behavior
- Existing QA artifacts except by append-only reviewed correction
- Authenticated YouTube/TikTok/Reddit account settings or posts before approval
- Release assets or tags
- Security advisories
- Other lanes’ branches/worktrees
- `ops/team-board.json` and Program Operations commit `2fd2f41c0f0597ee0a46726f26e68c5b14a467e0`
- Any active invitation/session payload or tester personal data

## Rollback

- Revert the two GROWTH-001 commits from this branch.
- Restore the prior issue template and public-copy files.
- Stop all draft/scheduled posts.
- Keep Discussion #8 and the prior session form as the only public flow until a corrected artifact is reviewed.
- Redact or remove unsafe public content through the maintainer/security process; preserve incident evidence privately.
