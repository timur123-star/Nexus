#!/usr/bin/env python3
"""
Regenerate all app icons from the clean shield emblem.

Why: the previous icon.ico contained a single 16x16 frame and the PNGs were
derived from the full text lockup (icon.png), so Windows showed a blurry /
unreadable taskbar + alt-tab icon. We rebuild from `src/assets/shield-emblem.png`
(transparent, near-square N-shield mark) into a crisp, square, padded icon set
with a real multi-resolution .ico.

Run:  python3 scripts/gen_icons.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "assets" / "shield-emblem.png"
OUT = ROOT / "src-tauri" / "icons"

# Pad factor: leave a small transparent margin around the emblem so it isn't
# clipped by the OS rounded-corner / circular masks.
MARGIN = 0.06
BG = (0, 0, 0, 0)  # fully transparent canvas


def square_master(size: int = 1024) -> Image.Image:
    """Return a transparent square canvas with the emblem centered + padded."""
    emblem = Image.open(SRC).convert("RGBA")
    inner = int(size * (1 - 2 * MARGIN))
    # Fit emblem into inner box preserving aspect ratio.
    ew, eh = emblem.size
    scale = min(inner / ew, inner / eh)
    nw, nh = max(1, round(ew * scale)), max(1, round(eh * scale))
    emblem = emblem.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.paste(emblem, ((size - nw) // 2, (size - nh) // 2), emblem)
    return canvas


def main() -> None:
    master = square_master(1024)

    # Master 1024 PNG (used to derive icns + store logos).
    master.save(OUT / "icon.png")

    # Standard square PNGs used by tauri.conf.json bundle.icon.
    png_targets = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }
    for name, sz in png_targets.items():
        master.resize((sz, sz), Image.LANCZOS).save(OUT / name)

    # Windows Store / MSIX square logos (kept square + padded).
    store_targets = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, sz in store_targets.items():
        master.resize((sz, sz), Image.LANCZOS).save(OUT / name)

    # Real multi-resolution Windows .ico — this is what the taskbar, title bar
    # and alt-tab actually read from the embedded exe.
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
    )

    # macOS .icns — Pillow writes a multi-resolution icns directly.
    master.save(OUT / "icon.icns", format="ICNS")

    print("Wrote icons to", OUT)
    # Verify the ICO actually contains all frames.
    ico = Image.open(OUT / "icon.ico")
    print("icon.ico frames:", sorted(ico.info.get("sizes", [])))


if __name__ == "__main__":
    main()
