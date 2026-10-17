#!/usr/bin/env python3
"""CSV (kept) vs korea-sangga.pmtiles feature counts within 300m of hubs."""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

import importlib.util

spec = importlib.util.spec_from_file_location(
    "bks", ROOT / "scripts" / "build-korea-sangga.py"
)
bks = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(bks)

PMTILES = ROOT / "build" / "tiles" / "korea-sangga.pmtiles"
RADIUS_M = 300

HUBS = [
    {"id": "mangwon", "label": "망원", "lat": 37.556, "lng": 126.9055},
    {"id": "hongdae", "label": "홍대", "lat": 37.5572, "lng": 126.924},
    {"id": "gangnam", "label": "강남", "lat": 37.4979, "lng": 127.0276},
    {"id": "haeundae", "label": "해운대", "lat": 35.1587, "lng": 129.1604},
    {
        "id": "haeundae_beach",
        "label": "해운대해수욕장",
        "lat": 35.1586,
        "lng": 129.1603,
    },
    {"id": "jeonju", "label": "전주한옥마을", "lat": 35.815, "lng": 127.153},
    {"id": "gangneung", "label": "강릉", "lat": 37.752, "lng": 128.876},
    {
        "id": "gangneung_gyodong",
        "label": "강릉교동/중앙시장",
        "lat": 37.7555,
        "lng": 128.8965,
    },
]

# Render counts from last measure (summary.json) — filled by caller if present
RENDER = ROOT / "e2e" / "artifacts" / "sangga-shops" / "summary.json"


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def lnglat_to_tile(lng: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int(
        (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    )
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_covering(lat: float, lng: float, z: int, radius_m: float) -> list[tuple[int, int]]:
    # ~degrees for radius
    dlat = radius_m / 110540.0
    dlng = radius_m / (111320.0 * max(0.2, math.cos(math.radians(lat))))
    corners = [
        (lng - dlng, lat - dlat),
        (lng - dlng, lat + dlat),
        (lng + dlng, lat - dlat),
        (lng + dlng, lat + dlat),
        (lng, lat),
    ]
    xs, ys = [], []
    for lo, la in corners:
        x, y = lnglat_to_tile(lo, la, z)
        xs.append(x)
        ys.append(y)
    out = []
    for x in range(min(xs), max(xs) + 1):
        for y in range(min(ys), max(ys) + 1):
            out.append((x, y))
    return out


def decode_tile(z: int, x: int, y: int) -> list[dict]:
    try:
        raw = subprocess.check_output(
            ["tippecanoe-decode", str(PMTILES), str(z), str(x), str(y)],
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return []
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return []
    # tippecanoe-decode emits nested FeatureCollections as concatenated JSON objs
    # separated by commas inside a wrapper — parse lines that are Feature objects
    feats: list[dict] = []
    # Try json.loads whole; if fail, extract Feature objects
    try:
        # Wrap as array if multiple top-level
        if text.startswith("{"):
            # tippecanoe-decode output: one big FeatureCollection with nested FCs
            data = json.loads(text)
            stack = [data]
            while stack:
                cur = stack.pop()
                if isinstance(cur, dict):
                    if cur.get("type") == "Feature":
                        feats.append(cur)
                    elif cur.get("type") == "FeatureCollection":
                        stack.extend(cur.get("features") or [])
                    else:
                        for v in cur.values():
                            if isinstance(v, (dict, list)):
                                stack.append(v)
                elif isinstance(cur, list):
                    stack.extend(cur)
    except json.JSONDecodeError:
        pass
    return feats


def count_csv_near() -> dict[str, int]:
    counts = {h["id"]: 0 for h in HUBS}
    scanned = 0
    for _fname, row in bks.iter_csv_rows():
        scanned += 1
        dae = (row.get("상권업종대분류명") or "").strip()
        jung = (row.get("상권업종중분류명") or "").strip()
        so = (row.get("상권업종소분류명") or "").strip()
        mapped = bks.map_category(dae, jung, so)
        if not mapped:
            continue
        try:
            lng = float(row.get("경도") or "")
            lat = float(row.get("위도") or "")
        except ValueError:
            continue
        name = bks.clean_name(row.get("상호명") or "", row.get("지점명") or "")
        if not name:
            continue
        for h in HUBS:
            if haversine_m(h["lat"], h["lng"], lat, lng) <= RADIUS_M:
                counts[h["id"]] += 1
        if scanned % 500_000 == 0:
            print(f"  csv scanned={scanned:,}", flush=True)
    return counts


def count_tiles_near(hub: dict, z: int) -> int:
    tiles = tiles_covering(hub["lat"], hub["lng"], z, RADIUS_M)
    n = 0
    seen = set()
    for x, y in tiles:
        for f in decode_tile(z, x, y):
            g = f.get("geometry") or {}
            if g.get("type") != "Point":
                continue
            coords = g.get("coordinates") or []
            if len(coords) < 2:
                continue
            lng, lat = float(coords[0]), float(coords[1])
            if haversine_m(hub["lat"], hub["lng"], lat, lng) > RADIUS_M:
                continue
            props = f.get("properties") or {}
            key = (
                props.get("name"),
                round(lng, 6),
                round(lat, 6),
            )
            if key in seen:
                continue
            seen.add(key)
            n += 1
    return n


def fuel_stats() -> dict:
    """Count fuel-related rows in 연료 소매 that would be included."""
    include = 0
    exclude = 0
    by_so: dict[str, int] = {}
    for _fname, row in bks.iter_csv_rows():
        jung = (row.get("상권업종중분류명") or "").strip()
        if jung != "연료 소매":
            continue
        so = (row.get("상권업종소분류명") or "").strip()
        by_so[so] = by_so.get(so, 0) + 1
        if any(k in so for k in ("주유", "LPG", "충전", "전기")):
            include += 1
        else:
            exclude += 1
    return {"include_est": include, "exclude_est": exclude, "by_so": by_so}


def main() -> int:
    if not PMTILES.exists():
        print("missing pmtiles", PMTILES, file=sys.stderr)
        return 1
    print("=== fuel 소매 breakdown ===", flush=True)
    fuel = fuel_stats()
    print(json.dumps(fuel, ensure_ascii=False, indent=2), flush=True)

    print("=== CSV kept within 300m ===", flush=True)
    csv_counts = count_csv_near()
    print(json.dumps(csv_counts, ensure_ascii=False, indent=2), flush=True)

    render = {}
    if RENDER.exists():
        data = json.loads(RENDER.read_text(encoding="utf-8"))
        for r in data.get("rows") or []:
            render[(r["hub"], r["z"])] = r.get("sangga", 0)

    rows = []
    print("=== pmtiles within 300m ===", flush=True)
    for h in HUBS:
        for z in (14, 15, 16):
            t = count_tiles_near(h, z)
            r = render.get((h["id"], z))
            row = {
                "hub": h["id"],
                "label": h["label"],
                "lat": h["lat"],
                "lng": h["lng"],
                "z": z,
                "csv_300m": csv_counts[h["id"]],
                "tile_300m": t,
                "render_sangga": r,
            }
            rows.append(row)
            print(
                f"{h['id']:20} z{z} csv={csv_counts[h['id']]:5} tile={t:5} render={r}",
                flush=True,
            )

    out = ROOT / "e2e" / "artifacts" / "sangga-hub-diag.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"radius_m": RADIUS_M, "fuel": fuel, "rows": rows, "hubs": HUBS},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
