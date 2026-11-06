#!/usr/bin/env python3
"""Fill public.map_search_catalog (~2만 행) for admin expanded-map search.

Sources (all local, no network):
  scripts/localdata/out/tourapi/tourapi_slim.json   관광 (쇼핑은 시장만)
  public/map/korea-landmarks.geojson                랜드마크
  public/map/korea-station-labels.geojson           역
  lib/koreaGuLabels.ts / koreaPlaceLabels.ts        구·군 / 시·군
  lib/koreaMajorLabels.ts                           주요 동 + 산·랜드마크

Table must exist (supabase/migrations/20261106_map_search_catalog.sql) and be empty.
DB URL from .db_url only, never printed. Output: counts only.

  scripts/localdata/.venv/bin/python scripts/localdata/load_map_search_catalog.py --dry-run
  scripts/localdata/.venv/bin/python scripts/localdata/load_map_search_catalog.py

Rollback:
  DELETE FROM public.map_search_catalog;
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BATCH = 1000

PUNCT = re.compile(r"[\s·.,'\"\-_/()]+")
PAREN_EN = re.compile(r"\s*\([^)]*[A-Za-z][^)]*\)\s*")
MULTI_SPACE = re.compile(r"\s+")

TOUR_CATEGORY = {"12": "관광명소", "14": "문화시설", "28": "레포츠", "38": "시장"}


def norm(name: str) -> str:
    """Must match search_map_admin: lower(regexp_replace(name, punct, '', 'g'))."""
    return PUNCT.sub("", name).lower()


def clean_title(title: str) -> str:
    t = MULTI_SPACE.sub(" ", (title or "").strip())
    t = PAREN_EN.sub(" ", t)
    t = re.sub(r"\s*\(\s*\)\s*", " ", t)
    return MULTI_SPACE.sub(" ", t).strip()


def valid_ll(lat: float, lng: float) -> bool:
    return 33.0 <= lat <= 39.5 and 124.0 <= lng <= 132.5


def tour_rows():
    rows = json.loads((HERE / "out" / "tourapi" / "tourapi_slim.json").read_text(encoding="utf-8"))
    for r in rows:
        ctype = str(r.get("contentTypeId"))
        name = clean_title(r.get("title") or "")
        if ctype not in TOUR_CATEGORY or len(name) < 2:
            continue
        if ctype == "38" and "시장" not in name:
            continue
        lat, lng = float(r["mapy"]), float(r["mapx"])
        if not valid_ll(lat, lng):
            continue
        yield (f"tour:{r['contentid']}", "tour", name, TOUR_CATEGORY[ctype], lat, lng)


def geojson_points(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    for i, f in enumerate(data.get("features") or []):
        props = f.get("properties") or {}
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        yield i, props, float(coords[1]), float(coords[0])


def landmark_rows():
    for i, props, lat, lng in geojson_points(ROOT / "public" / "map" / "korea-landmarks.geojson"):
        name = (props.get("name") or "").strip()
        if len(name) >= 2 and valid_ll(lat, lng):
            yield (f"landmark:{i}", "landmark", name, "랜드마크", lat, lng)


def station_rows():
    for i, props, lat, lng in geojson_points(ROOT / "public" / "map" / "korea-station-labels.geojson"):
        name = (props.get("name") or "").strip()
        if not name or not valid_ll(lat, lng):
            continue
        display = name if name.endswith("역") else f"{name}역"
        yield (f"station:{i}", "station", display, "지하철역", lat, lng)


JSONISH = re.compile(
    r'\{\s*"name":\s*"([^"]+)",(?:\s*"full":\s*"[^"]*",)?(?:\s*"kind":\s*"([a-z]+)",)?\s*"lng":\s*([\d.]+),\s*"lat":\s*([\d.]+)'
)
LITERAL = re.compile(
    r'\{\s*name:\s*"([^"]+)",\s*lng:\s*([\d.]+),\s*lat:\s*([\d.]+),\s*kind:\s*"([a-z]+)"'
)


def gu_rows():
    text = (ROOT / "lib" / "koreaGuLabels.ts").read_text(encoding="utf-8")
    for i, m in enumerate(JSONISH.finditer(text)):
        lat, lng = float(m.group(4)), float(m.group(3))
        if valid_ll(lat, lng):
            yield (f"gu:{i}", "gu", m.group(1), "구·군", lat, lng)


def si_rows():
    text = (ROOT / "lib" / "koreaPlaceLabels.ts").read_text(encoding="utf-8")
    for i, m in enumerate(JSONISH.finditer(text)):
        lat, lng = float(m.group(4)), float(m.group(3))
        if valid_ll(lat, lng):
            yield (f"si:{i}", "si", m.group(1), "시·군", lat, lng)


def major_rows():
    text = (ROOT / "lib" / "koreaMajorLabels.ts").read_text(encoding="utf-8")
    for i, m in enumerate(LITERAL.finditer(text)):
        name, lng, lat, kind = m.group(1), float(m.group(2)), float(m.group(3)), m.group(4)
        if not valid_ll(lat, lng):
            continue
        if kind == "dong":
            yield (f"dong:{i}", "dong", name, "동", lat, lng)
        else:
            yield (f"major:{i}", "landmark", name, "산" if kind == "mountain" else "랜드마크", lat, lng)


def collect():
    out = []
    seen = set()
    stats = Counter()
    for gen in (tour_rows, landmark_rows, station_rows, gu_rows, si_rows, major_rows):
        for rid, source, name, category, lat, lng in gen():
            nn = norm(name[:-1] if source == "station" else name)
            if len(nn) < 1 or rid in seen:
                stats["skip"] += 1
                continue
            seen.add(rid)
            out.append((rid, source, name, nn, category, round(lat, 7), round(lng, 7)))
            stats[source] += 1
    return out, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows, stats = collect()
    print(dict(stats), "total", len(rows), flush=True)
    if args.dry_run:
        return 0

    sys.path.insert(0, str(HERE))
    from prepare import db_url  # noqa: E402
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(db_url(), connect_timeout=30)
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '30s'")
            cur.execute("SELECT count(*) FROM public.map_search_catalog")
            existing = int(cur.fetchone()[0])
        conn.commit()
        if existing:
            print(f"map_search_catalog not empty (rows={existing}); aborting", flush=True)
            return 2
        for i in range(0, len(rows), BATCH):
            with conn.cursor() as cur:
                execute_values(
                    cur,
                    "INSERT INTO public.map_search_catalog (id, source, name, name_norm, category, lat, lng) VALUES %s",
                    rows[i : i + BATCH],
                    page_size=BATCH,
                )
            conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT source, count(*) FROM public.map_search_catalog GROUP BY source ORDER BY source")
            by_source = cur.fetchall()
            cur.execute("SELECT count(*) FROM public.map_search_catalog")
            total = int(cur.fetchone()[0])
        conn.commit()
        print("loaded", total, dict(by_source), flush=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
