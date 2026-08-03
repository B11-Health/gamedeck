# GameDeck Monetization Handoff

**Handoff ID:** GD-MON-20260802-01
**Updated:** 2026-08-02 ET
**Partner:** Sponsor Partnerships Operator — https://chatgpt.com/c/6a6ff000-94d4-83ea-af9e-bd0976932aa7
**Status:** Read-only audit complete. All pricing is hypothetical and non-binding. No outreach, payment-account creation, fund acceptance, sponsor promise, or authenticated public-surface change is authorized.

## Discord-free program boundary

Discord is treated as nonexistent for monetization. It is excluded from inventory, traction, pricing, fulfillment, reporting, supporter conversion, and renewal. No replacement Discord account is proposed.

Removed assumptions and replacements:

- Discord member/channel reach → GitHub traffic, stars/forks, release downloads, GitHub Discussions participation, and public YouTube/TikTok/Reddit aggregates.
- Sponsored Discord event/channel → release underwriting, one in-app Community card, public-site acknowledgement, and optional owner-approved GitHub Discussion.
- Discord joins/clicks → sponsorship issue submissions, qualified email inquiries, Discussion participation, release downloads, and supporter transactions.
- Discord announcement fulfillment → dated campaign record, app placement proof, public funding roster, release-note acknowledgement, and optional GitHub Discussion.
- Discord supporter destination → GitHub Discussions, the primary community conversion destination.
- Discord support channel → GitHub Discussions for general help and scoped GitHub issue forms for reproducible support, compatibility, security, and sponsorship.
- Discord matchmaking/event activity as traction → removed with no monetization proxy.

## Verifiable audit snapshot

The audit covered repository state/HEAD, collaboration handoff, README, roadmap, funding/privacy/sponsorship policies, donation and sponsor configs, GitHub funding and sponsorship forms, Community UI, manifest loading/sanitization, tests, recent commits, releases, repository metadata, and the live public site.

At the snapshot: the repository was created July 31, 2026, MIT licensed, and publicly showed 0 stars, 1 fork, 1 open issue, no sponsorship inquiries, three releases, and one aggregate release-asset download. The live public site had no donation or sponsorship CTA. These are point-in-time facts, not durable traction claims. Reach-based or CPM selling is therefore inappropriate; the credible initial offer is fixed-deliverable underwriting of open-source work.

## Production-ready

- Public EVM receiving address for Ethereum, Base, and Polygon; secrets are excluded from the repository/app.
- In-app address copy and visible network labeling.
- One clearly labeled Community sponsor card with persistent user opt-out.
- HTTPS/mailto-only external-link handling.
- Remote manifest timeout, local fallback, placement-count and field-length limits, URL/color/path sanitization, and a 1 MB declared-size guard.
- Policies prohibit tracking, scripts, personalized targeting, gameplay interruption, rankings, reviews, data access, and roadmap control.
- Tests reject wallet-secret fields and malformed EVM addresses.

## Scaffolding and highest-leverage gaps

- `sponsors.json` is a self-promotional placeholder, not a live campaign.
- Only the first placement renders; documented rotation is not implemented.
- The accepted `image` field is not rendered.
- No campaign status, start/end dates, expiry, priority, deterministic selection, or placement identifier.
- No offer matrix, term, asset spec, fulfillment/remedy rule, report covenant, cancellation, renewal, or category-conflict policy.
- Sponsorship issue form lacks URL, category, dates, package interest, source, creative readiness, and a safe private-contact route.
- Public site lacks supporter/sponsor conversion and GitHub Discussions routing.
- No ledger, sponsor roster, campaign archive, reporting template, or transparency cadence.
- No privacy-safe measurement specification.
- Shared address across three networks and no reference field make reconciliation manual.
- Donation renderer does not clearly enforce a complete disabled state.
- No owner-approved email intake or conventional payment method.
- General community conversion/support is not yet centered on GitHub Discussions.

The first-conversion blockers are: no understandable offer, no public funnel, no private commercial intake, no fulfillment contract, no transparency system, insufficient evidence for reach selling, no campaign lifecycle, and unresolved owner legal/tax/payment operations.

## Recommended offers and non-binding price hypotheses

### Individual supporter
One-time support with optional anchors of **$5 / $15 / $50 equivalent** and custom amount. No perks, priority, product advantage, roadmap influence, or public identity without explicit opt-in. Preserve EVM; add card/ACH/platform support only after owner approval and account/tax/refund readiness. Post-contribution community destination: GitHub Discussions.

