"""scripts/build_presentation_map.py

Builds the WAB Package presentation map inside a running QGIS instance.

INVOCATION
----------
Not a standalone script. Designed to be paste-run via the QGIS MCP
`execute_code` tool, or via QGIS's Python console: open the file and
run all. Reading the file via QGIS's "Run file" action also works.

WHAT IT DOES
------------
1. Resets / re-creates the project at qgis/wab-package-presentation.qgz
2. Sets CRS to EPSG:3857
3. Loads layers (bottom → top):
     - CARTO Light XYZ basemap
     - OK county boundaries (4 owned outlined maroon, others hairline gray)
     - BLM National PLSS WMS overlay (faint background grid)
     - Oseberg producing-lease polygons (light gray fill)
     - Oseberg well laterals (dark gray hairlines)
     - Owned tracts derived from BLM PLSS (maroon fill #9b2c31)
4. Applies brand-aligned symbology + smart labels
5. Frames the canvas to a 4-county AOI with breathing room
6. Builds an 11x8.5" landscape print layout with:
     - Maroon header bar with the Oklahoma Minerals wordmark
     - Eyebrow + title + descriptive subtitle
     - Map item locked to the framed canvas extent
     - Legend (right side), scale bar, north arrow
     - GBK/TPC + data-source attribution footer
7. Saves the project, then exports the layout to:
     - site/assets/maps/wab-footprint-overview.png  (300 DPI)
     - site/assets/maps/wab-footprint-overview.pdf

INPUTS (all relative to repo root)
----------------------------------
- shape_files/unzipped/Production_WAB_shape/Production_WAB_shape_Polygon.shp
- shape_files/unzipped/Wells_WAB_shape/POLYLINE.shp
- data/owned_tracts.geojson  (run scripts/build_owned_tracts_geojson.py first)
- scripts/.cache/oklahoma-counties.geojson  (cached by build_ok_counties_svg.py)
"""

from __future__ import annotations

import os
from pathlib import Path

