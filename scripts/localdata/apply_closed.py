#!/usr/bin/env python3
"""인허가 폐업 확정 + poi.closed_at 적용 스크립트.

기본 dry-run (SELECT만). --apply 일 때만 UPDATE.
롤백: --rollback BACKUP_JSON

원본은 scripts/localdata/raw_closed_check/ 재사용 (재다운로드 없음).
detect_closed.py 의 키/버퍼 로직을 재사용.

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
from prepare import OUT_DIR, assign_localdata_keys, db_url, open_csv

BATCH = 200
SUCCESSOR_DIST_M = 30.0

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


def parse_closed_date(closed_date: str, data_updated: str) -> str | None:
    """YYYY-MM-DD 문자열. 폐업일자 없으면 데이터갱신시점 날짜."""
    s = (closed_date or "").strip()
    if s:
        digits = "".join(ch for ch in s if ch.isdigit())
        if len(digits) >= 8:
            return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return s[:10]
    u = (data_updated or "").strip()
    if u:
        digits = "".join(ch for ch in u if ch.isdigit())
        if len(digits) >= 8:
            return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
        if len(u) >= 10 and u[4] == "-" and u[7] == "-":
            return u[:10]
    return None


def build_enriched_index(spec: dict) -> tuple[dict[str, dict], dict[str, list[dict]], dict]:
    """source_key → row meta; open_by_norm → open candidates (for successor)."""
    path: Path = spec["path"]
    group = spec["group"]
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
    open_by_norm: dict[str, list[dict]] = defaultdict(list)

    for item, key in keyed_items:
        if not key:
            continue
        st = item["_status"]
        entry = {
            "status": st,
            "closed_date": item.get("_closed_date") or "",
            "name": item["name"],
            "name_norm": item["name_norm"],
            "road_address": item.get("road_address") or "",
            "lat": item.get("lat") or "",
            "lng": item.get("lng") or "",
            "data_updated": item.get("data_updated") or "",
            "key": key,
        }
        if st == "영업/정상":
            open_by_norm[item["name_norm"]].append(
                {
                    "key": key,
                    "road_address": entry["road_address"],
                    "lat": entry["lat"],
                    "lng": entry["lng"],
                    "name": entry["name"],
                }
            )
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
    return by_key, open_by_norm, meta


def find_successor(
    closed: dict, open_by_norm: dict[str, list[dict]]
) -> tuple[dict | None, str | None]:
    """Returns (successor_open_row, rule) where rule is 'address' | 'dist_30m'."""
    nn = closed.get("name_norm") or ""
    if not nn:
        return None, None
    candidates = open_by_norm.get(nn) or []
    closed_key = closed.get("key") or ""
    ck = road_building_key(closed.get("road_address"))
    cll = parse_lat_lng(closed.get("lat") or "", closed.get("lng") or "")

    addr_hit: dict | None = None
    dist_hit: dict | None = None

    for c in candidates:
        if c["key"] == closed_key:
            continue
        ok = road_building_key(c.get("road_address"))
        if ck and ok and ck == ok:
            addr_hit = c
            break
        if cll and not dist_hit:
            oll = parse_lat_lng(c.get("lat") or "", c.get("lng") or "")
            if oll and haversine_m(cll[0], cll[1], oll[0], oll[1]) <= SUCCESSOR_DIST_M:
                dist_hit = c

    if addr_hit is not None:
        return addr_hit, "address"
    if dist_hit is not None:
        return dist_hit, "dist_30m"
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

    by_source_counts: dict[str, dict] = {}
    not_open_rows: list[dict] = []  # all found & status != 영업/정상
    confirmed: list[dict] = []
    successor_excluded: list[dict] = []
    other_excluded: list[dict] = []
    clear_candidates: list[dict] = []
    succ_rule_counts = Counter()

    for spec in specs:
        source = spec["source"]
        print(f"  indexing {source} …", flush=True)
        by_key, open_by_norm, meta = build_enriched_index(spec)
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

            # found & not open → part of the ~10,394 set
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

            succ, rule = find_successor(base, open_by_norm)
            if succ is not None and rule is not None:
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
            "raw_max_data_updated": meta.get("max_data_updated"),
        }
        print(
            f"    not_open={c_confirmed + c_succ + c_other:,} "
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
    }


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

    print("=== apply_closed dry-run (no download) ===", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    # dry-run always readonly; --apply reconnects writable later
    conn.set_session(readonly=True, autocommit=True)

    try:
        has_closed_at = column_exists(conn, "poi", "closed_at")
        print(f"  poi.closed_at column={'yes' if has_closed_at else 'no'}", flush=True)

        result = classify_all(conn, with_closed_at=has_closed_at)

        confirmed = result["confirmed"]
        successor_excluded = result["successor_excluded"]
        other_excluded = result["other_excluded"]
        not_open_n = len(result["not_open_rows"])

        # places linked to previous not-open set
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
            }
            if cls == "confirmed":
                place_confirmed.append(row)
            elif cls == "successor_exclude":
                place_successor.append(row)
            else:
                place_other.append(row)

        users_confirmed = {
            r["user_id"] for r in place_confirmed if r.get("user_id") is not None
        }

        elapsed = round(time.time() - t0, 1)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = OUT_DIR / f"closed_apply_dryrun_{stamp}.json"

        # JSON: ids/keys/status/dates/successor only — no address/coords/phone
        report = {
            "generated_at": stamp,
            "elapsed_s": elapsed,
            "has_closed_at_column": has_closed_at,
            "not_open_n": not_open_n,
            "confirmed_n": len(confirmed),
            "successor_exclude_n": len(successor_excluded),
            "other_exclude_n": len(other_excluded),
            "by_source": result["by_source"],
            "successor_rule_counts": result["succ_rule_counts"],
            "places_linked_n": len(places),
            "places_confirmed_n": len(place_confirmed),
            "places_successor_n": len(place_successor),
            "places_other_n": len(place_other),
            "users_with_confirmed_closed_place_n": len(users_confirmed),
            "clear_candidates_n": len(result["clear_candidates"]),
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

        # --- console report (시·구 only for place samples) ---
        print("\n========== CLOSED APPLY DRY-RUN ==========", flush=True)
        print(f"(a) not_open total={not_open_n:,}", flush=True)
        for src in LOCALDATA_SOURCES:
            m = result["by_source"].get(src) or {}
            print(
                f"  {src}: confirmed={m.get('confirmed_n', 0):,} "
                f"successor={m.get('successor_exclude_n', 0):,} "
                f"other={m.get('other_exclude_n', 0):,} "
                f"(not_open={m.get('not_open_n', 0):,}) "
                f"status={m.get('status_of_not_open')}",
                flush=True,
            )
        print(
            f"  TOTAL confirmed={len(confirmed):,} "
            f"successor={len(successor_excluded):,} "
            f"other={len(other_excluded):,}",
            flush=True,
        )

        print(
            f"\n(b) places linked={len(places):,} "
            f"confirmed={len(place_confirmed):,} "
            f"successor={len(place_successor):,} "
            f"other={len(place_other):,} "
            f"users_confirmed={len(users_confirmed):,}",
            flush=True,
        )

        print("\n(c) confirmed place samples (max 15):", flush=True)
        for r in place_confirmed[:15]:
            print(
                f"  {r['name']} | {r['si_gu']} | {r['closed_month']}",
                flush=True,
            )

        print("\n(d) successor-excluded place samples (max 10):", flush=True)
        if not place_successor:
            print("  (none)", flush=True)
        for r in place_successor[:10]:
            print(
                f"  {r['name']} | {r['si_gu']} | rule={r['successor_rule']}",
                flush=True,
            )

        addr_n = result["succ_rule_counts"].get("address", 0)
        dist_n = result["succ_rule_counts"].get("dist_30m", 0)
        print(
            f"\n(e) successor rules: address={addr_n:,} dist_30m_only={dist_n:,}",
            flush=True,
        )
        print(f"\n(f) elapsed={elapsed}s", flush=True)
        print(f"wrote {out_path}", flush=True)
        print(f"clear_candidates (would NULL closed_at)={len(result['clear_candidates']):,}", flush=True)

        if args.apply:
            if not has_closed_at:
                print("closed_at 컬럼 없음", flush=True)
                return 2
            set_rows = [
                {"poi_id": r["poi_id"], "closed_at": r["closed_at"]}
                for r in confirmed
                if r.get("closed_at")
            ]
            missing_date = len(confirmed) - len(set_rows)
            if missing_date:
                print(
                    f"  warn: confirmed without parseable date skipped={missing_date}",
                    flush=True,
                )
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