### Community Card Pilot
**$250–$500 / 30 days.** One labeled in-app Community card, one public funding-roster entry, launch proof, and aggregate end report. No impression/click/download/sales guarantee.

### Founding Underwriter
**$750–$1,500 / 90 days.** Up to three 30-day card flights, public-site/funding-roster acknowledgement, one factual release-note acknowledgement if a release occurs, one optional owner-approved GitHub Discussion, and aggregate report.

### Release Underwriter
**$1,000–$2,500 per defined objective.** Appropriate for signing/notarization, accessibility review, cross-platform QA, documentation, or compatibility work. Funding never buys technical outcomes, endorsement, user data, or roadmap control.

### Sustaining Sponsor
**$500–$1,000/month, three-month minimum.** Monthly card flights, roster presence, quarterly aggregate report, and limited category-conflict review. No global exclusivity or auto-renewal.

## Inventory and brand safety

Allowed inventory: one in-app Community card, restrained public-site acknowledgement, dated funding roster, factual release-note acknowledgement, and optional owner-approved GitHub Discussion tied to underwritten work.

Never sell gameplay/library/search/ranking/recommendation/default-emulator placement; paid reviews or endorsements; roadmap control; user data; email-list access; personalized targeting; sponsor scripts/pixels/cookies/fingerprinting; tracking redirects; per-user query IDs; or YouTube/TikTok/Reddit/GitHub/email editorial posts as implied endorsements.

Reject unauthorized downloads, competitive cheats, malware, gambling, adult content, deceptive finance, political persuasion, infringement, surveillance/ad-tech, spyware, predatory lending, speculative token promotions, tobacco/nicotine, weapons, hate/extremism, counterfeit goods, deceptive subscriptions, and unlicensed dropshipping. Review hardware, privacy/accessibility tools, developer infrastructure, preservation services, and creator tools case by case.

## Fulfillment rules

- Written owner approval and scope before any commitment; owner alone handles contract, invoice, account, and funds.
- Creative due seven business days before start; review within three business days; one reasonable revision.
- Start only after approval/payment; explicit calendar start/end dates.
- No outcome guarantees. Missed GameDeck-controlled placement days normally receive equal replacement days; refunds require owner approval/agreement.
- Suspend immediately for policy/security/legal/trademark risk; remove approved creative within two business days when operationally possible.
- Clean HTTPS destination only, without user IDs or tracking redirects; disclose that sponsor destinations may keep ordinary server logs.
- Enforced limits: eyebrow 32, title 100, body 280, CTA 42, six-digit hex accent; local/bundled image only after safe accessible rendering exists.
- Mandatory contrast, alt text, keyboard/controller access, reduced-motion compatibility, and clear Sponsored disclosure.

## Privacy-safe metrics and reporting

No in-app behavioral tracking.

Delivery evidence: manifest version/commit, dates/status, supported-platform screenshots, release versions, accessibility/link checklist.

Aggregate signals only: qualified sponsorship issues/email inquiries; self-reported inquiry source; GitHub traffic/clones/stars/forks/releases/Discussions when available; public YouTube/TikTok/Reddit aggregates for GameDeck-owned posts; public-site aggregate traffic only without invasive tracking; supporter count/value by network excluding known tests/self-transfers. Never join identities or provide per-user logs. Never attribute social views to a sponsor without a direct verifiable privacy-safe mechanism.

Cadence: preflight record; launch proof within two business days; end report within five business days; public quarterly statement of gross support by source, fees, net, broad spending buckets, and balance, without donor personal data.

Core metrics: qualified inquiries, inquiry-to-approved-pilot, days to launch, contracted-day completeness, renewal intent/renewal, supporter count/value, opt-out complaints, policy incidents, accessibility defects, and funds allocated to stated open-source costs.

Renewal review begins 14 days before expiry. No auto-renewal. Pricing follows scope, fulfillment cost, evidence, and demand—not invented reach. No permanent/global exclusivity.

## 30/60/90-day plan

### Days 0–30 — credible offer and funnel

After explicit ownership transfer:
- Expand `docs/SPONSORSHIP.md` with packages, ranges, inventory, terms, creative rules, fulfillment, reporting, renewal/removal, and no-guarantee language.
- Expand `FUNDING.md` with supporter options, GitHub Discussions as primary destination, network/reconciliation cautions, and transparency cadence.
- Improve sponsorship issue form with organization URL/category/dates/package/source/readiness and warning against public billing/legal/private data.
- Add/refine a reproducible support issue form; route general help/community to GitHub Discussions.
- Add public-site and app Community CTAs for Support, Sponsorship Inquiry, and GitHub Discussions.
- Define sponsor schema v2: status, startsAt, endsAt, placement, sponsorName, disclosure, and deterministic active selection.
- Add schema, expiry, prohibited-field, URL, opt-out, disabled-state, and no-tracker tests.

