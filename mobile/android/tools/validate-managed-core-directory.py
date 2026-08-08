#!/usr/bin/env python3
"""Validate that an Android GameDeck core directory contains only managed core artifacts.

The source of truth is AndroidRuntimeManager.CORES. This intentionally does not require
every managed core to be installed; it rejects stale/misnamed .so files and orphan hash
markers that are no longer part of the current Android runtime manifest.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def parse_managed(runtime: Path) -> set[str]:
    text = runtime.read_text(encoding="utf-8")
    libraries = {
        match.group(1)
        for match in re.finditer(
            r'add\(values,\s*"[^"]+",\s*"[^"]+",\s*"[0-9a-f]{64}",\s*"([^"]+)"\s*\);',
            text,
        )
    }
    if not libraries:
        raise SystemExit(f"could not parse managed Android core libraries from {runtime}")
    return libraries


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("core_dir", type=Path)
    parser.add_argument(
        "--runtime-manager",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java",
    )
    args = parser.parse_args()

    managed = parse_managed(args.runtime_manager)
    if not args.core_dir.is_dir():
        print(f"managed core directory: MISSING {args.core_dir}", file=sys.stderr)
        return 2

    unknown: list[Path] = []
    orphan_markers: list[Path] = []
    for path in sorted(args.core_dir.iterdir()):
        if not path.is_file():
            continue
        name = path.name
        if name.endswith("_libretro_android.so") or name.endswith("_gles3_libretro_android.so"):
            if name not in managed:
                unknown.append(path)
            continue
        suffix = ".archive.sha256"
        if name.endswith(suffix):
            library = name[: -len(suffix)]
            if library not in managed:
                orphan_markers.append(path)

    if unknown or orphan_markers:
        for path in unknown:
            print(f"UNMANAGED_CORE\t{path.name}")
        for path in orphan_markers:
            print(f"ORPHAN_HASH_MARKER\t{path.name}")
        print("Managed core directory validation: FAIL", file=sys.stderr)
        return 1

    installed = sorted(
        path.name
        for path in args.core_dir.iterdir()
        if path.is_file() and path.name in managed
    )
    print(f"managed={len(managed)} installed={len(installed)} unknown=0 orphan_markers=0")
    for name in installed:
        print(f"OK\t{name}")
    print("Managed core directory validation: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
