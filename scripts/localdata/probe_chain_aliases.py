#!/usr/bin/env python3
"""D-2: which 상호 spelling does 상가 data use for common chains?

Read-only. Name-prefix lookups on sangga_places through the existing
sangga_places_name_btree (text_pattern_ops) only, each capped at CAP rows.
Checks pg_stat seq_scan on sangga_places before/after (must not change).
.db_url is read, never printed. Output: e2e/artifacts/d2/chain-alias-probe.json

  scripts/localdata/.venv/bin/python scripts/localdata/probe_chain_aliases.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from prepare import db_url  # noqa: E402
import psycopg2  # noqa: E402

CAP = 5000
HI = chr(1114111)
# typed chain name → spellings to probe (first = what users type)
CANDIDATES: dict[str, list[str]] = {
    "빽다방": ["빽다방", "빽다방커피", "백다방", "PAIK", "Paik", "빽's"],
    "컴포즈커피": ["컴포즈커피", "컴포즈 커피", "컴포즈", "COMPOSE", "Compose"],
    "이디야커피": ["이디야커피", "이디야 커피", "이디야", "EDIYA"],
    "메가커피": ["메가커피", "메가엠지씨커피", "메가 엠지씨", "메가MGC", "메가 커피", "MEGA"],
    "투썸플레이스": ["투썸플레이스", "투썸 플레이스", "투썸", "A TWOSOME", "TWOSOME"],
    "할리스": ["할리스", "할리스커피", "HOLLYS"],
    "폴바셋": ["폴바셋", "폴 바셋", "PAUL BASSETT"],
    "커피빈": ["커피빈", "더커피빈", "COFFEE BEAN"],
    "더벤티": ["더벤티", "더 벤티", "벤티", "THE VENTI"],
    "매머드커피": ["매머드커피", "매머드 커피", "매머드익스프레스", "매머드"],
    "공차": ["공차", "GONG CHA"],
    "파스쿠찌": ["파스쿠찌", "PASCUCCI"],
    "탐앤탐스": ["탐앤탐스", "탐탐"],
    "엔제리너스": ["엔제리너스", "엔젤리너스"],
    "맥도날드": ["맥도날드", "한국맥도날드", "McDonald"],
    "버거킹": ["버거킹", "BURGER KING"],
    "롯데리아": ["롯데리아"],
    "맘스터치": ["맘스터치", "맘스 터치"],
    "노브랜드버거": ["노브랜드버거", "노브랜드 버거"],
    "써브웨이": ["써브웨이", "서브웨이", "SUBWAY"],
    "교촌치킨": ["교촌치킨", "교촌", "교촌 치킨"],
    "굽네치킨": ["굽네치킨", "굽네", "굽네 치킨"],
    "도미노피자": ["도미노피자", "도미노", "도미노 피자"],
    "파리바게뜨": ["파리바게뜨", "파리바게트"],
    "뚜레쥬르": ["뚜레쥬르", "뚜레주르"],
    "배스킨라빈스": ["배스킨라빈스", "베스킨라빈스"],
    "던킨": ["던킨", "던킨도너츠"],
    "설빙": ["설빙"],
    "올리브영": ["올리브영", "씨제이올리브영"],
    "다이소": ["다이소", "아성다이소"],
    "이마트24": ["이마트24", "이마트 24"],
    "세븐일레븐": ["세븐일레븐", "7-ELEVEN", "7-Eleven"],
    "미니스톱": ["미니스톱"],
    "KFC": ["KFC", "케이에프씨"],
    "BBQ": ["BBQ", "비비큐"],
    "BHC": ["BHC", "비에이치씨"],
    "CU": ["CU", "씨유"],
    "GS25": ["GS25", "지에스25"],
    "스타벅스": ["스타벅스", "스벅"],
}


def main() -> int:
    conn = psycopg2.connect(db_url(), connect_timeout=20)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '5s'")
    cur.execute("SET enable_seqscan = off")

    def seq_scans() -> int:
        cur.execute("SELECT pg_stat_clear_snapshot()")
        cur.execute("SELECT seq_scan FROM pg_stat_user_tables WHERE relid = 'public.sangga_places'::regclass")
        return int(cur.fetchone()[0])

    before = seq_scans()
    cur.execute(
        "EXPLAIN SELECT name FROM public.sangga_places WHERE name ~>=~ %s AND name ~<~ %s LIMIT %s",
        ("빽다방", "빽다방" + HI, CAP),
    )
    plan = "\n".join(r[0] for r in cur.fetchall())

    out: dict[str, list[dict]] = {}
    for typed, spellings in CANDIDATES.items():
        rows = []
        for p in spellings:
            cur.execute(
                """
                SELECT t.name, count(*) FROM (
                  SELECT s.name FROM public.sangga_places s
                  WHERE s.name ~>=~ %s AND s.name ~<~ %s
                  LIMIT %s
                ) t GROUP BY t.name ORDER BY 2 DESC, 1 LIMIT 4
                """,
                (p, p + HI, CAP),
            )
            top = cur.fetchall()
            rows.append({"prefix": p, "n": sum(c for _, c in top), "top": [[n, c] for n, c in top]})
        out[typed] = rows

    after = seq_scans()
    result = {
        "cap": CAP,
        "planUsesNameBtree": "sangga_places_name_btree" in plan,
        "seqScanBefore": before,
        "seqScanAfter": after,
        "probes": out,
    }
    dest = ROOT / "e2e/artifacts/d2/chain-alias-probe.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("planUsesNameBtree", "seqScanBefore", "seqScanAfter")}))
    for typed, rows in out.items():
        print(typed)
        for r in rows:
            print(f"  {r['prefix']!r:>16} top4={r['n']:>5}  {r['top']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
