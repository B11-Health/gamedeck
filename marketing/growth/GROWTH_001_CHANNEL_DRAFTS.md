# GROWTH-001 — Owned-channel recruitment drafts

**Draft status:** Hold for QA, Privacy/Security, Brand, and Program Operations approval. These drafts are not evidence that any post was published.

## Canonical links

- Download: https://github.com/B11-Health/gamedeck/releases/latest
- Public site: https://b11-health.github.io/gamedeck/
- Tester coordination: https://github.com/B11-Health/gamedeck/discussions/8
- Completed-session report: https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml
- Compatibility report: https://github.com/B11-Health/gamedeck/issues/new?template=compatibility_report.yml
- Private security report: https://github.com/B11-Health/gamedeck/security/advisories/new

## GitHub Discussion #8 refresh

### Title

Looking for GameDeck multiplayer testers — macOS, Linux, controllers, regions, networks, and 3P/4P sessions

### Body

GameDeck is recruiting a small group of real multiplayer testers. Current published proof is deliberately narrow:

- Windows 11 x64
- FinalBurn Neo arcade titles
- one Metal Slug 3 synchronized run through the New York relay at 2/2 players
- one two-profile Remote Play run with 1152×720 guest video and Player 2 input
- four-player lobby and selector UI, but not a completed three- or four-human online session

We need reports from:

- macOS Apple Silicon and Intel
- Linux, including Ubuntu/Debian and one non-Debian system
- cross-OS host/guest pairs
- DualSense, DualShock, Switch Pro, generic XInput/DInput, arcade stick, and keyboard fallback
- North America West, Europe, Latin America, Asia-Pacific, Oceania, and Middle East/Africa
- same-LAN, separate residential, double-NAT, mobile-hotspot/CGNAT, and managed/VPN networks
- keyboard-only, high scaling, reduced motion, high contrast/color filters, and assistive-technology setup
- real three-player and four-player sessions where GameDeck exposes those slots

Failures are useful. This is an evidence program, not a promise that every combination works.

Reply with only:

- host, guest, or exact-match tester
- broad time zone and region
- operating system
- controller
- preferred mode
- whether you can host

Do not post ROMs, BIOS files, keys, saves, precise locations, IP addresses, private paths, invitation codes, session tokens, or account information. Exchange short-lived session codes through a private channel you already trust.

Download: https://github.com/B11-Health/gamedeck/releases/latest

After a session, submit the structured report:
https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml

Unsigned installers may trigger operating-system warnings. Verify downloads with the SHA-256 manifests on the release page.

## YouTube pinned comment / description footer

GameDeck multiplayer proof is still narrow, and we are recruiting the missing test environments—not claiming they are already solved.

Current published evidence: Windows + FinalBurn Neo; one Metal Slug 3 synchronized New York relay run at 2/2; one two-profile Remote Play run with video and Player 2 input.

We need macOS, Linux, cross-OS, controller-diversity, region, external-network/NAT, accessibility, and real 3P/4P reports.

Coordinate: https://github.com/B11-Health/gamedeck/discussions/8
Report a completed session: https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml
Download: https://github.com/B11-Health/gamedeck/releases/latest

Bring only games and firmware you legally own. Never post game files, firmware, keys, saves, IP addresses, private paths, invitation codes, session tokens, or account information.

## TikTok caption

GameDeck multiplayer needs real-world testers—not hype.

Verified so far: one Windows Metal Slug 3 synchronized run through the New York relay, plus one two-profile Windows Remote Play run with video + Player 2 input.

Needed: macOS, Linux, cross-OS, DualSense/Switch/generic controllers, different regions, external networks/NAT, accessibility settings, and real 3P/4P sessions.

Failures count as evidence. Search “B11-Health GameDeck Discussion 8” on GitHub.

No ROMs, BIOS, keys, saves, invite codes, IPs, or private paths.

#GameDeck #OpenSource #RemotePlay #MultiplayerTesting #PCGaming

## Reddit tester-recruitment draft

### Title

I’m looking for blunt multiplayer test reports for an open-source game-library launcher — especially macOS/Linux and difficult networks

### Body

I maintain GameDeck, a free MIT-licensed desktop launcher for legally owned local game libraries. I am not looking for generic promotion or stars; I am trying to close specific multiplayer evidence gaps.

The published evidence is narrow: a Windows/FinalBurn Neo baseline, one Metal Slug 3 synchronized session through the New York relay, and one two-profile Remote Play run with guest video and Player 2 input. That does not prove broad cross-platform, controller, region, network, or game compatibility.

Useful testers include:

- macOS Apple Silicon/Intel or Linux
- Windows↔macOS/Linux pairs
- non-Xbox controllers or keyboard fallback
- separate home networks, double NAT, mobile hotspot/CGNAT, or managed/VPN networks
- reduced motion, high scaling, keyboard-only, or assistive-technology setup
- real three/four-player sessions where the title and GameDeck mode expose those slots

Failures are welcome if the first failing step is clear. Please do not share game files, firmware, keys, saves, IP addresses, private paths, invitation codes, session tokens, or account information.

Coordination and exact evidence boundary:
https://github.com/B11-Health/gamedeck/discussions/8

Source and releases:
https://github.com/B11-Health/gamedeck

Creator disclosure: I maintain the project. This draft should be posted only where current community rules allow it, once, with native media when required.

## GitHub Issue #9 cross-link comment

The console-theme, spotlight-control, and launch-reliability playtest in this issue remains separate from multiplayer proof.

For multiplayer coordination across OS, region, controller, network/NAT, accessibility, player count, and route diversity, use the pinned tester Discussion:
https://github.com/B11-Health/gamedeck/discussions/8

After a real session, submit the structured report:
https://github.com/B11-Health/gamedeck/issues/new?template=multiplayer_session.yml

Please do not post game files, firmware, keys, saves, IP addresses, private paths, invitation codes, session tokens, or account information.

## Public-site CTA microcopy

### Primary

**Help verify multiplayer**

Join the evidence program across operating systems, controllers, regions, networks, accessibility settings, and player counts. Current proof is limited; failures are useful.

Button: **Choose a test cohort** → Discussion #8

### Secondary

**Completed a session?**

Submit a sanitized report so the exact route can be reviewed by QA.

Button: **Report the result** → multiplayer session issue form

## Proof recap template

> **Verified session — [mode / game / route]**
>
> Build: [release or commit]
> Host/guest OS: [broad, non-identifying]
> Broad region/network class: [no location or IP]
> Controllers/player count: [models and slots]
> Result: [completed / first failing step]
> Evidence: [public sanitized session issue]
> Scope: This is one reviewed session, not a product-wide compatibility or performance claim.
>
> Tester credit: [anonymous / GitHub username, only with permission]

## Consent request for a specific screenshot, clip, or quote

> May GameDeck use this specific sanitized [screenshot / clip / quote] in official project documentation or an owned-channel post? Please confirm that you own or may share it; it contains no unauthorized game footage, other person’s voice/face/username, game files, firmware, keys, credentials, IP addresses, private paths, invitation codes, or session tokens. Permission is optional and separate from the product report. You may withdraw it before publication.

## Brand execution notes

- Use **GameDeck** exactly; tagline: **One library. Every era.**
- Use the official emblem/avatar and midnight navy, electric cyan, and restrained violet.
- Use the existing open-graph image or an approved sanitized GameDeck UI capture.
- Do not use console logos, recognizable commercial game key art, trademarked controller silhouettes, fake testimonials, or fabricated performance charts.
- Put the limitation or cohort context in the post itself, not behind a link.
