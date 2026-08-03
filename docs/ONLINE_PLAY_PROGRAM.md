# GameDeck online play program

## North star

A friend can receive an invitation, pass readiness checks, and reach responsive gameplay in under ten minutes across the widest truthful set of legally owned games.

GameDeck should not pretend that every title supports the same network model. It should choose the best safe route, explain why, and recover cleanly when the network, emulator, controller, or game cannot support the preferred path.

## Initial service-level targets

These are product targets, not claims about current production performance. They must be measured by QA before publication.

- Invitation open to playable session: p95 at or below ten minutes for a supported, already-installed route.
- Ready lobby to route decision: p95 at or below thirty seconds, including a direct-path result or a clear relay/repair decision.
- Disconnect input release-all: p95 at or below 250 milliseconds after disconnect is detected.
- Reconnect decision: p95 at or below ten seconds, ending in resumed play or one stable recovery action.
- Every terminal failure returns one public reason, one action, and no private path, token, library, or network detail.
- Video adaptation may reduce visual quality before it degrades input responsiveness.

## Universal play routing

Every game resolves to one explicit route:

1. **Couch co-op** — multiple local controllers; no network dependency.
2. **Synchronized netplay** — every player owns an exact compatible game/core revision and the emulator supports deterministic netplay.
3. **Remote Play Together** — only the host owns the game; encrypted video and audio travel to guests while controller input returns to the host.
4. **Integrated external** — GameDeck launches an externally managed route when truthful embedded ownership is unavailable.
5. **Blocked with repair guidance** — missing firmware, core, runtime, controller, capture, network, or compatibility evidence prevents a safe launch.

The route decision must be deterministic, versioned, locally explainable, and never based only on optimistic metadata.

## Product pillars

### Invitation to gameplay

- One host action produces a short-lived invitation with a clear expiry.
- The guest sees the game, host, required ownership model, controller slot, privacy notice, and estimated route before joining.
- Readiness checks run before expensive launch work.
- Invitations are replay-resistant, bounded, versioned, and safe to paste.
- A failed join produces one actionable reason and a retry path that does not duplicate processes or sessions.

### Network reliability

- Prefer direct encrypted peer-to-peer transport when it succeeds.
- Measure NAT type, UDP reachability, candidate gathering, packet loss, jitter, and round-trip time without exposing raw private data.
- Provide an optional trusted TURN/relay fallback after transparent consent and cost controls.
- Support reconnect and session resumption without reminting unlimited invitations or duplicating controller slots.
- Separate signaling, media, input, and synchronized-netplay health so diagnostics are precise.

### Responsive remote input

- Use ordered, bounded input channels with sequence, epoch, disconnect release-all, and stale-packet rejection.
- Normalize controller layouts to RetroPad or the chosen engine profile.
- Detect held-button, focus-loss, duplicate-controller, and reconnect edge cases.
- Report end-to-end input latency separately from video latency.

### Stream quality

- Start from conservative automatic settings based on measured uplink, decode capability, and round-trip time.
- Allow 720p60, 1080p60, and bandwidth-saving profiles only when the route can sustain them.
- Adapt bitrate before sacrificing input responsiveness.
- Make audio support explicit; never silently substitute microphone audio or claim unsupported game audio.

### Compatibility truth

- Maintain an evidence-backed route matrix by game, platform, engine, core, OS, controller, player count, and media mode.
- Distinguish verified, experimental, integrated external, and blocked.
- Never generalize from one game, core, GPU, OS session, or network environment to all titles.
- Keep user-managed emulator installations external unless an exact managed authority is approved.

### Privacy and security

- No ROM, BIOS, save, key, or private file transfer to guests.
- Invitations reveal only the minimum connection metadata required.
- Diagnostics are local by default and explicitly exported by the user.
- Authenticated discovery replaces unauthenticated lobby metadata before it can authorize a relay or room.
- Abuse controls cover invitation flooding, replay, oversized payloads, fake room substitution, slot theft, and malicious input.

## 30-day foundation

1. Freeze a versioned universal play-route contract.
2. Add a preflight readiness model for host, guest, game/core match, controllers, capture, audio mode, NAT, and relay availability.
3. Harden invitation parsing, replay prevention, expiry, and exactly-once slot consumption.
4. Add connection-state diagnostics with fixed public reason/copy/action mappings.
5. Build deterministic reconnect and disconnect release-all behavior.
6. Test two-player Remote Play and synchronized netplay across Windows, macOS, and Linux where supported.
7. Decide the trusted TURN strategy and cost envelope; do not deploy a paid relay before the model is reviewed.
8. Replace unauthenticated synchronized-netplay room discovery as an authority, or label and constrain it as degraded discovery only.

## 60-day universal compatibility

