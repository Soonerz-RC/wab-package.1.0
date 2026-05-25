"""scripts/build_ok_counties_svg.py

Generate a static, self-contained SVG of Oklahoma's 77 counties for use on the
WAB Package data-room footprint map.

INPUT
-----
A public-domain GeoJSON of Oklahoma counties cached at
  scripts/.cache/oklahoma-counties.geojson
If the cache is missing, this script will download it from the Code for America
"click_that_hood" project (MIT-licensed, derived from US Census TIGER data):
  https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/oklahoma-counties.geojson

OUTPUT
------
site/assets/ok-counties.svg — a standalone SVG with one <path> per county,
each path carrying `data-fips` (5-digit FIPS, e.g. "40015" for Caddo) and
`data-name` (display-cased name, e.g. "Caddo", "McClain").

DESIGN NOTES
------------
- Pure standard library (no geopandas / shapely / pyproj). Keeps the venv slim.
- Projection: equirectangular with cosine-latitude correction applied to
  longitude. For a single state at ~35°N, this is visually indistinguishable
  from Lambert Conformal Conic and avoids the dependency cost.
- Coordinate precision: 2 decimal places in the projected viewBox space.
  Combined with Douglas-Peucker simplification (epsilon ≈ 0.6 viewBox-units),
  this trims the upstream 2.4 MB GeoJSON to a ~50-80 kB inline SVG.
- viewBox is 1200x600 with 8-px padding. OK proper (with the panhandle) has a
  ~2:1 aspect ratio after the cosine correction.
- One-shot generator. Run only when county boundaries change (basically never).
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
CACHE_FILE = CACHE_DIR / "oklahoma-counties.geojson"
OUTPUT_FILE = REPO_ROOT / "site" / "assets" / "ok-counties.svg"

GEOJSON_URL = (
    "https://raw.githubusercontent.com/codeforamerica/click_that_hood/"
    "master/public/data/oklahoma-counties.geojson"
)

VIEW_W = 1200
VIEW_H = 600
PAD = 8

# Douglas-Peucker epsilon, expressed in projected viewBox units.
# 0.6 ≈ 0.6 pixels of the 1200-wide viewport — invisible at full size.
SIMPLIFY_EPSILON = 0.6

# Source data uses a few legacy lowercase variants. Map to display form.
NAME_FIXUPS = {
    "Mcclain": "McClain",
    "Mcintosh": "McIntosh",
    "Le Flore": "Le Flore",
}


def ensure_cache() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not CACHE_FILE.exists():
        print(f"Downloading {GEOJSON_URL} → {CACHE_FILE}")
        urllib.request.urlretrieve(GEOJSON_URL, CACHE_FILE)


def perp_dist_sq(p, a, b) -> float:
    """Squared perpendicular distance from p to the line segment a-b."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx = ax + t * dx
    qy = ay + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2


def douglas_peucker(points, eps_sq: float):
    """Simplify a polyline by removing points within sqrt(eps_sq) of the trend."""
    if len(points) < 3:
        return list(points)
    # Iterative DP to avoid Python recursion-depth issues on dense rings.
    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        a, b = points[lo], points[hi]
        max_d = -1.0
        max_i = -1
        for i in range(lo + 1, hi):
            d = perp_dist_sq(points[i], a, b)
            if d > max_d:
                max_d = d
                max_i = i
        if max_d > eps_sq and max_i != -1:
            keep[max_i] = True
            stack.append((lo, max_i))
            stack.append((max_i, hi))
    return [p for i, p in enumerate(points) if keep[i]]


def main() -> int:
    ensure_cache()
    geo = json.loads(CACHE_FILE.read_text())
    features = geo["features"]
    if len(features) != 77:
        print(f"WARN: expected 77 features, got {len(features)}", file=sys.stderr)

    # Global bounding box across every coordinate
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for f in features:
        geom = f["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
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

    mid_lat = (min_y + max_y) / 2.0
    lon_scale = math.cos(math.radians(mid_lat))
    geo_w = (max_x - min_x) * lon_scale
    geo_h = max_y - min_y
    scale = min((VIEW_W - 2 * PAD) / geo_w, (VIEW_H - 2 * PAD) / geo_h)

    # Center the projected shape inside the viewBox.
    offset_x = (VIEW_W - geo_w * scale) / 2.0 - min_x * lon_scale * scale
    offset_y = (VIEW_H + geo_h * scale) / 2.0 + min_y * scale  # flipped y

    eps_sq = SIMPLIFY_EPSILON ** 2

    def project(x, y):
        return (
            round(x * lon_scale * scale + offset_x, 2),
            round(offset_y - y * scale, 2),
        )

    def ring_to_d(ring):
        if len(ring) < 2:
            return ""
        proj_pts = [project(x, y) for x, y in ring]
        simplified = douglas_peucker(proj_pts, eps_sq)
        if len(simplified) < 3:
            return ""
        first = simplified[0]
        parts = [f"M{first[0]},{first[1]}"]
        for px, py in simplified[1:]:
            parts.append(f"L{px},{py}")
        parts.append("Z")
        return "".join(parts)

    # Emit alphabetically for stable, reviewable output.
    feats_sorted = sorted(features, key=lambda f: f["properties"]["name"].lower())
    path_lines = []
    for f in feats_sorted:
        props = f["properties"]
        raw_name = props["name"]
        name = NAME_FIXUPS.get(raw_name, raw_name)
        county_num = int(props["county"])
        fips = f"40{county_num:03d}"
        geom = f["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        d_parts = []
        for poly in polys:
            for ring in poly:
                d_parts.append(ring_to_d(ring))
        d = "".join(p for p in d_parts if p)
        if not d:
            print(f"WARN: county {name} ({fips}) produced no path data", file=sys.stderr)
            continue
        path_lines.append(
            f'    <path class="ok-county" data-fips="{fips}" '
            f'data-name="{name}" d="{d}"/>'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {VIEW_W} {VIEW_H}" preserveAspectRatio="xMidYMid meet" '
        f'role="img" aria-label="Oklahoma counties map">\n'
        f'  <g class="ok-counties">\n'
        + "\n".join(path_lines)
        + "\n  </g>\n"
        f"</svg>\n"
    )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(svg)
    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(
        f"Wrote {OUTPUT_FILE.relative_to(REPO_ROOT)} "
        f"({size_kb:.1f} kB, {len(path_lines)} counties)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
