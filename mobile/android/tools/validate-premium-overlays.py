#!/data/data/com.termux/files/usr/bin/python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1] / "app/src/main/assets/retroarch-overlay"
PRESETS = {
    "gamedeck-premium-classic.cfg": {
        "required": {"up", "down", "left", "right", "l", "r", "a", "b", "x", "y", "select", "start", "turbo", "menu_toggle"},
        "minimum_turbo_combos": 6,
        "forbidden": {"analog_left", "analog_right", "l2", "r2"},
    },
    "gamedeck-premium-six.cfg": {
        "required": {"up", "down", "left", "right", "l", "r", "a", "b", "x", "y", "select", "start", "turbo", "menu_toggle"},
        "minimum_turbo_combos": 6,
        "forbidden": {"analog_left", "analog_right", "l2", "r2"},
    },
    "gamedeck-premium-psp.cfg": {
        "required": {"up", "down", "left", "right", "analog_left", "l", "r", "a", "b", "x", "y", "select", "start", "turbo", "menu_toggle"},
        "minimum_turbo_combos": 6,
        "forbidden": {"analog_right", "l2", "r2"},
    },
    "gamedeck-premium-dual.cfg": {
        "required": {"up", "down", "left", "right", "analog_left", "analog_right", "l", "r", "l2", "r2", "a", "b", "x", "y", "select", "start", "turbo", "menu_toggle"},
        "minimum_turbo_combos": 8,
        "forbidden": set(),
    },
}

errors = []
for name, rules in PRESETS.items():
    path = ROOT / name
    if not path.is_file():
        errors.append(f"missing preset: {name}")
        continue
    text = path.read_text(encoding="utf-8")
    pages = set(re.findall(r'overlay\d+_name = "([^"]+)"', text))
    if pages != {"landscape", "portrait"}:
        errors.append(f"{name}: expected landscape and portrait pages, got {sorted(pages)}")

    descriptors = re.findall(r'overlay\d+_desc\d+ = "([^,]+),', text)
    flattened = set()
    for descriptor in descriptors:
        flattened.update(part.strip() for part in descriptor.split("|") if part.strip())
    missing = rules["required"] - flattened
    if missing:
        errors.append(f"{name}: missing bindings {sorted(missing)}")
    forbidden = rules.get("forbidden", set()) & flattened
    if forbidden:
        errors.append(f"{name}: unexpected bindings {sorted(forbidden)}")

    for page_index in range(2):
        page_descriptors = re.findall(rf'overlay{page_index}_desc\d+ = "([^,]+),', text)
        page_flattened = set()
        for descriptor in page_descriptors:
            page_flattened.update(part.strip() for part in descriptor.split("|") if part.strip())
        page_missing = rules["required"] - page_flattened
        if page_missing:
            errors.append(f"{name}: overlay{page_index} missing bindings {sorted(page_missing)}")

    turbo_combos = [descriptor for descriptor in descriptors if "turbo|" in descriptor]
    if len(turbo_combos) < rules["minimum_turbo_combos"]:
        errors.append(
            f"{name}: expected at least {rules['minimum_turbo_combos']} per-button turbo mappings, got {len(turbo_combos)}"
        )

    image_refs = re.findall(r'_overlay = img/([^\r\n]+)', text)
    for image_ref in image_refs:
        image = ROOT / "img" / image_ref.strip()
        if not image.is_file() or image.stat().st_size <= 0:
            errors.append(f"{name}: missing image {image_ref.strip()}")

    for target in re.findall(r'_next_target = ([^\r\n]+)', text):
        if target.strip() not in pages:
            errors.append(f"{name}: invalid page target {target.strip()}")

    declared = {
        int(index): int(count)
        for index, count in re.findall(r'overlay(\d+)_descs = (\d+)', text)
    }
    for index, expected in declared.items():
        actual = len(re.findall(rf'overlay{index}_desc\d+ = ', text))
        if actual != expected:
            errors.append(f"{name}: overlay{index} declares {expected} descriptors but contains {actual}")

if errors:
    print("Premium overlay validation: FAIL", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

print("Premium overlay validation: PASS")
