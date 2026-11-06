#!/usr/bin/env python3
"""D-2: DB blocks read per search_map_admin call (EXPLAIN ANALYZE BUFFERS on the function).

Also checks that sangga_places saw no sequential scan (pg_stat seq_scan before/after).
Same 20 generic queries / map center as scripts/measure-d2-search.mjs.
.db_url is read, never printed. Output: e2e/artifacts/d2/blocks.json

  scripts/localdata/.venv/bin/python scripts/localdata/measure_d2_blocks.py
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
]
BUF = re.compile(r"Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?")


def main() -> int:
    conn = psycopg2.connect(db_url(), connect_timeout=20)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '5s'")

    def seq_scans() -> int:
        cur.execute("SELECT pg_stat_clear_snapshot()")
        cur.execute("SELECT seq_scan FROM pg_stat_user_tables WHERE relid = 'public.sangga_places'::regclass")
        return int(cur.fetchone()[0])

    before = seq_scans()
    rows = []
    for q in QUERIES:
        cur.execute(
            "EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT * FROM public.search_map_admin(%s, %s, %s, 8)",
            (q, CENTER[0], CENTER[1]),
        )
        text = "\n".join(r[0] for r in cur.fetchall())
        m = BUF.search(text)
        hit = int(m.group(1) or 0) if m else 0
        read = int(m.group(2) or 0) if m else 0
        ex = re.search(r"Execution Time: ([\d.]+) ms", text)
        rows.append({"q": q, "blocks": hit + read, "hit": hit, "read": read, "ms": float(ex.group(1)) if ex else None})
    time.sleep(2)
    after = seq_scans()
    cur.close()
    conn.close()

    n = len(rows)
    summary = {
        "n": n,
        "avgBlocks": round(sum(r["blocks"] for r in rows) / n),
        "maxBlocks": max(r["blocks"] for r in rows),
        "avgReadFromDisk": round(sum(r["read"] for r in rows) / n, 1),
        "avgDbMs": round(sum(r["ms"] or 0 for r in rows) / n, 1),
        "sanggaSeqScanDelta": after - before,
    }
    out = ROOT / "e2e" / "artifacts" / "d2" / "blocks.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    for r in rows:
        print(f"{r['q']}\t{r['blocks']}\t(hit={r['hit']}, read={r['read']})\t{r['ms']}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
