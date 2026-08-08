#!/data/data/com.termux/files/usr/bin/python3
"""Audit or refresh GameDeck's pinned official Libretro Android core hashes."""
from pathlib import Path
from urllib.request import Request, urlopen
import argparse
import hashlib
import io
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--write", action="store_true", help="replace hashes after all artifacts validate")
args = parser.parse_args()

runtime = Path(__file__).resolve().parents[1] / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"
text = runtime.read_text(encoding="utf-8")
base = re.search(r'CORE_BASE_URL = "([^"]+)"', text).group(1)
rows = re.findall(
    r'add\(values, "([^"]+)", "([^"]+)", "([0-9a-f]{64})", "([^"]+)"\);', text
)
updates = {}
for core, archive, expected, library in rows:
    request = Request(base + archive, headers={"User-Agent": "GameDeck-Core-Manifest-Audit/1"})
    with urlopen(request, timeout=180) as response:
        data = response.read(256 * 1024 * 1024 + 1)
    if len(data) > 256 * 1024 * 1024:
        raise SystemExit(f"{core}: archive exceeds safety limit")
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        members = [name for name in bundle.namelist() if not name.endswith("/")]
        if members != [library]:
            raise SystemExit(f"{core}: expected only {library}, got {members}")
        binary = bundle.read(library)
    if not (len(binary) > 64 and binary[:4] == b"\x7fELF" and binary[4] == 2 and binary[5] == 1
            and int.from_bytes(binary[18:20], "little") == 183):
        raise SystemExit(f"{core}: downloaded library is not ARM64 ELF")
    actual = hashlib.sha256(data).hexdigest()
    updates[core] = actual
    print(f"{core:34} {'MATCH' if actual == expected else 'CHANGED'} {actual}")

if args.write:
    for core, actual in updates.items():
        text, count = re.subn(
            rf'(add\(values, "{re.escape(core)}", "[^"]+", ")[0-9a-f]{{64}}(", "[^"]+"\);)',
            rf'\g<1>{actual}\g<2>',
            text,
        )
        if count != 1:
            raise SystemExit(f"could not update {core}")
    runtime.write_text(text, encoding="utf-8")
    print("Core manifest hashes updated.")
