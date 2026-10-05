#!/usr/bin/env python3
"""인허가 폐업 확정 + poi.closed_at 적용 스크립트.

기본 dry-run (SELECT만). --apply 일 때만 UPDATE.
롤백: --rollback BACKUP_JSON

원본은 scripts/localdata/raw_closed_check/ 재사용 (재다운로드 없음).
detect_closed.py 의 키/버퍼 로직을 재사용.

승계 판정은 모든 인허가 파일을 합쳐 비교(업종 전환 포함).

  scripts/localdata/.venv/bin/python scripts/localdata/apply_closed.py
  scripts/localdata/.venv/bin/python scripts/localdata/apply_closed.py --apply
  scripts/localdata/.venv/bin/python scripts/localdata/apply_closed.py --rollback out/closed_apply_backup_....json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_batch

from detect_closed import (
    LOCALDATA_SOURCES,
    RAW_CHECK,
    _buffer_row,
    month_bucket,
    remap_download_specs,
)
from poi_match import contains_norm, rough_name_similarity
from prepare import OUT_DIR, assign_localdata_keys, db_url, open_csv

BATCH = 200
SUCCESSOR_DIST_M = 30.0
HIGH_NAME_SIM = 90.0  # poiMatch simGe90OrExact
PERMIT_WINDOW_DAYS = 90

# 도로명(+로/길/거리) + 건물번호 (apply_sangga_rematch 와 동일 패턴)
_ROAD_BN = re.compile(
    r"([0-9A-Za-z가-힣]+(?:로|길|거리))\s*([0-9]+(?:-[0-9]+)?)\s*$"
)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def road_building_key(addr: str | None) -> tuple[str, str] | None:
    s = (addr or "").strip()
    if not s:
        return None
    s = s.split(",")[0].split("(")[0].strip()
    m = _ROAD_BN.search(s)
    if not m:
        return None
    return m.group(1), m.group(2)


def si_gu_label(addr: str | None) -> str:
    """보고용: 시·구까지만 (상세 주소 제외)."""
    parts = (addr or "").replace(",", " ").split()
    if not parts:
        return ""
    picked: list[str] = []
    for p in parts:
        picked.append(p)
        if len(picked) >= 2 and p.endswith(("구", "군", "시")):
            break
        if len(picked) >= 3:
            break
    return " ".join(picked[:2])


def parse_lat_lng(lat_s: str, lng_s: str) -> tuple[float, float] | None:
    if not lat_s or not lng_s:
        return None
    try:
        return float(lat_s), float(lng_s)
    except ValueError:
        return None


def parse_ymd(raw: str) -> date | None:
    s = (raw or "").strip()
    if not s:
        return None
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) >= 8:
        try:
            return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
        except ValueError:
            return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
        except ValueError:
            return None
    return None


def parse_closed_date(closed_date: str, data_updated: str) -> str | None:
    """YYYY-MM-DD 문자열. 폐업일자 없으면 데이터갱신시점 날짜."""
    d = parse_ymd(closed_date) or parse_ymd(data_updated)
    return d.isoformat() if d else None


def within_permit_window(closed_date: str, permit_date: str, days: int = PERMIT_WINDOW_DAYS) -> bool:
    """폐업일·인허가일 모두 파싱 가능하고 |delta| <= days 이면 True.
    날짜 파싱 실패 시 False (90일 필터 적용 시 승계 불인정).
    """
    c = parse_ymd(closed_date)
    p = parse_ymd(permit_date)
    if c is None or p is None:
        return False
    return abs((p - c).days) <= days


def name_related(closed_norm: str, open_norm: str, closed_name: str, open_name: str) -> tuple[bool, str]:
    """주소 동일 경로용 이름 관련성. 애매하면 False(폐업 쪽)."""
    a = (closed_norm or "").strip()
    b = (open_norm or "").strip()
    if a and b and a == b:
        return True, "name_eq"
    if a and b and len(a) >= 2 and len(b) >= 2 and contains_norm(a, b):
        return True, "name_contain"
    sim = rough_name_similarity(a, b)
    if sim >= HIGH_NAME_SIM:
        return True, "name_sim90"
    # display soft path also via rough on raw names if norms weak
    if closed_name and open_name:
        sim2 = rough_name_similarity(
            re.sub(r"\s+", "", closed_name.lower()),
            re.sub(r"\s+", "", open_name.lower()),
        )
        if sim2 >= HIGH_NAME_SIM:
            return True, "name_sim90"
    return False, ""


def open_row_from_item(item: dict, key: str, source: str) -> dict:
    return {
        "key": key,
        "source": source,
        "road_address": item.get("road_address") or "",
        "lat": item.get("lat") or "",
        "lng": item.get("lng") or "",
        "name": item.get("name") or "",
        "name_norm": item.get("name_norm") or "",
        "permit_date": item.get("_permit_date") or "",
    }


def build_enriched_index(spec: dict) -> tuple[dict[str, dict], list[dict], dict]:
    """source_key → row meta; open_rows list for global successor index."""
    path: Path = spec["path"]
    group = spec["group"]
    source = spec["source"]
    open_buf: list[dict] = []
    closed_buf: list[dict] = []
    status_all: Counter = Counter()
    max_upd: str | None = None
    raw_n = 0

    if not path.is_file():
        raise FileNotFoundError(f"raw missing (재다운로드 금지): {path}")

    with open_csv(path) as f:
        for row in csv.DictReader(f):
            raw_n += 1
            upd = (row.get("데이터갱신시점") or "").strip()
            if upd and (max_upd is None or upd > max_upd):
                max_upd = upd
            st = (row.get("영업상태명") or "").strip() or "(empty)"
            status_all[st] += 1

            o = _buffer_row(spec, row, for_open_filters=True)
            if o is not None:
                open_buf.append(o)
                continue
            c = _buffer_row(spec, row, for_open_filters=False)
            if c is not None:
                closed_buf.append(c)

    if group in ("a_hotel", "c"):
        combined = open_buf + closed_buf
        keys = assign_localdata_keys(combined)
        keyed_items = list(zip(combined, keys))
    else:
        keyed_items = [(r, r["_mgmt"]) for r in (open_buf + closed_buf)]

    by_key: dict[str, dict] = {}
    open_rows: list[dict] = []

    for item, key in keyed_items:
        if not key:
            continue
        st = item["_status"]
        entry = {
            "status": st,
            "closed_date": item.get("_closed_date") or "",
            "permit_date": item.get("_permit_date") or "",
            "name": item["name"],
            "name_norm": item["name_norm"],
            "road_address": item.get("road_address") or "",
            "lat": item.get("lat") or "",
            "lng": item.get("lng") or "",
            "data_updated": item.get("data_updated") or "",
            "key": key,
            "source": source,
        }
        if st == "영업/정상":
            open_rows.append(open_row_from_item(item, key, source))
        prev = by_key.get(key)
        if prev is None or (prev["status"] == "영업/정상" and st != "영업/정상"):
            by_key[key] = entry

    meta = {
        "raw_rows": raw_n,
        "open_buffered": len(open_buf),
        "closed_buffered": len(closed_buf),
        "keys_indexed": len(by_key),
        "status_all_raw": dict(status_all),
        "max_data_updated": max_upd,
    }
    return by_key, open_rows, meta


def build_global_open_indexes(
    open_rows: list[dict],
) -> tuple[dict[tuple[str, str], list[dict]], dict[str, list[dict]]]:
    by_addr: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for r in open_rows:
        rk = road_building_key(r.get("road_address"))
        if rk:
            by_addr[rk].append(r)
        nn = (r.get("name_norm") or "").strip()
        if nn:
            by_norm[nn].append(r)
    return by_addr, by_norm


def find_successor(
    closed: dict,
    open_by_addr: dict[tuple[str, str], list[dict]],
    open_by_norm: dict[str, list[dict]],
) -> tuple[dict | None, str | None]:
    """Cross-source successor.

    Rules (오탐 방지 우선):
      A) 도로명+건물번호 동일 AND (name_eq | name_contain | name_sim>=90)
      B) name_norm 동일 AND 30m 이내
    """
    closed_source = closed.get("source") or ""
    closed_key = closed.get("key") or ""
    ck = road_building_key(closed.get("road_address"))
    cll = parse_lat_lng(closed.get("lat") or "", closed.get("lng") or "")
    cnn = (closed.get("name_norm") or "").strip()
    cname = closed.get("name") or ""

    def same_row(c: dict) -> bool:
        return c.get("source") == closed_source and c.get("key") == closed_key

    # A) address + name related
    if ck:
        for c in open_by_addr.get(ck, []):
            if same_row(c):
                continue
            ok, how = name_related(cnn, c.get("name_norm") or "", cname, c.get("name") or "")
            if ok:
                return c, f"addr_{how}"

    # B) same name_norm + 30m
    if cnn and cll:
        for c in open_by_norm.get(cnn, []):
            if same_row(c):
                continue
            oll = parse_lat_lng(c.get("lat") or "", c.get("lng") or "")
            if not oll:
                continue
            if haversine_m(cll[0], cll[1], oll[0], oll[1]) <= SUCCESSOR_DIST_M:
                return c, "dist_30m_name_eq"

    return None, None


def column_exists(conn, table: str, column: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND column_name = %s
            LIMIT 1
            """,
            (table, column),
        )
        return cur.fetchone() is not None


