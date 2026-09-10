#!/usr/bin/env python3
"""poi_load.csv → Supabase public.poi (psycopg2 COPY, 배치).

환경변수:
  DATABASE_URL  또는  SUPABASE_DB_URL
  (postgresql://postgres.[ref]:[password]@aws-0-....pooler.supabase.com:6543/postgres)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

OUT = Path(__file__).resolve().parent / "out" / "poi_load.csv"
MIGRATION = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260907_poi.sql"

COPY_SQL = """
COPY public.poi (
  source, source_key, name, name_norm,
  road_address, jibun_address, lat, lng,
  raw_category, category, phone
)
FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')
"""


def db_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not url:
        # optional local file not committed
        secret = Path(__file__).resolve().parent / ".db_url"
        if secret.exists():
            url = secret.read_text().strip()
    if not url:
        sys.stderr.write(
            "DATABASE_URL 또는 SUPABASE_DB_URL 이 필요합니다.\n"
            "Supabase Dashboard → Project Settings → Database → Connection string (URI)\n"
        )
        sys.exit(1)
    return url


def apply_migration(conn) -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print("migration applied:", MIGRATION.name)


def load_copy_batched(conn, csv_path: Path, batch_rows: int = 100_000) -> int:
    """헤더 포함 CSV를 batch_rows 단위로 나눠 COPY (타임아웃·메모리 대비)."""
    import csv
    import io

    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.poi")
        start_count = cur.fetchone()[0]

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        batch: list[list[str]] = []
        batch_i = 0
        for row in reader:
            batch.append(row)
            if len(batch) >= batch_rows:
                batch_i += 1
                _copy_batch(conn, header, batch, batch_i)
                batch = []
        if batch:
            batch_i += 1
            _copy_batch(conn, header, batch, batch_i)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.poi")
        end_count = cur.fetchone()[0]
    print(
        f"COPY batches={batch_i} in {time.time()-t0:.1f}s  "
        f"rows+={end_count - start_count}  total={end_count}"
    )
    return end_count


def _copy_batch(conn, header: list[str], rows: list[list[str]], batch_i: int) -> None:
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    buf.seek(0)
    with conn.cursor() as cur:
        cur.copy_expert(COPY_SQL, buf)
    conn.commit()
    print(f"  batch {batch_i}: +{len(rows)} rows")


def load_copy(conn, csv_path: Path) -> int:
    return load_copy_batched(conn, csv_path)


def truncate(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE public.poi RESTART IDENTITY")
    conn.commit()
    print("truncated poi")


def verify(conn) -> dict:
    q = {
        "by_source": """
          SELECT source, count(*) AS n FROM public.poi GROUP BY source ORDER BY source
        """,
        "coords": """
          SELECT
            count(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) AS with_coords,
            count(*) FILTER (WHERE lat IS NULL OR lng IS NULL) AS without_coords,
            count(*) AS total
          FROM public.poi
        """,
        "by_category": """
          SELECT category, count(*) AS n FROM public.poi GROUP BY category ORDER BY n DESC
        """,
        "coord_range": """
          SELECT
            min(lat) AS min_lat, max(lat) AS max_lat,
            min(lng) AS min_lng, max(lng) AS max_lng
          FROM public.poi
          WHERE lat IS NOT NULL AND lng IS NOT NULL
        """,
        "empty_norm": """
          SELECT count(*) AS empty_name_norm FROM public.poi WHERE name_norm = '' OR name_norm IS NULL
        """,
        "table_size": """
          SELECT pg_size_pretty(pg_total_relation_size('public.poi')) AS total_size,
                 pg_size_pretty(pg_relation_size('public.poi')) AS table_size,
                 pg_size_pretty(pg_indexes_size('public.poi')) AS indexes_size
        """,
    }
    out = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for k, sql in q.items():
            cur.execute(sql)
            rows = cur.fetchall()
            out[k] = [dict(r) for r in rows]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--migrate-only", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--truncate", action="store_true", help="적재 전 TRUNCATE")
    ap.add_argument("--skip-migrate", action="store_true")
    args = ap.parse_args()

    url = db_url()
    conn = psycopg2.connect(url)
    conn.autocommit = False
    try:
        if args.verify_only:
            print(verify(conn))
            return
        if not args.skip_migrate:
            apply_migration(conn)
        if args.migrate_only:
            return
        if not OUT.exists():
            sys.stderr.write(f"missing {OUT} — run prepare.py first\n")
            sys.exit(1)
        if args.truncate:
            truncate(conn)
        load_copy(conn, OUT)
        report = verify(conn)
        out_path = Path(__file__).resolve().parent / "out" / "load_verify.json"
        import json

        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
