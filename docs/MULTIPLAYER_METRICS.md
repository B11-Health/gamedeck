# Privacy-safe multiplayer metrics

Status: design-only measurement contract. This document does not enable telemetry, create accounts, upload raw events, or change player-visible behavior.

## Purpose

GameDeck needs evidence about invitation success, readiness, connection reliability, gameplay recovery, community contribution, and optional relay cost. The evidence must remain compatible with local-first operation and must not identify a player or reveal a game library.

The machine-readable source of truth is `config/multiplayer-metrics.json`. `scripts/multiplayer-metrics-contract.test.mjs` rejects missing denominators, identity requirements, prohibited dimensions, raw-event retention, silent baselines, and unbounded publication.

## Evidence classes

- **Hard evidence** is derived from exact local lifecycle counters, explicitly exported aggregate diagnostics, reviewed user submissions, or restricted operational cost totals. It is still unpublished until QA approves the evidence version and cohort.
- **Directional evidence** comes from public platform aggregates or optional surveys. It can guide prioritization but cannot prove product reliability.
- **Unknown** is the required baseline until an approved measurement path produces evidence. Zero must never be substituted for unknown.

## Collection boundary

- No account, advertising ID, persistent installation ID, email, IP address, invite code, room code, session token, game-library inventory, absolute path, save data, ROM/BIOS content, free-form chat, or raw controller input.
- Local aggregate counters remain on the device. Export requires a separate explicit user action and contains allowlisted aggregate fields only.
- Raw opt-in diagnostic material is retained for at most seven days; local counters roll for at most thirty days; reviewed aggregate snapshots are retained for at most ninety days.
- Published cells require at least 20 observations and are suppressed below that threshold.
- No metric may support profiling, selling user data, discriminatory pricing, or intentional degradation of the free direct route.

## Metric dictionary

