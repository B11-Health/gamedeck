# Embedded Play Phase 0B Threat Model

## Status and boundary

This document freezes security preparation only. Embedded Play Phase 0B and all player-visible behavior remain blocked pending independent Security and Release approval. The three policy modules are pure and test-only: they do not call Electron APIs, enumerate sources, access files, spawn or stop processes, open sockets, or provide runtime services.

## Platform posture

- Windows: video-only capture contract; audio is always off.
- macOS: disabled pending packaged-app consent validation.
- X11: experimental and independently gated.
- Wayland: external-only.
- Local-only: no GameDeck Live, WebRTC, relay, remote peer, or other network path.

Independent kill switches default off for capture, managed process control, and input injection. Enabling one must not enable another.

## Security invariants

Capture grants bind one active session to the exact sender, frame, window source object and identifier, video-only media scope, trusted session-bound action registration, recent single-use action marker, injected opaque grant identifier, bounded replay retention, and expiry of at most five seconds. Consumption is atomic and one-shot. Replacement, expiry, session replacement, and explicit revocation produce stable reasons. Screen fallback is forbidden. Public status excludes identifiers, paths, source IDs, sender/frame handles, and action markers.

Managed process policy accepts only exact expected canonical executable, core, configuration, and content identities proven inside their managed roots, with platform-explicit case/separator rules, explicit reparse/symlink decision inputs, and exact receipt/hash identity. The launch contract is the fixed RetroArch form `--config <config> -L <core> <content>`; fullscreen is forbidden. Any future adapter must use `shell=false`, `detached=false`, and `unref=false`. Stop is a complete-tree state machine: graceful request, escalation after deadline, post-stop verification, and failure unless root, descendants, and handles are all gone. This module never reads the filesystem or controls a process.

Input protocol bounds serialized payload size, event count, rate, and queue depth. Each connection uses an injected opaque epoch bound to every message. Sequence numbers increase monotonically within that epoch; acknowledgements report the highest processed sequence. Full button snapshots are authoritative, deltas are bounded, release-all is explicit, and separate receive/processing clocks ensure a 500ms watchdog releases every button on silence or processing stall. Every connection uses a strong injected opaque connection epoch with bounded retention; reconnect requires a fresh epoch and authoritative resynchronization. Separate receive and process clocks make the watchdog release all input if accepted work is not processed within 500ms even while traffic continues. Queue overflow compacts pending deltas into the latest full snapshot so release events cannot be silently lost.

## Blocked work

No integration with `main.js`, `preload.js`, `src/*`, display-media handlers, Electron capture APIs, process spawn/kill, source enumeration, sockets, networking, runtime services, UI, flags, or player-visible behavior is authorized by this preparation.
