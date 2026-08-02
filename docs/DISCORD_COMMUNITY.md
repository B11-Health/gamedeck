# GameDeck Discord Community

The official community is available at **https://discord.gg/eS7d4VqTT**. GameDeck treats Discord as an optional coordination layer: the app remains local-first and fully playable without an account.

## In-app integration

The Community screen routes players directly to the channel they need:

- **Find Remote Play partners** opens `#remote-play`.
- **Announcements** opens `#announcements`.
- **Support** opens `#support`.
- **Showcase** opens `#showcase`.
- **Copy community invite** copies the permanent server invitation.

Remote Play Together adds two Discord-aware actions:

1. **Share in #remote-play** prepares a paste-ready host invitation and opens the matchmaking channel.
2. **Return via #remote-play** prepares the guest response and opens the same channel.

GameDeck checks the final message length and falls back to the raw encrypted code if the formatted message would exceed Discord's 2,000-character limit. Invitations are short-lived and do not contain ROMs, firmware, saves, or account credentials.

## Channel map

| Channel | Purpose |
|---|---|
| `#general` | Welcomes, broad discussion, and community updates |
| `#announcements` | Releases, tutorials, milestones, and verified project news |
| `#remote-play` | Matchmaking and temporary Remote Play invitation exchange |
| `#support` | Setup help, diagnostics, controller issues, and compatibility |
| `#showcase` | Libraries, game rooms, controller setups, themes, and clips |
| `General` voice | Live play sessions and community hangouts |

## Community standards

- Share only games and firmware you legally own. Do not post ROM, BIOS, key, or copyrighted asset downloads.
- Treat Remote Play invitations like temporary private links. Delete or regenerate a code if it is posted in the wrong place.
- Never request passwords, Discord tokens, private keys, or remote desktop access in support conversations.
- Keep feedback specific: operating system, GameDeck version, system/core, game title, controller, and the Status Center report.
- Be constructive and welcoming. Harassment, impersonation, spam, and unsafe downloads are not accepted.

## Growth rhythm

A sustainable community cadence is more useful than high-volume promotion:

- **Release day:** one concise announcement, tutorial link, changelog, and known limitations.
- **Find-a-player post:** invite players to schedule a Remote Play session around a specific game or genre.
- **Showcase prompt:** ask for a library shelf, controller setup, room, or accessibility workflow.
- **Support recap:** convert repeated support answers into documentation or product fixes.
- **Roadmap pulse:** summarize what shipped, what is being tested, and where contributors can help.

Track meaningful outcomes rather than raw message volume: successful Remote Play sessions, resolved support threads, retained contributors, tutorial completion, reproducible bug reports, and accepted pull requests.

## Share templates

### Release

> GameDeck [version] is available: [three concrete improvements]. Watch the tutorial: [link]. Read the changelog: [link]. Join the community: https://discord.gg/eS7d4VqTT

### Find a player

> Looking for Player 2 for [game] on [day/time zone]. I will host through GameDeck Remote Play Together. Reply in #remote-play and I will generate a fresh private invite.

### Support

> GameDeck version: [version] · OS: [version] · System/core: [system] · Game: [title] · Controller: [model] · What happened: [short description] · Status Center output: [paste]
