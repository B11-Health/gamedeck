# GameDeck YouTube launch kit

## Channel identity

- Channel name: GameDeck
- Preferred handle: @GameDeckApp, then @PlayGameDeck
- Description: GameDeck is the cinematic, local-first launcher for legally owned game libraries on Windows, macOS, and Linux. Open source. Controller first. Your games, presented like the main event.

## Launch video

- Master: [marketing/youtube/GameDeck-Official-Launch.mp4](../marketing/youtube/GameDeck-Official-Launch.mp4)
- Captions: [marketing/youtube/GameDeck-Official-Launch.srt](../marketing/youtube/GameDeck-Official-Launch.srt)
- Title: GameDeck - Your Game Library, Presented Like the Main Event
- Description: Meet GameDeck, the open-source, controller-first desktop launcher for legally owned game libraries. Scan local games, check emulator readiness, browse a cinematic catalog, save favorites, revisit recent titles, and launch across Windows, macOS, and Linux.
- Repository: https://github.com/B11-Health/gamedeck
- Tags: gamedeck, game launcher, emulation frontend, retro gaming, open source, electron app, local first

## Current master specifications

- 1920x1080, 30 fps, H.264 High Profile
- 64 seconds
- Gemini model: `gemini-3.1-flash-tts-preview`
- Voice: Sulafat
- Background: `Quiet Focus.mp3`
- Stereo AAC at 256 kb/s
- Integrated loudness: -14.0 LUFS
- True peak: -2.3 dBTP
- Sidechain ducking keeps the music beneath narration

The narration transcript, direction prompt, and production manifest are stored beside the video.

## Rebuild workflow

Start GameDeck with remote debugging enabled, then run the production command from the repository root:

```powershell
$env:GEMINI_API_KEY = '<AI Studio key>'
$env:GAMEDECK_MUSIC = "$HOME\Downloads\Quiet Focus.mp3"
npm run video:youtube
```

The script requires Gemini TTS and intentionally has no Windows SAPI production fallback. It reads the API key only from the environment and never writes it to disk or Git. When `GAMEDECK_MUSIC` is omitted, it uses the newest `Quiet Focus*.mp3` in the current user's Downloads folder.

## Music rights

The current `Quiet Focus` file was created while the Suno account showed the Free Plan. Suno states that free-plan songs are limited to personal, non-commercial use and cannot be monetized. This master is therefore a non-commercial preview. Before monetizing the YouTube channel, replace the track with properly licensed music or regenerate it while subscribed to a plan that grants commercial rights.

- https://help.suno.com/en/articles/9601601
- https://help.suno.com/en/articles/2410177

## Security

Never commit API credentials. Set them through the environment or a secret manager, and rotate credentials that have been disclosed in plaintext.
