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

    sym_owned = QgsFillSymbol.createSimple(
        {
            "color": "0,0,0,0",
            "outline_color": "#9b2c31",
            "outline_width": "1.0",
            "outline_width_unit": "MM",
        }
    )
    sym_other = QgsFillSymbol.createSimple(
        {
            "color": "0,0,0,0",
            "outline_color": "180,180,175,200",
            "outline_width": "0.3",
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
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsFillSymbol.createSimple(
                {
                    "color": "180,180,175,140",
                    "outline_color": "130,130,125,160",
                    "outline_width": "0.15",
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
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            QgsLineSymbol.createSimple(
                {
                    "line_color": "55,55,55,230",
                    "line_width": "0.5",
                    "line_width_unit": "MM",
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


add_xyz_basemap()
add_counties()
add_plss()
add_producing_leases()
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
    "Owned tracts shown in maroon at section resolution. "
    "Gray polygons are active producing leases; dark gray lines are recent "
    "well laterals. PLSS section grid drawn from BLM cadastral data."
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
map_item.setLayers(
    [
        l
        for l in project.mapLayers().values()
        if l.name()
        in (
            "Owned tracts",
            "Well laterals",
            "Producing leases",
            "PLSS grid (BLM)",
            "OK counties",
            "CARTO Light (basemap)",
        )
    ]
)
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
for nm in ("Owned tracts", "Producing leases", "Well laterals"):
    for l in project.mapLayers().values():
        if l.name() == nm:
            legend_root.addLayer(l)
            break
legend.model().setRootGroup(legend_root)
legend.setAutoUpdateModel(False)
legend.attemptMove(QgsLayoutPoint(218, 47, QgsUnitTypes.LayoutMillimeters))
legend.attemptResize(QgsLayoutSize(58, 50, QgsUnitTypes.LayoutMillimeters))
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
