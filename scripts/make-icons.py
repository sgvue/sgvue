#!/usr/bin/env python3
"""Dev utility — NOT application code. Regenerates the app icons from the design's brand mark.

    python3 scripts/make-icons.py

Writes `build/icon.icns` (macOS), `build/icon.ico` (Windows) and `build/icon.png` (the 512 px
fallback electron-builder uses for Linux and for a missing size). Until Phase 10 all three
were electron-vite's scaffold icon — the Electron atom — which is not this app.

**The source is the design's own icon**, `design-reference/design/SGVue.dc.html:30`, the data
URI in `<link rel="icon">`:

    <svg viewBox='0 0 24 24'>
      <rect width='24' height='24' rx='5' fill='#0F1516'/>
      <path d='M12 3.6 19.4 7.9v8.2L12 20.4 4.6 16.1V7.9z'
            fill='none' stroke='#354544' stroke-width='1.1' stroke-linejoin='round'/>
      <path d='M4.6 7.9 12 20.4 19.4 7.9'
            fill='none' stroke='#35C4B6' stroke-width='2.6'
            stroke-linejoin='round' stroke-linecap='round'/>
    </svg>

Those eleven numbers and three colours are transcribed below and are the only geometry here —
the same mark `app/icons.tsx`'s `Logo` draws in the sidebar, on the design's own tile.

Why it draws the paths rather than rasterising the SVG: an SVG rasteriser (cairosvg, rsvg,
resvg) is a system dependency this repository does not have and will not add for three strokes.
Pillow is already what `tests/parity/*/README.md` compares captures with. Everything is drawn
16× oversampled and reduced with LANCZOS, so the edges are cleaner than a 1024 px rasterise.

It writes only into `build/`, and it is a dev utility like `scripts/screenshot.cjs`: the three
modules allowed to write from inside the *app* are unchanged (`CLAUDE.md`, Rules).
"""
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'

# ── the design's own numbers, in its 24-unit viewBox ──────────────────────────
TILE_RADIUS = 5.0
TILE_FILL = (0x0F, 0x15, 0x16, 255)          # --ground, dark theme
HEX = [(12, 3.6), (19.4, 7.9), (19.4, 16.1), (12, 20.4), (4.6, 16.1), (4.6, 7.9)]
HEX_STROKE, HEX_WIDTH = (0x35, 0x45, 0x44, 255), 1.1      # --border-strong
VEE = [(4.6, 7.9), (12, 20.4), (19.4, 7.9)]
VEE_STROKE, VEE_WIDTH = (0x35, 0xC4, 0xB6, 255), 2.6      # --accent

# Oversampling factor for one viewBox unit. 24 × 128 = 3 072 px of artwork.
UNIT = 128
# macOS artwork fills 824 of the 1 024 px canvas; Windows and Linux are full-bleed.
MAC_INSET = 824 / 1024


def _round_cap(draw: ImageDraw.ImageDraw, point, width, colour) -> None:
    """Pillow has no `stroke-linecap: round`; a disc of the stroke's own width is one."""
    x, y = point
    r = width / 2
    draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def mark(size: int) -> Image.Image:
    """The design's icon, drawn `size` px square, oversampled and reduced."""
    big = 24 * UNIT
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    u = lambda p: (p[0] * UNIT, p[1] * UNIT)  # noqa: E731 — viewBox units → pixels

    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=TILE_RADIUS * UNIT, fill=TILE_FILL)
    # `joint='curve'` is `stroke-linejoin: round`. It rounds *interior* joints only, so the
    # closed hexagon is walked one segment past its start — that makes the top vertex, where
    # the path closes, an interior joint like the other five instead of a mitre notch.
    hexw = HEX_WIDTH * UNIT
    draw.line(
        [u(p) for p in HEX] + [u(HEX[0]), u(HEX[1])],
        fill=HEX_STROKE,
        width=round(hexw),
        joint='curve'
    )
    veew = VEE_WIDTH * UNIT
    draw.line([u(p) for p in VEE], fill=VEE_STROKE, width=round(veew), joint='curve')
    for end in (VEE[0], VEE[-1]):
        _round_cap(draw, u(end), veew, VEE_STROKE)
    return img.resize((size, size), Image.LANCZOS)


def mac_canvas(size: int) -> Image.Image:
    """The mark inset into a transparent square, the proportion macOS icons have used
    since Big Sur — otherwise it sits visibly larger than its neighbours in the Dock."""
    art = max(1, round(size * MAC_INSET))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(mark(art), ((size - art) // 2, (size - art) // 2))
    return canvas


def main() -> int:
    BUILD.mkdir(exist_ok=True)

    # macOS: an .iconset of the ten sizes `iconutil` expects.
    with TemporaryDirectory() as tmp:
        iconset = Path(tmp) / 'icon.iconset'
        iconset.mkdir()
        for base in (16, 32, 128, 256, 512):
            mac_canvas(base).save(iconset / f'icon_{base}x{base}.png')
            mac_canvas(base * 2).save(iconset / f'icon_{base}x{base}@2x.png')
        out = BUILD / 'icon.icns'
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(out)], check=True)
        print(f'{out.relative_to(ROOT)}  {out.stat().st_size:,} bytes')

    # Windows: one .ico carrying every size the shell asks for.
    ico = BUILD / 'icon.ico'
    sizes = [16, 24, 32, 48, 64, 128, 256]
    mark(256).save(ico, sizes=[(s, s) for s in sizes])
    print(f'{ico.relative_to(ROOT)}  {ico.stat().st_size:,} bytes  ({", ".join(map(str, sizes))})')

    png = BUILD / 'icon.png'
    mark(512).save(png)
    print(f'{png.relative_to(ROOT)}  {png.stat().st_size:,} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
