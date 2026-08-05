# GameDeck Multiplayer Tester Recruitment Draft

> **Draft only. Do not publish or reuse externally until the General Orchestrator, QA Evidence Reviewer, and Privacy Reviewer approve the exact claim and destination.**

## Purpose

Recruit a small, diverse testing cohort for exact GameDeck multiplayer route tuples. A report is evidence for the tested environment only; it is never proof that every game, emulator, controller, operating system, or network works.

The program must not distribute game content, request private credentials, add telemetry, purchase promotion, promise compensation, or contact testers privately without separate authorization.

## Call to action

Approved destination after publication review:

`https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml`

The repository issue form asks for a sanitized multiplayer result and already requires the reporter to confirm that ROMs, BIOS files, keys, credentials, save files, private paths, IP addresses, invite codes, session tokens, and account identifiers were removed.

## Coverage matrix

Coverage counts are **unknown** until approved recruitment is published and reports are reviewed. These rows are priorities for evidence collection, not claims of support.

| Dimension | Coverage needed | Safe evidence |
| --- | --- | --- |
| Operating system | Windows, macOS, Linux | OS family and coarse version |
| Route | Same-device, LAN, internet-direct, relay fallback, blocked/unknown | Selected route and public reason code; no IP addresses |
| Role | Host, guest, both sides, same-device | Role only; no invite or session tokens |
| Controller topology | One local, two local, mixed local/remote, remote guest | Topology and controller family |
| Controller family | XInput, DualSense, Switch Pro, generic, keyboard fallback, other | Family plus wired/wireless; model optional |
| Region band | Same-region, cross-region, unknown | Coarse comparison only; no city or precise location |
| Display | Windowed, fullscreen, handheld, TV | Mode and optional coarse resolution |

## Proof checklist

Every usable report should identify:

1. GameDeck commit or release.
2. Tested route and host/guest role.
3. OS family and coarse version.
4. Controller topology and controller family.
5. Game system plus emulator or core.
6. Outcome category and first failing step, or a completed-play result.
7. One stable public reason and one repair action when blocked.
8. Approximate invite-to-play duration band, not an exact behavioral timeline.
9. Whether the result reproduced after restarting GameDeck.
10. Confirmation that diagnostics were sanitized.

A successful result supports only that exact tuple. Unknown evidence stays unknown.

## Privacy copy

Do not upload ROMs, BIOS files, keys, saves, invitations, private paths, IP addresses, session tokens, account identifiers, email addresses, phone numbers, precise location, or raw controller input. Screenshots and logs must hide private library locations and unrelated applications. GameDeck may credit a tester or reuse footage only after explicit opt-in consent and a separate publication review.

## Draft recruitment copy

### GitHub Discussion or issue introduction

GameDeck is looking for testers for specifically named multiplayer routes that QA has approved for the recruitment round. We need exact environment evidence across Windows, macOS, Linux, controller families, host/guest roles, and network conditions.

Each report should cover one legally owned title and one exact route tuple. A success or failure helps improve diagnostics; it does not establish universal compatibility. Use the multiplayer session form and remove private data, game content, invite codes, and session identifiers before submitting.

### Short social draft

Help test one exact GameDeck multiplayer setup. Report your OS family, controller topology, route, game system/core, and first failing step or completed-play outcome. Legally owned games only. No ROMs, BIOS files, keys, private paths, IP addresses, invites, tokens, or personal data. Publication remains blocked until the exact QA-approved routes and CTA are reviewed.

## Publication gate

Before any post, comment, video, account update, or outreach:

- name the exact QA-approved route tuples and evidence version;
- verify the CTA resolves to the repository multiplayer session form;
- preserve the privacy copy without weakening it;
- confirm no footage, tester identity, or result is reused without opt-in consent;
- keep unsupported availability and universal compatibility claims out;
- obtain General Orchestrator, QA Evidence Reviewer, and Privacy Reviewer approval;
- create a separate custody chain for publication or account mutation.

## Measurement

No product telemetry is authorized. Measure only public platform aggregates, CTA verification, and explicitly submitted GitHub reports. Track reports started, reports usable after privacy review, completed playable-session reports, and blocked reports with actionable diagnostics. Do not publish segmented rates below the minimum cohort in the privacy-safe multiplayer metrics contract.

Current response baseline: **unknown**. Do not convert missing publication or missing reports into a zero-performance conclusion.

## Stop and rollback

Pause immediately if the CTA breaks, a route claim exceeds QA evidence, reports expose private data or copyrighted content, or the reporting surface becomes unsafe. No spending, rewards, private outreach, or publication is part of this draft. Rollback is deletion of the draft and contract with no external side effects.
