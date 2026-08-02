# GameDeck YouTube launch kit

## Live channel

- Channel: [GameDeck](https://www.youtube.com/@PlayGameDeck)
- Handle: [@PlayGameDeck](https://www.youtube.com/@PlayGameDeck)
- Channel ID: `UCCEqWVian29zzVYSPviChmA`
- Official motion trailer: [GameDeck Official Launch Trailer — Your Games. One Move Away.](https://youtu.be/0nCHy9WsEpQ)
- Video ID: `0nCHy9WsEpQ`
- Visibility: Public
- Published: August 1, 2026

The public page was verified after publication through YouTube's player metadata and oEmbed response.

## Current motion master

- Master: [GameDeck-Official-Launch-YouTube.mp4](../marketing/youtube/GameDeck-Official-Launch-YouTube.mp4)
- Motion source: [GameDeck-Motion-Capture.mp4](../marketing/youtube/GameDeck-Motion-Capture.mp4)
- Narration source: [GameDeck-Launch-Narration-Gemini.wav](../marketing/youtube/GameDeck-Launch-Narration-Gemini.wav)
- Captions source: [GameDeck-Official-Launch-YouTube.srt](../marketing/youtube/GameDeck-Official-Launch-YouTube.srt)
- Runtime: 70.6 seconds
- Resolution: 1920×1080
- Frame rate: 30 fps
- Video: H.264 High Profile, approximately 1,206 kb/s
- Audio: AAC-LC, 48 kHz stereo, approximately 258 kb/s
- Integrated loudness: -14.1 LUFS
- Loudness range: 3.1 LU
- True peak: -1.0 dBFS
- SHA-256: `00190a6042f145efd7128a507d684f6e9ed0271c0c8bb4dfd2daccbee964394d`

The trailer uses real GameDeck UI motion captured from a populated library showing 221 games across 16 installed systems. It covers Library, system browsing, Surprise Me, Discover, search, Favorites, Recent, and Community.

## Narration and music

- Gemini model: `gemini-3.1-flash-tts-preview`
- Voice: Sulafat
- Music: `Quiet Focus.mp3`
- Mix: sidechain ducking beneath narration, normalized for YouTube delivery

The exact narration and direction prompt are stored beside the master as `NARRATION-SOCIAL.txt` and `TTS-SOCIAL-PROMPT.txt`.

## Captions and thumbnail status

- Video language is set to English (United States).
- YouTube automatic English captions are published.
- The production SRT is included in the repository for exact-timing replacement or additional platforms.
- A custom thumbnail is included in the channel kit. YouTube requires one-time phone verification before custom thumbnails can be applied on this channel, so the current public upload uses a YouTube-selected frame.

## Channel assets

The reusable brand package lives in [marketing/youtube/channel](../marketing/youtube/channel):

- YouTube avatar
- YouTube banner
- Video watermark
- Launch thumbnail
- End card
- Stream-starting screen
- On-screen feature overlays

## Rebuild workflow

Start GameDeck with remote debugging enabled. From the repository root:

```powershell
npm run video:capture-motion
$env:GAMEDECK_NARRATION = "marketing/youtube/GameDeck-Launch-Narration-Gemini.wav"
$env:GAMEDECK_MUSIC = "$HOME\Downloads\Quiet Focus.mp3"
npm run video:render-motion
```

`GAMEDECK_NARRATION` and `GAMEDECK_MUSIC` are optional when the default narration file and newest `Quiet Focus*.mp3` in Downloads are available.

To regenerate a Gemini narration and the original cinematic master, set `GEMINI_API_KEY` securely and run:

```powershell
$env:GEMINI_API_KEY = '<AI Studio key>'
npm run video:youtube
```

No production script contains an API key.

## Music rights

The current `Quiet Focus` file was created while the Suno account showed the Free Plan. It is treated as a non-commercial preview track. Replace it with properly licensed music before monetizing the video or channel.

## Security

Never commit API credentials. Use environment variables or a secret manager, and rotate any credential disclosed in plaintext.
