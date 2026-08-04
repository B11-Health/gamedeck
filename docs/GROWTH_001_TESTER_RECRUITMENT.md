# GROWTH-001 — Verified multiplayer tester recruitment and proof capture

**Status:** Review draft. Do not publish recruitment or proof claims until the approval gate in this document is complete.

**Evidence base:** `origin/main` at `1cbec11d13ee923cdaa0825748aac5e88965a903` plus the live public surfaces observed on August 3, 2026.

## Objective

Recruit a small, useful set of real GameDeck multiplayer testers across operating systems, broad regions, controllers, network conditions, accessibility settings, player counts, and launch routes. Convert each session into sanitized, reviewable evidence without collecting game-library contents, precise location, IP addresses, invitation codes, account credentials, or unnecessary identity data.

This program measures where GameDeck works, where it fails, and what remains unknown. It does **not** claim universal online play, universal compatibility, low latency, or support for every game, emulator, controller, GPU, network, or operating-system combination.

## Current hard evidence and claim boundary

| Evidence | Verified scope | What it does not prove |
| --- | --- | --- |
| Remote Play Together with Street Fighter II / FinalBurn Neo | Windows 11 x64; Xbox Wireless Controller; two isolated GameDeck profiles; host and guest showed two players; 1152×720 guest video; 18 Player 2 input transitions; clean teardown | A separate physical guest machine, an external internet path, macOS/Linux, restrictive NAT, every controller, or general latency/performance |
| Synchronized netplay with Metal Slug 3 / FinalBurn Neo | Windows; New York relay reached ready; 760-character `GDPLAY1` invitation; normal join reached ready at 2/2 players | Other relay regions, cross-OS pairs, adverse networks, or broad game/core compatibility |
| Couch Co-op with Metal Slug 3 / FinalBurn Neo | Windows local launch with the GameDeck arcade controller profile | Online behavior or non-arcade routes |
| Dungeons & Dragons: Shadow over Mystara | Four-player capacity, player selectors, and responsive lobby UI were validated | A completed three- or four-human online session |
| Release artifacts | Windows installer/portable, universal macOS DMG/ZIP, Linux AppImage/DEB, and checksum manifests are public | Fresh native macOS/Linux multiplayer execution or signed/notarized distribution |
| Accessibility/UI checks | Keyboard focus, minimum desktop viewports, reduced-motion behavior, and responsive event UI were checked | Assistive-technology coverage across all multiplayer states |
| Direct WebRTC | A direct test path worked in the recorded Windows run | TURN fallback or success on symmetric, carrier, corporate, school, or otherwise restrictive NATs |
| OpenBOR in current `main` | Catalog discovery and direct `.pak` launch support are present | Any online-play or multiplayer compatibility claim for OpenBOR |

## Live CTA hierarchy

