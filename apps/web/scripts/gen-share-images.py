#!/usr/bin/env python3
"""Make the link-preview image and the iOS home-screen icon.

  apps/web/public/og.jpg                1200x630 JPEG: the placeholder glass with
                                        the wordmark, the tagline and the button
  apps/web/public/apple-touch-icon.png  180x180 PNG: the favicon, full bleed

The SVGs are rasterized by ffmpeg's librsvg decoder in the same pinned Docker
image as build-landing-atlas.py (no network, no capabilities, read-only). The
text is drawn with Pillow's bundled Aileron font (SIL OFL 1.1), so no system
font ends up in the image. Re-run after changing the placeholder
(scripts/gen-placeholder.ts), the favicon or the landing copy; the outputs
are committed.

Needs Docker and Pillow (python3 -m pip install pillow).
Usage: python3 apps/web/scripts/gen-share-images.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
PUBLIC = WEB / 'public'
IMAGE = 'mwader/static-ffmpeg:9.0.2'  # same as build-landing-atlas.py

OG_W, OG_H = 1200, 630
ICON = 180

# Design tokens (src/styles.css).
INK = (11, 13, 18)
TEXT = (232, 237, 245)
ACCENT = (245, 197, 66)
ACCENT_INK = (26, 20, 0)

# Landing copy (src/locales/en/landing.json).
TITLE = 'usmfomo'
TAGLINE = "See what's happening around USM"
CTA = "I'm FOMO"


def rasterize(work: Path, svg: str, png: str, width: int, height: int) -> None:
    cmd = [
        'docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--read-only',
        '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{work}:/w',
        '--entrypoint', '/ffmpeg', IMAGE, '-hide_banner', '-v', 'error', '-y',
        '-width', str(width), '-height', str(height), '-i', f'/w/{svg}', '-frames:v', '1', f'/w/{png}',
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f'ffmpeg failed: {res.stderr.strip()[-600:]}')


def full_bleed(favicon: str) -> str:
    """iOS rounds the icon itself and fills transparent corners with black."""
    return re.sub(r'\s+rx="[^"]*"', '', favicon, count=1)


def og_image(background: Path, out: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    bg = Image.open(background).convert('RGB')
    scale = max(OG_W / bg.width, OG_H / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.Resampling.LANCZOS)
    left = (bg.width - OG_W) // 2
    top = (bg.height - OG_H) // 2
    img = bg.crop((left, top, left + OG_W, top + OG_H)).convert('RGBA')

    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    title_font = ImageFont.load_default(size=128)
    tagline_font = ImageFont.load_default(size=40)
    cta_font = ImageFont.load_default(size=36)

    def centred_box(text: str, font, cy: int, pad_x: int, pad_y: int, stroke: int = 0):
        x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
        w, h = x1 - x0, y1 - y0
        box = (OG_W // 2 - w // 2 - pad_x, cy - h // 2 - pad_y, OG_W // 2 + (w + 1) // 2 + pad_x, cy + (h + 1) // 2 + pad_y)
        origin = (OG_W // 2 - w // 2 - x0, cy - h // 2 - y0)
        return box, origin

    # The same plates as .landing-title / .landing-tagline / .landing-cta.
    box, origin = centred_box(TITLE, title_font, 250, 52, 24, stroke=3)
    draw.rounded_rectangle(box, radius=26, fill=(*INK, 190))
    # A thin outline in the fill colour thickens Aileron Regular into a wordmark.
    draw.text(origin, TITLE, font=title_font, fill=TEXT, stroke_width=3, stroke_fill=TEXT)

    box, origin = centred_box(TAGLINE, tagline_font, 372, 26, 12)
    draw.rounded_rectangle(box, radius=16, fill=(*INK, 190))
    draw.text(origin, TAGLINE, font=tagline_font, fill=TEXT)

    box, origin = centred_box(CTA, cta_font, 466, 44, 20, stroke=1)
    glow = (box[0] - 8, box[1] - 8, box[2] + 8, box[3] + 8)
    draw.rounded_rectangle(glow, radius=999, fill=(*ACCENT, 64))
    draw.rounded_rectangle(box, radius=999, fill=(*ACCENT, 255))
    draw.text(origin, CTA, font=cta_font, fill=ACCENT_INK, stroke_width=1, stroke_fill=ACCENT_INK)

    Image.alpha_composite(img, layer).convert('RGB').save(out, 'JPEG', quality=86, optimize=True, progressive=True)


def main() -> int:
    try:
        import PIL  # noqa: F401
    except ImportError:
        print('error: Pillow is required (python3 -m pip install pillow)', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / 'bg.svg').write_text((PUBLIC / 'landing' / 'placeholder.svg').read_text())
        (work / 'icon.svg').write_text(full_bleed((PUBLIC / 'favicon.svg').read_text()))
        rasterize(work, 'bg.svg', 'bg.png', 1600, 900)
        rasterize(work, 'icon.svg', 'icon.png', ICON, ICON)
        og_image(work / 'bg.png', PUBLIC / 'og.jpg')
        from PIL import Image

        Image.open(work / 'icon.png').convert('RGB').save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    for name in ('og.jpg', 'apple-touch-icon.png'):
        print(f'wrote {PUBLIC / name} ({(PUBLIC / name).stat().st_size / 1024:.1f} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
