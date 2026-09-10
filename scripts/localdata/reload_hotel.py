#!/usr/bin/env python3
"""localdata_hotel 복구: 복합 source_key 로 재생성 후 hotel만 교체 적재.

원본: localdata/tourist_accommodations.csv (CP949, EPSG:5174)
원인: 관리번호 단독 키 → 영업/정상 3463건이 871로 붕괴
키: 관리번호 → 중복 시 관리번호|개방자치단체코드 → 그래도 충돌 시 내용 sha1
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

# reuse CRS + name_norm from prepare.py
from prepare import (
    LOCALDATA,
    OUT_DIR,
    convert_xy,
    map_category,
    name_norm,
    open_csv,
)

DB_URL_FILE = Path(__file__).resolve().parent / ".db_url"
HOTEL_CSV = LOCALDATA / "tourist_accommodations.csv"
BACKUP_PATH = OUT_DIR / "poi_hotel_backup.json"
LOAD_CSV = OUT_DIR / "poi_hotel_load.csv"
SOURCE = "localdata_hotel"
OTHER_SOURCES = (
    "localdata_general",
    "localdata_rest",
    "park",
    "museum",
    "market",
    "library",
    "tourspot",
)


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def sha1_32(payload: str) -> str:
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:32]


def build_hotel_keys(rows: list[dict]) -> tuple[list[str], dict]:
    """park 방식: 관리번호 → |개방자치단체코드 → content sha1 (행번호 금지)."""
    stats = {
        "mgmt_dup_keys": 0,
        "mgmt_rows_using_composite": 0,
        "mgmt_still_collided_hashed": 0,
        "empty_key": 0,
    }
    mgmt_counts: Counter[str] = Counter(
        (r["_mgmt"] or "").strip() for r in rows if (r.get("_mgmt") or "").strip()
    )
    stats["mgmt_dup_keys"] = sum(1 for _, n in mgmt_counts.items() if n > 1)

    provisional: list[str] = []
    for r in rows:
        m = (r.get("_mgmt") or "").strip()
        org = (r.get("_org") or "").strip()
        if not m:
            provisional.append("")
            continue
        if mgmt_counts[m] > 1:
            provisional.append(f"{m}|{org}")
            stats["mgmt_rows_using_composite"] += 1
        else:
            provisional.append(m)

    keys: list[str] = [""] * len(rows)
    groups: dict[str, list[int]] = defaultdict(list)
    for i, k in enumerate(provisional):
        if not k:
            keys[i] = ""
            stats["empty_key"] += 1
        else:
            groups[k].append(i)

    for k, idxs in groups.items():
        if len(idxs) == 1:
            keys[idxs[0]] = k
            continue
        for i in idxs:
            r = rows[i]
            payload = "|".join(
                [
                    k,
                    (r.get("name") or "").strip(),
                    (r.get("road_address") or "").strip(),
                    (r.get("jibun_address") or "").strip(),
                    r.get("lat") or "",
                    r.get("lng") or "",
                ]
            )
            keys[i] = sha1_32(payload)
            stats["mgmt_still_collided_hashed"] += 1
    return keys, stats


def analyze_raw() -> dict:
    if not HOTEL_CSV.exists():
        print(f"MISSING original CSV: {HOTEL_CSV}")
        print("재다운로드 필요. 중단.")
        sys.exit(2)

    with open_csv(HOTEL_CSV) as f:
        all_rows = list(csv.DictReader(f))

    total = len(all_rows)
    mgmt_c = Counter((r.get("관리번호") or "").strip() for r in all_rows)
    unique = sum(1 for k, n in mgmt_c.items() if k)
    dup_keys = sum(1 for k, n in mgmt_c.items() if k and n > 1)
    dup_rows = sum(n for k, n in mgmt_c.items() if k and n > 1)

    open_n = sum(1 for r in all_rows if r.get("영업상태명") == "영업/정상")
    open_mgmt = Counter(
        (r.get("관리번호") or "").strip()
        for r in all_rows
        if r.get("영업상태명") == "영업/정상"
    )
    open_unique = sum(1 for k, n in open_mgmt.items() if k)

    report = {
        "file": str(HOTEL_CSV),
        "total_rows": total,
        "unique_관리번호": unique,
        "중복_키_수": dup_keys,
        "중복으로_묶인_행수": dup_rows,
        "영업정상": open_n,
        "영업정상_고유_관리번호": open_unique,
    }
    print("=== [1] 원인 확인 ===")
    print(f"원본: {HOTEL_CSV}")
    print(f"전체 행수: {total}")
    print(f"고유 관리번호 수: {unique}")
    print(f"중복 키 수: {dup_keys}")
    print(f"중복으로 묶인 행수: {dup_rows}")
    print(f"(참고) 영업/정상: {open_n} / 그중 고유 관리번호: {open_unique}")
    return report


def prepare_hotel_rows() -> tuple[list[dict], dict]:
    skipped = Counter()
    kept: list[dict] = []

    with open_csv(HOTEL_CSV) as f:
        for row in csv.DictReader(f):
            if row.get("영업상태명") != "영업/정상":
                skipped["not_open"] += 1
                continue
            name = (row.get("사업장명") or "").strip()
            mgmt = (row.get("관리번호") or "").strip()
            org = (row.get("개방자치단체코드") or "").strip()
            if not name:
                skipped["empty_name"] += 1
                continue
            if not mgmt:
                skipped["empty_key"] += 1
                continue
            norm = name_norm(name)
            if not norm:
                skipped["empty_norm"] += 1
                continue

            raw = (row.get("관광숙박업상세명") or "").strip()
            if not raw:
                raw = (row.get("문화체육업종명") or "관광숙박업").strip()

            lat, lng = convert_xy(row.get("좌표정보(X)", ""), row.get("좌표정보(Y)", ""))
            x_s = (row.get("좌표정보(X)") or "").strip()
            y_s = (row.get("좌표정보(Y)") or "").strip()
            if lat is None and x_s and y_s:
                try:
                    float(x_s)
                    float(y_s)
                    skipped["coord_out_of_bounds"] += 1
                except ValueError:
                    pass

            kept.append(
                {
                    "_mgmt": mgmt,
                    "_org": org,
                    "name": name,
                    "name_norm": norm,
                    "road_address": (row.get("도로명주소") or "").strip(),
                    "jibun_address": (row.get("지번주소") or "").strip(),
                    "lat": "" if lat is None else f"{lat:.8f}",
                    "lng": "" if lng is None else f"{lng:.8f}",
                    "raw_category": raw,
                    "category": map_category(SOURCE, raw),
                    "phone": (row.get("전화번호") or "").strip(),
                }
            )

    keys, key_stats = build_hotel_keys(kept)
    out_rows: list[dict] = []
    seen: set[str] = set()
    identical_dedup = 0
    for r, sk in zip(kept, keys):
        if not sk:
            skipped["empty_key_after"] += 1
            continue
        if sk in seen:
            identical_dedup += 1
            continue
        seen.add(sk)
        out_rows.append(
            {
                "source": SOURCE,
                "source_key": sk,
                "name": r["name"],
                "name_norm": r["name_norm"],
                "road_address": r["road_address"],
                "jibun_address": r["jibun_address"],
                "lat": r["lat"],
                "lng": r["lng"],
                "raw_category": r["raw_category"],
                "category": r["category"],
                "phone": r["phone"],
            }
        )

    meta = {
        "raw_open_kept_before_key": len(kept),
        "skipped": dict(skipped),
        "key_stats": key_stats,
        "identical_content_dedup": identical_dedup,
        "final_rows": len(out_rows),
    }
    return out_rows, meta


def source_counts(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT source, count(*)::bigint FROM public.poi GROUP BY source")
        return {str(s): int(n) for s, n in cur.fetchall()}


def backup_hotel(conn) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, source, source_key, name, name_norm,
                   road_address, jibun_address, lat, lng,
                   raw_category, category, phone, updated_at
            FROM public.poi
            WHERE source = %s
            ORDER BY id
            """,
            (SOURCE,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        if r.get("updated_at") is not None:
            r["updated_at"] = r["updated_at"].isoformat()
    BACKUP_PATH.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"backup: {len(rows)} → {BACKUP_PATH}")
    return len(rows)


