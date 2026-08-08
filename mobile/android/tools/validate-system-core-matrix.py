#!/usr/bin/env python3
"""Cross-check Android SystemRegistry against AndroidRuntimeManager core artifacts."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "app/src/main/java/io/gamedeck/mobile/SystemRegistry.java"
RUNTIME = ROOT / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"

registry = REGISTRY.read_text(encoding="utf-8")
runtime = RUNTIME.read_text(encoding="utf-8")

systems = []
for m in re.finditer(
    r'def\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"#[0-9A-Fa-f]+",.*?,\s*"([^"]+)"\)',
    registry,
):
    systems.append({"id": m.group(1), "name": m.group(2), "short": m.group(3), "core": m.group(4)})

managed = {
    m.group(1): m.group(2)
    for m in re.finditer(
        r'add\(values,\s*"([^"]+)",\s*"[^"]+",\s*"[0-9a-f]{64}",\s*"([^"]+)"\s*\);',
        runtime,
    )
}

if not systems:
    raise SystemExit("could not parse Android system registry")
if not managed:
    raise SystemExit("could not parse Android core artifact manifest")

failures = []
for system in systems:
    core = system["core"]
    if core == "external":
        print(f"EXTERNAL\t{system['id']}\t{system['name']}")
        continue
    library = managed.get(core)
    if not library:
        failures.append(f"{system['id']} -> {core} has no managed Android artifact")
        continue
    print(f"OK\t{system['id']}\t{core}\t{library}")

if failures:
    for failure in failures:
        print(f"FAIL\t{failure}")
    raise SystemExit("Android system/core matrix validation: FAIL")

print(f"systems={len(systems)} managed_artifacts={len(managed)} failures=0")
print("Android system/core matrix validation: PASS")
