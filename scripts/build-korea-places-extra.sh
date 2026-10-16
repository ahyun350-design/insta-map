#!/usr/bin/env bash
# Build korea-places-extra.pmtiles from south-korea-latest.osm.pbf
# Requires: osmium, tippecanoe, node
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/build/tiles}"
PBF="${1:-$OUT_DIR/south-korea-latest.osm.pbf}"
LANDMARKS="${LANDMARKS:-$ROOT/public/map/korea-landmarks.geojson}"
WORKDIR="$OUT_DIR/places-extra-work"
FINAL_OUT="$OUT_DIR/korea-places-extra.pmtiles"

if [ ! -f "$PBF" ]; then
  echo "Missing OSM PBF: $PBF"
  exit 1
fi

mkdir -p "$WORKDIR" "$OUT_DIR"
echo "Filtering named residential / apartments / buildings…"
# landuse residential (named), apartments/residential buildings, any named building
osmium tags-filter "$PBF" \
  nw/landuse=residential \
  nw/building=apartments \
  nw/building=residential \
  nw/building \
  -o "$WORKDIR/filtered.osm.pbf" --overwrite

echo "Exporting GeoJSON (named only kept in process step)…"
osmium export "$WORKDIR/filtered.osm.pbf" -f geojson -o "$WORKDIR/raw.geojson" --overwrite

echo "Processing clusters / ranks…"
node "$ROOT/scripts/process-korea-places-extra.mjs" \
  --in "$WORKDIR/raw.geojson" \
  --landmarks "$LANDMARKS" \
  --out-dir "$WORKDIR/layers"

echo "Tippecanoe → korea-places-extra.pmtiles…"
# tippecanoe 2.x writes .pmtiles when extension is .pmtiles
tippecanoe \
  -o "$FINAL_OUT" \
  --force \
  --name="korea-places-extra" \
  --attribution="© OpenStreetMap contributors" \
  --minimum-zoom=12 \
  --maximum-zoom=16 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -L apt_complex:"$WORKDIR/layers/apt_complex.geojson" \
  -L named_building:"$WORKDIR/layers/named_building.geojson"

ls -lh "$FINAL_OUT"
cp "$WORKDIR/layers/summary.json" "$OUT_DIR/places-extra-summary.json" || true
echo "Wrote $FINAL_OUT"
