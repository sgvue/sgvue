#!/usr/bin/env python3
"""Dev utility — NOT application code. Regenerates the Windows installer's two bitmaps.

    python scripts/make-installer-images.py

Writes, into `build/`:

- `installerSidebar.bmp` — 164 × 314, the left column of the Welcome and Finish pages of both
  the installer and the uninstaller (`electron-builder.yml` points both at it).
- `installerHeader.bmp` — 150 × 57, the right end of the white header strip on the progress
  page.

Both are 24-bit uncompressed BMP at exactly the size NSIS's Modern UI draws them at 96 dpi,
which is what electron-builder documents for `installerSidebar` / `installerHeader`.

**Nothing here is invented.** The mark is `build/icon.png`, the app's own icon, itself drawn
from the design by `scripts/make-icons.py`. The colours are the design's tokens
(`design-reference/BUILD_PLAN.md` §5): the sidebar is the dark theme — `--ground` surface,
`--ink` wordmark, `--faint` caption, one `--accent` rule — and the header is the light theme's
`--ink` on white, because Modern UI paints that strip white. The lockup follows the landing
page's (`SGVue.dc.html:737–743`), resized for a 164 px column: `SGVue` in IBM Plex Sans 600
over `IFC model review` in IBM Plex Mono 400, upper-case and tracked .14em — the same
self-hosted fonts the app ships, read from `node_modules/@fontsource`.

It writes only into `build/`, like `scripts/make-icons.py`: the modules allowed to write from
inside the *app* are unchanged (`CLAUDE.md`, Rules).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
ICON = BUILD / 'icon.png'
FONTS = ROOT / 'node_modules' / '@fontsource'
SANS_600 = FONTS / 'ibm-plex-sans' / 'files' / 'ibm-plex-sans-latin-600-normal.woff'
MONO_400 = FONTS / 'ibm-plex-mono' / 'files' / 'ibm-plex-mono-latin-400-normal.woff'

# ── the design's tokens (BUILD_PLAN.md §5) ─────────────────────────────────────
DARK_GROUND = (0x0F, 0x15, 0x16)   # --ground, dark
DARK_INK = (0xE4, 0xEC, 0xEA)      # --ink, dark
DARK_FAINT = (0x79, 0x8C, 0x8A)    # --faint, dark
ACCENT = (0x35, 0xC4, 0xB6)        # --accent, dark
LIGHT_INK = (0x1B, 0x2A, 0x2C)     # --ink, light
WHITE = (0xFF, 0xFF, 0xFF)         # Modern UI's header strip

SIDEBAR = (164, 314)
HEADER = (150, 57)


def icon(size: int) -> Image.Image:
    return Image.open(ICON).convert('RGBA').resize((size, size), Image.LANCZOS)


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, font, fill, tracking: float) -> None:
    """Pillow has no `letter-spacing`; one glyph at a time, `tracking` px apart."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking


def tracked_width(text: str, font, tracking: float) -> float:
    return sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def sidebar() -> Image.Image:
    w, h = SIDEBAR
    img = Image.new('RGB', SIDEBAR, DARK_GROUND)
    draw = ImageDraw.Draw(img)

    mark = icon(72)
    top = 84
    img.paste(mark, ((w - mark.width) // 2, top), mark)

    word = ImageFont.truetype(str(SANS_600), 26)
    y = top + mark.height + 16
    draw.text((w / 2, y), 'SGVue', font=word, fill=DARK_INK, anchor='mt')

    caption = ImageFont.truetype(str(MONO_400), 9)
    text, track = 'IFC MODEL REVIEW', 9 * 0.14
    y += 26 + 10
    tracked(draw, ((w - tracked_width(text, caption, track)) / 2, y), text, caption, DARK_FAINT, track)

    # One short accent rule under the lockup — the design's teal, once.
    y += 9 + 16
    draw.rectangle([w // 2 - 12, y, w // 2 + 11, y + 1], fill=ACCENT)
    return img


def header() -> Image.Image:
    w, h = HEADER
    img = Image.new('RGB', HEADER, WHITE)
    draw = ImageDraw.Draw(img)

    mark = icon(34)
    word = ImageFont.truetype(str(SANS_600), 17)
    gap, right = 8, 12
    text_w = word.getlength('SGVue')
    x = w - right - text_w - gap - mark.width
    img.paste(mark, (round(x), (h - mark.height) // 2), mark)
    draw.text((x + mark.width + gap, h / 2), 'SGVue', font=word, fill=LIGHT_INK, anchor='lm')
    return img


def main() -> int:
    for path, image in ((BUILD / 'installerSidebar.bmp', sidebar()), (BUILD / 'installerHeader.bmp', header())):
        image.save(path, 'BMP')  # an RGB image saves as 24-bit, uncompressed
        print(f'{path.relative_to(ROOT)}  {image.width}x{image.height}  {path.stat().st_size:,} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
