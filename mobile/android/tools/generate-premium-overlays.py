#!/data/data/com.termux/files/usr/bin/python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app/src/main/assets/retroarch-overlay"


def desc(binding, x, y, shape, rx, ry, image=None, extra=None):
    lines = [f'"{binding},{x:.5f},{y:.5f},{shape},{rx:.5f},{ry:.5f}"']
    return {"value": lines[0], "image": image, "extra": extra or []}


def add_dpad(items, prefix, cx, cy, sx, sy):
    items.extend([
        desc("left", cx-sx, cy, "radial", sx*0.72, sy*0.78, "dpad-left.png"),
        desc("right", cx+sx, cy, "radial", sx*0.72, sy*0.78, "dpad-right.png"),
        desc("up", cx, cy-sy, "radial", sx*0.74, sy*0.72, "dpad-up.png"),
        desc("down", cx, cy+sy, "radial", sx*0.74, sy*0.72, "dpad-down.png"),
        desc("left|up", cx-sx*0.72, cy-sy*0.72, "rect", sx*0.48, sy*0.48),
        desc("right|up", cx+sx*0.72, cy-sy*0.72, "rect", sx*0.48, sy*0.48),
        desc("left|down", cx-sx*0.72, cy+sy*0.72, "rect", sx*0.48, sy*0.48),
        desc("right|down", cx+sx*0.72, cy+sy*0.72, "rect", sx*0.48, sy*0.48),
    ])


def add_four_face(items, cx, cy, sx, sy, r_x, r_y):
    buttons = [
        ("x", cx, cy-sy, "x.png"),
        ("a", cx+sx, cy, "a.png"),
        ("b", cx, cy+sy, "b.png"),
        ("y", cx-sx, cy, "y.png"),
    ]
    for binding, x, y, image in buttons:
        items.append(desc(binding, x, y, "radial", r_x, r_y, image))
    for binding, x, y, _ in buttons:
        tx = x + (0.043 if x >= cx else -0.043)
        ty = y - (0.011 if y <= cy else -0.011)
        items.append(desc(f"turbo|{binding}", tx, ty, "radial", r_x*0.38, r_x*0.38, "turbo.png"))


def add_six_face(items, cx, cy, dx, dy, r_x, r_y):
    # RetroPad Y/X/L over B/A/R gives Genesis/Saturn/arcade cores six digital buttons.
    buttons = [
        ("y", cx-dx, cy-dy, "y.png"),
        ("x", cx, cy-dy, "x.png"),
        ("l", cx+dx, cy-dy, "l.png"),
        ("b", cx-dx, cy+dy, "b.png"),
        ("a", cx, cy+dy, "a.png"),
        ("r", cx+dx, cy+dy, "r.png"),
    ]
    for binding, x, y, image in buttons:
        items.append(desc(binding, x, y, "radial", r_x, r_y, image))
    for binding, x, y, _ in buttons:
        items.append(desc(f"turbo|{binding}", x+r_x*0.76, y-r_y*0.76, "radial", r_x*0.34, r_x*0.34, "turbo.png"))


def common_tail(items, portrait):
    if portrait:
        items.extend([
            desc("select", 0.31, 0.965, "rect", 0.10, 0.022, "select.png"),
            desc("start", 0.69, 0.965, "rect", 0.10, 0.022, "start.png"),
            desc("turbo", 0.50, 0.965, "rect", 0.095, 0.022, "turbo-wide.png"),
            desc("menu_toggle", 0.50, 0.505, "rect", 0.08, 0.025, "menu.png"),
        ])
    else:
        items.extend([
            desc("select", 0.40, 0.93, "rect", 0.065, 0.029, "select.png"),
            desc("start", 0.60, 0.93, "rect", 0.065, 0.029, "start.png"),
            desc("turbo", 0.50, 0.93, "rect", 0.060, 0.029, "turbo-wide.png"),
            desc("menu_toggle", 0.50, 0.10, "rect", 0.050, 0.031, "menu.png"),
        ])


