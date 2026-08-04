# GameDeck ethical revenue and optional relay model

This document is a design-only decision aid. It does not authorize pricing, spending, payment accounts, sponsor commitments, publication, telemetry, or a hosted relay launch. The machine-readable source is `config/ethical-relay-economics.json`.

## Non-negotiable trust boundary

GameDeck keeps local couch play, direct peer-to-peer play, and Remote Play over user-owned networks free and usable. Funding must never buy user data, personalized targeting, compatibility rankings, reviews, default-emulator placement, roadmap control, or degradation of a free route.

Optional hosted relay capacity may be evaluated only as a fallback. It must remain separable and reversible: disabling it cannot disable local play, direct play, or user-owned-network routes.

## What the scenarios mean

The low, base, and high rows are hypotheses, not provider quotes, traction, demand, or public prices. They use one transparent formula:

- relay egress GB = relayed minutes × 60 × average bitrate Mbps ÷ 8 ÷ 1000;
- relay compute hours = relayed minutes ÷ 60;
- monthly relay cost = egress GB × assumed egress unit cost + compute hours × assumed compute unit cost + assumed fixed cost;
- hypothetical monthly revenue = supporters × hypothetical supporter amount + sponsors × hypothetical sponsor amount + hypothetical grant monthly equivalent;
- monthly gap = hypothetical revenue − hypothetical relay cost.

| Scenario | Relayed minutes | Bitrate | Hypothetical relay cost | Hypothetical revenue | Gap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low | 6,000 | 6 Mbps | $22.10 | $100 | $77.90 |
| Base | 30,000 | 8 Mbps | $244 | $1,300 | $1,056 |
| High | 120,000 | 10 Mbps | $2,050 | $12,000 | $9,950 |

These rows are sensitivity examples only. Positive gaps do not prove demand, margin, tax treatment, fraud exposure, concurrency capacity, support burden, or provider suitability. They must not be converted into a rate card or budget.

## Evidence classes

**Verified** evidence requires a dated quote or invoice, exact unit and region, tax and fee treatment, an evidence owner, and a capture date.

**Assumption** means a calculation input chosen only to explore sensitivity.

**Unknown** remains the literal value `unknown`; it is not zero. Current unknowns include provider unit costs, relay-route share, sustained bitrate, concurrency and abuse exposure, supporter and sponsor demand, and payment, tax, refund, and bookkeeping requirements.

## Revenue hypotheses

1. **Individual support:** voluntary funding for open development, with no product advantage, priority, public identity, or roadmap control.
2. **Fixed-deliverable underwriting:** clearly scoped QA, accessibility, signing, documentation, or infrastructure work, with no outcome guarantee.
3. **Optional hosted relay:** separately funded fallback capacity only after cost, abuse, privacy, and free-route evidence is available.

None is approved pricing or a promise of availability.

## Measurement before pricing

Use only aggregate operational evidence already allowed by the multiplayer KPI contract:

- bounded QA measurements for bitrate, relayed minutes, concurrency, and route outcomes;
- local aggregate route counters or explicit opt-in diagnostic exports;
- approved aggregate inquiry and supporter counts;
- dated provider quotes and owner-controlled financial records.

Do not collect persistent player identifiers, IP addresses, invitation or room tokens, library inventories, file paths, raw controller input, gameplay content, or joined cross-platform profiles.

A public demand claim or pricing decision requires at least 20 qualified signals, current cost evidence, privacy and abuse review, regression evidence that the free direct route remains intact, and explicit owner financial authority.

## Stop-loss and rollback

No paid pilot starts until the provider, term, funding source, written spend cap, owner, and rollback are approved. Halt the pilot for a cap breach, billing anomaly, privacy or security incident, abuse exposure, material provider change, degradation of a free route, or owner withdrawal.

Rollback disables only the optional hosted relay route, preserves all free routes, retains no player-level relay history, and makes no unsupported demand, savings, latency, or reliability claim.

## Decision status

The safe current decision is **measure first, commit later**. Provider costs, demand, operational burden, and legal/payment readiness remain unknown. No spending, publication, outreach, partner promise, account change, or product implementation is authorized by this model.
