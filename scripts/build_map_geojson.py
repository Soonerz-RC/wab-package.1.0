"""scripts/build_map_geojson.py

Convert the Oseberg WAB shapefiles into compact, web-ready GeoJSON files
under data/maps/. The interactive Leaflet map on site/map.html consumes
these via fetch().

WHY DERIVED GEOJSON RATHER THAN SHAPEFILES
------------------------------------------
- Browsers can't read .shp/.dbf natively.
- Each shapefile carries 50-80 fields, most of them junk for our use case.
  We trim to a focused subset (operator, well name, dates, legals, etc.).
- Polygon geometries get Douglas-Peucker-simplified at ~50 m tolerance
  so the files load fast — invisible at presentation zoom but reduces
  GeoJSON size 5-10× over raw.

OUTPUTS (committed to data/maps/)
---------------------------------
- producing_leases.geojson    (1,868 polygons → producing-lease universe)
- well_laterals.geojson       (46 lateral lines)
- well_surface_points.geojson (118 surface points, for popups)
- spacing_units.geojson       (1,301 OCC spacing units)
- pooling_units.geojson       (480 OCC pooling units)
- drilling_permits.geojson    (85 OCC permit polygons)
- completions.geojson         (88 completion points)

USAGE
-----
    $ source .venv/bin/activate
    $ python3 scripts/build_map_geojson.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterable

import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parent.parent
SHAPES = REPO / "shape_files" / "unzipped"
OUT_DIR = REPO / "data" / "maps"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Douglas-Peucker tolerance in degrees. 0.0005 ≈ 50 m at OK's latitude —
# imperceptible at the 4-county presentation zoom but reduces file size
# considerably for the dense polygon layers (production, spacing).
SIMPLIFY_TOL = 0.0005


def _convert(
    name: str,
    shp_path: Path,
    keep_fields: Iterable[str],
    rename: dict | None = None,
    simplify: bool = True,
) -> dict:
    """Read shp_path, keep only `keep_fields` (rename via `rename` map),
    optionally simplify geometries, return a GeoJSON FeatureCollection dict."""
    if not shp_path.exists():
        raise FileNotFoundError(shp_path)
    sf = shapefile.Reader(str(shp_path))
    field_names = [f[0] for f in sf.fields[1:]]
    keep_set = set(keep_fields)
    rename = rename or {}

    features = []
    for sr in sf.iterShapeRecords():
        rec = sr.record
        attrs = {}
        for fn in field_names:
            if fn not in keep_set:
                continue
            v = rec[fn]
            if v == "" or v is None:
                continue
            attrs[rename.get(fn, fn)] = v if not hasattr(v, "isoformat") else v.isoformat()
        # Build shapely geom from __geo_interface__
        try:
            geom = shape(sr.shape.__geo_interface__)
        except Exception:
            continue
        if geom.is_empty:
            continue
        if simplify and geom.geom_type in ("Polygon", "MultiPolygon", "LineString", "MultiLineString"):
            geom = geom.simplify(SIMPLIFY_TOL, preserve_topology=True)
        if geom.is_empty:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": attrs,
                "geometry": mapping(geom),
            }
        )

    fc = {
        "type": "FeatureCollection",
        "name": name,
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": features,
    }
    return fc


def _write(fc: dict, out: Path) -> None:
    out.write_text(json.dumps(fc, separators=(",", ":")))
    size_kb = out.stat().st_size / 1024
    print(f"  ✓ {out.name:30s}  {len(fc['features']):>5} feats  {size_kb:>8.1f} kB")


def main() -> int:
    print("Converting Oseberg shapefiles → data/maps/*.geojson")
    print(f"Simplify tolerance: {SIMPLIFY_TOL}° (~50 m)")
    print()

    # 1) Producing leases (polygons)
    fc = _convert(
        "Producing leases (Oseberg)",
        SHAPES / "Production_WAB_shape" / "Production_WAB_shape_Polygon.shp",
        keep_fields={
            "county", "legal", "operator", "lease_na", "api_numb",
            "reservoi", "field_na", "first_pr", "last_pro",
        },
        rename={
            "lease_na": "lease_name", "api_numb": "api_number",
            "reservoi": "reservoir", "field_na": "field_name",
            "first_pr": "first_production", "last_pro": "last_production",
        },
    )
    _write(fc, OUT_DIR / "producing_leases.geojson")

    # 2) Well laterals (lines)
    fc = _convert(
        "Well laterals (Oseberg)",
        SHAPES / "Wells_WAB_shape" / "POLYLINE.shp",
        keep_fields={
            "county", "operator", "well_nam", "api_numb", "well_num",
            "lease_na", "well_sta", "well_typ", "lateral_", "spud_dat",
            "total_de",
        },
        rename={
            "well_nam": "well_name", "api_numb": "api_number",
            "well_num": "well_number", "lease_na": "lease_name",
            "well_sta": "well_status", "well_typ": "well_type",
            "lateral_": "lateral_length_ft", "spud_dat": "spud_date",
            "total_de": "total_depth_ft",
        },
        simplify=False,  # 46 features — keep crisp
    )
    _write(fc, OUT_DIR / "well_laterals.geojson")

    # 3) Well surface points
    fc = _convert(
        "Well surface points (Oseberg)",
        SHAPES / "Wells_WAB_shape" / "Wells_WAB_shape_Point.shp",
        keep_fields={
            "county", "operator", "well_nam", "api_numb", "well_num",
            "lease_na", "well_sta", "well_typ", "spud_dat", "total_de",
        },
        rename={
            "well_nam": "well_name", "api_numb": "api_number",
            "well_num": "well_number", "lease_na": "lease_name",
            "well_sta": "well_status", "well_typ": "well_type",
            "spud_dat": "spud_date", "total_de": "total_depth_ft",
        },
        simplify=False,
    )
    _write(fc, OUT_DIR / "well_surface_points.geojson")

    # 4) Spacing units (polygons)
    fc = _convert(
        "OCC spacing units",
        SHAPES / "spacing_WAB_shape" / "spacing_WAB_shape_Polygon.shp",
        keep_fields={
            "county", "legal", "applican", "operator", "cause_nu",
            "order_nu", "type", "section", "township", "range",
        },
        rename={
            "applican": "applicant", "cause_nu": "cause_number",
            "order_nu": "order_number",
        },
    )
    _write(fc, OUT_DIR / "spacing_units.geojson")

    # 5) Pooling units (polygons)
    fc = _convert(
        "OCC pooling units",
        SHAPES / "Pooling_WAB_shape" / "Pooling_WAB_shape_Polygon.shp",
        keep_fields={
            "county", "legal", "applican", "operator", "cause_nu",
            "order_nu", "type", "section", "township", "range", "status",
        },
        rename={
            "applican": "applicant", "cause_nu": "cause_number",
            "order_nu": "order_number",
        },
    )
    _write(fc, OUT_DIR / "pooling_units.geojson")

    # 6a) Drilling permits — POLYGONS (surface-hole squares ~175 m; used
    # for high-zoom rendering only)
    fc = _convert(
        "OCC drilling permits",
        SHAPES / "Permits_WAB_shape" / "Permits_WAB_shape_Polygon.shp",
        keep_fields={
            "county", "legal", "operator", "well_nam", "api_numb",
            "purpose_", "approval", "spud", "well_typ", "type_of_",
        },
        rename={
            "well_nam": "well_name", "api_numb": "api_number",
            "purpose_": "purpose", "approval": "approval_date",
            "well_typ": "well_type", "type_of_": "type_of_filing",
        },
    )
    _write(fc, OUT_DIR / "drilling_permits.geojson")

    # 6b) Drilling permits — POINTS, deduplicated by API+well_name. Used as
    # the primary visualization on the interactive map (visible at AOI zoom).
    raw = _convert(
        "OCC drilling permit points",
        SHAPES / "Permits_WAB_shape" / "Permits_WAB_shape_Point.shp",
        keep_fields={
            "county", "legal", "operator", "well_nam", "api_numb",
            "purpose_", "approval", "filed_da", "spud", "well_typ",
            "type_of_",
        },
        rename={
            "well_nam": "well_name", "api_numb": "api_number",
            "purpose_": "purpose", "approval": "approval_date",
            "filed_da": "filed_date", "well_typ": "well_type",
            "type_of_": "type_of_filing",
        },
        simplify=False,
    )
    # Dedup by (api OR well_name, approval_date) — the source has multiple
    # filing records per well; one marker per unique permit is enough.
    seen = set()
    deduped = []
    for f in raw["features"]:
        props = f["properties"]
        key = (
            props.get("api_number") or props.get("well_name", ""),
            props.get("approval_date", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    raw["features"] = deduped
    _write(raw, OUT_DIR / "drilling_permits_points.geojson")

    # 7) Completions (points)
    fc = _convert(
        "OCC completions",
        SHAPES / "completions_WAB_shape" / "completions_WAB_shape_Point.shp",
        keep_fields={
            "county", "legal", "operator", "well_nam", "api_numb",
            "purpose_", "completi", "spud_dat", "well_typ", "type_of_",
        },
        rename={
            "well_nam": "well_name", "api_numb": "api_number",
            "purpose_": "purpose", "completi": "completion_date",
            "spud_dat": "spud_date", "well_typ": "well_type",
            "type_of_": "type_of_filing",
        },
        simplify=False,
    )
    _write(fc, OUT_DIR / "completions.geojson")

    print()
    print("Done. All outputs in data/maps/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
