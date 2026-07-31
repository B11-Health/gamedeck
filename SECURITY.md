# Security policy

## Supported versions

Security fixes target the latest release and the current `main` branch.

## Report a vulnerability

Use the repository's private **Security → Report a vulnerability** form. Do not open a public issue for credential exposure, arbitrary command execution, unsafe path handling, malicious sponsor manifests, or wallet-related findings.

Include the affected version, operating system, reproduction steps, impact, and any proposed mitigation. Please allow a reasonable remediation window before public disclosure.

## Secrets

GameDeck stores no wallet private key. The optional wallet utility writes an encrypted keystore outside the repository and refuses non-interactive execution. Never attach a keystore, seed phrase, API key, ROM, BIOS file, or game decryption key to an issue or pull request.
