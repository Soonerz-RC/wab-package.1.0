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

    # 8) Leasing — aggregated to per-section choropleth so 32k point records
    # collapse to ~650 polygons. Drives the "leasing pressure" layer on the
    # interactive map. See _build_leasing_by_section() below.
    _build_leasing_by_section()

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


def _build_leasing_by_section() -> None:
    """Aggregate 32k Oseberg lease points to per-section summaries.

    Output schema (one feature per section that has at least 1 oil & gas
    lease in the dataset):
        - section_legal (e.g. "16-12N-23W")
        - county
        - total_leases
        - leases_24mo  ← drives the choropleth color/opacity
        - leases_12mo
        - latest_recording
        - top_lessees   (list of {name, count}, top 3)

    Lessor names are deliberately omitted — these are private parties whose
    names are public record but inappropriate for a sale-process map.

    Section polygons are pulled from the existing layer-build outputs
    (producing leases / spacing / pooling / owned tracts). Any section we
    don't have a polygon for is skipped (a handful at the AOI edges).
    """
    import re
    from collections import Counter, defaultdict
    from datetime import datetime, timedelta

    today = datetime.now()
    cutoff_24 = (today - timedelta(days=365 * 2)).strftime("%Y-%m-%d")
    cutoff_12 = (today - timedelta(days=365)).strftime("%Y-%m-%d")

    src_shp = SHAPES / "Leasing_WAB_shape" / "Leasing_WAB_shape_Point.shp"
    if not src_shp.exists():
        print("  · skipping leasing aggregate (shapefile not present)")
        return

    print("  · aggregating 32k lease points → per-section choropleth …")
    sf = shapefile.Reader(str(src_shp), encoding="latin-1")
    fields = [f[0] for f in sf.fields[1:]]
    i_legal = fields.index("legal")
    i_county = fields.index("county")
    i_recorded = fields.index("recorded")
    i_lessee = fields.index("lessee")
    i_classifi = fields.index("classifi")
    legal_re = re.compile(r"^(\d{1,2})-(\d{1,2}N)-(\d{1,2}W)")

    by_section = defaultdict(
        lambda: {
            "total_leases": 0,
            "leases_24mo": 0,
            "leases_12mo": 0,
            "lessees": Counter(),
            "latest_recording": "",
            "county": "",
        }
    )
    for rec in sf.iterRecords():
        legal = rec[i_legal] or ""
        m = legal_re.match(legal)
        if not m:
            continue
        classifi = rec[i_classifi] or ""
        if "Lease" not in classifi:
            continue
        sec = int(m.group(1))
        twp = m.group(2)
        rng = m.group(3)
        key = (sec, twp, rng)
        agg = by_section[key]
        agg["total_leases"] += 1
        agg["county"] = rec[i_county] or agg["county"]
        recorded = rec[i_recorded]
        rec_str = (
            recorded.isoformat()
            if hasattr(recorded, "isoformat")
            else str(recorded or "")
        )
        if rec_str > agg["latest_recording"]:
            agg["latest_recording"] = rec_str
        if rec_str >= cutoff_24:
            agg["leases_24mo"] += 1
        if rec_str >= cutoff_12:
            agg["leases_12mo"] += 1
        lessee = (rec[i_lessee] or "").strip()
        if lessee:
            agg["lessees"][lessee] += 1

    print(f"    Unique sections with leasing activity: {len(by_section)}")

    # Build section→polygon lookup from already-derived layers
    section_polys = {}
    for source in (
        OUT_DIR / "producing_leases.geojson",
        OUT_DIR / "spacing_units.geojson",
        OUT_DIR / "pooling_units.geojson",
        REPO / "data" / "owned_tracts.geojson",
    ):
        if not source.exists():
            continue
        fc = json.loads(source.read_text())
        for f in fc.get("features", []):
            p = f.get("properties") or {}
            legal_str = p.get("legal") or p.get("str") or ""
            m = legal_re.match(legal_str)
            if not m:
                continue
            key = (int(m.group(1)), m.group(2), m.group(3))
            if key in section_polys:
                continue
            try:
                g = shape(f["geometry"])
                # Simplify a touch to stay compact
                if g.geom_type in ("Polygon", "MultiPolygon"):
                    g = g.simplify(SIMPLIFY_TOL, preserve_topology=True)
                section_polys[key] = g
            except Exception:
                continue
    print(f"    Section-polygon lookup built from existing layers: "
          f"{len(section_polys)} sections")

    # Assemble features
    features = []
    no_poly = 0
    for key, agg in by_section.items():
        sec, twp, rng = key
        geom = section_polys.get(key)
        if geom is None or geom.is_empty:
            no_poly += 1
            continue
        top3 = [
            {"name": n, "count": c}
            for n, c in agg["lessees"].most_common(3)
        ]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "section_legal": f"{sec:02d}-{twp}-{rng}",
                    "county": agg["county"],
                    "total_leases": agg["total_leases"],
                    "leases_24mo": agg["leases_24mo"],
                    "leases_12mo": agg["leases_12mo"],
                    "latest_recording": agg["latest_recording"],
                    "top_lessees": top3,
                },
                "geometry": mapping(geom),
            }
        )
    if no_poly:
        print(f"    Skipped {no_poly} sections (no polygon available)")

    fc = {
        "type": "FeatureCollection",
        "name": "Oseberg leasing — aggregated by PLSS section",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": features,
    }
    out = OUT_DIR / "leasing_by_section.geojson"
    _write(fc, out)


if __name__ == "__main__":
    sys.exit(main())
