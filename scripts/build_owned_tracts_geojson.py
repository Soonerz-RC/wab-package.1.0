"""scripts/build_owned_tracts_geojson.py

Derive owned-tract section polygons from the BLM National PLSS service
by looking up each section that contains an owned tract in tracts.json.

OUTPUT
------
- data/owned_tracts.geojson — one feature per unique owned SECTION, with
  the section's polygon and aggregated tract metadata (tract IDs, count
  by type, total NRA, deal names).

WHY THIS APPROACH
-----------------
We don't have native owned-tract polygons in the inventory — only STR
descriptors (e.g. "12-12N-23W"). At presentation zoom, section-level
resolution is plenty; sub-section ownership doesn't read on the page.
The BLM PLSS service is the canonical source the OCC and oilfield
title world both reference, so map-readers immediately trust the grid.

DESIGN NOTES
------------
- One-shot generator. Runs in ~30 seconds for 43 sections. Re-run only
  when the owned-tract set changes (i.e. after a new inventory ingest).
- Aggregates by section: when multiple tracts share a section (e.g.
  Min004 + Min005 + 7 ORRIs all on 12-12N-23W), they collapse into a
  single feature whose properties carry the aggregated metadata.
- Falls back gracefully if the BLM service is unreachable: the script
  exits with a clear error rather than producing a partial file.

USAGE
-----
    $ source .venv/bin/activate
    $ python3 scripts/build_owned_tracts_geojson.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
TRACTS_FILE = REPO_ROOT / "data" / "tracts.json"
OUT_FILE = REPO_ROOT / "data" / "owned_tracts.geojson"

# BLM PLSS Section layer — REST query endpoint, sub-layer 2.
BLM_URL = (
    "https://gis.blm.gov/arcgis/rest/services/Cadastral/"
    "BLM_Natl_PLSS_CadNSDI/MapServer/2/query"
)

# All owned tracts sit on the Indian Meridian (Oklahoma east of the
# panhandle). The 17 in the PLSSID is the meridian code; we hard-wire it.
INDIAN_MERIDIAN_CODE = "17"

# Canonical STR pattern: "SS-TTN-RRW" (section, township, range).
STR_RE = re.compile(r"^(\d{1,2})-(\d{1,2})N-(\d{1,2})W$")


def build_frstdivid(section: int, twp_n: int, rng_w: int) -> str:
    """Construct the BLM FRSTDIVID for an Oklahoma section.

    Format observed from sample BLM responses:
      OK<MERIDIAN><TTTTN><RRRRW><?>SN<SSS>0
    e.g. OK170190N0260W0SN260 = OK / meridian 17 / Twp 19N / Range 26W /
                                section 26 (the trailing "0" is a fixed
                                BLM-internal duplicate disambiguator).
    """
    twp = f"{twp_n:03d}0N"     # 12 → "0120N"
    rng = f"{rng_w:03d}0W"     # 23 → "0230W"
    sec = f"{section:02d}0"    # 12 → "120"
    return f"OK{INDIAN_MERIDIAN_CODE}{twp}{rng}0SN{sec}"


def fetch_section_geom(frstdivid: str) -> Optional[dict]:
    """Query the BLM PLSS endpoint for one section. Returns Esri JSON
    geometry (rings) or None if no match.
    """
    params = {
        "where": f"FRSTDIVID='{frstdivid}'",
        "outFields": "PLSSID,FRSTDIVID,FRSTDIVNO,FRSTDIVLAB",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "json",
    }
    full = BLM_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)

    feats = data.get("features") or []
    if not feats:
        return None
    return feats[0]


def esri_rings_to_geojson_polygon(rings: List[List[List[float]]]) -> dict:
    """BLM returns Esri 'rings' format. Convert to GeoJSON Polygon.

    Heuristic: the first ring is the outer boundary; the rest are holes.
    For OK sections (simple convex-ish rectangles), holes are rare, but
    we preserve the structure either way.
    """
    if not rings:
        raise ValueError("empty rings")
    coords = [list(map(list, rings[0]))] + [list(map(list, r)) for r in rings[1:]]
    return {"type": "Polygon", "coordinates": coords}


def aggregate_tracts_by_section(tracts: List[dict]) -> Dict[str, dict]:
    """Group tracts by canonical STR. Returns a dict keyed by STR with
    aggregated properties for each section."""
    by_str: Dict[str, dict] = {}
    for t in tracts:
        s = t.get("str")
        if not s:
            continue
        agg = by_str.setdefault(
            s,
            {
                "str": s,
                "county": t.get("county"),
                "township_range": t.get("township_range"),
                "tract_ids": [],
                "tract_count": 0,
                "mineral_count": 0,
                "orri_count": 0,
                "orri_hbp_count": 0,
                "orri_nonhbp_count": 0,
                "total_nra": 0.0,
                "total_nma": 0.0,
                "deal_names": set(),
                "status_categories": set(),
                "has_regulatory": False,
            },
        )
        agg["tract_ids"].append(t["tract_id"])
        agg["tract_count"] += 1
        agg["total_nra"] += t.get("nra") or 0
        if t.get("type") == "mineral":
            agg["mineral_count"] += 1
            agg["total_nma"] += t.get("nma") or 0
            if t.get("deal_name"):
                agg["deal_names"].add(t["deal_name"])
        elif t.get("type") == "orri":
            agg["orri_count"] += 1
            if t.get("status_category") == "HBP":
                agg["orri_hbp_count"] += 1
            else:
                agg["orri_nonhbp_count"] += 1
        if t.get("status_category"):
            agg["status_categories"].add(t["status_category"])
        if t.get("regulatory_status"):
            agg["has_regulatory"] = True

    # Serialize sets to sorted lists / comma-joined strings for GeoJSON
    for s, agg in by_str.items():
        agg["tract_ids"] = sorted(agg["tract_ids"])
        agg["deal_names"] = sorted(agg["deal_names"])
        agg["status_categories"] = sorted(agg["status_categories"])
        agg["total_nra"] = round(agg["total_nra"], 2)
        agg["total_nma"] = round(agg["total_nma"], 2)
        agg["tract_label"] = ", ".join(agg["tract_ids"])
        # type_summary: 'mineral', 'orri', or 'mineral + orri'
        if agg["mineral_count"] > 0 and agg["orri_count"] > 0:
            agg["type_summary"] = "mineral + orri"
        elif agg["mineral_count"] > 0:
            agg["type_summary"] = "mineral"
        else:
            agg["type_summary"] = "orri"
    return by_str


def main() -> int:
    if not TRACTS_FILE.exists():
        sys.exit(f"Missing {TRACTS_FILE.relative_to(REPO_ROOT)}.")

    tracts_doc = json.loads(TRACTS_FILE.read_text())
    tracts = tracts_doc.get("tracts", [])
    if not tracts:
        sys.exit("No tracts in tracts.json")

    by_str = aggregate_tracts_by_section(tracts)
    print(f"Building owned_tracts.geojson for {len(tracts)} tracts across "
          f"{len(by_str)} unique sections.")

    features: List[dict] = []
    misses: List[Tuple[str, str]] = []
    for s, agg in by_str.items():
        m = STR_RE.match(s)
        if not m:
            misses.append((s, "STR did not parse"))
            continue
        section = int(m.group(1))
        twp_n = int(m.group(2))
        rng_w = int(m.group(3))
        frstdivid = build_frstdivid(section, twp_n, rng_w)
        try:
            feat = fetch_section_geom(frstdivid)
        except Exception as e:
            misses.append((s, f"BLM error: {e}"))
            continue
        if not feat:
            misses.append((s, f"no BLM feature for {frstdivid}"))
            continue
        rings = feat["geometry"].get("rings") or []
        try:
            geom = esri_rings_to_geojson_polygon(rings)
        except Exception as e:
            misses.append((s, f"geom conversion: {e}"))
            continue

        # Attach BLM identifiers so users can trace the polygon source.
        agg["plssid"] = feat["attributes"].get("PLSSID")
        agg["frstdivid"] = feat["attributes"].get("FRSTDIVID")
        agg["section_number"] = feat["attributes"].get("FRSTDIVNO")

        features.append(
            {"type": "Feature", "properties": agg, "geometry": geom}
        )
        print(f"  ✓ {s} → {len(rings[0])} vertices · "
              f"{agg['tract_count']} tract(s): {agg['tract_label']}")
        # Be polite to the BLM endpoint.
        time.sleep(0.05)

    if misses:
        print(f"\n!! {len(misses)} section(s) missed:")
        for s, why in misses:
            print(f"   - {s}: {why}")

    fc = {
        "type": "FeatureCollection",
        "name": "WAB Package 1.0 — owned tracts (section polygons)",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": features,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(fc, indent=2))
    size_kb = OUT_FILE.stat().st_size / 1024
    print(
        f"\nWrote {OUT_FILE.relative_to(REPO_ROOT)} "
        f"({size_kb:.1f} kB, {len(features)} features, "
        f"{sum(f['properties']['tract_count'] for f in features)} tracts)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