from qgis.core import (
    Qgis,
    QgsCoordinateTransform,
    QgsFillSymbol,
    QgsLayoutItemLabel,
    QgsLayoutItemLegend,
    QgsLayoutItemMap,
    QgsLayoutItemPage,
    QgsLayoutItemPicture,
    QgsLayoutItemScaleBar,
    QgsLayoutItemShape,
    QgsLayoutMeasurement,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLayerTree,
    QgsLineSymbol,
    QgsMapSettings,
    QgsPalLayerSettings,
    QgsProject,
    QgsProperty,
    QgsRasterLayer,
    QgsRectangle,
    QgsRuleBasedRenderer,
    QgsSingleSymbolRenderer,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtCore import QSize, Qt
from qgis.PyQt.QtGui import QColor, QFont

# ---------------------------------------------------------------------------
# Repo paths
# ---------------------------------------------------------------------------
REPO = Path("/Users/gibber/Downloads/Claude_Dev/wab-package.1.0")
PROJECT_PATH = REPO / "qgis" / "wab-package-presentation.qgz"
MAPS_DIR = REPO / "site" / "assets" / "maps"
MAPS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Reset project
# ---------------------------------------------------------------------------
project = QgsProject.instance()
project.clear()
project.setCrs(Qgis.WkbType.NoGeometry and project.crs())  # no-op cleanup
project.setCrs(__import__("qgis").core.QgsCoordinateReferenceSystem("EPSG:3857"))


# ---------------------------------------------------------------------------
# 1. Load layers (bottom → top order)
# ---------------------------------------------------------------------------
def add_xyz_basemap():
    uri = (
        "type=xyz&url=https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        "&zmin=0&zmax=20"
    )
    layer = QgsRasterLayer(uri, "CARTO Light (basemap)", "wms")
    assert layer.isValid()
    project.addMapLayer(layer)


def add_counties():
    layer = QgsVectorLayer(
        str(REPO / "scripts" / ".cache" / "oklahoma-counties.geojson"),
        "OK counties",
        "ogr",
    )
    assert layer.isValid()

    # Bold maroon outline on the four owned counties; hairline gray on others.
    # Width bumped from 1.0 mm → 1.6 mm so it reads at 11x8.5" print scale
    # (and at thumbnail size when embedded in the data room).
    sym_owned = QgsFillSymbol.createSimple(
        {
            "color": "0,0,0,0",
            "outline_color": "#9b2c31",
            "outline_width": "1.6",
            "outline_width_unit": "MM",
        }
    )
    sym_other = QgsFillSymbol.createSimple(
        {
            "color": "0,0,0,0",
            "outline_color": "150,150,145,230",
            "outline_width": "0.4",
            "outline_width_unit": "MM",
        }
    )

    root = QgsRuleBasedRenderer.Rule(None)
    r1 = QgsRuleBasedRenderer.Rule(sym_owned)
    r1.setFilterExpression(
        "\"name\" IN ('Caddo','Custer','Roger Mills','Washita')"
    )
    r1.setLabel("Owned counties")
    r2 = QgsRuleBasedRenderer.Rule(sym_other)
    r2.setFilterExpression("ELSE")
    r2.setLabel("Other counties")
    root.appendChild(r1)
    root.appendChild(r2)
    layer.setRenderer(QgsRuleBasedRenderer(root))

    # Bold county-name labels, owned counties only
    text_fmt = QgsTextFormat()
    f = QFont("Helvetica", 14)
    f.setBold(True)
    text_fmt.setFont(f)
    text_fmt.setSize(14)
    text_fmt.setColor(QColor("#333333"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(1.2)
    buf.setColor(QColor("#ffffff"))
    text_fmt.setBuffer(buf)

    pal = QgsPalLayerSettings()
    pal.fieldName = "upper(\"name\")"
    pal.isExpression = True
    pal.placement = Qgis.LabelPlacement.OverPoint
    pal.setFormat(text_fmt)
    pal.dataDefinedProperties().setProperty(
        QgsPalLayerSettings.Show,
        QgsProperty.fromExpression(
            "\"name\" IN ('Caddo','Custer','Roger Mills','Washita')"
        ),
    )
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)
    project.addMapLayer(layer)


def add_plss():
    uri = (
        "contextualWMSLegend=0&crs=EPSG:3857&dpiMode=7&featureCount=10"
        "&format=image/png&layers=1&layers=2&styles=&styles=&tilePixelRatio=0"
        "&url=https://gis.blm.gov/arcgis/services/Cadastral/"
        "BLM_Natl_PLSS_CadNSDI/MapServer/WMSServer"
    )
    layer = QgsRasterLayer(uri, "PLSS grid (BLM)", "wms")
    assert layer.isValid()
    layer.setOpacity(0.30)
    project.addMapLayer(layer)


def add_producing_leases():
    path = (
        REPO / "shape_files" / "unzipped" / "Production_WAB_shape"
        / "Production_WAB_shape_Polygon.shp"
    )
    layer = QgsVectorLayer(str(path), "Producing leases", "ogr")
    assert layer.isValid()
    # Soft gray activity backdrop. Slightly higher alpha + slightly darker
    # outline so 1,868 polygons read as a visible "producing-leases blanket"
    # rather than fading into the cadastral basemap.
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "165,165,160,170",
                    "outline_color": "115,115,110,190",
                    "outline_width": "0.2",
                    "outline_width_unit": "MM",
                }
            )
        )
    )
    project.addMapLayer(layer)


def add_well_laterals():
    path = (
        REPO / "shape_files" / "unzipped" / "Wells_WAB_shape" / "POLYLINE.shp"
    )
    layer = QgsVectorLayer(str(path), "Well laterals", "ogr")
    assert layer.isValid()
    # Bump line width 0.5 → 1.5 mm so 46 ~1-mile laterals are visible at
    # the 4-county scale. Pure black at full alpha to read against any base.
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsLineSymbol.createSimple(
                {
                    "line_color": "30,30,30,255",
                    "line_width": "1.5",
                    "line_width_unit": "MM",
                    "capstyle": "round",
                    "joinstyle": "round",
                }
            )
        )
    )
    project.addMapLayer(layer)


