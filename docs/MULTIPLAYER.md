# GameDeck multiplayer

GameDeck 1.2 presents local and online multiplayer in one controller-first command center. Select a game, choose **Multiplayer**, press **M**, or press **Start** on a standard controller.

The command center follows a calm **game → play style → lobby → launch** flow. The selected game, compatibility state, and local match IDs appear once at the top; a compact three-way switch selects Couch, Remote Play, or Synced; and a full-width lobby keeps all four player positions readable from a couch. The guidance panel always describes the selected mode while still marking the recommended route. **Paste invite** reads the clipboard only after the user presses the button and routes recognized `GDREMOTE2`, `GDREMOTEANSWER2`, or `GDPLAY1` codes to the correct role and mode.

## Play styles

### Couch co-op

Connect player two before launch and choose **Launch couch co-op**. GameDeck starts the selected title with the local RetroArch controller profile. The readiness row shows whether one or more gamepads are currently visible.

### Remote Play Together

Only the host needs the game. The host launches the title and an encrypted WebRTC stream, then exchanges short-lived invitation and response codes with each remote player. Video travels to the guest and native RetroPad input returns to the host. GameDeck does not transfer the ROM.

### Synchronized netplay

Both players need the same game revision and compatible RetroArch core build. GameDeck calculates SHA-256 identifiers locally, displays compact game and core match IDs, and rejects mismatches before joining. Hosting uses the selected RetroArch relay region and creates a short `GDPLAY1` invitation.

## Four-slot lobby

GameDeck always shows P1 through P4 so the lobby layout remains predictable across titles. The selected game still controls the playable capacity:

- Two-player games keep P1 and P2 available while P3 and P4 are visibly locked.
- Three-player games unlock P1 through P3 and lock P4.
- Four-player games unlock all four positions and expose 2, 3, and 4-player host options.

The lobby never increases a game's native player count. It makes the limit explicit before launch or invitation sharing.

The setup view keeps one primary action visible at a time. Stream quality, relay region, and total-player controls stay inside **Session options** until opened. Mode explanations are not repeated inside the launch panel, and Couch setup reduces to controller readiness plus the launch action. Once a room starts, GameDeck removes the setup card, resets the dialog scroll position, and shows one live dashboard containing session status, P1–P4 readiness, the invitation, and End Session. Remote Play reveals **Connect this player** only after a response code is present.

## Metal Slug 3 validation target

The integrated flow is tested with a legally supplied **Metal Slug 3** Neo Geo archive and the FinalBurn Neo core. The command center should report:

- the friendly title **Metal Slug 3**
- FinalBurn Neo as the synchronized core
- a native two-player limit with P3 and P4 visibly locked in the four-slot lobby
- local game and core match IDs
- a setup-aware recommendation and visible 1/2 player lobby
- a no-scroll live-room state after the relay invitation is ready
- Couch, Remote Play, and Synced netplay as separate choices

For synchronized hosting, GameDeck launches RetroArch through the relay-backed netplay manager. A friend can join only after GameDeck verifies the matching archive and core.

## Privacy and networking

- Hashes are calculated on the local computer. Game files are not uploaded.
- Remote Play uses encrypted peer-to-peer WebRTC. Public-IP metadata can be visible to the invited peer.
- Synchronized netplay uses RetroArch relay infrastructure and a temporary password inside the invitation.
- Couch co-op never requires a network connection.

## Synchronized netplay discovery trust boundary

Synchronized hosting currently discovers the relay-published room through `http://lobby.libretro.com/list`. During the 2026-08-02 live audit, the upstream HTTPS form timed out while HTTP remained available, so switching the URL directly would have prevented rooms from reaching the ready state. The HTTP response must therefore be treated as **unauthenticated discovery metadata**, not as proof of relay identity.

The response can influence which room GameDeck associates with the host and supplies the `mitm_ip`, `mitm_port`, `mitm_session`, player count, and spectator count used for the displayed room and generated invitation. A network intermediary able to modify that HTTP response could stall discovery, falsify counts, or substitute relay session metadata. The local game and core SHA-256 checks prevent incompatible content from joining, but they do not authenticate the lobby response or the relay endpoint. The temporary room password also does not make the discovery metadata authentic.

Current safeguards reduce accidental cross-room matching: every host receives a cryptographically random nickname and password, GameDeck requires a recent room timestamp when the upstream record supplies one, invitations expire, and joining still requires matching local game and core hashes. These protections are useful, but they are not a replacement for authenticated transport. Remote Play Together does not use this lobby-list endpoint.

### Non-breaking migration plan

1. **Constrain the existing response.** Add strict response-size, JSON-shape, field-length, port-range, session-token, and relay-address validation. Accept only a room matching the random nickname and launch window, and reject metadata inconsistent with the selected known relay region.
2. **Prefer HTTPS without breaking current hosting.** Probe the HTTPS endpoint first with a short timeout. While upstream HTTPS remains unreliable, allow the HTTP endpoint only as an explicit degraded-trust fallback and expose that state in diagnostics rather than silently treating it as authenticated.
3. **Introduce authenticated discovery alongside the current invite format.** Use a reliable upstream HTTPS endpoint, signed lobby records, or a small GameDeck-controlled HTTPS relay directory with an allowlist. Add optional provenance fields to `GDPLAY1` version 1 payloads so updated hosts and guests can verify stronger discovery while older clients continue to parse the invitation.
4. **Require secure discovery after a compatibility window.** Once authenticated discovery has passed Windows, macOS, Linux, and live-relay validation, stop creating new rooms from HTTP metadata. Continue giving clear errors for older invitations instead of silently connecting through untrusted substituted metadata.

## Troubleshooting

- **Core needs attention:** open Community -> This device and allow GameDeck to finish preparing RetroArch and the required core.
- **Game mismatch:** compare the compact GAME identifier on both computers and confirm the same ROM revision.
- **Core mismatch:** update GameDeck on both computers so the same managed core build is installed.
- **Remote player has no video:** repeat the invitation/response exchange and keep the GameDeck window open during pairing.
- **Second local controller is missing:** connect it before launch and verify its RetroArch input port assignment.
See the [four-player multiplayer E2E report](E2E_MULTIPLAYER_4_PLAYER_2026-08-02.md) for the complete Metal Slug 3 and Shadow over Mystara validation matrix.
