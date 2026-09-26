#!/usr/bin/env python3
"""Raster brand assets for «Отсчёт», drawn from the symbol geometry in src/brand/logo.ts.

Palette «Чёрное золото»: мазут #0a0907 (background), кость #f2ebdd (ring), сурик #ff4a14 (dot).
Writes the web icons (platform/public), the Android launcher icons and splash screens
(apps/mobile/android) and the Windows icon (apps/desktop/icon.ico).

Needs Pillow, which is not a runtime dependency:  python3 -m pip install pillow
Run from anywhere:                               python3 platform/scripts/brand-assets.py
The Open Graph card is HTML (platform/scripts/og.html), captured at 1200×630 in a browser.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'platform' / 'public'
RES = ROOT / 'apps' / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'

MAZUT = (10, 9, 7, 255)
BONE = (242, 235, 221, 255)
SURIK = (255, 74, 20, 255)

# symbol in a 64-unit box, as in logo.ts: ring, knockout gap, index dot
RING_C, RING_R, RING_W = (32.0, 32.0), 16.8, 7.2
DOT_C, DOT_R, KNOCK_R = (40.4, 17.45), 6.4, 8.8
SS = 8  # supersampling factor


def symbol(size: int, scale: float, bg=None, shape: str = 'square', radius: float = 0.234) -> Image.Image:
    """Symbol centred on a size×size canvas; `scale` is the 64-unit box as a fraction of the canvas."""
    s = size * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg is not None:
        if shape == 'square':
            d.rectangle([0, 0, s - 1, s - 1], fill=bg)
        elif shape == 'rounded':
            d.rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * radius), fill=bg)
        elif shape == 'circle':
            d.ellipse([0, 0, s - 1, s - 1], fill=bg)
    u = s * scale / 64.0
    o = (s - 64 * u) / 2
    cx, cy = o + RING_C[0] * u, o + RING_C[1] * u
    kx, ky = o + DOT_C[0] * u, o + DOT_C[1] * u
    ro, ri, kr, dr = (RING_R + RING_W / 2) * u, (RING_R - RING_W / 2) * u, KNOCK_R * u, DOT_R * u
    # the knockout is cut out of the ring, so the background (or transparency) shows through the gap
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=255)
    md.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=0)
    md.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=0)
    im.paste(Image.new('RGBA', (s, s), BONE), (0, 0), mask)
    d.ellipse([kx - dr, ky - dr, kx + dr, ky + dr], fill=SURIK)
    return im.resize((size, size), Image.LANCZOS)


def splash(w: int, h: int) -> Image.Image:
    im = Image.new('RGB', (w, h), MAZUT[:3])
    side = min(w, h)
    mark = symbol(side, 0.36)
    im.paste(mark, ((w - side) // 2, (h - side) // 2), mark)
    return im


def main() -> None:
    # web
    symbol(180, 0.95, MAZUT, 'square').convert('RGB').save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    symbol(192, 1.0, MAZUT, 'rounded').save(PUBLIC / 'icon-192.png', optimize=True)
    symbol(512, 1.0, MAZUT, 'rounded').save(PUBLIC / 'icon-512.png', optimize=True)
    # maskable: whole ink inside the 80 % safe circle
    symbol(512, 0.78, MAZUT, 'square').convert('RGB').save(PUBLIC / 'icon-maskable-512.png', optimize=True)
    symbol(256, 1.05, MAZUT, 'rounded').save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

    # Android launcher: legacy square, round, and the adaptive foreground (ink inside the 66 dp safe zone)
    for dpi, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        folder = RES / f'mipmap-{dpi}'
        symbol(px, 1.0, MAZUT, 'rounded').save(folder / 'ic_launcher.png', optimize=True)
        symbol(px, 0.95, MAZUT, 'circle').save(folder / 'ic_launcher_round.png', optimize=True)
        symbol(round(px * 108 / 48), 0.66).save(folder / 'ic_launcher_foreground.png', optimize=True)

    # Android splash screens keep their existing sizes
    for path in sorted(RES.glob('drawable*/splash.png')):
        with Image.open(path) as old:
            w, h = old.size
        splash(w, h).save(path, optimize=True)

    # Windows
    symbol(256, 1.0, MAZUT, 'rounded').save(
        ROOT / 'apps' / 'desktop' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )


if __name__ == '__main__':
    main()