# ---------------------------------------------------------------------------
# OCC regulatory activity layers
#
# Four shapefile bundles all derive from OCC filings. Each is rendered with
# a distinct hue + line style so a buyer can read activity type at a glance:
#   - Spacing  : faint blue dashed outline    (where drilling units exist)
#   - Pooling  : amber dashed outline         (where forced-pooling ordered)
#   - Permits  : muted orange polygon fill    (recent drill permits)
#   - Completions: green dot at surface point (wells brought online)
# ---------------------------------------------------------------------------


def add_spacing_units():
    path = (
        REPO / "shape_files" / "unzipped" / "spacing_WAB_shape"
        / "spacing_WAB_shape_Polygon.shp"
    )
    layer = QgsVectorLayer(str(path), "Spacing units (OCC)", "ogr")
    assert layer.isValid()
    # 1,301 polygons — go very subtle so the layer reads as background scaffolding
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "0,0,0,0",
                    "outline_color": "74,109,167,160",   # muted navy
                    "outline_width": "0.18",
                    "outline_width_unit": "MM",
                    "outline_style": "dash",
                }
            )
        )
    )
    project.addMapLayer(layer)


def add_pooling_units():
    path = (
        REPO / "shape_files" / "unzipped" / "Pooling_WAB_shape"
        / "Pooling_WAB_shape_Polygon.shp"
    )
    layer = QgsVectorLayer(str(path), "Pooling units (OCC)", "ogr")
    assert layer.isValid()
    # 480 polygons — slightly bolder than spacing since fewer + more meaningful
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "0,0,0,0",
                    "outline_color": "160,122,58,200",   # muted amber
                    "outline_width": "0.28",
                    "outline_width_unit": "MM",
                    "outline_style": "dash",
                }
            )
        )
    )
    project.addMapLayer(layer)


def add_permits():
    path = (
        REPO / "shape_files" / "unzipped" / "Permits_WAB_shape"
        / "Permits_WAB_shape_Polygon.shp"
    )
    layer = QgsVectorLayer(str(path), "Drilling permits (OCC)", "ogr")
    assert layer.isValid()
    # 85 polygons — solid orange-tinted fill at low alpha, so they read as
    # near-term drilling activity hotspots
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "230,140,70,90",          # warm orange
                    "outline_color": "180,100,40,200",
                    "outline_width": "0.35",
                    "outline_width_unit": "MM",
                }
            )
        )
    )
    project.addMapLayer(layer)


def add_completions():
    path = (
        REPO / "shape_files" / "unzipped" / "completions_WAB_shape"
        / "completions_WAB_shape_Point.shp"
    )
    layer = QgsVectorLayer(str(path), "Completions (OCC)", "ogr")
    assert layer.isValid()
    # 88 points — small green dots, matching the green used for HBP/producing
    # status on the data-room status pills
    from qgis.core import QgsMarkerSymbol
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsMarkerSymbol.createSimple(
                {
                    "name": "circle",
                    "color": "47,110,63,230",          # #2f6e3f
                    "outline_color": "30,75,42,255",
                    "outline_width": "0.2",
                    "size": "1.6",
                    "size_unit": "MM",
                }
            )
        )
    )
    project.addMapLayer(layer)


def add_owned_tracts():
    layer = QgsVectorLayer(
        str(REPO / "data" / "owned_tracts.geojson"), "Owned tracts", "ogr"
    )
    assert layer.isValid()
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "#9b2c31",
                    "color_alpha": "230",
                    "outline_color": "#7a2126",
                    "outline_width": "0.7",
                    "outline_width_unit": "MM",
                }
            )
        )
    )

    # Smart labels: tract ID for singletons, count+type for clusters
    text_fmt = QgsTextFormat()
    f = QFont("Helvetica", 8)
    f.setBold(True)
    text_fmt.setFont(f)
    text_fmt.setSize(8)
    text_fmt.setColor(QColor("white"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.6)
    buf.setColor(QColor("#7a2126"))
    text_fmt.setBuffer(buf)

    pal = QgsPalLayerSettings()
    pal.fieldName = (
        "CASE "
        "  WHEN \"tract_count\" = 1 THEN \"tract_label\" "
        "  WHEN \"mineral_count\" > 0 AND \"orri_count\" > 0 "
        "    THEN \"mineral_count\" || 'M + ' || \"orri_count\" || 'O' "
        "  ELSE \"tract_count\" || ' ' || \"type_summary\" "
        "END"
    )
    pal.isExpression = True
    pal.placement = Qgis.LabelPlacement.OverPoint
    pal.setFormat(text_fmt)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)
    project.addMapLayer(layer)


