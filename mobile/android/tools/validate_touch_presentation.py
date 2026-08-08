#!/usr/bin/env python3
"""Validate the packaged GameDeck touch surface and ambient shader graph."""
from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "mobile/android/app/src/main/assets/console/presentation-v2"
OVERLAY = ASSETS / "gamedeck-premium.cfg"
RUNTIME_MANAGER = ROOT / "mobile/android/app/src/main/java/io/gamedeck/mobile/AndroidRuntimeManager.java"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def parse_cfg(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        require("=" in line, f"{path}:{line_number}: expected key=value")
        key, value = (part.strip() for part in line.split("=", 1))
        require(key not in values, f"{path}:{line_number}: duplicate key {key}")
        values[key] = value.strip().strip('"')
    return values


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    require(data[:8] == b"\x89PNG\r\n\x1a\n", f"{path}: invalid PNG signature")
    require(data[12:16] == b"IHDR", f"{path}: missing PNG IHDR")
    return struct.unpack(">II", data[16:24])


def validate_manifest() -> None:
    manifest_path = ASSETS / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(payload.get("version") == 2, "presentation manifest version must be 2")
    expected = payload.get("files")
    require(isinstance(expected, dict) and expected, "presentation manifest files map is empty")
    actual_files = {
        str(path.relative_to(ASSETS)): path
        for path in ASSETS.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    }
    require(set(expected) == set(actual_files), "presentation manifest does not match packaged files")
    for relative, path in actual_files.items():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        require(digest == expected[relative], f"manifest digest mismatch: {relative}")


def validate_images() -> None:
    expected = {
        "button-a.png": (256, 256),
        "button-b.png": (256, 256),
        "button-x.png": (256, 256),
        "button-y.png": (256, 256),
        "dpad-left.png": (220, 164),
        "dpad-right.png": (220, 164),
        "dpad-up.png": (220, 164),
        "dpad-down.png": (220, 164),
        "dpad-hub.png": (150, 150),
        "plate-left.png": (540, 540),
        "plate-right.png": (540, 540),
        "shoulder-l.png": (360, 132),
        "shoulder-r.png": (360, 132),
        "select.png": (420, 132),
        "start.png": (420, 132),
        "menu.png": (160, 160),
        "hide.png": (160, 160),
        "show.png": (160, 160),
    }
    image_dir = ASSETS / "img"
    require({path.name for path in image_dir.glob("*.png")} == set(expected), "unexpected touch image set")
    for name, dimensions in expected.items():
        require(png_dimensions(image_dir / name) == dimensions, f"unexpected dimensions for {name}")


def parse_descriptor(value: str) -> tuple[str, float, float, str, float, float]:
    parts = [part.strip() for part in value.split(",")]
    require(len(parts) == 6, f"invalid descriptor: {value}")
    action, x, y, shape, rx, ry = parts
    require(shape in {"rect", "radial"}, f"unsupported descriptor shape: {shape}")
    return action, float(x), float(y), shape, float(rx), float(ry)


def validate_overlay() -> None:
    cfg = parse_cfg(OVERLAY)
    require(cfg.get("overlays") == "4", "touch surface must define four overlay states")
    names = {cfg[f"overlay{index}_name"] for index in range(4)}
    require(names == {"landscape", "portrait", "landscape-hidden", "portrait-hidden"}, "overlay state names are incomplete")

    expected_actions = {"left", "right", "up", "down", "a", "b", "x", "y", "l", "r", "select", "start", "menu_toggle"}
    for index in range(4):
        count = int(cfg[f"overlay{index}_descs"])
        descriptor_keys = [f"overlay{index}_desc{item}" for item in range(count)]
        require(all(key in cfg for key in descriptor_keys), f"overlay {index} descriptor count is inconsistent")
        require(not any(key.startswith(f"overlay{index}_desc{count}") for key in cfg), f"overlay {index} has undeclared descriptors")
        actions: set[str] = set()
        for item, key in enumerate(descriptor_keys):
            action, x, y, _shape, rx, ry = parse_descriptor(cfg[key])
            actions.update(action.split("|"))
            require(rx > 0 and ry > 0, f"{key}: hit target must be non-zero")
            image_key = f"{key}_overlay"
            if image_key in cfg:
                image = ASSETS / cfg[image_key]
                require(image.is_file(), f"{key}: missing image {cfg[image_key]}")
                require(0 <= x <= 1 and 0 <= y <= 1, f"{key}: visible image is outside the surface")
            next_key = f"{key}_next_target"
            if next_key in cfg:
                require(cfg[next_key] in names, f"{key}: unknown next target {cfg[next_key]}")
            if action not in {"nul", "overlay_next"} and image_key in cfg:
                alpha = float(cfg.get(f"{key}_alpha_mod", "1"))
                require(alpha > 1.0, f"{key}: visible controls require pressed-state alpha feedback")
        state_name = cfg[f"overlay{index}_name"]
        if not state_name.endswith("hidden"):
            require(expected_actions.issubset(actions), f"{state_name}: missing gameplay actions {sorted(expected_actions - actions)}")
            require("overlay_next" in actions, f"{state_name}: missing hide/orientation transitions")
        else:
            require(actions == {"overlay_next"}, f"{state_name}: hidden state should only expose restore/orientation transitions")

    landscape = cfg["overlay0_name"]
    portrait = cfg["overlay1_name"]
    require("landscape" in landscape and "portrait" in portrait, "auto-rotate states must be ordered landscape then portrait")


def shader_references(path: Path) -> list[str]:
    cfg = parse_cfg(path)
    count = int(cfg["shaders"])
    references = [cfg[f"shader{index}"] for index in range(count)]
    require(all(".." not in reference for reference in references), f"{path.name}: shader paths must remain inside presentation root")
    return references


def validate_shaders() -> None:
    variants = ["native", "4x3", "3x2", "16x9", "10x9", "2x3"]
    for variant in variants:
        preset = ASSETS / f"blur_fill_{variant}.glslp"
        require(preset.is_file(), f"missing shader preset {preset.name}")
        text = preset.read_text(encoding="utf-8")
        require("BLUR_RADIUS = 3.0" in text, f"{preset.name}: premium blur strength missing")
        require("FILL_GAMMA = 1.25" in text, f"{preset.name}: ambient gamma missing")
        for reference in shader_references(preset):
            require((ASSETS / reference).is_file(), f"{preset.name}: missing shader stage {reference}")


def validate_runtime_integration() -> None:
    source = RUNTIME_MANAGER.read_text(encoding="utf-8")
    required_fragments = (
        'input_overlay = \\"',
        'input_overlay_auto_rotate = \\"true\\"',
        'input_overlay_hide_when_gamepad_connected = \\"true\\"',
        'input_overlay_show_inputs = \\"1\\"',
        'vibrate_on_keypress = \\"',
        'video_driver = \\"gl\\"',
        'video_shader_enable = \\"true\\"',
        'video_shader = \\"',
        'aspect_ratio_index = \\"24\\"',
        'startEmbeddedActivity(embeddedCore, playableContent, sessionTitle, system.id)',
        'new Intent(activity, GameDeckPlayActivity.class)',
        'intent.putExtra(GameDeckPlayActivity.EXTRA_SYSTEM_ID',
        '"gamedeck-touch-v2-ambient-blur"',
    )
    for fragment in required_fragments:
        require(fragment in source, f"runtime integration missing: {fragment}")


def main() -> int:
    try:
        require(ASSETS.is_dir(), f"missing presentation asset directory: {ASSETS}")
        validate_manifest()
        validate_images()
        validate_overlay()
        validate_shaders()
        validate_runtime_integration()
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ValidationError) as error:
        print(f"touch-presentation validation failed: {error}", file=sys.stderr)
        return 1
    print("GameDeck touch presentation v2 validated: controls, feedback, rotation, assets, and ambient shader graph.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
