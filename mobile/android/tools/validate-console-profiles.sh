#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/gamedeck-console-profile-test"
rm -rf "$OUT"
mkdir -p "$OUT"
javac -d "$OUT" \
  "$ROOT/app/src/main/java/io/gamedeck/mobile/SystemRegistry.java" \
  "$ROOT/app/src/main/java/io/gamedeck/mobile/ConsoleInputProfile.java" \
  "$ROOT/tools/java/io/gamedeck/mobile/ConsoleInputProfileTest.java"
java -cp "$OUT" io.gamedeck.mobile.ConsoleInputProfileTest