# Order matters: each addMapLayer() inserts at the TOP of the tree, so the
# last-called function ends up rendered on top. Result top→bottom:
#   Owned tracts → Well laterals → Completions → Permits → Pooling → Spacing
#   → Producing leases → PLSS → OK counties → CARTO Light.
add_xyz_basemap()
add_counties()
add_plss()
add_producing_leases()
add_spacing_units()
add_pooling_units()
add_permits()
add_completions()
add_well_laterals()
add_owned_tracts()


# ---------------------------------------------------------------------------
# 2. Frame the canvas to the 4-county AOI
# ---------------------------------------------------------------------------
target_4326 = QgsRectangle(-100.05, 34.83, -98.05, 36.04)
counties = next(
    l for l in project.mapLayers().values() if l.name() == "OK counties"
)
xform = QgsCoordinateTransform(counties.crs(), project.crs(), project)
target_3857 = xform.transformBoundingBox(target_4326)
iface.mapCanvas().setExtent(target_3857)
iface.mapCanvas().refresh()


# ---------------------------------------------------------------------------
# 3. Build the print layout (11x8.5" landscape)
# ---------------------------------------------------------------------------
lm = project.layoutManager()
# Remove existing layout of the same name if it exists (re-run safety)
existing = lm.layoutByName("WAB Footprint Overview")
if existing is not None:
    lm.removeLayout(existing)

from qgis.core import QgsPrintLayout
layout = QgsPrintLayout(project)
layout.initializeDefaults()
layout.setName("WAB Footprint Overview")

# Page: Letter landscape
page = layout.pageCollection().pages()[0]
page.setPageSize("Letter", QgsLayoutItemPage.Landscape)


# ---- Header bar ----
header = QgsLayoutItemShape(layout)
header.setShapeType(QgsLayoutItemShape.Rectangle)
header.attemptResize(QgsLayoutSize(279.4, 14, QgsUnitTypes.LayoutMillimeters))
header.attemptMove(QgsLayoutPoint(0, 0, QgsUnitTypes.LayoutMillimeters))
header.symbol().setColor(QColor("#9b2c31"))
header.symbol().symbolLayer(0).setStrokeStyle(Qt.NoPen)
layout.addItem(header)

wordmark = QgsLayoutItemLabel(layout)
wordmark.setText("OKLAHOMA MINERALS  ·  WAB PACKAGE 1.0")
wf = QFont("Helvetica", 11)
wf.setBold(True)
# (deliberately no letter-spacing — QGIS over-applies PercentageSpacing in
#  print layouts, producing massively gapped glyphs)
wordmark.setFont(wf)
wordmark.setFontColor(QColor("#ffffff"))
wordmark.attemptMove(QgsLayoutPoint(10, 2, QgsUnitTypes.LayoutMillimeters))
wordmark.attemptResize(QgsLayoutSize(200, 10, QgsUnitTypes.LayoutMillimeters))
wordmark.setVAlign(Qt.AlignVCenter)
layout.addItem(wordmark)

# ---- Eyebrow / Title / Subtitle ----
eyebrow = QgsLayoutItemLabel(layout)
eyebrow.setText("WESTERN ANADARKO BASIN  ·  FOOTPRINT MAP")
ef = QFont("Helvetica", 8)
ef.setBold(True)
eyebrow.setFont(ef)
eyebrow.setFontColor(QColor("#9b2c31"))
eyebrow.attemptMove(QgsLayoutPoint(10, 18, QgsUnitTypes.LayoutMillimeters))
eyebrow.attemptResize(QgsLayoutSize(200, 5, QgsUnitTypes.LayoutMillimeters))
layout.addItem(eyebrow)

