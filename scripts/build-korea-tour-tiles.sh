#!/usr/bin/env bash
# Build korea-tour.pmtiles from TourAPI slim cache (grid top-N ranks + tippecanoe minzoom).
# Large artifacts stay under build/tiles/ (gitignored). Upload separately to map-tiles bucket.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/build-korea-tour.py
rm -f build/tiles/korea-tour.pmtiles
tippecanoe -o build/tiles/korea-tour.pmtiles --force --name=korea-tour \
  --attribution=한국관광공사 --minimum-zoom=12 --maximum-zoom=15 \
  --drop-rate=1 --no-feature-limit --no-tile-size-limit --order-by=rank \
  -l tour build/tiles/korea-tour.geojson
ls -lh build/tiles/korea-tour.pmtiles build/tiles/korea-tour.geojson
