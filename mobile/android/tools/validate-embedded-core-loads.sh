#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ANDROID_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="${1:?usage: validate-embedded-core-loads.sh CORE_ARCHIVE_CACHE_DIR}"
OUT="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/gamedeck-embedded-core-load-test"
rm -rf "$OUT"
mkdir -p "$OUT/cores"
clang -O2 -Wall -Wextra -Werror "$ANDROID_ROOT/tools/libretro-core-probe.c" -ldl -o "$OUT/core-probe"
python3 - "$ANDROID_ROOT" "$CACHE_DIR" "$OUT/cores" <<'PY'
from pathlib import Path
import re
import sys
import zipfile
android, cache, out = map(Path, sys.argv[1:])
runtime = (android / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java").read_text(encoding="utf-8")
embedded_block = re.search(r'EMBEDDED_NATIVE_CORES.*?Arrays\.asList\((.*?)\)\)\);', runtime, flags=re.DOTALL)
if not embedded_block:
    raise SystemExit("could not parse embedded core list")
embedded = set(re.findall(r'"([^"]+)"', embedded_block.group(1)))
manifest = {
    core: (archive, library)
    for core, archive, _, library in re.findall(
        r'add\(values, "([^"]+)", "([^"]+)", "([0-9a-f]{64})", "([^"]+)"\);', runtime
    )
}
for core in sorted(embedded):
    archive, library = manifest[core]
    with zipfile.ZipFile(cache / archive) as bundle:
        data = bundle.read(library)
    target = out / library
    target.write_bytes(data)
    target.chmod(0o700)
    print(f"{core}\t{target}")
PY
fail=0
while IFS=$'\t' read -r core library; do
  set +e
  result=$("$OUT/core-probe" "$library" 2>&1)
  code=$?
  set -e
  printf '%-34s %s\n' "$core" "$result"
  if [ "$code" -ne 0 ]; then fail=1; fi
done < <(python3 - "$ANDROID_ROOT" "$CACHE_DIR" "$OUT/cores" <<'PY'
from pathlib import Path
import re
import sys
android, cache, out = map(Path, sys.argv[1:])
runtime = (android / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java").read_text(encoding="utf-8")
embedded = set(re.findall(r'"([^"]+)"', re.search(r'EMBEDDED_NATIVE_CORES.*?Arrays\.asList\((.*?)\)\)\);', runtime, flags=re.DOTALL).group(1)))
manifest = {core: library for core, _, _, library in re.findall(r'add\(values, "([^"]+)", "([^"]+)", "([0-9a-f]{64})", "([^"]+)"\);', runtime)}
for core in sorted(embedded): print(f"{core}\t{out / manifest[core]}")
PY
)
if [ "$fail" -ne 0 ]; then
  echo "Embedded core load validation: FAIL" >&2
  exit 1
fi
echo "Embedded core load validation: PASS"
