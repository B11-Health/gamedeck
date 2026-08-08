#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/gamedeck-metal-slug-routing"
rm -rf "$TMP"
mkdir -p "$TMP/io/gamedeck/mobile"
cp "$ROOT/mobile/android/app/src/main/java/io/gamedeck/mobile/ArcadeContentIdentity.java" "$TMP/io/gamedeck/mobile/"
cat > "$TMP/io/gamedeck/mobile/MetalSlugRoutingValidation.java" <<'JAVA'
package io.gamedeck.mobile;

import java.io.File;

public final class MetalSlugRoutingValidation {
    public static void main(String[] args) {
        String[] sets = {"mslug", "mslug2", "mslugx", "mslug3", "mslug4", "mslug5", "mslug6"};
        for (String set : sets) {
            for (String extension : new String[]{".zip", ".7z"}) {
                String expected = set + extension;
                String actual = ArcadeContentIdentity.canonicalArchiveName(
                    new File("0123456789abcdef-" + expected), "Metal Slug");
                if (!expected.equals(actual)) {
                    throw new AssertionError(expected + " -> " + actual);
                }
                if (!set.equals(ArcadeContentIdentity.setName(actual))) {
                    throw new AssertionError("set identity failed for " + actual);
                }
            }
        }
        if (!ArcadeContentIdentity.isArcadeSystem("arcade")
            || !ArcadeContentIdentity.isArcadeSystem("mame")
            || ArcadeContentIdentity.isArcadeSystem("psp")) {
            throw new AssertionError("arcade system classification failed");
        }
        System.out.println("Metal Slug arcade route matrix: PASS (7 canonical sets, ZIP + 7z)");
    }
}
JAVA
javac -d "$TMP/classes" $(find "$TMP" -name '*.java' -print)
java -cp "$TMP/classes" io.gamedeck.mobile.MetalSlugRoutingValidation

grep -q '"fbneo_libretro"' "$ROOT/mobile/android/app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"
grep -q '"mame_libretro"' "$ROOT/mobile/android/app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"
grep -q 'RetroArch fallback is disabled for arcade play' "$ROOT/mobile/android/app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"
echo "Metal Slug embedded-only policy: PASS"