1. Publish the first evidence-backed top-title route matrix.
2. Add per-system and per-game controller profiles with explicit player-slot limits.
3. Cover two, three, and four-player lobbies with mixed local and remote participants where the engine supports them.
4. Add automated bandwidth, latency, decode, and controller readiness checks.
5. Add route fallback without duplicate launches: synchronized netplay to Remote Play only after clean teardown and user confirmation.
6. Create community compatibility reports that collect exact evidence without asking for copyrighted game files.
7. Ship a controller-first join flow with deterministic focus restoration and reduced-motion behavior.

## 90-day dependable network

1. Offer an optional GameDeck relay/TURN path with transparent region, cost, privacy, and fallback behavior.
2. Add accountless invite links or codes that preserve local-first operation.
3. Support resumable sessions and host migration only where the emulator and security model make them truthful.
4. Publish a reproducible multiplayer release matrix and public reliability dashboard based on aggregate, privacy-safe evidence.
5. Run recurring community playtests across multiple regions and network types.
6. Establish partner validation with emulator, controller, and networking communities without making unsupported compatibility claims.

## Program increments

### Increment 0: shared contracts

Freeze route, readiness, public reason, copy, action, lifecycle, cleanup, focus, security, and rollback semantics across Runtime, Compatibility, Player Experience, Security, and Integration QA.

### Increment 1: pure models

Implement readiness, invitations, slot consumption, state transitions, reconnect, route choice, and diagnostics as pure modules with exhaustive tests and no product side effects.

### Increment 2: injected adapters

Introduce fake process, signaling, capture, input, transport, and relay adapters. Prove ordering, idempotency, timeout, stale-event rejection, and cleanup before real integrations.

### Increment 3: live two-player slice

Validate one exact supported route across host and guest with controller input, audio mode, network diagnostics, reconnect, teardown, privacy review, and rollback evidence.

### Increment 4: compatibility and scale

Expand the evidence matrix, mixed local/remote slots, three-to-four-player sessions, regional networks, relay fallback, and community playtests without broadening claims beyond verified tuples.

## Stage gates

No feature advances because a document says it is ready. Each stage needs evidence.

### Contract gate

- Runtime, Compatibility, Player Experience, Security, and Integration QA approve the same immutable contract.
- All public reasons, copy, actions, focus, lifecycle, and rollback behavior are fixed.

### Pure implementation gate

- New pure modules and tests only.
- No Electron, capture, controller, network, renderer, or product side effects.
- Exhaustive state and replay tests pass.

### Adapter gate

- Injected fake process, capture, input, signaling, and relay adapters.
- Failure ordering and cleanup verified before real side effects.

### Platform gate

- Exact OS, engine/core, GPU/session, controller, player count, and media tuple.
- Independent security and compatibility evidence.

### Player-visible gate

- Controller-only walkthrough, keyboard accessibility, screen-reader review, 44-pixel targets, reduced motion, focus restoration, and truthful copy.
- No hidden or focusable controls while unavailable.

### Release gate

- Exact commit, clean integration branch, full CI, reproducible artifacts, checksums, rollback, and multi-client live evidence.

## Multiplayer KPI tree

### Awareness

- Qualified visits to multiplayer documentation and release pages
- Video completion and tester-call response
- GitHub discussion and compatibility-report participation

### Activation

- Host preflight completion rate
- Invitation successfully created
- Guest invitation successfully parsed
- Readiness check completion

### Connection

- Direct connection success rate
- Relay fallback success rate
- Median time from invite open to ready lobby
- Failure rate by fixed public reason

### Gameplay

- Session reaches playable state
- Time to first remote input
- Median input round-trip time
- Packet loss, jitter, reconnect, and unexpected disconnect rates
- Percentage of sessions ending through clean teardown

### Retention and contribution

- Players returning for another session
- Repeat friend groups
- Compatibility reports with reproducible evidence
- Community playtest participation
- Contributors improving route coverage or diagnostics

No metric should require invasive per-user tracking. Prefer aggregate counters, opt-in diagnostics, release data, surveys, and user-submitted evidence.

## Ethical monetization boundaries

Local library use, couch play, compatibility data, external launch, and direct peer-to-peer play remain free and local-first.

Potential revenue paths:

- Optional supporter memberships
- Transparent sponsorships
- Optional paid relay/TURN capacity with clear bandwidth limits and no game-content access
- Hardware or service partnerships disclosed as partnerships
- Grants and open-source funding

Do not sell conversation data, gameplay data, library inventories, invite metadata, or player profiles. Do not make the free direct path intentionally unreliable to force relay purchases.

## First prioritized backlog

1. Universal route decision and reason table
2. Host/guest readiness preflight
3. Invitation replay and slot-consumption hardening
4. Authenticated synchronized-netplay discovery
5. NAT and relay diagnostics
6. Reconnect and release-all behavior
7. Optional TURN architecture and cost model
8. Two-to-four-player automated QA harness
9. Controller mapping and mixed local/remote slots
10. Player-facing recovery and focus contract
11. Privacy-preserving multiplayer KPI tree
12. Verified multiplayer acquisition campaign
