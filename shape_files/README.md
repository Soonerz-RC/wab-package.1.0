# shape_files/ — Oseberg WAB shapefile sources

These zips are **source data** for the QGIS presentation map at
`site/assets/maps/wab-footprint-overview.png`. They are gitignored
because their combined size (~700 MB with leasing) is too large for
git, but they are required to re-run the QGIS map build.

## What's here

| Zip | What it carries | Geom types |
|---|---|---|
| `Permits_WAB_shape.zip` | OCC drilling permits + proposed laterals | point / line / polygon |
| `Wells_WAB_shape.zip` | Well surface locations + completed laterals | point / line |
| `completions_WAB_shape.zip` | OCC completion records | point / line / polygon |
| `Production_WAB_shape.zip` | Producing leases (Oseberg-attributed) | point / polygon |
| `Pooling_WAB_shape.zip` | OCC pooling orders + drilling units | point / polygon |
| `spacing_WAB_shape.zip` | OCC spacing orders + drilling units | point / polygon |
| `Leasing_WAB_shape.zip` | OK County Records lease filings | point / polygon |

All are exported from **Oseberg**, projection **WGS84 (EPSG:4326)**,
covering the WAB area of interest (roughly lon −99.7 to −98.3, lat
35.4 to 35.8 — squarely inside the four owned counties).

## To regenerate after a fresh Oseberg export

1. Drop the new zips into this folder.
2. Unzip:
   ```bash
   mkdir -p shape_files/unzipped
   cd shape_files/unzipped
   for z in ../*.zip; do unzip -oq "$z"; done
   ```
3. Re-run the owned-tract polygon build (re-queries BLM PLSS):
   ```bash
   source .venv/bin/activate
   python3 scripts/build_owned_tracts_geojson.py
   ```
4. With QGIS open and the MCP plugin running, execute the map build
   script (via the QGIS MCP `execute_code` tool or QGIS's Python
   console "Run file"):
   ```python
   exec(open("scripts/build_presentation_map.py").read())
   ```
5. Outputs land at `site/assets/maps/wab-footprint-overview.{png,pdf}`.

## Notes

- `Leasing_WAB_shape.zip` carries ~32,000 lease points / ~16,000
  polygons. It's available for follow-up "leasing pressure" maps but
  is intentionally **not** loaded in the v1 footprint overview — at
  the 4-county scale it overwhelms the composition.
- Only `Wells_WAB_shape/POLYLINE.shp` and
  `Production_WAB_shape/Production_WAB_shape_Polygon.shp` are loaded
  in the v1 map. The rest are available for future map variants.
