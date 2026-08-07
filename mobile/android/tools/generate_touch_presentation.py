#!/usr/bin/env python3
"""Generate GameDeck's premium RetroArch touch overlay assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "mobile/android/app/src/main/assets/console/presentation-v2"
IMG = OUT / "img"
PREVIEW = ROOT / "mobile/android/design/touch-presentation-v2-preview.png"
AA = 2

GRAPHITE = (9, 14, 22)
SURFACE = (21, 29, 41)
SURFACE_2 = (31, 41, 56)
WHITE = (242, 247, 255)
MUTED = (147, 162, 184)
CYAN = (82, 216, 255)
PURPLE = (147, 109, 255)
LIME = (166, 232, 92)
MAGENTA = (255, 76, 168)

FONT_PATHS = (
    Path("/system/fonts/Roboto-Bold.ttf"),
    Path("/system/fonts/NotoSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
)


def font(size: int):
    for path in FONT_PATHS:
        if path.is_file():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def rgba(rgb, alpha):
    return (*rgb, alpha)


def canvas(size):
    return Image.new("RGBA", (size[0] * AA, size[1] * AA), (0, 0, 0, 0))


def box(values):
    return tuple(round(v * AA) for v in values)


def down(image):
    return image.resize((image.width // AA, image.height // AA), Image.Resampling.LANCZOS)


def text_center(image, label, size, color=rgba(WHITE, 248)):
    draw = ImageDraw.Draw(image)
    fnt = font(size * AA)
    bounds = draw.textbbox((0, 0), label, font=fnt)
    x = (image.width - (bounds[2] - bounds[0])) / 2 - bounds[0]
    y = (image.height - (bounds[3] - bounds[1])) / 2 - bounds[1]
    draw.text((x, y), label, font=fnt, fill=color)


def glow(image, mask, color, alpha=105, blur=26):
    blurred = mask.filter(ImageFilter.GaussianBlur(blur * AA))
    alpha_layer = ImageChops.multiply(blurred, Image.new("L", blurred.size, alpha))
    layer = Image.new("RGBA", image.size, rgba(color, alpha))
    layer.putalpha(alpha_layer)
    image.alpha_composite(layer)


def circle_button(label, accent, name):
    image = canvas((256, 256))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse(box((28, 28, 228, 228)), fill=255)
    glow(image, mask, accent)
    draw = ImageDraw.Draw(image)
    draw.ellipse(box((28, 28, 228, 228)), fill=rgba(GRAPHITE, 232), outline=rgba(accent, 230), width=5 * AA)
    draw.ellipse(box((42, 42, 214, 214)), fill=rgba(SURFACE_2, 225), outline=rgba(WHITE, 34), width=2 * AA)
    draw.ellipse(box((56, 48, 200, 106)), fill=rgba(WHITE, 18))
    text_center(image, label, 76)
    down(image).save(IMG / name, optimize=True)


def pill_button(label, accent, name, width=360):
    image = canvas((width, 132))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box((16, 18, width - 16, 114)), radius=46 * AA, fill=255)
    glow(image, mask, accent, alpha=90, blur=20)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box((16, 18, width - 16, 114)), radius=46 * AA, fill=rgba(GRAPHITE, 234), outline=rgba(accent, 205), width=4 * AA)
    draw.rounded_rectangle(box((28, 29, width - 28, 103)), radius=36 * AA, fill=rgba(SURFACE_2, 218), outline=rgba(WHITE, 28), width=2 * AA)
    draw.rounded_rectangle(box((44, 34, width - 44, 62)), radius=14 * AA, fill=rgba(WHITE, 14))
    text_center(image, label, 38)
    down(image).save(IMG / name, optimize=True)


def dpad_segment(direction, name):
    image = canvas((220, 164))
    accent = CYAN
    mask = Image.new("L", image.size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle(box((18, 20, 202, 144)), radius=38 * AA, fill=255)
    glow(image, mask, accent, alpha=82, blur=20)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box((18, 20, 202, 144)), radius=38 * AA, fill=rgba(GRAPHITE, 234), outline=rgba(accent, 185), width=4 * AA)
    draw.rounded_rectangle(box((30, 31, 190, 133)), radius=29 * AA, fill=rgba(SURFACE_2, 218), outline=rgba(WHITE, 24), width=2 * AA)
    cx, cy = 110 * AA, 82 * AA
    s = 28 * AA
    if direction == "left":
        pts = [(cx + s // 2, cy - s), (cx - s, cy), (cx + s // 2, cy + s)]
    elif direction == "right":
        pts = [(cx - s // 2, cy - s), (cx + s, cy), (cx - s // 2, cy + s)]
    elif direction == "up":
        pts = [(cx - s, cy + s // 2), (cx, cy - s), (cx + s, cy + s // 2)]
    else:
        pts = [(cx - s, cy - s // 2), (cx, cy + s), (cx + s, cy - s // 2)]
    draw.polygon(pts, fill=rgba(WHITE, 230))
    down(image).save(IMG / name, optimize=True)


def hub(name):
    image = canvas((150, 150))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse(box((19, 19, 131, 131)), fill=255)
    glow(image, mask, CYAN, alpha=70, blur=18)
    draw = ImageDraw.Draw(image)
    draw.ellipse(box((19, 19, 131, 131)), fill=rgba(GRAPHITE, 235), outline=rgba(CYAN, 150), width=4 * AA)
    draw.ellipse(box((33, 33, 117, 117)), fill=rgba(SURFACE_2, 220), outline=rgba(WHITE, 24), width=2 * AA)
    draw.ellipse(box((52, 48, 98, 72)), fill=rgba(WHITE, 13))
    down(image).save(IMG / name, optimize=True)


def plate(name, accent):
    image = canvas((540, 540))
    mask = Image.new("L", image.size, 0)
    md = ImageDraw.Draw(mask)
    md.ellipse(box((42, 42, 498, 498)), fill=215)
    glow(image, mask, accent, alpha=60, blur=42)
    draw = ImageDraw.Draw(image)
    draw.ellipse(box((52, 52, 488, 488)), fill=rgba(GRAPHITE, 108), outline=rgba(accent, 70), width=3 * AA)
    draw.ellipse(box((82, 82, 458, 458)), fill=rgba(SURFACE, 70), outline=rgba(WHITE, 17), width=2 * AA)
    down(image).save(IMG / name, optimize=True)


def brand_button(label, name):
    image = canvas((160, 160))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse(box((20, 20, 140, 140)), fill=255)
    glow(image, mask, PURPLE, alpha=88, blur=22)
    draw = ImageDraw.Draw(image)
    draw.ellipse(box((20, 20, 140, 140)), fill=rgba(GRAPHITE, 236), outline=rgba(PURPLE, 210), width=4 * AA)
    draw.ellipse(box((32, 32, 128, 128)), fill=rgba(SURFACE_2, 220), outline=rgba(CYAN, 70), width=2 * AA)
    text_center(image, label, 42)
    down(image).save(IMG / name, optimize=True)


def control_line(index, action, x, y, shape, rx, ry, image=None, **attrs):
    lines = [f'overlay{index}_desc{control_line.counter} = "{action},{x:.6f},{y:.6f},{shape},{rx:.6f},{ry:.6f}"']
    n = control_line.counter
    if image:
        lines.append(f"overlay{index}_desc{n}_overlay = img/{image}")
    for key, value in attrs.items():
        rendered = str(value).lower() if isinstance(value, bool) else value
        if key == "next_target":
            rendered = f'"{rendered}"'
        lines.append(f"overlay{index}_desc{n}_{key} = {rendered}")
    control_line.counter += 1
    return lines


control_line.counter = 0


def build_state(index, orientation, hidden=False):
    portrait = orientation == "portrait"
    lines = [
        f"overlay{index}_full_screen = true",
        f"overlay{index}_normalized = true",
        f'overlay{index}_name = "{orientation}{"-hidden" if hidden else ""}"',
        f"overlay{index}_alpha_mod = 1.18",
        f"overlay{index}_range_mod = 1.18",
    ]
    control_line.counter = 0
    if hidden:
        x, y = ((0.91, 0.045) if portrait else (0.955, 0.075))
        lines += control_line(index, "overlay_next", x, y, "radial", 0.038 if portrait else 0.024, 0.022 if portrait else 0.043, "show.png", next_target=orientation)
        opposite = "landscape-hidden" if portrait else "portrait-hidden"
        lines += control_line(index, "overlay_next", 2.0, 2.0, "radial", 0.01, 0.01, next_target=opposite)
        lines.insert(5, f"overlay{index}_descs = {control_line.counter}")
        return lines

    if portrait:
        lx, ly, rx, ry = 0.195, 0.765, 0.805, 0.765
        plate_rx, plate_ry = 0.205, 0.115
        dpx, dpy = 0.082, 0.057
        bx, by = 0.079, 0.044
        shoulder_y = 0.615
        shoulder_rx, shoulder_ry = 0.142, 0.025
        system_y = 0.915
        system_rx, system_ry = 0.118, 0.023
        menu_x, menu_y, menu_rx, menu_ry = 0.5, 0.575, 0.046, 0.026
        hide_x, hide_y, hide_rx, hide_ry = 0.91, 0.575, 0.041, 0.024
    else:
        lx, ly, rx, ry = 0.132, 0.755, 0.868, 0.755
        plate_rx, plate_ry = 0.132, 0.235
        dpx, dpy = 0.046, 0.081
        bx, by = 0.045, 0.080
        shoulder_y = 0.285
        shoulder_rx, shoulder_ry = 0.083, 0.038
        system_y = 0.925
        system_rx, system_ry = 0.064, 0.034
        menu_x, menu_y, menu_rx, menu_ry = 0.5, 0.075, 0.026, 0.046
        hide_x, hide_y, hide_rx, hide_ry = 0.58, 0.075, 0.024, 0.043

    lines += control_line(index, "nul", lx, ly, "radial", plate_rx, plate_ry, "plate-left.png")
    lines += control_line(index, "nul", rx, ry, "radial", plate_rx, plate_ry, "plate-right.png")
    lines += control_line(index, "left", lx - dpx * 1.10, ly, "rect", dpx, dpy, "dpad-left.png", alpha_mod=1.24, range_mod=1.28)
    lines += control_line(index, "right", lx + dpx * 1.10, ly, "rect", dpx, dpy, "dpad-right.png", alpha_mod=1.24, range_mod=1.28)
    lines += control_line(index, "up", lx, ly - dpy * 1.06, "rect", dpx, dpy, "dpad-up.png", alpha_mod=1.24, range_mod=1.28)
    lines += control_line(index, "down", lx, ly + dpy * 1.06, "rect", dpx, dpy, "dpad-down.png", alpha_mod=1.24, range_mod=1.28)
    lines += control_line(index, "left|up", lx - dpx * 0.70, ly - dpy * 0.70, "rect", dpx * 0.55, dpy * 0.55, range_mod=1.25)
    lines += control_line(index, "right|up", lx + dpx * 0.70, ly - dpy * 0.70, "rect", dpx * 0.55, dpy * 0.55, range_mod=1.25)
    lines += control_line(index, "left|down", lx - dpx * 0.70, ly + dpy * 0.70, "rect", dpx * 0.55, dpy * 0.55, range_mod=1.25)
    lines += control_line(index, "right|down", lx + dpx * 0.70, ly + dpy * 0.70, "rect", dpx * 0.55, dpy * 0.55, range_mod=1.25)
    lines += control_line(index, "nul", lx, ly, "radial", dpx * 0.75, dpy * 0.75, "dpad-hub.png")

    lines += control_line(index, "x", rx, ry - by * 1.55, "radial", bx, by, "button-x.png", alpha_mod=1.24, range_mod=1.20)
    lines += control_line(index, "y", rx - bx * 1.55, ry, "radial", bx, by, "button-y.png", alpha_mod=1.24, range_mod=1.20)
    lines += control_line(index, "a", rx + bx * 1.55, ry, "radial", bx, by, "button-a.png", alpha_mod=1.24, range_mod=1.20)
    lines += control_line(index, "b", rx, ry + by * 1.55, "radial", bx, by, "button-b.png", alpha_mod=1.24, range_mod=1.20)

    lines += control_line(index, "l", 0.18 if portrait else 0.125, shoulder_y, "rect", shoulder_rx, shoulder_ry, "shoulder-l.png", alpha_mod=1.22, range_mod=1.16)
    lines += control_line(index, "r", 0.82 if portrait else 0.875, shoulder_y, "rect", shoulder_rx, shoulder_ry, "shoulder-r.png", alpha_mod=1.22, range_mod=1.16)
    lines += control_line(index, "select", 0.36 if portrait else 0.42, system_y, "rect", system_rx, system_ry, "select.png", alpha_mod=1.22, range_mod=1.18)
    lines += control_line(index, "start", 0.64 if portrait else 0.58, system_y, "rect", system_rx, system_ry, "start.png", alpha_mod=1.22, range_mod=1.18)
    lines += control_line(index, "menu_toggle", menu_x, menu_y, "radial", menu_rx, menu_ry, "menu.png", alpha_mod=1.20, range_mod=1.15)
    hidden_target = "portrait-hidden" if portrait else "landscape-hidden"
    lines += control_line(index, "overlay_next", hide_x, hide_y, "radial", hide_rx, hide_ry, "hide.png", next_target=hidden_target)
    opposite = "landscape" if portrait else "portrait"
    lines += control_line(index, "overlay_next", 2.0, 2.0, "radial", 0.01, 0.01, next_target=opposite)
    lines.insert(5, f"overlay{index}_descs = {control_line.counter}")
    return lines


def write_overlay():
    lines = [
        "# GameDeck Premium Touch Surface v2",
        "# Generated by mobile/android/tools/generate_touch_presentation.py",
        "overlays = 4",
        "",
    ]
    for index, orientation, hidden in ((0, "landscape", False), (1, "portrait", False), (2, "landscape", True), (3, "portrait", True)):
        lines += build_state(index, orientation, hidden)
        lines.append("")
    (OUT / "gamedeck-premium.cfg").write_text("\n".join(lines), encoding="utf-8")


def draw_preview():
    width, height = 1600, 900
    image = Image.new("RGB", (width, height), GRAPHITE)
    game = Image.new("RGB", (960, 720), (77, 152, 196))
    gd = ImageDraw.Draw(game)
    for y in range(0, 720, 8):
        tone = int(196 + (y / 720) * 36)
        gd.rectangle((0, y, 960, y + 8), fill=(93, min(222, tone), min(238, tone + 10)))
    gd.ellipse((560, 320, 980, 760), fill=(56, 158, 96))
    gd.rectangle((0, 620, 960, 720), fill=(48, 174, 69))
    gd.text((38, 30), "GAMEDECK TOUCH PRESENTATION V2", font=font(28), fill=WHITE)
    game = game.filter(ImageFilter.GaussianBlur(18))
    image.paste(game.resize((1600, 900)), (0, 0))
    overlay = Image.new("RGBA", (width, height), rgba(GRAPHITE, 72))
    image = Image.alpha_composite(image.convert("RGBA"), overlay)
    frame = Image.new("RGB", (960, 720), (95, 180, 218))
    fd = ImageDraw.Draw(frame)
    fd.rectangle((0, 610, 960, 720), fill=(64, 188, 76))
    fd.ellipse((560, 320, 980, 760), fill=(61, 160, 96))
    fd.text((40, 36), "GAME 01     STAGE 1", font=font(30), fill=WHITE)
    image.paste(frame, (320, 90))

    def paste_asset(name, center, size):
        asset = Image.open(IMG / name).convert("RGBA").resize(size, Image.Resampling.LANCZOS)
        image.alpha_composite(asset, (round(center[0] - size[0] / 2), round(center[1] - size[1] / 2)))

    paste_asset("plate-left.png", (145, 670), (270, 270))
    paste_asset("plate-right.png", (1455, 670), (270, 270))
    paste_asset("dpad-left.png", (90, 670), (100, 74))
    paste_asset("dpad-right.png", (200, 670), (100, 74))
    paste_asset("dpad-up.png", (145, 580), (100, 74))
    paste_asset("dpad-down.png", (145, 760), (100, 74))
    paste_asset("dpad-hub.png", (145, 670), (74, 74))
    for name, center in (("button-x.png", (1455, 570)), ("button-y.png", (1355, 670)), ("button-a.png", (1555, 670)), ("button-b.png", (1455, 770))):
        paste_asset(name, center, (90, 90))
    paste_asset("shoulder-l.png", (145, 250), (210, 77))
    paste_asset("shoulder-r.png", (1455, 250), (210, 77))
    paste_asset("select.png", (690, 830), (185, 68))
    paste_asset("start.png", (910, 830), (185, 68))
    paste_asset("menu.png", (800, 62), (74, 74))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(PREVIEW, quality=93, optimize=True)


def write_shader_variants():
    base_path = OUT / "blur_fill.glslp"
    if not base_path.is_file():
        return
    base = base_path.read_text(encoding="utf-8").replace("../blurs/", "blurs/")
    needle = 'parameters = "SIGMA;BLUR_RADIUS"\nSIGMA = 1.5\nBLUR_RADIUS = 3.0'
    if needle not in base:
        raise RuntimeError("Unexpected bundled Blur Fill parameter block")
    profiles = {
        "native": (0.0, 0.0),
        "4x3": (4.0, 3.0),
        "3x2": (3.0, 2.0),
        "16x9": (16.0, 9.0),
        "10x9": (10.0, 9.0),
        "2x3": (2.0, 3.0),
    }
    base_path.write_text(base, encoding="utf-8")
    for name, (horizontal, vertical) in profiles.items():
        replacement = (
            'parameters = "SIGMA;BLUR_RADIUS;FORCE_ASPECT_RATIO;ASPECT_H;ASPECT_V;FILL_GAMMA"\n'
            'SIGMA = 1.5\nBLUR_RADIUS = 3.0\nFORCE_ASPECT_RATIO = 1.0\n'
            f'ASPECT_H = {horizontal:.1f}\nASPECT_V = {vertical:.1f}\nFILL_GAMMA = 1.25'
        )
        (OUT / f"blur_fill_{name}.glslp").write_text(base.replace(needle, replacement), encoding="utf-8")


def manifest():
    files = sorted(path for path in OUT.rglob("*") if path.is_file() and path.name != "manifest.json")
    payload = {"version": 2, "files": {str(path.relative_to(OUT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}
    (OUT / "manifest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def clean_generated_files():
    if IMG.exists():
        shutil.rmtree(IMG)
    for name in ("gamedeck-premium.cfg", "manifest.json", "presentation-version.txt"):
        target = OUT / name
        if target.exists():
            target.unlink()
    for target in OUT.glob("blur_fill_*.glslp"):
        target.unlink()


def generate(clean=True):
    OUT.mkdir(parents=True, exist_ok=True)
    if clean:
        clean_generated_files()
    IMG.mkdir(parents=True, exist_ok=True)
    circle_button("A", CYAN, "button-a.png")
    circle_button("B", MAGENTA, "button-b.png")
    circle_button("X", PURPLE, "button-x.png")
    circle_button("Y", LIME, "button-y.png")
    for direction in ("left", "right", "up", "down"):
        dpad_segment(direction, f"dpad-{direction}.png")
    hub("dpad-hub.png")
    plate("plate-left.png", CYAN)
    plate("plate-right.png", PURPLE)
    pill_button("L", CYAN, "shoulder-l.png")
    pill_button("R", PURPLE, "shoulder-r.png")
    pill_button("SELECT", MUTED, "select.png", 420)
    pill_button("START", MUTED, "start.png", 420)
    brand_button("G", "menu.png")
    brand_button("—", "hide.png")
    brand_button("G", "show.png")
    write_overlay()
    write_shader_variants()
    (OUT / "presentation-version.txt").write_text("2\n", encoding="utf-8")
    draw_preview()
    manifest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-clean", action="store_true")
    args = parser.parse_args()
    generate(clean=not args.no_clean)
