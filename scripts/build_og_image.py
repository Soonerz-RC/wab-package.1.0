"""scripts/build_og_image.py

Generate site/assets/og-image.png — the 1200x630 social-sharing card that
LinkedIn, Twitter, Facebook, and any other Open Graph-respecting platform
will display when the data-room URL is pasted into a post or DM.

DESIGN
------
Maroon header bar at top with the Oklahoma Minerals wordmark, an Oklahoma
counties map on the left (77 counties; the 4 owned counties are shaded
gray with a maroon outline), title block on the right (WAB Package 1.0,
package descriptor, county roll-call, tract count), brand attribution
footer at bottom. Mirrors the site's restrained McKinsey-publication
aesthetic — no shadows, hairline dividers, maroon as the only chromatic
accent.

INPUT
-----
- scripts/.cache/oklahoma-counties.geojson  (cached by build_ok_counties_svg.py)
- scripts/.cache/fonts/*.ttf  (auto-downloaded from Google Fonts on first run)

OUTPUT
------
- site/assets/og-image.png  (~80-120 kB PNG, 1200x630, optimized)

USAGE
-----
One-shot generator. Re-run only when the design or the owned-county set
changes. The generated PNG is committed to the repo so Netlify can serve
it without running this script at deploy time.

    $ source .venv/bin/activate
    $ python3 scripts/build_og_image.py
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
GEOJSON_FILE = CACHE_DIR / "oklahoma-counties.geojson"
FONT_DIR = CACHE_DIR / "fonts"
OUTPUT_FILE = REPO_ROOT / "site" / "assets" / "og-image.png"

# Output dimensions — OG / Twitter Card "summary_large_image" standard.
W, H = 1200, 630

# Site palette (mirrors site/styles.css design tokens). Tuples are RGB.
COLOR_MAROON = (155, 44, 49)         # #9b2c31
COLOR_MAROON_DARK = (122, 33, 38)    # #7a2126
COLOR_BG = (255, 255, 255)
COLOR_BG_ALT = (250, 250, 248)       # #fafaf8
COLOR_TEXT = (34, 34, 34)
COLOR_TEXT_SECONDARY = (84, 89, 95)  # #54595f
COLOR_TEXT_MUTED = (122, 122, 122)
COLOR_HAIRLINE = (229, 229, 224)     # #e5e5e0
COLOR_HAIRLINE_STRONG = (199, 199, 192)  # #c7c7c0
COLOR_OWNED_FILL = (156, 163, 175)   # #9ca3af (mid gray)
COLOR_OTHER_FILL = (240, 240, 236)   # very light gray

# 5-digit state+county FIPS for the four owned counties.
OWNED_FIPS = {"40015", "40039", "40129", "40149"}

# Fonts: Apache-2.0 licensed Roboto family from Google Fonts. The runtime
# CSS at fonts.googleapis.com gives us versioned URLs on fonts.gstatic.com
# for each static weight. These URLs are stable across deploys (the version
# segment in the path changes only when Google ships a new font release).
# Downloaded once into scripts/.cache/fonts/ (gitignored).
FONT_URLS = {
    "RobotoSlab-Regular": "https://fonts.gstatic.com/s/robotoslab/v36/BngbUXZYTXPIvIBgJJSb6s3BzlRRfKOFbvjojISWaA.ttf",
    "RobotoSlab-Medium": "https://fonts.gstatic.com/s/robotoslab/v36/BngbUXZYTXPIvIBgJJSb6s3BzlRRfKOFbvjovoSWaA.ttf",
    "RobotoSlab-Bold": "https://fonts.gstatic.com/s/robotoslab/v36/BngbUXZYTXPIvIBgJJSb6s3BzlRRfKOFbvjoa4OWaA.ttf",
    "Roboto-Regular": "https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf",
    "Roboto-Medium": "https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWub2bWmT.ttf",
    "Roboto-Bold": "https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf",
}


def ensure_fonts() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_URLS.items():
        out = FONT_DIR / f"{name}.ttf"
        if not out.exists():
            print(f"  Downloading {name}")
            # gstatic refuses bare Python urlopen User-Agent; impersonate a
            # standard browser. Same UA the runtime CSS endpoint expects.
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0 Safari/537.36"
                    )
                },
            )
            with urllib.request.urlopen(req) as r, open(out, "wb") as f:
                f.write(r.read())


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / f"{name}.ttf"), size)


def _bbox(features):
    """Bounding box across every coordinate in the FeatureCollection."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for f in features:
        geom = f["geometry"]
        polys = (
            [geom["coordinates"]]
            if geom["type"] == "Polygon"
            else geom["coordinates"]
        )
        for poly in polys:
            for ring in poly:
                for x, y in ring:
                    if x < min_x:
                        min_x = x
                    if x > max_x:
                        max_x = x
                    if y < min_y:
                        min_y = y
                    if y > max_y:
                        max_y = y
    return min_x, min_y, max_x, max_y


