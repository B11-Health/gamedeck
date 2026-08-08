#!/data/data/com.termux/files/usr/bin/python3
from pathlib import Path
import argparse
import hashlib
import json
import re
import sys
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("cache_dir", type=Path)
parser.add_argument("--write-report", type=Path)
args = parser.parse_args()

android = Path(__file__).resolve().parents[1]
runtime = (android / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java").read_text(encoding="utf-8")
rows = [
    {"core": core, "archive": archive, "sha256": sha256, "library": library}
    for core, archive, sha256, library in re.findall(
        r'add\(values, "([^"]+)", "([^"]+)", "([0-9a-f]{64})", "([^"]+)"\);', runtime
    )
]
errors = []
report = []
for row in rows:
    archive = args.cache_dir / row["archive"]
    result = dict(row)
    result.update(exists=archive.is_file(), hashMatch=False, zipValid=False, arm64Elf=False, size=0)
    if not archive.is_file():
        errors.append(f"{row['core']}: missing {archive}")
        report.append(result)
        continue
    result["size"] = archive.stat().st_size
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    result["actualSha256"] = actual
    result["hashMatch"] = actual == row["sha256"]
    if not result["hashMatch"]:
        errors.append(f"{row['core']}: archive digest differs from the release manifest")
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = [name for name in bundle.namelist() if not name.endswith("/")]
            result["members"] = members
            result["zipValid"] = members == [row["library"]]
            if not result["zipValid"]:
                errors.append(f"{row['core']}: expected only {row['library']}, got {members}")
            if row["library"] in members:
                binary = bundle.read(row["library"])
                result["arm64Elf"] = (
                    len(binary) > 64
                    and binary[:4] == b"\x7fELF"
                    and binary[4] == 2
                    and binary[5] == 1
                    and int.from_bytes(binary[18:20], "little") == 183
                )
                if not result["arm64Elf"]:
                    errors.append(f"{row['core']}: library is not little-endian ARM64 ELF")
    except Exception as error:
        errors.append(f"{row['core']}: invalid ZIP: {error}")
    report.append(result)
    print(f"{row['core']:34} hash={'PASS' if result['hashMatch'] else 'FAIL'} zip={'PASS' if result['zipValid'] else 'FAIL'} arm64={'PASS' if result['arm64Elf'] else 'FAIL'}")

summary = {
    "manifestDate": re.search(r'CORE_MANIFEST_DATE = "([^"]+)"', runtime).group(1),
    "coreCount": len(rows),
    "passed": not errors,
    "errors": errors,
    "cores": report,
}
if args.write_report:
    args.write_report.parent.mkdir(parents=True, exist_ok=True)
    args.write_report.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
if errors:
    print("Core cache validation: FAIL", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)
print(f"Core cache validation: PASS ({len(rows)} official ARM64 core archives)")