def classic(portrait):
    items=[]
    if portrait:
        items.append(desc("nul", 0.50, 0.78, "rect", 0.49, 0.218, "panel-bottom.png"))
        add_dpad(items, "", 0.20, 0.72, 0.085, 0.058)
        add_four_face(items, 0.80, 0.72, 0.095, 0.060, 0.067, 0.041)
        items.extend([
            desc("l", 0.13, 0.56, "rect", 0.105, 0.025, "l.png"),
            desc("r", 0.87, 0.56, "rect", 0.105, 0.025, "r.png"),
            desc("turbo|l", 0.27, 0.56, "radial", 0.028, 0.018, "turbo.png"),
            desc("turbo|r", 0.73, 0.56, "radial", 0.028, 0.018, "turbo.png"),
        ])
    else:
        items.extend([
            desc("nul", 0.135, 0.61, "rect", 0.13, 0.37, "panel-left.png"),
            desc("nul", 0.865, 0.61, "rect", 0.13, 0.37, "panel-right.png"),
        ])
        add_dpad(items, "", 0.12, 0.61, 0.052, 0.095)
        add_four_face(items, 0.88, 0.61, 0.060, 0.105, 0.045, 0.078)
        items.extend([
            desc("l", 0.115, 0.24, "rect", 0.075, 0.035, "l.png"),
            desc("r", 0.885, 0.24, "rect", 0.075, 0.035, "r.png"),
            desc("turbo|l", 0.205, 0.24, "radial", 0.017, 0.030, "turbo.png"),
            desc("turbo|r", 0.795, 0.24, "radial", 0.017, 0.030, "turbo.png"),
        ])
    common_tail(items, portrait)
    return items


def six(portrait):
    items=[]
    if portrait:
        items.append(desc("nul", 0.50, 0.78, "rect", 0.49, 0.218, "panel-bottom.png"))
        add_dpad(items, "", 0.19, 0.73, 0.078, 0.055)
        add_six_face(items, 0.79, 0.73, 0.085, 0.060, 0.055, 0.034)
    else:
        items.extend([
            desc("nul", 0.135, 0.61, "rect", 0.13, 0.37, "panel-left.png"),
            desc("nul", 0.865, 0.61, "rect", 0.13, 0.37, "panel-right.png"),
        ])
        add_dpad(items, "", 0.12, 0.61, 0.050, 0.092)
        add_six_face(items, 0.875, 0.61, 0.055, 0.105, 0.038, 0.068)
    common_tail(items, portrait)
    return items


def render(name, builder):
    pages=[("landscape", builder(False)), ("portrait", builder(True))]
    lines=["overlays = 2", ""]
    for index,(page,_) in enumerate(pages):
        lines += [
            f"overlay{index}_full_screen = true",
            f"overlay{index}_normalized = true",
            f'overlay{index}_name = "{page}"',
            f"overlay{index}_range_mod = 1.35",
            f"overlay{index}_alpha_mod = 1.85",
            "",
        ]
    for index,(page,items) in enumerate(pages):
        items=items+[desc("overlay_next", -0.60, -0.08, "radial", 0.00001, 0.00001,
                         extra=[f"next_target = {'portrait' if page == 'landscape' else 'landscape'}"])]
        lines += [f"# {page}", f"overlay{index}_descs = {len(items)}", ""]
        for number,item in enumerate(items):
            key=f"overlay{index}_desc{number}"
            lines.append(f"{key} = {item['value']}")
            if item['image']:
                lines.append(f"{key}_overlay = img/{item['image']}")
            for extra in item['extra']:
                suffix,value=extra.split(" = ",1)
                lines.append(f"{key}_{suffix} = {value}")
            lines.append("")
    (ROOT/name).write_text("\n".join(lines).rstrip()+"\n", encoding="utf-8")


render("gamedeck-premium-classic.cfg", classic)
render("gamedeck-premium-six.cfg", six)
print("Generated classic and six-button premium overlays")
