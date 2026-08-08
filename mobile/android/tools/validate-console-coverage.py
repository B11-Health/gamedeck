#!/data/data/com.termux/files/usr/bin/python3
from pathlib import Path
import re
import sys

ANDROID = Path(__file__).resolve().parents[1]
JAVA = ANDROID / "app/src/main/java/io/gamedeck/mobile"
OVERLAYS = ANDROID / "app/src/main/assets/retroarch-overlay"

registry = (JAVA / "SystemRegistry.java").read_text(encoding="utf-8")
profiles = (JAVA / "ConsoleInputProfile.java").read_text(encoding="utf-8")
runtime = (JAVA / "AndroidRuntimeManager.java").read_text(encoding="utf-8")

systems = {
    system_id: {"name": name, "core": core}
    for system_id, name, core in re.findall(
        r'def\("([^"]+)",\s*"([^"]+)",.*?,\s*"([^"]+)"\),?$',
        registry,
        flags=re.MULTILINE,
    )
}
cores = {
    core: {"archive": archive, "sha256": sha256, "library": library}
    for core, archive, sha256, library in re.findall(
        r'add\(values, "([^"]+)", "([^"]+)", "([0-9a-f]{64})", "([^"]+)"\);',
        runtime,
    )
}
profile_presets = {
    enum_name: {"key": key, "preset": preset}
    for enum_name, key, preset in re.findall(
        r'^\s*([A-Z0-9_]+)\(\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*Layout\.[A-Z0-9_]+,',
        profiles,
        flags=re.MULTILINE,
    )
}
assignments = {}
for profile_name, body in re.findall(
    r'assign\(values, Profile\.([A-Z0-9_]+),\s*(.*?)\);',
    profiles,
    flags=re.DOTALL,
):
    for system_id in re.findall(r'"([^"]+)"', body):
        if system_id in assignments:
            raise SystemExit(f"duplicate controller assignment for {system_id}")
        assignments[system_id] = profile_name

errors = []
for system_id, system in systems.items():
    profile_name = assignments.get(system_id)
    if not profile_name:
        errors.append(f"{system_id}: no explicit controller profile")
        continue
    profile = profile_presets.get(profile_name)
    if not profile:
        errors.append(f"{system_id}: unknown controller profile {profile_name}")
        continue
    preset = OVERLAYS / profile["preset"]
    if not preset.is_file():
        errors.append(f"{system_id}: missing overlay {profile['preset']}")
    core = system["core"]
    if core != "external" and core not in cores:
        errors.append(f"{system_id}: core {core} has no downloadable artifact")

unknown_assignments = sorted(set(assignments) - set(systems))
for system_id in unknown_assignments:
    errors.append(f"controller profile references unknown system {system_id}")

manifest_date = re.search(r'CORE_MANIFEST_DATE = "([^"]+)"', runtime)
if not manifest_date:
    errors.append("runtime core manifest has no date")

if errors:
    print("Console coverage validation: FAIL", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

route_count = sum(1 for value in systems.values() if value["core"] != "external")
external = [key for key, value in systems.items() if value["core"] == "external"]
print("Console coverage validation: PASS")
print(f"registered={len(systems)} routes={route_count} gamepads={len(assignments)} unique_cores={len(cores)}")
print("catalog_only=" + (",".join(external) if external else "none"))
for system_id, system in systems.items():
    profile = profile_presets[assignments[system_id]]
    route = "catalog-only" if system["core"] == "external" else "libretro"
    print(f"{system_id}\t{route}\t{system['core']}\t{profile['key']}\t{profile['preset']}")