title = QgsLayoutItemLabel(layout)
title.setText("Four Western Anadarko counties — 87 tracts on 43 sections")
tf = QFont("Helvetica", 18)
tf.setBold(True)
title.setFont(tf)
title.setFontColor(QColor("#222222"))
title.attemptMove(QgsLayoutPoint(10, 23.5, QgsUnitTypes.LayoutMillimeters))
title.attemptResize(QgsLayoutSize(250, 9, QgsUnitTypes.LayoutMillimeters))
layout.addItem(title)

subtitle = QgsLayoutItemLabel(layout)
subtitle.setText(
    "Owned tracts in maroon at section resolution. Surrounding context: "
    "producing leases (gray), spacing + pooling units (blue/amber dashed), "
    "drilling permits (orange), completions (green), and well laterals "
    "(black). PLSS section grid drawn from BLM cadastral data."
)
subtitle.setFont(QFont("Helvetica", 9))
subtitle.setFontColor(QColor("#54595f"))
subtitle.attemptMove(QgsLayoutPoint(10, 33, QgsUnitTypes.LayoutMillimeters))
subtitle.attemptResize(QgsLayoutSize(260, 9, QgsUnitTypes.LayoutMillimeters))
layout.addItem(subtitle)

# ---- Main map item ----
map_item = QgsLayoutItemMap(layout)
map_item.attemptMove(QgsLayoutPoint(10, 44, QgsUnitTypes.LayoutMillimeters))
map_item.attemptResize(QgsLayoutSize(200, 160, QgsUnitTypes.LayoutMillimeters))
map_item.setExtent(iface.mapCanvas().extent())
# IMPORTANT: in QGIS layout maps, the FIRST entry of setLayers() is the
# top-rendered layer. dict.values() order is arbitrary, so we explicitly
# build the list in top→bottom render order.
_layer_order_top_to_bottom = [
    "Owned tracts",            # maroon, must be on top
    "Well laterals",           # black lines, above all OCC layers
    "Completions (OCC)",       # green dots
    "Drilling permits (OCC)",  # orange polygons
    "Pooling units (OCC)",     # amber dashed
    "Spacing units (OCC)",     # blue dashed
    "Producing leases",        # gray fill
    "PLSS grid (BLM)",         # faint watermark
    "OK counties",             # county outlines + labels
    "CARTO Light (basemap)",   # bottom
]
_by_name = {l.name(): l for l in project.mapLayers().values()}
map_item.setLayers([_by_name[n] for n in _layer_order_top_to_bottom if n in _by_name])
map_item.setKeepLayerSet(True)  # lock this order in
map_item.setFrameEnabled(True)
map_item.setFrameStrokeColor(QColor("#c7c7c0"))
map_item.setFrameStrokeWidth(
    QgsLayoutMeasurement(0.3, QgsUnitTypes.LayoutMillimeters)
)
map_item.setBackgroundColor(QColor("#ffffff"))
layout.addItem(map_item)

# ---- Legend ----
legend = QgsLayoutItemLegend(layout)
legend.setTitle("LEGEND")
legend_root = QgsLayerTree()
for nm in (
    "Owned tracts",
    "Well laterals",
    "Completions (OCC)",
    "Drilling permits (OCC)",
    "Pooling units (OCC)",
    "Spacing units (OCC)",
    "Producing leases",
):
    for l in project.mapLayers().values():
        if l.name() == nm:
            legend_root.addLayer(l)
            break
