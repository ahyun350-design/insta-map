#!/usr/bin/env python3
"""
Stream Juso building polygons (TL_SGCO_RNADR_MST) → GeoJSONSeq → tippecanoe PMTiles.
Local Mac only. Never prints coordinates/addresses/raw records.
"""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import fiona
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(__file__).resolve().parent / "raw_juso"
OUT_DIR = ROOT / "build" / "tiles"
OUT_PMTILES = OUT_DIR / "korea-buildings.pmtiles"
LAYER = "building_kr"
SRC_EPSG = 5179  # Korea 2000 / Unified CS (no .prj in zip; validated vs Korea bbox)


def peak_rss_mb() -> float:
    # ru_maxrss: macOS bytes, Linux KB
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return rss / (1024 * 1024)
    return rss / 1024


def houseno(props: dict) -> str | None:
    try:
        mn = int(props.get("BULD_MNNM") or 0)
        sn = int(props.get("BULD_SLNO") or 0)
    except (TypeError, ValueError):
        return None
    if mn <= 0:
        return None
    if sn > 0:
        return f"{mn}-{sn}"
    return str(mn)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    zips = sorted(RAW.glob("건물도형_전체분_*.zip"))
    if not zips:
        print("no_raw_zips", file=sys.stderr)
        return 2

    tippecanoe = [
        "tippecanoe",
        "-o",
        str(OUT_PMTILES),
        "-l",
        LAYER,
        "-Z14",
        "-z16",
        "--force",
        "--read-parallel",
        "--no-feature-limit",
        "--maximum-tile-bytes=480000",
        "--simplify-only-low-zooms",
        "--simplification=12",
        "--maximum-zoom=16",
        "--minimum-zoom=14",
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "-P",
    ]

    transformer = Transformer.from_crs(
        f"EPSG:{SRC_EPSG}", "EPSG:4326", always_xy=True
    )

    def project(x, y, z=None):
        lon, lat = transformer.transform(x, y)
        return (lon, lat) if z is None else (lon, lat, z)

    t0 = time.time()
    n_in = 0
    n_out = 0
    n_skip = 0
    max_child_rss = 0.0

    env = os.environ.copy()
    # tippecanoe child
    proc = subprocess.Popen(
        tippecanoe,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1 << 20,
    )
    assert proc.stdin is not None

    try:
        for zpath in zips:
            with zipfile.ZipFile(zpath) as zf:
                shps = [
                    n
                    for n in zf.namelist()
                    if n.endswith(".shp") and "TL_SGCO_RNADR_MST" in n
                ]
            for shp_name in shps:
                vsizip = f"/vsizip/{zpath}/{shp_name}"
                with fiona.open(vsizip) as src:
                    for ft in src:
                        n_in += 1
                        props = ft.get("properties") or {}
                        no = houseno(props)
                        geom = ft.get("geometry")
                        if not geom or not no:
                            n_skip += 1
                            continue
                        try:
                            g = shape(geom)
                            if g.is_empty:
                                n_skip += 1
                                continue
                            g2 = shp_transform(project, g)
                            if g2.is_empty:
                                n_skip += 1
                                continue
                        except Exception:
                            n_skip += 1
                            continue
                        # Minimal attrs only — no address string / ADR_MNG_NO
                        out = {
                            "type": "Feature",
                            "properties": {"no": no},
                            "geometry": mapping(g2),
                        }
                        proc.stdin.write(json.dumps(out, ensure_ascii=False))
                        proc.stdin.write("\n")
                        n_out += 1
                        if n_out % 200000 == 0:
                            rss = peak_rss_mb()
                            print(
                                json.dumps(
                                    {
                                        "progress_out": n_out,
                                        "progress_in": n_in,
                                        "rss_mb": round(rss, 1),
                                        "elapsed_s": int(time.time() - t0),
                                    }
                                ),
                                flush=True,
                            )
        proc.stdin.close()
        stderr = proc.stderr.read() if proc.stderr else ""
        stdout = proc.stdout.read() if proc.stdout else ""
        rc = proc.wait()
    except Exception:
        proc.kill()
        raise

    elapsed = time.time() - t0
    size = OUT_PMTILES.stat().st_size if OUT_PMTILES.exists() else 0
    summary = {
        "zips": len(zips),
        "features_in": n_in,
        "features_out": n_out,
        "features_skipped": n_skip,
        "src_epsg": SRC_EPSG,
        "layer": LAYER,
        "out": str(OUT_PMTILES.relative_to(ROOT)),
        "bytes": size,
        "mb": round(size / 1e6, 1),
        "build_s": int(elapsed),
        "peak_rss_mb_python": round(peak_rss_mb(), 1),
        "tippecanoe_rc": rc,
        "has_building_name_field": False,
        "has_floors_field": False,
        "attrs": ["no"],
        "tippecanoe_stderr_tail": "\n".join(stderr.strip().splitlines()[-30:]),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    (OUT_DIR / "korea-buildings.build.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if rc == 0 and size > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