def load_pois(conn, source: str, *, with_closed_at: bool) -> list[dict]:
    cols = "id, source_key, name, road_address, jibun_address"
    if with_closed_at:
        cols += ", closed_at"
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT {cols}
            FROM public.poi
            WHERE source = %s
              AND source_key IS NOT NULL
              AND btrim(source_key) <> ''
            """,
            (source,),
        )
        return [dict(r) for r in cur.fetchall()]


def load_places_for_poi_ids(conn, poi_ids: list[int]) -> list[dict]:
    if not poi_ids:
        return []
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, user_id, name, address, poi_id
            FROM public.places
            WHERE poi_id = ANY(%s)
            """,
            (poi_ids,),
        )
        return [dict(r) for r in cur.fetchall()]


def inspect_poi_column_impact(conn) -> dict:
    """SELECT-only catalog check for adding poi.closed_at."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
              p.proname AS name,
              pg_get_function_result(p.oid) AS result_type,
              CASE
                WHEN pg_get_function_result(p.oid) ILIKE 'SETOF%poi%'
                  OR pg_get_function_result(p.oid) ILIKE 'poi'
                  THEN 'setof_or_poi'
                WHEN pg_get_function_result(p.oid) ILIKE 'TABLE%'
                  THEN 'returns_table'
                ELSE 'other'
              END AS result_kind,
              (
                pg_get_functiondef(p.oid) ~* 'select[[:space:]]+\\*'
                OR pg_get_functiondef(p.oid) ~* 'poi\\.\\*'
              ) AS has_select_star_or_poi_star
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.prokind = 'f'
              AND pg_get_functiondef(p.oid) ~* '\\mpoi\\M'
            ORDER BY p.proname
            """
        )
        functions = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT c.relname AS name, c.relkind
            FROM pg_rewrite r
            JOIN pg_class c ON c.oid = r.ev_class
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_depend d ON d.objid = r.oid
            JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_namespace tn ON tn.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND tn.nspname = 'public'
              AND t.relname = 'poi'
              AND c.relkind IN ('v', 'm')
            GROUP BY c.relname, c.relkind
            ORDER BY c.relname
            """
        )
        views = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT tgname AS name, tgrelid::regclass::text AS on_table
            FROM pg_trigger
            WHERE NOT tgisinternal
              AND (
                tgrelid = 'public.poi'::regclass
                OR pg_get_triggerdef(oid) ~* '\\mpoi\\M'
              )
            ORDER BY tgname
            """
        )
        triggers = [dict(r) for r in cur.fetchall()]

    risky = [
        f["name"]
        for f in functions
        if f.get("has_select_star_or_poi_star")
        and f.get("result_kind") in ("setof_or_poi", "returns_table")
    ]
    nearby = [f for f in functions if f["name"] in ("nearby_poi", "nearby_poi_batch")]

    return {
        "functions": [
            {
                "name": f["name"],
                "result_kind": f["result_kind"],
                "result_type": f["result_type"],
                "has_select_star_or_poi_star": bool(f["has_select_star_or_poi_star"]),
            }
            for f in functions
        ],
        "views": [v["name"] for v in views],
        "triggers": [{"name": t["name"], "on_table": t["on_table"]} for t in triggers],
        "risky_star_functions": risky,
        "nearby_poi": [
            {
                "name": f["name"],
                "result_kind": f["result_kind"],
                "has_select_star_or_poi_star": bool(f["has_select_star_or_poi_star"]),
            }
            for f in nearby
        ],
    }


