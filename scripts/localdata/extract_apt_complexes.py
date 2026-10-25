#!/usr/bin/env python3
"""
Decode apt_complex from korea-places-extra.pmtiles → GeoJSONSeq (local only).
Never prints names/coordinates; summary counts only.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "build" / "tiles" / "korea-places-extra.pmtiles"
# Fallback: public Supabase copy downloaded by caller
OUT = ROOT / "build" / "tiles" / "apt_complex.geojsonseq"


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    if not src.is_file():
        print(json.dumps({"ok": False, "error": "missing_pmtiles"}))
        return 2
    OUT.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["tippecanoe-decode", str(src)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1 << 20,
    )
    assert proc.stdout is not None
    seen: set[str] = set()
    n_in = 0
    n_out = 0
    with OUT.open("w", encoding="utf-8") as fout:
        for line in proc.stdout:
            line = line.strip()
            if not line or line[0] != "{":
                continue
            try:
                ft = json.loads(line)
            except json.JSONDecodeError:
                continue
            tip = ft.get("tippecanoe") or {}
            if tip.get("layer") != "apt_complex":
                continue
            n_in += 1
            geom = ft.get("geometry")
            if not geom:
                continue
            # Dedup tile overzoom copies via geometry hash (no coords logged).
            h = hashlib.sha1(
                json.dumps(geom, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            out = {
                "type": "Feature",
                "properties": {"kind": "apt"},
                "geometry": geom,
            }
            fout.write(json.dumps(out, ensure_ascii=False))
            fout.write("\n")
            n_out += 1
    rc = proc.wait()
    print(
        json.dumps(
            {
                "ok": rc == 0 and n_out > 0,
                "layer_hits": n_in,
                "unique_out": n_out,
                "out": str(OUT.relative_to(ROOT)),
            }
        )
    )
    return 0 if n_out > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