Acceptance: inquiry path under five minutes; all monetization community CTAs are Discussions/appropriate issues, never Discord; ranges visibly non-binding; dry-run campaign activates/expires by data; opt-out persists; no analytics requests; full tests and diff check pass in a clean owned worktree.

### Days 31–60 — prove fulfillment

- Implement dated lifecycle and accessible optional image rendering.
- Add sponsor roster, quarterly transparency template, non-confidential campaign archive, and aggregate report template.
- Run internal placeholder QA on Windows/macOS/Linux.
- Establish owner-approved sponsor email alias/workflow without publishing before privacy/ownership approval.

Acceptance: data-only activate/pause/expire/replace; expired campaigns never render; offline fallback works; safe image/alt text; sample report contains no personal/behavioral data; public aggregates reconcile and unknowns are explicit.

### Days 61–90 — validate one pilot

After owner legal/tax/payment approval and clean handoff, accept at most one pilot; publish first quarterly statement; deliver placement/report; assess trust, burden, package fit, renewal intent, and whether conventional supporter payment is justified. Adjust hypotheses only from evidence; no binding public rate card without approval.

Acceptance: scope/dates/brand review/payment/creative approval before launch; all days delivered/remedied; no privacy/accessibility/trust exceptions; report separates hard evidence, directional signals, and unknowns; renewal requires explicit approval.

## Structured relay packet

HANDOFF ID: GD-MON-20260802-01

OBJECTIVE: Build a credible Discord-free supporter/sponsor system without selling reach, behavioral tracking, or weakening open-source trust.

DONE: Read-only audit; production/scaffolding classification; offer/inventory/pricing hypotheses; fulfillment, safety, reporting, renewal, metrics, and 30/60/90 plan; every Discord assumption removed and replaced; GitHub Discussions established as primary community conversion.

EVIDENCE: Public-address donation controls; sponsor opt-out and sanitized fallback manifest; policies/tests; no public-site monetization CTA; point-in-time public traction of 0 stars, 1 fork, one release-asset download, and no sponsorship inquiry; renderer uses only first placement and ignores image.

CHANGED FILES / SURFACES: `MONETIZATION_HANDOFF.md` only. No authenticated surface, account, issue, Discussion, email, payment account, sponsor contact, or public pricing changed.

TESTS AND RESULTS: Read-only inspection completed. `node scripts/smoke-test.mjs` passed on the audited snapshot before concurrent changes resumed. No final full-suite claim against the moving dirty worktree; unrelated active edits and a previously observed cross-platform documentation-link failure remain outside this lane. Run `git diff --check -- MONETIZATION_HANDOFF.md` after write.

OPEN RISKS / BLOCKERS: Dirty active worktree; no implementation ownership; owner approval required for rates/legal/payment/invoice/tax/refund/email/live sponsor; Discussions/support routing needs public-surface ownership; traction cannot support reach pricing; lifecycle/reporting/transparency/tests remain unimplemented.

NEXT OWNER: Sponsor Partnerships Operator — https://chatgpt.com/c/6a6ff000-94d4-83ea-af9e-bd0976932aa7

NEXT BOUNDED TASK: Produce a read-only **Founding Sponsor Qualification and Packaging Validation Memo**. Research 8–12 publicly verifiable organizations across privacy tools, accessible gaming, open-source developer infrastructure, controller/hardware accessories, game preservation, and creator tools. For each: fit rationale/evidence, likely buyer role, disqualifiers, best package/range hypothesis, objections, and confidence. Recommend only top three for a future owner-approved pipeline. No contact, outreach, commitment, traction claim, or Discord evidence.

OWNED FILES / SURFACES: Partner-chat notes, public unauthenticated research, and the partner’s handoff response only. No repository ownership transferred.

DO NOT TOUCH: All repo files (including this file and `COLLAB_HANDOFF.md`), docs/config/app/site/tests/workflows/releases, GitHub Issues/Discussions, social accounts, email, payment accounts, sponsor contacts, authenticated browser surfaces, other workstream surfaces, or Discord in monetization analysis.

EXPECTED RETURN: 8–12 candidate matrix with sources; top-three recommendation and disqualifiers; package/range validation or revision; objection map; owner-approved next-experiment recommendation; statement that no outreach/contact/account/commitment/authenticated change occurred; same relay protocol.
