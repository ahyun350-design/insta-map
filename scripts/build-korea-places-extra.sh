#!/usr/bin/env bash
# Build korea-places-extra.pmtiles from south-korea-latest.osm.pbf
# Requires: osmium, tippecanoe, node
# Streams GeoJSONSeq (no giant in-memory / on-disk FeatureCollection).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/build/tiles}"
PBF="${1:-$OUT_DIR/south-korea-latest.osm.pbf}"
LANDMARKS="${LANDMARKS:-$ROOT/public/map/korea-landmarks.geojson}"
WORKDIR="$OUT_DIR/places-extra-work"
FINAL_OUT="$OUT_DIR/korea-places-extra.pmtiles"
# Stay under GitHub ubuntu-latest ~7GB RAM; leave headroom for osmium/tippecanoe
NODE_HEAP_MB="${NODE_HEAP_MB:-4096}"

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

echo "Export GeoJSONSeq → process (streamed, no raw FeatureCollection on disk)…"
# Pipe export directly into Node so we never materialize a multi-GB FeatureCollection string.
osmium export "$WORKDIR/filtered.osm.pbf" -f geojsonseq \
  | node --max-old-space-size="$NODE_HEAP_MB" \
    "$ROOT/scripts/process-korea-places-extra.mjs" \
    --in - \
    --landmarks "$LANDMARKS" \
    --out-dir "$WORKDIR/layers"

# Free filtered PBF early (largest intermediate after source PBF)
rm -f "$WORKDIR/filtered.osm.pbf"

if [ ! -f "$WORKDIR/layers/summary.json" ]; then
  echo "Process step did not write summary.json"
  exit 1
fi
APT_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/summary.json"))["apt_complex"])')
BLD_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/summary.json"))["named_building"])')
if [ "$APT_N" -eq 0 ] && [ "$BLD_N" -eq 0 ]; then
  echo "No apt_complex / named_building features produced — aborting empty pmtiles"
  exit 1
fi
echo "Layers: apt_complex=$APT_N named_building=$BLD_N"

echo "Tippecanoe → korea-places-extra.pmtiles…"
# -P: parallel read of GeoJSONSeq (one Feature per line)
tippecanoe \
  -o "$FINAL_OUT" \
  --force \
  --name="korea-places-extra" \
  --attribution="© OpenStreetMap contributors" \
  --minimum-zoom=12 \
  --maximum-zoom=16 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -P \
  -L apt_complex:"$WORKDIR/layers/apt_complex.geojsonseq" \
  -L named_building:"$WORKDIR/layers/named_building.geojsonseq"

ls -lh "$FINAL_OUT"
cp "$WORKDIR/layers/summary.json" "$OUT_DIR/places-extra-summary.json" || true
echo "Wrote $FINAL_OUT"
