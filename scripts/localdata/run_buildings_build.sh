#!/bin/bash
# Solo Korea buildings rebuild. Do not pkill during this process.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG="$ROOT/scripts/localdata/build_korea_buildings.v2.log"
OUT="$ROOT/build/tiles"
mkdir -p "$OUT"
rm -f "$OUT/korea-buildings.pmtiles" "$OUT/korea-buildings.pmtiles-journal"
export PYTHONUNBUFFERED=1
PY="$ROOT/scripts/localdata/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "{\"error\": \"missing_venv_python\", \"path\": \"$PY\"}" | tee "$LOG"
  exit 2
fi
echo "{\"start\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"cwd\": \"$ROOT\", \"python\": \"$PY\"}" | tee "$LOG"
# caffeinate -dimsu: prevent idle/display/system/user sleep while building
caffeinate -dimsu -- "$PY" \
  "$ROOT/scripts/localdata/build_korea_buildings_pmtiles.py" \
  2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
