# GameDeck Remote Play Together

GameDeck Remote Play Together turns a local multiplayer title into a private online session without transferring the game to the guest.

## Host flow

1. Select a compatible game in the GameDeck library.
2. Choose **Play online**.
3. Select total player slots and stream quality.
4. Choose **Start Remote Play Together**.
5. GameDeck launches the title through its managed RetroArch route, enables Remote RetroPad sockets for Players 2–4, and starts GameDeck Live capture.
6. Copy the short-lived `GDREMOTE1` invitation and send it privately.
7. Paste the guest's `GDREMOTEANSWER1` response and choose **Connect this player**.

For games with more than two players, create one invitation per remote player slot. Invitations are session-specific and expire after 20 minutes.

## Guest flow

1. Open **Play Online → Join a friend** in GameDeck.
2. Paste the host invitation and enter a display name.
3. Choose **Create join response**.
4. Send the generated response back to the host.
5. Keep the Remote Play window focused. Connect a standard gamepad or use keyboard controls.

The guest does not need the host's ROM, BIOS, save files, or emulator configuration.

## Input mapping

GameDeck maps the browser Standard Gamepad layout to RetroPad. Keyboard fallback uses:

- Arrow keys: D-pad
- `Z` / `X`: primary face buttons
- `A` / `S`: secondary face buttons
- `Q` / `W`: shoulder buttons
- `Enter`: Start
- `Shift`: Select

Remote transitions travel over an ordered WebRTC data channel. The host validates the session token and player slot, then forwards events to RetroArch's built-in UDP Remote RetroPad interface at `network_remote_base_port + player index`. GameDeck spaces queued transitions across frames because RetroArch consumes one remote packet per user per poll.

## Media and signaling

- Video/audio: encrypted WebRTC peer connection using GameDeck Live capture.
- Input: encrypted WebRTC data channel, then localhost-only UDP from GameDeck to RetroArch.
- Signaling: manual invitation and response codes exchanged through a private channel you trust. Public GitHub threads are for scheduling and support, not live invitation payloads.
- NAT discovery: public STUN services; no GameDeck account or cloud signaling database.
- Third-party runtime dependencies: none beyond the Chromium WebRTC and RetroArch components already included with GameDeck.

## Privacy

WebRTC invitations contain session descriptions and ICE candidates. An invited friend may be able to see public or local network-address metadata. Share invitations only with people you trust. Codes expire, are bound to one session/player slot, and do not include game files.

## Network limitations

Direct WebRTC works across many home networks, but restrictive carrier-grade, corporate, or symmetric NATs may block peer-to-peer media. A future GameDeck-operated TURN relay can provide fallback coverage; the current implementation does not silently route gameplay through an unknown third-party media relay.

For best results:

- Prefer wired Ethernet or strong 5/6 GHz Wi-Fi.
- Use 720p/60 for responsive action games.
- Close VPNs that block UDP when a direct path cannot be established.
- Keep GameDeck and the game window running until every guest is connected.

## Validation baseline

The initial end-to-end QA used **Street Fighter II: The World Warrior (World 910522)** with FinalBurn Neo. Two isolated GameDeck clients completed offer/answer pairing, received 1152×720 video, reported a 1 ms local peer latency, and forwarded Player 2 button transitions into the host's Remote RetroPad queue without renderer errors.
