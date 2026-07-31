# Support GameDeck

GameDeck is open source. Funding pays for code signing, Apple notarization, release infrastructure, accessibility work, cross-platform QA, documentation, and emulator-integration maintenance.

The in-app Community page reads **public receiving addresses only** from `config/donations.json`. Private keys, recovery phrases, and encrypted keystores are never bundled or committed.

The maintainer can create an encrypted local EVM wallet with:

```bash
npm run wallet:create
```

The command requires an interactive terminal, a 12+ character password, and recovery-phrase verification. It writes the encrypted keystore to `Documents/GameDeck Vault`, outside this repository. Back up both the encrypted file and the handwritten recovery phrase before publishing the public address or accepting funds.

Sponsorships follow the [public placement and privacy rules](docs/SPONSORSHIP.md). Financial support never buys roadmap control, access to user data, or an unlabeled advertisement.