| ID | Stage | Metric | Numerator | Denominator | Calculation | Evidence | Source / consent | Retention | Allowed dimensions | Baseline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `multiplayer_doc_visit_rate` | awareness | Qualified multiplayer documentation visit rate | Qualified visits to multiplayer documentation or release evidence pages | All visits to the linked GameDeck public entry pages | numerator / denominator | directional | public-platform-aggregate / public-aggregate | 90 days, repository-snapshot, raw=false | `evidenceVersion` | unknown |
| `tester_call_response_rate` | awareness | Tester call response rate | Responses that include the requested OS, controller, and network categories | Views or impressions of the exact tester call where the platform exposes them | numerator / denominator | directional | public-platform-aggregate / public-aggregate | 90 days, repository-snapshot, raw=false | `evidenceVersion` | unknown |
| `host_preflight_completion_rate` | activation | Host preflight completion rate | Host preflights reaching a terminal ready or blocked result | Host preflights started | numerator / denominator | hard | local-aggregate / local-only | 30 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `failureReasonCode` | unknown |
| `invitation_creation_success_rate` | activation | Invitation creation success rate | Invitation creation attempts returning success | Invitation creation attempts reaching a terminal result | numerator / denominator | hard | local-aggregate / local-only | 30 days, local-device, raw=false | `appVersion`, `networkRoute`, `failureReasonCode` | unknown |
| `guest_invitation_parse_success_rate` | activation | Guest invitation parse success rate | Invitation parses returning a valid bounded contract | Invitation parse attempts reaching a terminal result | numerator / denominator | hard | local-aggregate / local-only | 30 days, local-device, raw=false | `appVersion`, `failureReasonCode` | unknown |
| `readiness_pass_rate` | readiness | Readiness pass rate | Readiness checks returning ready | Readiness checks reaching any terminal result | numerator / denominator | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `evidenceVersion`, `platformFamily`, `networkRoute`, `failureReasonCode`, `playerCountBucket`, `controllerCountBucket`, `consentMode` | unknown |
| `readiness_reason_share` | readiness | Readiness terminal reason share | Readiness terminal results for one fixed public reason code | All readiness checks reaching a terminal result | numerator / denominator grouped by failureReasonCode | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `evidenceVersion`, `platformFamily`, `networkRoute`, `failureReasonCode`, `consentMode` | unknown |
| `direct_connection_success_rate` | connection | Direct connection success rate | Direct connection attempts reaching connected | Direct connection attempts reaching connected or terminal failure | numerator / denominator | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `failureReasonCode`, `playerCountBucket`, `consentMode` | unknown |
| `relay_fallback_success_rate` | connection | Relay fallback success rate | Relay attempts reaching connected | Relay attempts reaching connected or terminal failure | numerator / denominator | hard | operational-aggregate / service-operation | 90 days, restricted-operations, raw=false | `appVersion`, `networkRoute`, `failureReasonCode`, `playerCountBucket` | unknown |
| `invite_to_playable_p95_seconds` | connection | Invite-to-playable p95 | Duration values for qualifying sessions that reach playable | Qualifying sessions that reach playable | p95(numerator duration series); denominator is the sample count | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `playerCountBucket`, `consentMode` | unknown |
| `playable_session_rate` | gameplay | Playable session rate | Session attempts reaching playable | Session attempts reaching playable or a terminal failure | numerator / denominator | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `failureReasonCode`, `playerCountBucket`, `consentMode` | unknown |
| `reconnect_success_rate` | gameplay | Reconnect success rate | Reconnect attempts returning resumed play | Reconnect attempts reaching resumed play or terminal recovery | numerator / denominator | hard | explicit-opt-in-diagnostic / explicit-opt-in | 7 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `failureReasonCode`, `playerCountBucket`, `consentMode` | unknown |
| `clean_teardown_rate` | gameplay | Clean teardown rate | Session endings confirmed clean by the local lifecycle manager | All session endings reaching a terminal teardown result | numerator / denominator | hard | local-aggregate / local-only | 30 days, local-device, raw=false | `appVersion`, `platformFamily`, `networkRoute`, `failureReasonCode` | unknown |
| `repeat_play_intent_rate` | retention | Repeat-play intent rate | Survey responses selecting likely or very likely | All completed responses to the exact optional question | numerator / denominator | directional | user-submitted / explicit-opt-in | 90 days, local-device, raw=false | `evidenceVersion`, `consentMode` | unknown |
| `reproducible_compatibility_report_rate` | contribution | Reproducible compatibility report rate | Submitted reports meeting the published evidence checklist | All submitted compatibility reports reviewed in the period | numerator / denominator | hard | user-submitted / explicit-opt-in | 90 days, local-device, raw=false | `evidenceVersion`, `platformFamily`, `networkRoute`, `consentMode` | unknown |
| `relay_cost_per_successful_session` | cost | Relay cost per successful session | Relay bandwidth, compute, and egress cost in the reporting period | Successful relay sessions in the same reporting period | numerator / denominator | hard | operational-aggregate / service-operation | 90 days, restricted-operations, raw=false | `evidenceVersion`, `networkRoute`, `playerCountBucket` | unknown |

## Data-minimization matrix

| Data category | Allowed? | Handling |
| --- | --- | --- |
| Fixed lifecycle counts and durations | Yes, locally | Aggregate only; no persistent identity; optional aggregate export. |
| Stable public reason codes | Yes | Allowlisted, path-free, payload-free, grouped into cohorts. |
| OS/platform family, app version, route, player/controller buckets | Yes | Coarse dimensions only; suppress small cells. |
| Public page/video/discussion aggregates | Yes | Directional evidence; retain reviewed snapshots, not viewer identities. |
| Optional survey or compatibility report | Yes, explicit opt-in | User chooses what to submit; exact evidence is never inferred from the local library. |
| Relay service totals and cost | Yes, restricted operations | Aggregate bandwidth, compute, egress, success count, and cost only. |
| Account, IP, invite, room, token, file path, library inventory, raw input | No | Do not collect, store, export, or publish. |

## Decision rules

1. Every rate has a named numerator and denominator. Time distributions also state the qualifying sample denominator.
2. Comparisons require the same `evidenceVersion`; mixed versions are not combined.
3. Unknown denominators remain unknown. A platform that does not expose impressions cannot produce a response rate.
4. A local metric is not a product-wide metric. Product-wide claims require explicit opt-in aggregate evidence, minimum cohorts, and QA approval.
5. GameDeck may improve reliability based on a metric, but may not use it to weaken free local play, direct peer-to-peer play, or privacy protections.
6. Pricing and sponsorship decisions require separate monetization, privacy, and owner approval; this contract supplies evidence only.

## Implementation gate

Future implementation must be a separate bounded task. It must define the exact local counter lifecycle, export preview, consent copy, deletion behavior, cohort suppression, evidence version, and adversarial tests before any data leaves a device.