1. **Recruitment and coordination:** [GitHub Discussion #8 — Looking for GameDeck multiplayer testers](https://github.com/B11-Health/gamedeck/discussions/8)
2. **Completed-session evidence:** [Multiplayer session report](https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml)
3. **Reproducible product problem:** [Compatibility report](https://github.com/B11-Health/gamedeck/issues/new?template=compatibility_report.yml)
4. **Private vulnerability or accidental secret exposure:** [GitHub private security advisory](https://github.com/B11-Health/gamedeck/security/advisories/new)
5. **Current downloads:** [GameDeck releases](https://github.com/B11-Health/gamedeck/releases/latest)

Discussion #8 is public coordination only. Never paste a Remote Play or synchronized-netplay invitation into a Discussion, Issue, comment, screenshot, or video. Testers must exchange short-lived codes through a private channel they already trust.

## Tester journey

1. Read the evidence boundary and choose one cohort gap.
2. Reply in Discussion #8 with only: broad time zone, broad region, OS, controller, preferred mode, and whether they can host.
3. A host and guest agree on a private communication channel outside the public repository.
4. Both record the GameDeck release or commit, mode, game/system, route, and sanitized environment details.
5. Run the session. Record the first failing step or the successful path; failures are valid results.
6. Submit the structured session issue. Do not attach sensitive data.
7. Optional screenshots or clips enter the publication gate separately. A session report is not automatic permission to use media or a username in promotion.

## Cohort gaps and minimum evidence goals

Minimum goals are coverage targets, not statistical significance and not launch claims.

| Dimension | Current evidence | Priority cohort | Minimum evidence goal | Public claim before completion |
| --- | --- | --- | --- | --- |
| Windows | One Windows 11 source environment and isolated profiles | Windows 10/11 on separate physical machines | 3 completed or clearly failed external-network sessions | “Tested on one Windows environment” |
| macOS Apple Silicon | Release artifact only | M1/M2/M3/M4 host and guest | 2 session reports, including one cross-OS pair | “macOS artifact available; live multiplayer unverified” |
| macOS Intel | Universal artifact only | Intel Mac | 1 session report | Same as above |
| Linux Debian/Ubuntu | Release artifact only | Ubuntu/Debian x64 | 2 session reports | “Linux artifacts available; live multiplayer unverified” |
| Linux non-Debian | No native live evidence | Fedora/Arch-family x64 | 1 session report | Unverified |
| Cross-OS | No physical cross-OS pair | Windows↔macOS, Windows↔Linux, macOS↔Linux | 1 report per pair | Unverified |
| Region | New York relay only | North America West, Europe, Latin America, Asia-Pacific, Oceania, Middle East/Africa | 1–2 reports per broad region | “New York relay tested once” |
| Xbox controller | Xbox Wireless Controller verified | Wired/wireless Xbox variants | 2 replication reports | One model tested |
| PlayStation controller | No published session evidence | DualSense and DualShock | 2 DualSense, 1 DualShock | Unverified |
| Nintendo/generic controller | No published session evidence | Switch Pro, generic XInput/DInput | 1 Switch Pro, 2 generic reports | Unverified |
| Arcade/keyboard | Arcade profile and keyboard fallback exist; limited live diversity | Wired arcade stick and keyboard-only guest | 1 report each | Unverified beyond recorded Windows path |
| Same LAN | No separate-device report | Two physical machines on one LAN | 1 report | Unverified |
| Separate home networks | Same-machine isolated profiles only | Two residential networks | 3 reports across at least two regions | Unverified |
| Restrictive network | Documented limitation only | Double NAT, mobile hotspot/CGNAT, corporate/school/VPN | 1 report per class, success or failure | “May fail without TURN” |
| Accessibility | Focus/reduced-motion UI evidence | Keyboard-only, 150–200% scaling, high contrast/color filters, assistive technology during setup/reporting | 1 report per setting; 2 scaling reports | Bounded to current UI checks |
| Player count | Two-player live evidence; four-player UI evidence | Real three-player and four-player sessions where the selected title and mode expose those slots | 1 completed or failed report at each count | “Four-player UI was validated; live 3P/4P session unverified” |
| Game route | FinalBurn Neo arcade is the live baseline | Managed RetroArch non-arcade cores, existing RetroArch, MAME/standalone, OpenBOR/local route | 3 non-arcade systems plus 1 truthful blocked/unavailable report for unsupported routes | No route is implied to support online play merely because it launches |

Do not ask a tester to force a mode that GameDeck does not expose for the selected title. A visible “unsupported,” “repair required,” or blocked route is useful proof when reported accurately.

## Safe recruitment copy

> GameDeck is recruiting a small group of multiplayer testers. Current published proof is limited: Windows, FinalBurn Neo arcade titles, one New York synchronized relay run, and a two-profile Remote Play session. We especially need macOS, Linux, cross-OS, non-Xbox-controller, different-region, restrictive-network, accessibility, and real three/four-player reports. Failures are useful. Bring only games and firmware you legally own. Do not post game files, firmware, keys, saves, IP addresses, private paths, invitation codes, session tokens, or account information. Coordinate publicly in Discussion #8, exchange session codes privately, and submit the structured report afterward.

## Consent and privacy copy

### Public coordination notice

> Replies in GitHub Discussions are public. Share only a broad region or time zone, operating system, controller, desired mode, and availability. Do not share an email address, phone number, precise location, IP address, private path, game-library listing, invitation code, session token, credential, ROM, BIOS, key, save, or copyrighted asset.

### Session report notice

> This report is public and voluntary. GameDeck does not require your real name, precise location, IP address, account identifiers, or game-library contents. Use a broad region, sanitize diagnostics, and remove invitation codes, session tokens, peer identifiers, network addresses, and private paths. Not checking an optional publication-permission box means the report may be used only for product triage and aggregate coverage counts, not promotional attribution or media reuse.

### Optional proof/media permission

> I own or have permission to share the attached screenshot or clip. It contains no copyrighted game footage beyond what I am authorized to show, no game files or firmware, no credentials, no invitation/session tokens, no IP addresses, no private paths, and no other person’s voice, face, or username without their permission. I grant GameDeck permission to use this specific sanitized asset in official project documentation or owned-channel posts. I understand I may withdraw permission before publication; after publication, third-party copies or caches may remain.

No compensation, prize, sponsorship, or public credit is promised unless a separate written offer is approved by the maintainer.

## Proof-capture checklist

### Before the session

- [ ] GameDeck release/tag or exact commit recorded
- [ ] Host and guest OS/version/architecture recorded
- [ ] Broad region only; no precise location
- [ ] Controller model, connection type, and intended player slot recorded
- [ ] Mode and launch route recorded
- [ ] Network class recorded without IP address
- [ ] Accessibility settings recorded when relevant
- [ ] All participants understand public-report and optional-media consent
- [ ] Private channel selected for invitation exchange

### During the session

- [ ] First action and first failing step recorded
- [ ] Invitation generated/accepted result recorded without copying the code
- [ ] Ready/connected state and visible player count recorded
- [ ] Video, audio, and remote input result recorded where applicable
- [ ] Time-to-play captured as a coarse bucket, not a precision performance claim
- [ ] Reconnect attempt recorded when safe and relevant
- [ ] Error copy or Status Center output sanitized before capture

### After the session

- [ ] Structured issue submitted
- [ ] Outcome classified with the first failure reason
- [ ] Screenshot/clip checked for private paths, notifications, usernames, addresses, and codes
- [ ] Source asset retained privately with date, source, and SHA-256
- [ ] Exact public claim drafted with its session-report URL
- [ ] Optional credit and media permissions recorded separately
- [ ] QA, privacy/security, brand, and Program Operations approvals recorded before publication
- [ ] Published URL and observed platform metrics added to the handoff

## Publication approval gate

No tester result, quote, screenshot, clip, performance statement, compatibility statement, or cohort summary may be published until every applicable gate is complete.

1. **Evidence owner:** links the session issue, source asset, SHA-256, build/release, and exact proposed wording.
2. **QA / Reliability:** confirms the report supports the exact claim, distinguishes UI evidence from live-session evidence, and records unknowns.
3. **Security / Privacy:** confirms sanitization, consent, and absence of codes, tokens, addresses, credentials, private paths, game files, firmware, and unnecessary identity data.
4. **Brand / Evidence reviewer:** checks GameDeck naming, midnight/cyan/violet assets, legibility, legal-use language, and no third-party marks or misleading game art.
5. **Program Operations:** approves the destination, timing, owner, rollback, and collision boundaries.
6. **Publisher:** publishes to one owned surface, verifies the live URL, and records the exact copy and metrics snapshot.

### Allowed and forbidden claim patterns

| Allowed | Forbidden until broader QA evidence exists |
| --- | --- |
| “One Windows Remote Play session delivered 1152×720 video and Player 2 input.” | “Remote Play is lag-free.” |
| “A Metal Slug 3 synchronized session reached the New York relay at 2/2 players.” | “Synchronized netplay works everywhere.” |
| “We are recruiting macOS and Linux testers.” | “GameDeck multiplayer works on macOS and Linux.” |
| “This controller was reported in one completed session.” | “All controllers are supported.” |
| “Three of five submitted reports completed a playable session.” | “GameDeck has a 60% success rate” without cohort/method context. |
| “Four-player lobby UI was validated.” | “Four-player online play is verified.” |

## Metrics required from Analytics

Analytics should return definitions and a privacy-safe aggregation contract for:

- external participants in Discussion #8, excluding maintainers and bots
- recruitment replies by broad cohort dimension
- qualified session reports / all submitted session reports
- playable-session reports / reports that attempted connection
- first-failure reason distribution
- time-to-play buckets and reconnect outcome
- cohort coverage score: verified cells / targeted cells
- OS, region, controller, network class, accessibility setting, route, mode, and player-count coverage using small-number suppression
- report completeness rate
- optional public-credit consent rate and media-reuse consent rate
- approved proof assets / submitted proof assets
- time from recruitment reply to first completed report
- owned-channel post views, watch time, comments, and CTA responses as platform-provided aggregates
- release asset download counters as directional signals, separated from update metadata, CI, and maintainer activity where possible
- issue/discussion source self-report as optional, coarse, and non-identifying

Required safeguards: no personal identity graph, no game-library inventory, no IP storage, no cross-app tracking, no fingerprinting, no sale of data, no tiny-cohort publication, and explicit separation of hard evidence, directional signal, estimate, and unknown.

## Dependencies

- **QA / Reliability:** supported route matrix, failure taxonomy, evidence review, and claim approval
- **Security / Privacy:** issue-form review, consent copy, sanitization checklist, and small-cohort privacy rules
- **Analytics:** KPI definitions, denominators, retention, small-number suppression, and anti-gaming rules
- **Multiplayer Platform / Compatibility:** exact mode availability, relay/network limitations, and route-specific test assignments
- **Brand reviewer:** proof-card and video review using the existing GameDeck asset kit
- **Program Operations:** work-item status, publication approval, collision control, and next-task assignment
- **Maintainer:** final approval for any public post, incentive, partnership, or change to an authenticated channel

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Small or self-selected cohort is mistaken for product-wide performance | Publish raw counts, cohort context, and unknowns; avoid generalized rates |
| Public issue contains sensitive data | Strong form warnings, sanitizer checklist, security escalation, and prompt redaction |
| Testers share copyrighted content | Prohibit files/firmware/keys; reject or remove unsafe attachments |
| Invitation code is posted publicly | Revoke/regenerate; remove from public copy; treat as privacy incident if still active |
| Platform filters remove recruitment | Do not repost repeatedly; adapt to rules and keep GitHub Discussion as canonical CTA |
| Unsigned installers reduce participation | State signing limitation before download and link checksum manifests |
| Restrictive NAT failure is framed as user error | Classify network limitation neutrally and route to Platform/QA |
| Unapproved quote or media is published | Separate session consent from attribution/media consent; require the publication gate |
| Branding drifts across channels | Use the official emblem, avatar, open-graph image, cyan/violet palette, and exact GameDeck naming |

## Rollback

- Stop all scheduled or draft posts.
- Remove campaign links from owned-channel drafts and revert the issue-template commit.
- Keep submitted issues as product evidence unless they contain sensitive or unlawful material; redact or remove unsafe content through the maintainer/security process.
- Revert to Discussion #8 plus the prior issue form as the only public flow.
- Do not delete source evidence needed for incident review; quarantine it privately and record access.
