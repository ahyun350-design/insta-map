#!/usr/bin/env python3
"""Dry-run search_map_admin bodies (two migration versions) without creating anything.

  scripts/localdata/.venv/bin/python scripts/localdata/probe_search_near.py

The plpgsql body is run as an anonymous DO block in a READ ONLY session; result rows come
back as NOTICEs. Per call: sangga_places blocks (pg_statio delta, idle-flushed) and seq_scan
delta. .db_url is read, never printed. Output: e2e/artifacts/d2/near-dryrun.json
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from prepare import db_url  # noqa: E402
import psycopg2  # noqa: E402

CENTER = (37.5563, 126.9236)
QUERIES = [
    "스타벅스", "스타벅스 홍대", "이디야 강남", "메가커피 성수", "투썸 플레이스",
    "홍대입구역", "망원역", "강남역", "한강진", "경복궁",
    "남산서울타워", "북촌한옥마을", "코엑스", "가로수길", "연남동",
    "마포구", "망원로4길 3", "세종대로 175", "스타벅수", "경복구",
    "빽다방", "컴포즈커피", "이디야커피 망원",
    # extra: the reported case, alias queries the API also sends, broad prefixes
    "이디야", "이디야 망원", "메가엠지씨커피 성수", "투썸", "컴포즈", "카페", "망원",
]
SOURCES = {
    "current": ROOT / "supabase/migrations/20261106_map_search_catalog.sql",
    "near": ROOT / "supabase/migrations/20261107_search_map_admin_near.sql",
}


def body_of(sql_path: Path) -> str:
    text = sql_path.read_text(encoding="utf-8")
    m = re.search(r"FUNCTION public\.search_map_admin\(.*?AS \$\$(.*?)\$\$;", text, re.S)
    assert m, sql_path
    return m.group(1)


def to_do_block(body: str, q: str, lat: float, lng: float) -> str:
    lit = "'" + q.replace("'", "''") + "'"
    body = body.replace(
        "DECLARE",
        f"DECLARE\n  p_q text := {lit};\n  p_lat double precision := {lat!r};\n"
        f"  p_lng double precision := {lng!r};\n  p_limit integer := 20;\n  _row record;",
        1,
    )
    i = body.index("RETURN QUERY")
    j = body.index("LIMIT lim;", i) + len("LIMIT lim;")
    query = body[i + len("RETURN QUERY") : j - 1]
    loop = f"FOR _row IN {query} LOOP\n    RAISE NOTICE 'ROW%', row_to_json(_row)::text;\n  END LOOP;"
    return "DO $do$\n" + body[:i] + loop + body[j:] + "\n$do$;"


def main() -> int:
    conn = psycopg2.connect(db_url(), connect_timeout=20)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '8s'")
    cur.execute("SET enable_seqscan = off")
    cur.execute("SET plan_cache_mode = force_custom_plan")
    cur.execute("SHOW server_version")
    version = cur.fetchone()[0]

    def stats() -> tuple[int, int]:
        cur.execute("SELECT pg_stat_clear_snapshot()")
        cur.execute(
            """SELECT coalesce(heap_blks_hit,0)+coalesce(heap_blks_read,0)+coalesce(idx_blks_hit,0)+coalesce(idx_blks_read,0),
                      (SELECT seq_scan FROM pg_stat_user_tables WHERE relid = 'public.sangga_places'::regclass)
               FROM pg_statio_user_tables WHERE relid = 'public.sangga_places'::regclass"""
        )
        b, s = cur.fetchone()
        return int(b), int(s)

    bodies = {k: body_of(p) for k, p in SOURCES.items()}
    out: dict[str, dict] = {}
    seq_total = {k: 0 for k in SOURCES}
    time.sleep(1.2)
    for q in QUERIES:
        out[q] = {}
        for k, body in bodies.items():
            b0, s0 = stats()
            conn.notices.clear()
            t0 = time.perf_counter()
            err = None
            try:
                cur.execute(to_do_block(body, q, CENTER[0], CENTER[1]))
            except psycopg2.Error as e:  # noqa: BLE001
                err = type(e).__name__
            ms = (time.perf_counter() - t0) * 1000
            rows = [json.loads(n.split("ROW", 1)[1]) for n in conn.notices if "ROW{" in n]
            time.sleep(1.2)  # let this backend flush its table stats while idle
            b1, s1 = stats()
            seq_total[k] += s1 - s0
            out[q][k] = {
                "error": err,
                "ms": round(ms),
                "sanggaBlocks": b1 - b0,
                "seqScanDelta": s1 - s0,
                "rows": [
                    {
                        "id": r["rid"], "name": r["rname"], "branch": r["rbranch"], "category": r["rcat"],
                        "address": r["raddr"], "floor": r["rfloor"], "lat": r["rlat"], "lng": r["rlng"],
                        "dist_m": r["d_center"], "score": r["sc"], "source": r["rsrc"],
                    }
                    for r in rows
                ],
            }
        c, nr = out[q]["current"], out[q]["near"]
        top = lambda x: (f"{x['rows'][0]['name']} {x['rows'][0]['branch'] or ''}".strip() + f" {round(x['rows'][0]['dist_m'] or 0)}m") if x["rows"] else "-"
        print(f"{q:14s} cur {c['sanggaBlocks']:>5}blk {top(c):36s} | near {nr['sanggaBlocks']:>5}blk {top(nr)}" + (f"  ERR {nr['error']}" if nr["error"] else ""))
    summary = {
        "serverVersion": version,
        "seqScanDelta": seq_total,
        "avgBlocks": {k: round(sum(out[q][k]["sanggaBlocks"] for q in QUERIES) / len(QUERIES)) for k in SOURCES},
        "maxBlocks": {k: max(out[q][k]["sanggaBlocks"] for q in QUERIES) for k in SOURCES},
    }
    (ROOT / "e2e/artifacts/d2/near-dryrun.json").write_text(
        json.dumps({"summary": summary, "queries": out}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
