# GameDeck YouTube launch kit

## Channel identity

- Channel name: GameDeck
- Preferred handle: @GameDeckApp, then @PlayGameDeck
- Description: GameDeck is the cinematic, local-first launcher for legally owned game libraries on Windows, macOS, and Linux. Open source. Controller first. Your games, presented like the main event.

## Launch video metadata

- Title: GameDeck - Your Game Library, Presented Like the Main Event
- Description: Meet GameDeck, the open-source, controller-first desktop launcher for legally owned game libraries. Scan local games, check emulator readiness, browse a cinematic catalog, save favorites, revisit recent titles, and launch across Windows, macOS, and Linux.
- Repository: https://github.com/B11-Health/gamedeck
- Tags: gamedeck, game launcher, emulation frontend, retro gaming, open source, electron app, local first

## Production workflow

Run node scripts/generate-youtube-video.cjs while GameDeck is open with remote debugging enabled. Set GEMINI_API_KEY in the environment to use gemini-3.1-flash-tts-preview; the script never stores the key. Without it, Windows SAPI is used as a local preview fallback.

The intended owner-supplied background track is Quiet Focus (1).mp3. Confirm public-upload rights before publishing. The current preview uses a generated ambient fallback because the downloaded source file was no longer present at render time.

## Security

Never paste or commit API credentials. Rotate any credential that has been shared in chat or another plaintext channel.