def backup_path() -> Path:
    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d_%H%M%S")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUT_DIR / f"closed_apply_backup_{stamp}.json"


def do_apply(
    conn,
    set_rows: list[dict],
    clear_ids: list[int],
    bak_path: Path,
) -> None:
    if not column_exists(conn, "poi", "closed_at"):
        print("closed_at 컬럼 없음", flush=True)
        sys.exit(2)

    ids = [int(r["poi_id"]) for r in set_rows] + [int(i) for i in clear_ids]
    ids = sorted(set(ids))
    if not ids:
        print("nothing to apply", flush=True)
        return

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, closed_at
            FROM public.poi
            WHERE id = ANY(%s)
            """,
            (ids,),
        )
        prev = {int(r["id"]): r.get("closed_at") for r in cur.fetchall()}

    backup_rows = []
    for pid in ids:
        v = prev.get(pid)
        backup_rows.append(
            {
                "id": pid,
                "closed_at": v.isoformat() if isinstance(v, (date, datetime)) else v,
            }
        )
    bak_path.write_text(
        json.dumps(
            {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "n": len(backup_rows),
                "rows": backup_rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"  backup wrote {bak_path} n={len(backup_rows):,}", flush=True)

    t0 = time.time()
    with conn.cursor() as cur:
        for i in range(0, len(set_rows), BATCH):
            chunk = set_rows[i : i + BATCH]
            execute_batch(
                cur,
                """
                UPDATE public.poi
                SET closed_at = %(closed_at)s
                WHERE id = %(poi_id)s
                """,
                [
                    {
                        "poi_id": int(r["poi_id"]),
                        "closed_at": r["closed_at"],
                    }
                    for r in chunk
                ],
                page_size=BATCH,
            )
            conn.commit()
            done = min(i + BATCH, len(set_rows))
            print(
                f"  set closed_at {done:,}/{len(set_rows):,} [{time.time()-t0:.0f}s]",
                flush=True,
            )

        for i in range(0, len(clear_ids), BATCH):
            chunk = clear_ids[i : i + BATCH]
            execute_batch(
                cur,
                """
                UPDATE public.poi
                SET closed_at = NULL
                WHERE id = %(poi_id)s
                """,
                [{"poi_id": int(pid)} for pid in chunk],
                page_size=BATCH,
            )
            conn.commit()
            done = min(i + BATCH, len(clear_ids))
            print(
                f"  clear closed_at {done:,}/{len(clear_ids):,} [{time.time()-t0:.0f}s]",
                flush=True,
            )

    print(
        f"DONE set={len(set_rows):,} clear={len(clear_ids):,}",
        flush=True,
    )


def do_rollback(conn, bak_path: Path) -> None:
    if not column_exists(conn, "poi", "closed_at"):
        print("closed_at 컬럼 없음", flush=True)
        sys.exit(2)
    data = json.loads(bak_path.read_text(encoding="utf-8"))
    rows = data.get("rows") or []
    print(f"=== rollback from {bak_path.name} n={len(rows):,} ===", flush=True)
    t0 = time.time()
    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH):
            chunk = rows[i : i + BATCH]
            execute_batch(
                cur,
                """
                UPDATE public.poi
                SET closed_at = %(closed_at)s
                WHERE id = %(id)s
                """,
                chunk,
                page_size=BATCH,
            )
            conn.commit()
            done = min(i + BATCH, len(rows))
            print(
                f"  rollback {done:,}/{len(rows):,} [{time.time()-t0:.0f}s]",
                flush=True,
            )
    print("DONE rollback", flush=True)


def classify_all(conn, *, with_closed_at: bool) -> dict:
    specs = remap_download_specs()
    for spec in specs:
        if not Path(spec["path"]).is_file():
            raise FileNotFoundError(
                f"raw_closed_check 원본 없음 (재다운로드 금지): {spec['path']}"
            )

    print(
        "  successor_scope=ALL_LOCALDATA_FILES (cross-source; was same-source-only)",
        flush=True,
    )

    by_key_by_source: dict[str, dict[str, dict]] = {}
    all_open_rows: list[dict] = []
    meta_by_source: dict[str, dict] = {}

    for spec in specs:
        source = spec["source"]
        print(f"  indexing {source} …", flush=True)
        by_key, open_rows, meta = build_enriched_index(spec)
        by_key_by_source[source] = by_key
        all_open_rows.extend(open_rows)
        meta_by_source[source] = meta
        print(
            f"    keys={len(by_key):,} open_rows={len(open_rows):,}",
            flush=True,
        )

    open_by_addr, open_by_norm = build_global_open_indexes(all_open_rows)
    print(
        f"  global open index: by_addr={len(open_by_addr):,} "
        f"by_norm={len(open_by_norm):,} open_total={len(all_open_rows):,}",
        flush=True,
    )

    by_source_counts: dict[str, dict] = {}
    not_open_rows: list[dict] = []
    confirmed: list[dict] = []
    successor_excluded: list[dict] = []
    other_excluded: list[dict] = []
    clear_candidates: list[dict] = []
    succ_rule_counts: Counter = Counter()
    succ_cross_source_n = 0
    succ_with_90d = 0
    succ_without_90d = 0
    succ_90d_unknown_date = 0

    for spec in specs:
        source = spec["source"]
        by_key = by_key_by_source[source]
        pois = load_pois(conn, source, with_closed_at=with_closed_at)

        c_confirmed = c_succ = c_other = 0
        status_of_not_open: Counter = Counter()

        for p in pois:
            sk = (p["source_key"] or "").strip()
            hit = by_key.get(sk)
            if hit is None:
                continue
            st = hit["status"]

            if with_closed_at and p.get("closed_at") is not None and st == "영업/정상":
                clear_candidates.append(
                    {
                        "poi_id": int(p["id"]),
                        "source": source,
                        "source_key": sk,
                    }
                )

            if st == "영업/정상":
                continue

            status_of_not_open[st] += 1
            base = {
                "poi_id": int(p["id"]),
                "source": source,
                "source_key": sk,
                "status": st,
                "closed_date": hit.get("closed_date") or "",
                "data_updated": hit.get("data_updated") or "",
                "name": hit.get("name") or p.get("name") or "",
                "name_norm": hit.get("name_norm") or "",
                "road_address": hit.get("road_address") or "",
                "lat": hit.get("lat") or "",
                "lng": hit.get("lng") or "",
                "key": sk,
            }
            not_open_rows.append(
                {
                    "poi_id": base["poi_id"],
                    "source": source,
                    "source_key": sk,
                    "status": st,
                    "closed_date": base["closed_date"],
                }
            )

            if st != "폐업":
                other_excluded.append(
                    {
                        "poi_id": base["poi_id"],
                        "source": source,
                        "source_key": sk,
                        "status": st,
                        "closed_date": base["closed_date"],
                        "class": "other_exclude",
                    }
                )
                c_other += 1
                continue

            succ, rule = find_successor(base, open_by_addr, open_by_norm)
            if succ is not None and rule is not None:
                succ_without_90d += 1
                in_window = within_permit_window(
                    base["closed_date"], succ.get("permit_date") or ""
                )
                if in_window:
                    succ_with_90d += 1
                else:
                    # date missing or outside window
                    if parse_ymd(base["closed_date"]) is None or parse_ymd(
                        succ.get("permit_date") or ""
                    ) is None:
                        succ_90d_unknown_date += 1

                if (succ.get("source") or "") != source:
                    succ_cross_source_n += 1
                succ_rule_counts[rule] += 1
                successor_excluded.append(
                    {
                        "poi_id": base["poi_id"],
                        "source": source,
                        "source_key": sk,
                        "status": st,
                        "closed_date": base["closed_date"],
                        "class": "successor_exclude",
                        "successor_rule": rule,
                        "successor_source_key": succ["key"],
                        "successor_source": succ.get("source") or "",
                        "successor_permit_date": succ.get("permit_date") or "",
                        "within_90d": in_window,
                    }
                )
                c_succ += 1
            else:
                closed_at = parse_closed_date(
                    base["closed_date"], base["data_updated"]
                )
                confirmed.append(
                    {
                        "poi_id": base["poi_id"],
                        "source": source,
                        "source_key": sk,
                        "status": st,
                        "closed_date": base["closed_date"],
                        "closed_at": closed_at,
                        "class": "confirmed",
                    }
                )
                c_confirmed += 1

        by_source_counts[source] = {
            "not_open_n": c_confirmed + c_succ + c_other,
            "confirmed_n": c_confirmed,
            "successor_exclude_n": c_succ,
            "other_exclude_n": c_other,
            "status_of_not_open": dict(status_of_not_open),
            "raw_max_data_updated": meta_by_source[source].get("max_data_updated"),
        }
        print(
            f"    classify {source}: not_open={c_confirmed + c_succ + c_other:,} "
            f"confirmed={c_confirmed:,} successor={c_succ:,} other={c_other:,}",
            flush=True,
        )

    return {
        "by_source": by_source_counts,
        "not_open_rows": not_open_rows,
        "confirmed": confirmed,
        "successor_excluded": successor_excluded,
        "other_excluded": other_excluded,
        "clear_candidates": clear_candidates,
        "succ_rule_counts": dict(succ_rule_counts),
        "succ_cross_source_n": succ_cross_source_n,
        "succ_without_90d_n": succ_without_90d,
        "succ_with_90d_n": succ_with_90d,
        "succ_90d_unknown_date_n": succ_90d_unknown_date,
        "successor_scope": "all_localdata_files",
    }


def load_prev_dryrun() -> dict | None:
    files = sorted(OUT_DIR.glob("closed_apply_dryrun_*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply",
        action="store_true",
        help="실제로 poi.closed_at UPDATE (기본은 dry-run)",
    )
    ap.add_argument(
        "--rollback",
        type=str,
        default=None,
        help="backup JSON 경로로 롤백",
    )
    args = ap.parse_args()

    if args.rollback:
        conn = psycopg2.connect(db_url(), connect_timeout=60)
        try:
            do_rollback(conn, Path(args.rollback))
        finally:
            conn.close()
        return 0

    t0 = time.time()
    if not RAW_CHECK.is_dir():
        print(f"raw_closed_check 없음: {RAW_CHECK}", flush=True)
        return 1

    print("=== apply_closed dry-run (no download, cross-source successor) ===", flush=True)
    prev_report = load_prev_dryrun()
    prev_succ_pois = set()
    prev_conf_pois = set()
    if prev_report:
        prev_succ_pois = {int(r["poi_id"]) for r in prev_report.get("successor_excluded", [])}
        prev_conf_pois = {int(r["poi_id"]) for r in prev_report.get("confirmed", [])}
        print(
            f"  prev dryrun: confirmed={prev_report.get('confirmed_n')} "
            f"successor={prev_report.get('successor_exclude_n')} "
            f"other={prev_report.get('other_exclude_n')}",
            flush=True,
        )

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)

    try:
        has_closed_at = column_exists(conn, "poi", "closed_at")
        print(f"  poi.closed_at column={'yes' if has_closed_at else 'no'}", flush=True)

        print("\n=== catalog impact (closed_at ADD COLUMN) ===", flush=True)
        impact = inspect_poi_column_impact(conn)
        print(f"  functions_ref_poi={len(impact['functions'])}", flush=True)
        for f in impact["functions"]:
            print(
                f"    fn {f['name']} kind={f['result_kind']} "
                f"star={f['has_select_star_or_poi_star']}",
                flush=True,
            )
        print(f"  views={impact['views']}", flush=True)
        print(f"  triggers={impact['triggers']}", flush=True)
        print(f"  nearby={impact['nearby_poi']}", flush=True)
        print(f"  risky_star_fns={impact['risky_star_functions']}", flush=True)

        result = classify_all(conn, with_closed_at=has_closed_at)

        confirmed = result["confirmed"]
        successor_excluded = result["successor_excluded"]
        other_excluded = result["other_excluded"]
        not_open_n = len(result["not_open_rows"])

        not_open_ids = [r["poi_id"] for r in result["not_open_rows"]]
        places = load_places_for_poi_ids(conn, not_open_ids)
        class_by_poi = {}
        for r in confirmed:
            class_by_poi[r["poi_id"]] = ("confirmed", r)
        for r in successor_excluded:
            class_by_poi[r["poi_id"]] = ("successor_exclude", r)
        for r in other_excluded:
            class_by_poi[r["poi_id"]] = ("other_exclude", r)

        place_confirmed = []
        place_successor = []
        place_other = []
        newly_successor_places = []
        for pl in places:
            pid = int(pl["poi_id"])
            cls, meta = class_by_poi.get(pid, ("other_exclude", {}))
            row = {
                "place_id": str(pl["id"]),
                "user_id": str(pl["user_id"]) if pl.get("user_id") is not None else None,
                "name": (pl.get("name") or "").strip(),
                "si_gu": si_gu_label(pl.get("address")),
                "poi_id": pid,
                "class": cls,
                "closed_month": month_bucket(meta.get("closed_date") or "")
                if cls == "confirmed"
                else "",
                "successor_rule": meta.get("successor_rule") or "",
                "successor_source": meta.get("successor_source") or "",
            }
            if cls == "confirmed":
                place_confirmed.append(row)
            elif cls == "successor_exclude":
                place_successor.append(row)
                if pid in prev_conf_pois and pid not in prev_succ_pois:
                    newly_successor_places.append(row)
            else:
                place_other.append(row)

        users_confirmed = {
            r["user_id"] for r in place_confirmed if r.get("user_id") is not None
        }

        # dedupe confirmed places by name for report
        confirmed_by_name: dict[str, dict] = {}
        for r in place_confirmed:
            nm = r["name"] or "(empty)"
            if nm not in confirmed_by_name:
                confirmed_by_name[nm] = {
                    "name": r["name"],
                    "si_gu": r["si_gu"],
                    "closed_month": r["closed_month"],
                    "n": 1,
                }
            else:
                confirmed_by_name[nm]["n"] += 1

        elapsed = round(time.time() - t0, 1)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = OUT_DIR / f"closed_apply_dryrun_{stamp}.json"

        # If 90d filter were applied: successors outside window become confirmed
        succ_keep_90 = [r for r in successor_excluded if r.get("within_90d")]
        succ_drop_90 = [r for r in successor_excluded if not r.get("within_90d")]
        confirmed_if_90d = len(confirmed) + len(succ_drop_90)
        successor_if_90d = len(succ_keep_90)

        report = {
            "generated_at": stamp,
            "elapsed_s": elapsed,
            "has_closed_at_column": has_closed_at,
            "successor_scope": "all_localdata_files",
            "not_open_n": not_open_n,
            "confirmed_n": len(confirmed),
            "successor_exclude_n": len(successor_excluded),
            "other_exclude_n": len(other_excluded),
            "by_source": result["by_source"],
            "successor_rule_counts": result["succ_rule_counts"],
            "succ_cross_source_n": result["succ_cross_source_n"],
            "permit_window_days": PERMIT_WINDOW_DAYS,
            "successor_n_without_90d_filter": result["succ_without_90d_n"],
            "successor_n_with_90d_filter": result["succ_with_90d_n"],
            "successor_90d_unknown_date_n": result["succ_90d_unknown_date_n"],
            "confirmed_n_if_90d_filter": confirmed_if_90d,
            "successor_n_if_90d_filter": successor_if_90d,
            "places_linked_n": len(places),
            "places_confirmed_n": len(place_confirmed),
            "places_successor_n": len(place_successor),
            "places_other_n": len(place_other),
            "users_with_confirmed_closed_place_n": len(users_confirmed),
            "newly_successor_places": [
                {"name": r["name"], "si_gu": r["si_gu"], "poi_id": r["poi_id"]}
                for r in newly_successor_places
            ],
            "clear_candidates_n": len(result["clear_candidates"]),
            "catalog_impact": {
                "functions": [
                    {
                        "name": f["name"],
                        "result_kind": f["result_kind"],
                        "has_select_star_or_poi_star": f["has_select_star_or_poi_star"],
                    }
                    for f in impact["functions"]
                ],
                "views": impact["views"],
                "triggers": [t["name"] for t in impact["triggers"]],
                "risky_star_functions": impact["risky_star_functions"],
                "nearby_poi": impact["nearby_poi"],
            },
            "confirmed": [
                {
                    "poi_id": r["poi_id"],
                    "source": r["source"],
                    "source_key": r["source_key"],
                    "status": r["status"],
                    "closed_date": r["closed_date"],
                    "closed_at": r["closed_at"],
                }
                for r in confirmed
            ],
            "successor_excluded": [
                {
                    "poi_id": r["poi_id"],
                    "source": r["source"],
                    "source_key": r["source_key"],
                    "status": r["status"],
                    "closed_date": r["closed_date"],
                    "successor_rule": r["successor_rule"],
                    "successor_source_key": r["successor_source_key"],
                    "successor_source": r["successor_source"],
                    "within_90d": r["within_90d"],
                }
                for r in successor_excluded
            ],
            "other_excluded": [
                {
                    "poi_id": r["poi_id"],
                    "source": r["source"],
                    "source_key": r["source_key"],
                    "status": r["status"],
                    "closed_date": r["closed_date"],
                }
                for r in other_excluded
            ],
            "clear_candidates": result["clear_candidates"],
        }
        out_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        print("\n========== CLOSED APPLY DRY-RUN ==========", flush=True)
        print(
            "1a. previous successor scope: same source file only; "
            "now: all localdata files combined",
            flush=True,
        )
        print(
            f"\n(a) TOTAL confirmed={len(confirmed):,} "
            f"successor={len(successor_excluded):,} "
            f"other={len(other_excluded):,} "
            f"(prev 9631 / 751 / 12)",
            flush=True,
        )
        for src in LOCALDATA_SOURCES:
            m = result["by_source"].get(src) or {}
            print(
                f"  {src}: confirmed={m.get('confirmed_n', 0):,} "
                f"successor={m.get('successor_exclude_n', 0):,} "
                f"other={m.get('other_exclude_n', 0):,}",
                flush=True,
            )
        print(
            f"  cross_source_successor={result['succ_cross_source_n']:,}",
            flush=True,
        )
        print(f"  rules={dict(result['succ_rule_counts'])}", flush=True)

        print(
            f"\n(b) places linked={len(places):,} "
            f"confirmed={len(place_confirmed):,} "
            f"successor={len(place_successor):,} "
            f"other={len(place_other):,} "
            f"users_confirmed={len(users_confirmed):,} "
            f"(prev places 53 / 4 / 0)",
            flush=True,
        )

        print("\n(c) newly successor-excluded saved places:", flush=True)
        if not newly_successor_places:
            print("  (none)", flush=True)
        for r in newly_successor_places:
            print(f"  {r['name']} | {r['si_gu']}", flush=True)

        print("\n(d) confirmed saved places (deduped by name):", flush=True)
        for item in confirmed_by_name.values():
            extra = f" x{item['n']}" if item["n"] > 1 else ""
            print(
                f"  {item['name']} | {item['si_gu']} | {item['closed_month']}{extra}",
                flush=True,
            )

        print(
            f"\n(e) 90d filter: without={result['succ_without_90d_n']:,} "
            f"with={result['succ_with_90d_n']:,} "
            f"unknown_date={result['succ_90d_unknown_date_n']:,} "
            f"| if applied: confirmed={confirmed_if_90d:,} "
            f"successor={successor_if_90d:,}",
            flush=True,
        )
        print(f"\n(f) elapsed={elapsed}s", flush=True)
        print(f"wrote {out_path}", flush=True)

        # Safety conclusion for ALTER (no ALTER executed)
        star_risk = impact["risky_star_functions"]
        nearby_star = any(
            f.get("has_select_star_or_poi_star") for f in impact["nearby_poi"]
        )
        safe = (not star_risk) and (not nearby_star)
        print(
            f"\n=== ALTER closed_at safety: {'YES' if safe else 'NO'} "
            f"(risky_star={star_risk}, nearby_star={nearby_star}) ===",
            flush=True,
        )

        if args.apply:
            if not has_closed_at:
                print("closed_at 컬럼 없음", flush=True)
                return 2
            set_rows = [
                {"poi_id": r["poi_id"], "closed_at": r["closed_at"]}
                for r in confirmed
                if r.get("closed_at")
            ]
            clear_ids = [r["poi_id"] for r in result["clear_candidates"]]
            conn.close()
            conn = psycopg2.connect(db_url(), connect_timeout=60)
            do_apply(conn, set_rows, clear_ids, backup_path())
        else:
            print("\n(dry-run only — pass --apply to write)", flush=True)

    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
