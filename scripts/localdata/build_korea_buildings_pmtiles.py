#!/usr/bin/env python3
"""
Stream Juso building polygons → enrich use/shop_n (+apt) → tippecanoe PMTiles.
Local Mac only. Never prints coordinates/addresses/raw records.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import math
import os
import resource
import subprocess
import sys
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import fiona
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform as shp_transform
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(__file__).resolve().parent / "raw_juso"
RAW_SANGGA = Path(__file__).resolve().parent / "raw_sangga"
OUT_DIR = ROOT / "build" / "tiles"
OUT_PMTILES = OUT_DIR / "korea-buildings.pmtiles"
APT_SEQ = OUT_DIR / "apt_complex.geojsonseq"
LAYER = "building_kr"
SRC_EPSG = 5179
# ~220 m cells for sangga candidate lookup
SHOP_CELL = 0.002


def peak_rss_mb() -> float:
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


def load_map_category():
    path = ROOT / "scripts" / "build-korea-sangga.py"
    spec = importlib.util.spec_from_file_location("korea_sangga_build", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot_load_sangga_mapper")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.map_category


def cell_xy(lon: float, lat: float) -> tuple[int, int]:
    return (int(math.floor(lon / SHOP_CELL)), int(math.floor(lat / SHOP_CELL)))


def load_shop_grid(map_category) -> tuple[dict[tuple[int, int], list[tuple[float, float]]], int]:
    """Index kept 상가 points only (lon/lat). No names stored."""
    grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    n = 0
    files = sorted(RAW_SANGGA.glob("*.csv"))
    if not files:
        print(json.dumps({"warn": "no_raw_sangga_csv"}))
        return grid, 0
    for path in files:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                dae = (row.get("상권업종대분류명") or "").strip()
                jung = (row.get("상권업종중분류명") or "").strip()
                so = (row.get("상권업종소분류명") or "").strip()
                if map_category(dae, jung, so) is None:
                    continue
                try:
                    lon = float(row.get("경도") or "")
                    lat = float(row.get("위도") or "")
                except ValueError:
                    continue
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    continue
                # Rough Korea bbox gate (no logging of values)
                if not (124.0 <= lon <= 132.5 and 33.0 <= lat <= 39.6):
                    continue
                grid[cell_xy(lon, lat)].append((lon, lat))
                n += 1
    return grid, n


def load_apt_grid() -> tuple[dict[tuple[int, int], list[tuple[float, float]]], int]:
    """places-extra apt_complex is Point geometry; index lon/lat only."""
    grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    if not APT_SEQ.is_file():
        return grid, 0
    n = 0
    with APT_SEQ.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ft = json.loads(line)
            except json.JSONDecodeError:
                continue
            geom = ft.get("geometry") or {}
            if geom.get("type") != "Point":
                continue
            coords = geom.get("coordinates") or []
            if len(coords) < 2:
                continue
            try:
                lon = float(coords[0])
                lat = float(coords[1])
            except (TypeError, ValueError):
                continue
            grid[cell_xy(lon, lat)].append((lon, lat))
            n += 1
    return grid, n


def points_inside(g, grid: dict) -> int:
    minx, miny, maxx, maxy = g.bounds
    ix0, iy0 = cell_xy(minx, miny)
    ix1, iy1 = cell_xy(maxx, maxy)
    candidates: list[tuple[float, float]] = []
    for ix in range(ix0 - 1, ix1 + 2):
        for iy in range(iy0 - 1, iy1 + 2):
            pts = grid.get((ix, iy))
            if pts:
                candidates.extend(pts)
    if not candidates:
        return 0
    pg = prep(g)
    n = 0
    for lon, lat in candidates:
        if pg.contains(Point(lon, lat)):
            n += 1
    return n


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    zips = sorted(RAW.glob("건물도형_전체분_*.zip"))
    if not zips:
        print("no_raw_zips", file=sys.stderr)
        return 2

    t_load0 = time.time()
    map_category = load_map_category()
    shop_grid, n_shops = load_shop_grid(map_category)
    apt_grid, n_apt = load_apt_grid()
    load_s = int(time.time() - t_load0)
    print(
        json.dumps(
            {
                "shop_points_indexed": n_shops,
                "shop_cells": len(shop_grid),
                "apt_points_indexed": n_apt,
                "apt_cells": len(apt_grid),
                "load_s": load_s,
                "rss_mb_after_index": round(peak_rss_mb(), 1),
            }
        ),
        flush=True,
    )

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
    n_shop_bldg = 0
    n_apt_bldg = 0

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

                        out_props: dict = {"no": no}
                        sc = points_inside(g2, shop_grid) if n_shops else 0
                        if sc > 0:
                            out_props["use"] = "shop"
                            out_props["shop_n"] = int(sc)
                            n_shop_bldg += 1
                        elif n_apt and points_inside(g2, apt_grid) > 0:
                            out_props["use"] = "apt"
                            n_apt_bldg += 1

                        out = {
                            "type": "Feature",
                            "properties": out_props,
                            "geometry": mapping(g2),
                        }
                        proc.stdin.write(json.dumps(out, ensure_ascii=False))
                        proc.stdin.write("\n")
                        n_out += 1
                        if n_out % 200000 == 0:
                            print(
                                json.dumps(
                                    {
                                        "progress_out": n_out,
                                        "shop_bldgs": n_shop_bldg,
                                        "apt_bldgs": n_apt_bldg,
                                        "rss_mb": round(peak_rss_mb(), 1),
                                        "elapsed_s": int(time.time() - t0),
                                    }
                                ),
                                flush=True,
                            )
        proc.stdin.close()
        stderr = proc.stderr.read() if proc.stderr else ""
        _stdout = proc.stdout.read() if proc.stdout else ""
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
        "shop_points_indexed": n_shops,
        "shop_buildings": n_shop_bldg,
        "shop_building_pct": round(100.0 * n_shop_bldg / max(n_out, 1), 2),
        "apt_points": n_apt,
        "apt_buildings": n_apt_bldg,
        "apt_building_pct": round(100.0 * n_apt_bldg / max(n_out, 1), 2),
        "src_epsg": SRC_EPSG,
        "layer": LAYER,
        "out": str(OUT_PMTILES.relative_to(ROOT)),
        "bytes": size,
        "mb": round(size / 1e6, 1),
        "index_load_s": load_s,
        "build_s": int(elapsed),
        "peak_rss_mb_python": round(peak_rss_mb(), 1),
        "tippecanoe_rc": rc,
        "attrs": ["no", "use", "shop_n"],
        "tippecanoe_stderr_tail": "\n".join(stderr.strip().splitlines()[-20:]),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    (OUT_DIR / "korea-buildings.build.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if rc == 0 and size > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
