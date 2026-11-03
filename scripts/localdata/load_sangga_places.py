#!/usr/bin/env python3
"""상가(상권)정보 CSV → public.sangga_places (스트리밍 COPY, 배치 커밋).

테이블·인덱스·RLS 는 사전에 수동 생성되어 있어야 한다 (이 스크립트는 DDL 없음).
DB 접속 정보는 .db_url 파일에서만 읽고 출력하지 않는다. 출력은 건수만.

  scripts/localdata/.venv/bin/python scripts/localdata/load_sangga_places.py
  scripts/localdata/.venv/bin/python scripts/localdata/load_sangga_places.py --dry-run
  scripts/localdata/.venv/bin/python scripts/localdata/load_sangga_places.py --resume

롤백:
  TRUNCATE public.sangga_places;
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import io
import re
import sys
import time
from collections import Counter
from datetime import date
from pathlib import Path

import psycopg2

from prepare import db_url

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RAW = HERE / "raw_sangga"
# Small batches: GIN (pg_trgm) maintenance makes large COPYs hit statement_timeout.
BATCH = 10_000
SESSION_STATEMENT_TIMEOUT = "10min"

COLUMNS = (
    "bizes_id",
    "name",
    "branch",
    "ind_l_code",
    "ind_l_name",
    "ind_m_code",
    "ind_m_name",
    "ind_s_code",
    "ind_s_name",
    "poi_class",
    "poi_subclass",
    "road_address",
    "floor",
    "lat",
    "lng",
    "base_ym",
)

_YM = re.compile(r"_(\d{4})(\d{2})\.csv$")


def load_map_category():
    spec = importlib.util.spec_from_file_location(
        "build_korea_sangga", ROOT / "scripts" / "build-korea-sangga.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.map_category


def base_ym_of(path: Path) -> str:
    m = _YM.search(path.name)
    if not m:
        raise ValueError(f"base month not in file name: {path.name}")
    return date(int(m.group(1)), int(m.group(2)), 1).isoformat()


def clean(v: str | None) -> str:
    return (v or "").strip()


def iter_records(map_category, stats: Counter):
    for path in sorted(RAW.glob("*.csv")):
        ym = base_ym_of(path)
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                stats["scanned"] += 1
                bid = clean(row.get("상가업소번호"))
                name = clean(row.get("상호명"))
                try:
                    lng = float(row.get("경도") or "")
                    lat = float(row.get("위도") or "")
                except ValueError:
                    stats["skip_coords"] += 1
                    continue
                if not bid or not name or not (124 <= lng <= 132.5 and 33 <= lat <= 39.5):
                    stats["skip_invalid"] += 1
                    continue
                dae = clean(row.get("상권업종대분류명"))
                jung = clean(row.get("상권업종중분류명"))
                so = clean(row.get("상권업종소분류명"))
                mapped = map_category(dae, jung, so)
                cls, sub = (mapped[0], mapped[1]) if mapped else ("", None)
                stats["mapped" if mapped else "unmapped"] += 1
                yield (
                    bid,
                    name,
                    clean(row.get("지점명")),
                    clean(row.get("상권업종대분류코드")),
                    dae,
                    clean(row.get("상권업종중분류코드")),
                    jung,
                    clean(row.get("상권업종소분류코드")),
                    so,
                    cls,
                    sub or "",
                    clean(row.get("도로명주소")),
                    clean(row.get("층정보")),
                    lat,
                    lng,
                    ym,
                )


def copy_batch(cur, rows: list[tuple]) -> None:
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow(r)
    buf.seek(0)
    # Empty optional text fields → NULL (FORCE_NULL keeps quoted '' as NULL too).
    cur.copy_expert(
        "COPY public.sangga_places ("
        + ", ".join(COLUMNS)
        + ") FROM STDIN WITH (FORMAT csv, FORCE_NULL (branch, ind_l_code, ind_l_name, "
        "ind_m_code, ind_m_name, ind_s_code, ind_s_name, poi_class, poi_subclass, "
        "road_address, floor))",
        buf,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="parse only, no DB writes")
    ap.add_argument(
        "--resume",
        action="store_true",
        help="table already holds the first N records (batches commit in file order): skip N, continue",
    )
    args = ap.parse_args()

    map_category = load_map_category()
    stats: Counter = Counter()
    t0 = time.time()

    if args.dry_run:
        for _ in iter_records(map_category, stats):
            stats["would_load"] += 1
        print(dict(stats), f"elapsed={time.time() - t0:.0f}s", flush=True)
        return 0

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = %s", (SESSION_STATEMENT_TIMEOUT,))
            cur.execute("SELECT count(*) FROM public.sangga_places")
            existing = int(cur.fetchone()[0])
        conn.commit()
        if existing and not args.resume:
            print(f"sangga_places not empty (rows={existing:,}); aborting", flush=True)
            return 2
        skip = existing if args.resume else 0
        if skip:
            print(f"  resume: skipping first {skip:,} records", flush=True)

        batch: list[tuple] = []
        loaded = 0
        with conn.cursor() as cur:
            for i, rec in enumerate(iter_records(map_category, stats)):
                if i < skip:
                    continue
                batch.append(rec)
                if len(batch) >= BATCH:
                    copy_batch(cur, batch)
                    conn.commit()
                    loaded += len(batch)
                    batch.clear()
                    if loaded % 100_000 == 0:
                        print(f"  loaded {loaded:,} [{time.time() - t0:.0f}s]", flush=True)
            if batch:
                copy_batch(cur, batch)
                conn.commit()
                loaded += len(batch)

        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM public.sangga_places")
            total = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(*) FROM public.sangga_places WHERE poi_class IS NOT NULL"
            )
            with_class = int(cur.fetchone()[0])
        print(
            f"DONE loaded={loaded:,} table_rows={total:,} with_poi_class={with_class:,} "
            f"stats={dict(stats)} elapsed={time.time() - t0:.0f}s",
            flush=True,
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
