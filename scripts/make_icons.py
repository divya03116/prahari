"""Draws the PRAHARI app icons (public/icons/*.png) from the logo's own geometry.

    python scripts/make_icons.py

The shield and the mark are the paths in src/components/brand.tsx, drawn at
4x and scaled down for clean edges. Needs only Pillow. Run it again if the
logo changes; the PNGs are committed, so a normal build does not need Python.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
CANVAS, SIGNAL, INK = (9, 9, 11, 255), (139, 124, 246, 255), (244, 244, 245, 255)
SS = 4  # supersampling


def cubic(p0, p1, p2, p3, steps=40):
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )


def shield():
    """M12 2.75 4.25 5.6v6.02c0 4.47 3.13 8.4 7.75 9.63 4.62-1.23 7.75-5.16 7.75-9.63V5.6L12 2.75Z"""
    pts = [(12, 2.75), (4.25, 5.6), (4.25, 11.62)]
    pts += cubic((4.25, 11.62), (4.25, 16.09), (7.38, 20.02), (12, 21.25))
    pts += cubic((12, 21.25), (16.62, 20.02), (19.75, 16.09), (19.75, 11.62))
    pts += [(19.75, 5.6), (12, 2.75)]
    return pts


def stroke(draw, pts, colour, width):
    draw.line(pts, fill=colour, width=round(width), joint='curve')
    r = width / 2
    for x, y in (pts[0], pts[-1]):  # round caps
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)


def icon(size, mark, radius=0.0, transparent=False):
    """`mark`: the logo's share of the canvas. `radius`: corner radius as a share of the size."""
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0) if transparent else CANVAS)
    draw = ImageDraw.Draw(img)
    if transparent:
        draw.rounded_rectangle((0, 0, n - 1, n - 1), radius=radius * n, fill=CANVAS)
    scale = n * mark / 24
    off = (n - 24 * scale) / 2
    at = lambda p: (off + p[0] * scale, off + p[1] * scale)  # noqa: E731
    stroke(draw, [at(p) for p in shield()], INK, 1.6 * scale)
    stroke(draw, [at((12, 7.5)), at((12, 12.75))], SIGNAL, 1.9 * scale)
    stroke(draw, [at((12, 15.6)), at((12, 16.5))], SIGNAL, 1.9 * scale)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon(192, 0.62, radius=0.22, transparent=True).save(OUT / 'icon-192.png', optimize=True)
    icon(512, 0.62, radius=0.22, transparent=True).save(OUT / 'icon-512.png', optimize=True)
    # Maskable: full bleed, the logo inside the central safe zone.
    icon(512, 0.5).save(OUT / 'maskable-512.png', optimize=True)
    # iOS draws its own rounded corners and does not like transparency.
    icon(180, 0.62).convert('RGB').save(OUT / 'apple-touch-icon.png', optimize=True)
    for f in sorted(OUT.glob('*.png')):
        print(f.name, f.stat().st_size, 'bytes')


main()