def _draw_county(draw: ImageDraw.ImageDraw, feature: dict, project, owned: bool) -> None:
    fill = COLOR_OWNED_FILL if owned else COLOR_OTHER_FILL
    border = COLOR_MAROON if owned else COLOR_HAIRLINE_STRONG
    border_w = 3 if owned else 1
    geom = feature["geometry"]
    polys = (
        [geom["coordinates"]]
        if geom["type"] == "Polygon"
        else geom["coordinates"]
    )
    for poly in polys:
        for ring in poly:
            pts = [project(x, y) for x, y in ring]
            if len(pts) < 3:
                continue
            # Fill first
            draw.polygon(pts, fill=fill)
            # Stroke separately so we can control width (Pillow's polygon
            # outline param is always 1px on most builds).
            closed = pts + [pts[0]]
            draw.line(closed, fill=border, width=border_w, joint="curve")


def main() -> int:
    if not GEOJSON_FILE.exists():
        sys.exit(
            f"Missing {GEOJSON_FILE.relative_to(REPO_ROOT)}.\n"
            f"Run scripts/build_ok_counties_svg.py first to populate the cache."
        )

    ensure_fonts()

    geo = json.loads(GEOJSON_FILE.read_text())
    features = geo["features"]

    # --- Map projection ---
    map_x1, map_y1 = 60, 130
    map_x2, map_y2 = 560, 530
    map_w = map_x2 - map_x1
    map_h = map_y2 - map_y1

    min_x, min_y, max_x, max_y = _bbox(features)
    mid_lat = (min_y + max_y) / 2
    lon_scale = math.cos(math.radians(mid_lat))
    geo_w = (max_x - min_x) * lon_scale
    geo_h = max_y - min_y
    scale = min(map_w / geo_w, map_h / geo_h)
    offset_x = map_x1 + (map_w - geo_w * scale) / 2 - min_x * lon_scale * scale
    offset_y = map_y1 + (map_h + geo_h * scale) / 2 + min_y * scale  # flipped y

    def project(x, y):
        return (x * lon_scale * scale + offset_x, offset_y - y * scale)

    # --- Build image ---
    img = Image.new("RGB", (W, H), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # Header bar
    BAR_H = 88
    draw.rectangle([0, 0, W, BAR_H], fill=COLOR_MAROON)
    # Thin maroon-dark hairline under the bar for depth
    draw.rectangle([0, BAR_H, W, BAR_H + 2], fill=COLOR_MAROON_DARK)

    # Header text (uppercase eyebrow + wordmark)
    f_header_eyebrow = load_font("Roboto-Medium", 16)
    f_header_wordmark = load_font("RobotoSlab-Bold", 28)
    draw.text((60, 18), "OKLAHOMA MINERALS", font=f_header_eyebrow, fill=COLOR_BG)
    draw.text((60, 42), "WAB PACKAGE 1.0", font=f_header_wordmark, fill=COLOR_BG)

    # Map: other counties first (background), owned counties last (so their
    # heavier maroon strokes land on top).
    def _fips(f):
        return f"40{int(f['properties']['county']):03d}"

    others = [f for f in features if _fips(f) not in OWNED_FIPS]
    owned = [f for f in features if _fips(f) in OWNED_FIPS]
    for f in others:
        _draw_county(draw, f, project, owned=False)
    for f in owned:
        _draw_county(draw, f, project, owned=True)

    # Subtle caption under the map
    f_caption_small = load_font("Roboto-Medium", 13)
    cap_y = map_y2 + 14
    draw.text(
        (map_x1, cap_y),
        "OKLAHOMA · 4 owned counties · WAB",
        font=f_caption_small,
        fill=COLOR_TEXT_MUTED,
    )

    # --- Right-side text block ---
    tx = 620

    f_eyebrow = load_font("Roboto-Medium", 16)
    f_title = load_font("RobotoSlab-Bold", 52)
    f_subtitle = load_font("RobotoSlab-Regular", 34)
    f_body = load_font("Roboto-Regular", 22)
    f_counties = load_font("RobotoSlab-Medium", 22)
    f_stat = load_font("Roboto-Medium", 18)

    ty = 140

    # Maroon top hairline that visually anchors the headline block.
    draw.rectangle([tx, ty, tx + 56, ty + 2], fill=COLOR_MAROON)
    ty += 16

    draw.text((tx, ty), "WAB PACKAGE 1.0", font=f_eyebrow, fill=COLOR_MAROON)
    ty += 32

    draw.text((tx, ty), "Western Anadarko Basin", font=f_title, fill=COLOR_TEXT)
    ty += 68

    draw.text((tx, ty), "Mineral & ORRI Package", font=f_subtitle, fill=COLOR_TEXT)
    ty += 64

    draw.text(
        (tx, ty),
        "Caddo  ·  Custer  ·  Roger Mills  ·  Washita",
        font=f_counties,
        fill=COLOR_TEXT_SECONDARY,
    )
    ty += 44

    draw.text(
        (tx, ty),
        "87 TRACTS  ·  43 SECTIONS  ·  4 COUNTIES",
        font=f_stat,
        fill=COLOR_MAROON,
    )

    # --- Footer ---
    foot_y = H - 50
    draw.rectangle([60, foot_y - 14, W - 60, foot_y - 13], fill=COLOR_HAIRLINE)
    draw.text(
        (60, foot_y),
        "GBK International Group, Ltd  ·  TPC Minerals, LLC",
        font=f_body,
        fill=COLOR_TEXT_MUTED,
    )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUTPUT_FILE, "PNG", optimize=True)
    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(
        f"Wrote {OUTPUT_FILE.relative_to(REPO_ROOT)} "
        f"({W}x{H}, {size_kb:.1f} kB)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
