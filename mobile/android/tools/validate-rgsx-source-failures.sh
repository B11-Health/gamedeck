#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/gamedeck-rgsx-source-failure-test"
rm -rf "$OUT"
mkdir -p "$OUT"
javac -d "$OUT" \
  "$ROOT/app/src/main/java/io/gamedeck/mobile/RgsxSourceFailure.java" \
  "$ROOT/tools/java/io/gamedeck/mobile/RgsxSourceFailureTest.java"
java -cp "$OUT" io.gamedeck.mobile.RgsxSourceFailureTest
