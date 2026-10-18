#!/usr/bin/env bash
# Build korea-places-extra.pmtiles from south-korea-latest.osm.pbf
# Layers: apt_complex, named_building, admin_dong (al=8), admin_sigungu (al=6|7)
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

echo "Export GeoJSONSeq → process apt/buildings (streamed)…"
osmium export "$WORKDIR/filtered.osm.pbf" -f geojsonseq \
  | node --max-old-space-size="$NODE_HEAP_MB" \
    "$ROOT/scripts/process-korea-places-extra.mjs" \
    --in - \
    --landmarks "$LANDMARKS" \
    --out-dir "$WORKDIR/layers"

rm -f "$WORKDIR/filtered.osm.pbf"

echo "Filtering administrative boundaries (admin_level 6–8)…"
osmium tags-filter "$PBF" \
  wr/boundary=administrative \
  -o "$WORKDIR/admin.osm.pbf" --overwrite

echo "Export GeoJSONSeq → process admin_dong / admin_sigungu…"
osmium export "$WORKDIR/admin.osm.pbf" -f geojsonseq \
  | node --max-old-space-size="$NODE_HEAP_MB" \
    "$ROOT/scripts/process-korea-admin-labels.mjs" \
    --in - \
    --out-dir "$WORKDIR/layers"

rm -f "$WORKDIR/admin.osm.pbf"

if [ ! -f "$WORKDIR/layers/summary.json" ]; then
  echo "Process step did not write summary.json"
  exit 1
fi
APT_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/summary.json"))["apt_complex"])')
BLD_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/summary.json"))["named_building"])')
DONG_N=0
SIG_N=0
if [ -f "$WORKDIR/layers/admin-summary.json" ]; then
  DONG_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/admin-summary.json"))["admin_dong"])')
  SIG_N=$(python3 -c 'import json; print(json.load(open("'"$WORKDIR"'/layers/admin-summary.json"))["admin_sigungu"])')
fi
if [ "$APT_N" -eq 0 ] && [ "$BLD_N" -eq 0 ] && [ "$DONG_N" -eq 0 ] && [ "$SIG_N" -eq 0 ]; then
  echo "No places-extra features produced — aborting empty pmtiles"
  exit 1
fi
echo "Layers: apt_complex=$APT_N named_building=$BLD_N admin_dong=$DONG_N admin_sigungu=$SIG_N"

# Merge summaries for CI logs / artifact
python3 - <<PY
import json
from pathlib import Path
layers = Path("$WORKDIR/layers")
s = json.loads((layers / "summary.json").read_text())
admin_path = layers / "admin-summary.json"
if admin_path.exists():
    a = json.loads(admin_path.read_text())
    s["admin_dong"] = a.get("admin_dong", 0)
    s["admin_sigungu"] = a.get("admin_sigungu", 0)
    s["samples_dong"] = a.get("samples_dong", [])
    s["samples_sigungu"] = a.get("samples_sigungu", [])
else:
    s["admin_dong"] = 0
    s["admin_sigungu"] = 0
(layers / "summary.json").write_text(json.dumps(s, indent=2) + "\n")
print(json.dumps({k: s.get(k) for k in ("apt_complex","named_building","admin_dong","admin_sigungu")}, indent=2))
PY

echo "Tippecanoe → korea-places-extra.pmtiles…"
# z10 for sigungu labels; apt/building layers filter higher in style
TIPPE_LAYERS=(
  -L apt_complex:"$WORKDIR/layers/apt_complex.geojsonseq"
  -L named_building:"$WORKDIR/layers/named_building.geojsonseq"
)
if [ -f "$WORKDIR/layers/admin_dong.geojsonseq" ] && [ "$DONG_N" -gt 0 ]; then
  TIPPE_LAYERS+=(-L admin_dong:"$WORKDIR/layers/admin_dong.geojsonseq")
fi
if [ -f "$WORKDIR/layers/admin_sigungu.geojsonseq" ] && [ "$SIG_N" -gt 0 ]; then
  TIPPE_LAYERS+=(-L admin_sigungu:"$WORKDIR/layers/admin_sigungu.geojsonseq")
fi

tippecanoe \
  -o "$FINAL_OUT" \
  --force \
  --name="korea-places-extra" \
  --attribution="© OpenStreetMap contributors" \
  --minimum-zoom=10 \
  --maximum-zoom=16 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --order-by=rank \
  -P \
  "${TIPPE_LAYERS[@]}"

ls -lh "$FINAL_OUT"
cp "$WORKDIR/layers/summary.json" "$OUT_DIR/places-extra-summary.json" || true
echo "Wrote $FINAL_OUT"