def write_load_csv(rows: list[dict]) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fields = [
        "source",
        "source_key",
        "name",
        "name_norm",
        "road_address",
        "jibun_address",
        "lat",
        "lng",
        "raw_category",
        "category",
        "phone",
    ]
    with LOAD_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return LOAD_CSV


def replace_hotel(conn, rows: list[dict], before_counts: dict[str, int]) -> None:
    """DELETE localdata_hotel only, then INSERT new rows. Abort if other sources drift."""
    expected_others = {s: before_counts.get(s, 0) for s in OTHER_SOURCES}

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.poi WHERE source = %s", (SOURCE,))
        old_n = cur.fetchone()[0]
        print(f"deleting source={SOURCE} ({old_n}) …")
        cur.execute("DELETE FROM public.poi WHERE source = %s", (SOURCE,))
        deleted = cur.rowcount
        print(f"deleted {deleted}")

        # guard: other sources unchanged mid-tx
        cur.execute(
            """
            SELECT source, count(*)::bigint
            FROM public.poi
            WHERE source = ANY(%s)
            GROUP BY source
            """,
            (list(OTHER_SOURCES),),
        )
        mid = {str(s): int(n) for s, n in cur.fetchall()}
        for s, exp in expected_others.items():
            got = mid.get(s, 0)
            if got != exp:
                conn.rollback()
                raise RuntimeError(
                    f"ABORT: other source drifted during delete: {s} {exp} → {got}"
                )

        print(f"inserting {len(rows)} …")
        execute_values(
            cur,
            """
            INSERT INTO public.poi (
              source, source_key, name, name_norm,
              road_address, jibun_address, lat, lng,
              raw_category, category, phone
            ) VALUES %s
            """,
            [
                (
                    r["source"],
                    r["source_key"],
                    r["name"],
                    r["name_norm"],
                    r["road_address"] or None,
                    r["jibun_address"] or None,
                    float(r["lat"]) if r["lat"] else None,
                    float(r["lng"]) if r["lng"] else None,
                    r["raw_category"] or None,
                    r["category"],
                    r["phone"] or None,
                )
                for r in rows
            ],
            page_size=500,
        )

    conn.commit()
    print("commit ok")


