# GameDeck sponsorship policy

GameDeck accepts a small number of sponsor placements to fund open development without turning the library into an ad-tech product.

## Placement standard

- Clearly labeled as **Sponsored** or **Community Sponsor**
- Static title, body, call to action, color, and optional bundled image
- No JavaScript, pixels, cookies, fingerprinting, cross-app identifiers, or personalized targeting
- No overlays, autoplay, interruptions, or placements inside gameplay
- User can disable community sponsors in Settings
- External links open through a validated HTTPS handler

## Brand safety

GameDeck does not accept promotions for unauthorized game downloads, cheats sold for competitive play, malware, gambling, adult content, deceptive financial products, political persuasion, or products that infringe game and console trademarks.

## Inventory

The initial inventory is one rotating card on the Community page. A sponsor cannot buy rankings, reviews, telemetry, default emulator selection, or roadmap control.

## Creative delivery

Approved campaigns are represented by the versioned `sponsors.json` schema. The app accepts a remote HTTPS manifest but sanitizes field lengths, URL schemes, colors, and image paths. Local creative remains the offline fallback.

To discuss a founding placement, open a [Sponsorship inquiry](https://github.com/B11-Health/gamedeck/issues/new?template=sponsorship.yml). Do not include confidential billing details in a public issue.
