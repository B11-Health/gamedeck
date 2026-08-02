# GameDeck social kit

This directory stores source copy and production guidance. Generated videos belong in `dist/social/`, which is ignored by Git.

## Generate the vertical launch cut

```bash
npm run video:short
```

The command creates a 30-second, 1080×1920 H.264/AAC video plus an SRT caption file and platform-ready caption copy. Override the source, start time, duration, output directory, slug, headline, five timed messages, or caption copy with the `GAMEDECK_SHORT_*` environment variables.

## Generate the full launch campaign

```bash
npm run video:campaign
```

This produces two additional native-video angles in `dist/social/`: **Your collection deserves better than folders** and **Setup should explain itself**. Each includes a matching SRT and caption file.

## Publishing principles

- Disclose that you built or maintain GameDeck.
- Read each community's rules before posting.
- Prefer native video and a real question over link-only promotion.
- Never buy votes, comments, followers, reviews, or fake testimonials.
- Do not post the same copy into many communities at once.
- Use the permanent GitHub, tutorial, and Discord links; avoid opaque tracking links.

## Published playlists

- **GameDeck — Start Here:** https://www.youtube.com/playlist?list=PLG-ejeCsa-AI
- **GameDeck Shorts:** https://www.youtube.com/playlist?list=PLCbffYifS8R8