def verify(conn, rows: list[dict], raw_open: int, before_counts: dict[str, int], meta: dict) -> None:
    after = source_counts(conn)
    print("\n=== [4] 검증 ===")
    print(f"원본 영업/정상: {raw_open}")
    print(f"정제 제외 skipped: {meta['skipped']}")
    print(f"key_stats: {meta['key_stats']}")
    print(f"identical_content_dedup: {meta['identical_content_dedup']}")
    print(f"최종 적재 행수: {after.get(SOURCE, 0)}")

    # abort if other sources changed
    for s in OTHER_SOURCES:
        if before_counts.get(s, 0) != after.get(s, 0):
            raise RuntimeError(
                f"ABORT: other source count changed: {s} "
                f"{before_counts.get(s)} → {after.get(s)}"
            )
    print("다른 source 건수: 변동 없음 OK")

    final_n = after.get(SOURCE, 0)
    if final_n < raw_open * 0.9:
        raise RuntimeError(
            f"ABORT: final {final_n} < 90% of raw open {raw_open}"
        )
    print(f"90% 기준 통과 ({final_n} / {raw_open})")

    # Korea bounds
    outside = []
    for r in rows:
        if not r["lat"] or not r["lng"]:
            continue
        lat, lng = float(r["lat"]), float(r["lng"])
        if not (33.0 <= lat <= 39.0 and 124.0 <= lng <= 132.0):
            outside.append(r)
    print(f"한국 밖 좌표: {len(outside)}")
    for r in outside[:50]:
        print(f"  {r['name']} | {r['road_address'] or r['jibun_address']} | {r['lat']},{r['lng']}")

    print("\nselect source, count(*) …")
    for s in sorted(after.keys()):
        print(f"  {s}: {after[s]}")

    import random

    sample = random.sample(rows, min(10, len(rows))) if rows else []
    print("\n무작위 10건:")
    for r in sample:
        addr = r["road_address"] or r["jibun_address"] or ""
        coord = f"{r['lat']},{r['lng']}" if r["lat"] else "(no coords)"
        print(f"  {r['name']} | {addr} | {coord}")


def main() -> None:
    t0 = time.time()
    analyze_raw()

    print("\n=== [2] 복합키 재생성 ===")
    rows, meta = prepare_hotel_rows()
    write_load_csv(rows)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"wrote {LOAD_CSV} ({len(rows)} rows)")

    raw_open = 3463  # from analyze; recompute
    with open_csv(HOTEL_CSV) as f:
        raw_open = sum(1 for r in csv.DictReader(f) if r.get("영업상태명") == "영업/정상")

    if len(rows) < raw_open * 0.9:
        print(f"ABORT before load: prepared {len(rows)} < 90% of {raw_open}")
        sys.exit(3)

    print("\n=== [3] 교체 적재 ===")
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.autocommit = False
    try:
        before = source_counts(conn)
        print("before counts:", before)
        for s in OTHER_SOURCES:
            print(f"  lock-check {s}={before.get(s, 0)}")

        backup_hotel(conn)
        replace_hotel(conn, rows, before)
        verify(conn, rows, raw_open, before, meta)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f"\nDONE in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
