# GameDeck YouTube launch

## Live channel

- Channel name: **GameDeck**
- Handle: **@GameDeckApp**
- Channel URL: https://www.youtube.com/@GameDeckApp
- Channel ID: `UCufqQr2nK29be6nMkbApspQ`
- Published launch video: https://youtu.be/u-hBhTyaqzA
- Video ID: `u-hBhTyaqzA`
- Visibility: Public
- Audience: Not made for kids
- Video language: English (United States)
- Captions: Published English track plus YouTube automatic English captions

The channel uses the GameDeck banner, profile mark, description, GitHub link, and video watermark. The reusable source assets are stored in [`marketing/youtube/channel`](../marketing/youtube/channel).

## Channel description

> GameDeck is the cinematic, controller-first, local-first launcher for legally owned game libraries on Windows, macOS, and Linux. Scan local games, check emulator readiness, browse a premium catalog, save favorites, revisit recent titles, and launch your collection from one open-source desktop experience.
>
> Open source: https://github.com/B11-Health/gamedeck

## Launch video

- Master: [`marketing/youtube/GameDeck-Official-Launch.mp4`](../marketing/youtube/GameDeck-Official-Launch.mp4)
- Captions: [`marketing/youtube/GameDeck-Official-Launch.srt`](../marketing/youtube/GameDeck-Official-Launch.srt)
- Title: **GameDeck — Your Game Library, Presented Like the Main Event**
- Public URL: https://youtu.be/u-hBhTyaqzA
- Repository: https://github.com/B11-Health/gamedeck
- Tags: `gamedeck`, `game launcher`, `emulation frontend`, `retro gaming`, `open source`, `electron app`, `local first`

The published description explains that GameDeck does not include ROMs, BIOS files, encryption keys, or commercial game artwork and asks viewers to use only games and firmware they are legally entitled to use.

## Channel assets

- `gamedeck-youtube-avatar.jpg` — 800 × 800 channel avatar
- `gamedeck-youtube-banner.jpg` — 2560 × 1440 channel banner with centered safe area
- `gamedeck-launch-thumbnail.jpg` — 1280 × 720 reusable launch thumbnail
- `gamedeck-video-watermark.png` — 150 × 150 transparent video watermark
- `gamedeck-stream-starting.jpg` — 1920 × 1080 stream starting scene
- `gamedeck-end-card.jpg` — 1920 × 1080 video end card

These are derivatives of the official repository emblem and hero artwork. They contain no third-party game characters, console marks, or commercial game artwork.

## Current master specifications

- 1920 × 1080, 30 fps, H.264 High Profile
- 64 seconds
- Gemini model: `gemini-3.1-flash-tts-preview`
- Voice: Sulafat
- Background: `Quiet Focus.mp3`
- Stereo AAC at 256 kb/s
- Integrated loudness: -14.0 LUFS
- True peak: -2.3 dBTP
- Sidechain ducking keeps the music beneath narration

The narration transcript, direction prompt, captions, and production manifest are stored beside the video.

## Rebuild workflow

Start GameDeck with remote debugging enabled, then run the production command from the repository root:

```powershell
$env:GEMINI_API_KEY = '<AI Studio key>'
$env:GAMEDECK_MUSIC = "$HOME\Downloads\Quiet Focus.mp3"
npm run video:youtube
```

The script requires Gemini TTS and intentionally has no Windows SAPI production fallback. It reads the API key only from the environment and never writes it to disk or Git. When `GAMEDECK_MUSIC` is omitted, it uses the newest `Quiet Focus*.mp3` in the current user's Downloads folder.

## Music rights

The current `Quiet Focus` file was created while the Suno account showed the Free Plan. Treat this master as a non-commercial preview unless the track has subsequently received commercial rights. Replace it with properly licensed music before enabling monetization.

## Security

Never commit API credentials. Set them through the environment or a secret manager. Rotate any credential disclosed in plaintext, including credentials pasted into chat.