legend.model().setRootGroup(legend_root)
legend.setAutoUpdateModel(False)
legend.attemptMove(QgsLayoutPoint(214, 47, QgsUnitTypes.LayoutMillimeters))
legend.attemptResize(QgsLayoutSize(64, 105, QgsUnitTypes.LayoutMillimeters))
legend.setBackgroundEnabled(True)
legend.setBackgroundColor(QColor("#fafaf8"))
legend.setFrameEnabled(True)
legend.setFrameStrokeColor(QColor("#c7c7c0"))
legend.setFrameStrokeWidth(
    QgsLayoutMeasurement(0.25, QgsUnitTypes.LayoutMillimeters)
)
layout.addItem(legend)

# ---- Scale bar ----
sb = QgsLayoutItemScaleBar(layout)
sb.setStyle("Single Box")
sb.setUnits(QgsUnitTypes.DistanceMiles)
sb.setUnitLabel("mi")
sb.setNumberOfSegments(4)
sb.setNumberOfSegmentsLeft(0)
sb.setUnitsPerSegment(5)
sb.setLinkedMap(map_item)
sb.setFont(QFont("Helvetica", 8))
sb.update()
sb.attemptMove(QgsLayoutPoint(13, 205, QgsUnitTypes.LayoutMillimeters))
layout.addItem(sb)

# ---- North arrow ----
narr = QgsLayoutItemPicture(layout)
narr.setLinkedMap(map_item)
narr.setPicturePath(":/images/north_arrows/layout_default_north_arrow.svg")
narr.attemptMove(QgsLayoutPoint(196, 50, QgsUnitTypes.LayoutMillimeters))
narr.attemptResize(QgsLayoutSize(12, 15, QgsUnitTypes.LayoutMillimeters))
layout.addItem(narr)

# ---- Footer ----
hairline = QgsLayoutItemShape(layout)
hairline.setShapeType(QgsLayoutItemShape.Rectangle)
hairline.attemptResize(
    QgsLayoutSize(259.4, 0.3, QgsUnitTypes.LayoutMillimeters)
)
hairline.attemptMove(QgsLayoutPoint(10, 208, QgsUnitTypes.LayoutMillimeters))
hairline.symbol().setColor(QColor("#c7c7c0"))
hairline.symbol().symbolLayer(0).setStrokeStyle(Qt.NoPen)
layout.addItem(hairline)

footer = QgsLayoutItemLabel(layout)
footer.setText(
    "GBK International Group, Ltd  ·  TPC Minerals, LLC          "
    "Sources: BLM National PLSS, Oseberg, OK County Records, CARTO basemap"
)
footer.setFont(QFont("Helvetica", 7))
footer.setFontColor(QColor("#7a7a7a"))
footer.attemptMove(QgsLayoutPoint(10, 210, QgsUnitTypes.LayoutMillimeters))
footer.attemptResize(QgsLayoutSize(260, 5, QgsUnitTypes.LayoutMillimeters))
layout.addItem(footer)

lm.addLayout(layout)
print(f"Layout built: {layout.name()} ({len(list(layout.items()))} items)")

# ---------------------------------------------------------------------------
# 4. Save project + export PNG/PDF
# ---------------------------------------------------------------------------
PROJECT_PATH.parent.mkdir(parents=True, exist_ok=True)
project.write(str(PROJECT_PATH))
print(f"Saved project: {PROJECT_PATH}")

from qgis.core import QgsLayoutExporter

exporter = QgsLayoutExporter(layout)

# PNG at 300 DPI
png_settings = QgsLayoutExporter.ImageExportSettings()
png_settings.dpi = 300
png_path = MAPS_DIR / "wab-footprint-overview.png"
result = exporter.exportToImage(str(png_path), png_settings)
print(f"PNG export: {png_path}  result={result}")

# PDF
pdf_settings = QgsLayoutExporter.PdfExportSettings()
pdf_settings.dpi = 300
pdf_path = MAPS_DIR / "wab-footprint-overview.pdf"
result = exporter.exportToPdf(str(pdf_path), pdf_settings)
print(f"PDF export: {pdf_path}  result={result}")

print(f"\nDone. Outputs:")
print(f"  {png_path}  ({png_path.stat().st_size / 1024:.1f} kB)")
print(f"  {pdf_path}  ({pdf_path.stat().st_size / 1024:.1f} kB)")
