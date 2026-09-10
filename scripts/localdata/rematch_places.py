#!/usr/bin/env python3
"""Phase 4: source IS NULL places → poi 좌표·주소 교체.

기본: --dry-run (쓰기 없음)
실제 쓰기: --apply 명시 시에만
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import statistics
import sys
import time
from datetime import date
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

OUT = Path(__file__).resolve().parent / "out"
DB_URL_FILE = Path(__file__).resolve().parent / ".db_url"
PAGE_SIZE = 1000
MATCH_BATCH = 200
UPDATE_BATCH = 500

from poi_match import is_reverse_contain  # lib/poiMatch.rules.json · lib/poiMatch.ts 공용


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def haversine_m(lat1, lng1, lat2, lng2) -> float | None:
    if None in (lat1, lng1, lat2, lng2):
        return None
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def fetch_places_pages(conn, where_sql: str = "", params: tuple = ()) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT id, name, lat, lng, address, category, created_at, user_id, memo, source
                FROM public.places
                {where_sql}
                ORDER BY id
                LIMIT %s OFFSET %s
                """,
                params + (PAGE_SIZE, offset),
            )
            page = cur.fetchall()
        if not page:
            break
        rows.extend([dict(r) for r in page])
        print(f"  loaded {len(rows)} (+{len(page)}) offset={offset}", flush=True)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def backup_places(conn, path: Path | None = None) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    if path is None:
        stamp = date.today().strftime("%Y%m%d")
        path = OUT / f"places_backup_{stamp}.json"
    print(f"backing up all places → {path.name} …", flush=True)
    rows = fetch_places_pages(conn)
    # JSON-safe
    serializable = []
    for r in rows:
        item = dict(r)
        if item.get("created_at") is not None:
            item["created_at"] = item["created_at"].isoformat()
        if item.get("user_id") is not None:
            item["user_id"] = str(item["user_id"])
        serializable.append(item)
    path.write_text(json.dumps(serializable, ensure_ascii=False), encoding="utf-8")
    size = path.stat().st_size
    print(f"backup done: {len(serializable)} rows → {path} ({size} bytes)", flush=True)
    try:
        import shutil

        du = shutil.disk_usage(path.parent)
        print(
            f"disk free: {du.free / (1024**3):.2f} GiB (of {du.total / (1024**3):.2f} GiB)",
            flush=True,
        )
    except Exception as e:
        print(f"disk free: (unavailable: {e})", flush=True)
    return path


MATCH_SQL = """
WITH input(place_id, place_name, plat, plng) AS (
  VALUES %s
),
normed AS (
  SELECT
    place_id,
    place_name,
    plat,
    plng,
    public.normalize_poi_name(place_name) AS qn
  FROM input
  WHERE plat IS NOT NULL
    AND plng IS NOT NULL
    AND length(public.normalize_poi_name(place_name)) >= 2
),
cand AS (
  SELECT
    n.place_id,
    n.place_name,
    n.qn,
    p.id AS poi_id,
    p.name AS poi_name,
    p.name_norm,
    p.lat AS poi_lat,
    p.lng AS poi_lng,
    p.road_address,
    p.jibun_address,
    (
      6371000.0 * 2.0 * asin(least(1.0, sqrt(
        power(sin(radians(p.lat - n.plat) / 2.0), 2) +
        cos(radians(n.plat)) * cos(radians(p.lat)) *
        power(sin(radians(p.lng - n.plng) / 2.0), 2)
      )))
    ) AS dist_m,
    (similarity(p.name_norm, n.qn) * 100.0) AS sim
  FROM normed n
  JOIN public.poi p
    ON p.lat IS NOT NULL
   AND p.lng IS NOT NULL
   AND p.lat BETWEEN n.plat - 0.012 AND n.plat + 0.012
   AND p.lng BETWEEN n.plng - 0.015 AND n.plng + 0.015
  WHERE
    (
      6371000.0 * 2.0 * asin(least(1.0, sqrt(
        power(sin(radians(p.lat - n.plat) / 2.0), 2) +
        cos(radians(n.plat)) * cos(radians(p.lat)) *
        power(sin(radians(p.lng - n.plng) / 2.0), 2)
      )))
    ) <= 1000.0
    AND (
      p.name_norm = n.qn
      OR similarity(p.name_norm, n.qn) >= 0.70
    )
),
ranked AS (
  SELECT
    c.*,
    CASE
      WHEN c.dist_m <= 200 AND c.sim >= 70 THEN 1
      WHEN c.dist_m <= 500 AND c.sim >= 85 THEN 2
      WHEN c.dist_m <= 1000 AND c.name_norm = c.qn THEN 3
      ELSE NULL
    END AS tier
  FROM cand c
),
ok AS (
  SELECT * FROM ranked WHERE tier IS NOT NULL
),
best AS (
  SELECT DISTINCT ON (place_id)
    place_id,
    place_name,
    poi_id,
    poi_name,
    poi_lat,
    poi_lng,
    road_address,
    jibun_address,
    dist_m,
    sim,
    tier
  FROM ok
  ORDER BY place_id, tier ASC, dist_m ASC, sim DESC, poi_id ASC
)
SELECT * FROM best
"""


def match_batch(conn, batch: list[dict]) -> dict[str, dict]:
    values = [
        (
            str(p["id"]),
            str(p["name"] or ""),
            float(p["lat"]) if p.get("lat") is not None else None,
            float(p["lng"]) if p.get("lng") is not None else None,
        )
        for p in batch
    ]
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        execute_values(
            cur,
            MATCH_SQL,
            values,
            template="(%s::text, %s::text, %s::double precision, %s::double precision)",
            page_size=len(values),
        )
        rows = cur.fetchall()
    return {str(r["place_id"]): dict(r) for r in rows}


def ensure_poi_id_column(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            ALTER TABLE public.places
              ADD COLUMN IF NOT EXISTS poi_id bigint
            """
        )
        cur.execute(
            """
            COMMENT ON COLUMN public.places.poi_id IS
              '매칭된 public.poi.id (Phase 4 rematch)'
            """
        )


def apply_updates(conn, planned: list[dict]) -> list[dict]:
    """500건 배치 UPDATE. 실패 배치만 스킵. 실패 목록 반환."""
    ensure_poi_id_column(conn)
    failures: list[dict] = []
    total = len(planned)
    for i in range(0, total, UPDATE_BATCH):
        batch = planned[i : i + UPDATE_BATCH]
        n0 = i + 1
        n1 = min(i + UPDATE_BATCH, total)
        try:
            with conn.cursor() as cur:
                # 배치 단위 트랜잭션
                execute_values(
                    cur,
                    """
                    UPDATE public.places AS pl SET
                      lat = v.lat,
                      lng = v.lng,
                      address = v.address,
                      source = 'poi',
                      poi_id = v.poi_id
                    FROM (VALUES %s) AS v(id, lat, lng, address, poi_id)
                    WHERE pl.id = v.id
                      AND pl.source IS NULL
                    """,
                    [
                        (
                            p["place_id"],
                            p["after_lat"],
                            p["after_lng"],
                            p["after_address"],
                            p["poi_id"],
                        )
                        for p in batch
                    ],
                    template="(%s::text, %s::double precision, %s::double precision, %s::text, %s::bigint)",
                    page_size=len(batch),
                )
            conn.commit()
            print(f"  apply batch {n0}-{n1}/{total} ok ({len(batch)})", flush=True)
        except Exception as e:
            conn.rollback()
            print(f"  apply batch {n0}-{n1}/{total} FAILED: {e}", flush=True)
            for p in batch:
                failures.append(
                    {
                        "place_id": p["place_id"],
                        "name": p["name"],
                        "error": str(e),
                    }
                )
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Rematch places → poi (default dry-run)")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="실제로 UPDATE 수행. 없으면 dry-run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="쓰기 없이 계획만 출력 (기본값).",
    )
    parser.add_argument(
        "--from-match-eval",
        action="store_true",
        help="기존 out/match_eval.json 매칭 결과를 재사용 (재검색 생략, 빠름).",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="--backup 경로에 파일이 있으면 재덤프 생략.",
    )
    parser.add_argument(
        "--backup",
        type=str,
        default="",
        help="백업 파일명 또는 경로 (기본: places_backup_YYYYMMDD.json).",
    )
    args = parser.parse_args()
    do_apply = bool(args.apply)
    if do_apply:
        mode = "APPLY"
    else:
        mode = "DRY-RUN"

    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    print(f"mode={mode}", flush=True)

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.autocommit = True

    if args.backup:
        backup_path = Path(args.backup)
        if not backup_path.is_absolute():
            backup_path = OUT / backup_path
    else:
        stamp = date.today().strftime("%Y%m%d")
        backup_path = OUT / f"places_backup_{stamp}.json"

    if args.skip_backup and backup_path.exists() and backup_path.stat().st_size > 0:
        print(
            f"skip backup (exists): {backup_path} ({backup_path.stat().st_size} bytes)",
            flush=True,
        )
    else:
        backup_path = backup_places(conn, path=backup_path)

    print("loading source IS NULL places…", flush=True)
    targets = fetch_places_pages(conn, where_sql="WHERE source IS NULL")
    print(f"targets (source IS NULL): {len(targets)}", flush=True)

    by_id = {str(p["id"]): p for p in targets}
    matches: dict[str, dict] = {}

    if args.from_match_eval:
        me_path = OUT / "match_eval.json"
        print(f"reusing matches from {me_path.name}…", flush=True)
        me = json.loads(me_path.read_text(encoding="utf-8"))
        if me.get("matched"):
            matched_rows = [r for r in me["matched"] if r.get("poi_id")]
            print(f"  v4 matched rows: {len(matched_rows)}", flush=True)
        else:
            matched_rows = [
                r for r in me.get("results", []) if r.get("matched") and r.get("poi_id")
            ]
            print(f"  legacy matched rows: {len(matched_rows)}", flush=True)

        poi_ids = sorted({int(r["poi_id"]) for r in matched_rows})
        poi_by_id: dict[int, dict] = {}
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for i in range(0, len(poi_ids), 500):
                chunk = poi_ids[i : i + 500]
                cur.execute(
                    """
                    SELECT id, name, name_norm, lat, lng, road_address, jibun_address
                    FROM public.poi
                    WHERE id = ANY(%s)
                    """,
                    (chunk,),
                )
                for row in cur.fetchall():
                    poi_by_id[int(row["id"])] = dict(row)

        place_norm_by_id: dict[str, str] = {}
        place_ids = [str(r["place_id"]) for r in matched_rows if str(r["place_id"]) in by_id]
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for i in range(0, len(place_ids), 500):
                chunk = place_ids[i : i + 500]
                names = [(pid, by_id[pid].get("name") or "") for pid in chunk]
                execute_values(
                    cur,
                    """
                    SELECT v.place_id, public.normalize_poi_name(v.place_name) AS place_norm
                    FROM (VALUES %s) AS v(place_id, place_name)
                    """,
                    names,
                    template="(%s::text, %s::text)",
                    page_size=len(names) or 1,
                )
                for row in cur.fetchall():
                    place_norm_by_id[str(row["place_id"])] = row["place_norm"] or ""

        skipped_not_null = 0
        for r in matched_rows:
            pid = str(r["place_id"])
            if pid not in by_id:
                skipped_not_null += 1
                continue
            poi = poi_by_id.get(int(r["poi_id"]))
            if not poi:
                continue
            matches[pid] = {
                "place_id": pid,
                "poi_id": int(r["poi_id"]),
                "poi_name": poi.get("name"),
                "poi_norm": poi.get("name_norm") or "",
                "place_norm": place_norm_by_id.get(pid, ""),
                "poi_lat": poi.get("lat"),
                "poi_lng": poi.get("lng"),
                "road_address": poi.get("road_address"),
                "jibun_address": poi.get("jibun_address"),
                "dist_m": r.get("dist_m") or 0,
                "sim": r.get("sim") or 0,
                "tier": r.get("tier"),
                "reason": r.get("reason")
                or ("sim" if (r.get("sim") or 0) >= 70 else "contain"),
            }
        print(
            f"  reused matches still source IS NULL: {len(matches)} "
            f"(skipped already-poi/missing: {skipped_not_null})",
            flush=True,
        )
        if me.get("matched"):
            print("  v4 mode: no extra rematch beyond match_eval", flush=True)
        else:
            known_ids = {str(r["place_id"]) for r in me.get("results", [])}
            missing = [p for p in targets if str(p["id"]) not in known_ids]
            if missing:
                print(f"  rematching {len(missing)} NEW places not in match_eval…", flush=True)
                for i in range(0, len(missing), MATCH_BATCH):
                    batch = missing[i : i + MATCH_BATCH]
                    part = match_batch(conn, batch)
                    matches.update(part)
                    print(
                        f"  rematch {min(i + MATCH_BATCH, len(missing))}/{len(missing)} (+{len(part)})",
                        flush=True,
                    )
            else:
                print("  no new places beyond match_eval", flush=True)
    else:
        print("matching…", flush=True)
        for i in range(0, len(targets), MATCH_BATCH):
            batch = targets[i : i + MATCH_BATCH]
            bt0 = time.perf_counter()
            part = match_batch(conn, batch)
            matches.update(part)
            done = min(i + MATCH_BATCH, len(targets))
            print(
                f"  match {done}/{len(targets)} (+{len(part)} hits, "
                f"{(time.perf_counter() - bt0) * 1000:.0f}ms)",
                flush=True,
            )

    planned: list[dict] = []
    for pid, m in matches.items():
        place = by_id.get(pid)
        if not place:
            continue
        poi_lat = m.get("poi_lat")
        poi_lng = m.get("poi_lng")
        if poi_lat is None or poi_lng is None:
            continue
        addr = (m.get("road_address") or m.get("jibun_address") or "").strip()
        if not addr:
            continue
        move = haversine_m(
            place.get("lat"), place.get("lng"), float(poi_lat), float(poi_lng)
        )
        planned.append(
            {
                "place_id": pid,
                "name": place.get("name") or "",
                "tier": int(m["tier"]) if m.get("tier") is not None else None,
                "reason": m.get("reason"),
                "place_norm": m.get("place_norm") or "",
                "poi_norm": m.get("poi_norm") or "",
                "dist_m_match": round(float(m["dist_m"]), 1),
                "sim": round(float(m["sim"]), 1),
                "poi_id": int(m["poi_id"]),
                "poi_name": m.get("poi_name"),
                "before_lat": place.get("lat"),
                "before_lng": place.get("lng"),
                "before_address": place.get("address"),
                "after_lat": float(poi_lat),
                "after_lng": float(poi_lng),
                "after_address": addr,
                "move_m": round(move, 1) if move is not None else None,
            }
        )

    excluded: list[dict] = []
    kept: list[dict] = []
    # match_eval 재사용 시 거리·유사도 컷은 이미 적용됨 → moved_100m/tier 재제외 안 함
    trust_match_eval = bool(args.from_match_eval)
    for p in planned:
        reason: str | None = None
        move_m = p.get("move_m")
        tier = p.get("tier")
        dist_poi = p.get("dist_m_match")
        if trust_match_eval:
            if p.get("reason") == "contain" and is_reverse_contain(
                p.get("place_norm") or "",
                p.get("poi_norm") or "",
                p.get("name") or "",
                p.get("poi_name") or "",
                move_m,
            ):
                reason = "reverse_contain"
        elif move_m is not None and move_m >= 100:
            reason = "moved_100m"
        elif tier in (2, 3):
            reason = "tier_2_3"
        elif (
            tier is None
            and p.get("reason") is None
            and dist_poi is not None
            and dist_poi > 200
        ):
            reason = "tier_2_3"
        elif (
            tier is None
            and p.get("reason") is None
            and move_m is not None
            and move_m > 200
        ):
            reason = "tier_2_3"
        elif p.get("reason") == "contain" and is_reverse_contain(
            p.get("place_norm") or "",
            p.get("poi_norm") or "",
            p.get("name") or "",
            p.get("poi_name") or "",
            move_m,
        ):
            reason = "reverse_contain"

        if reason:
            excluded.append({**p, "excluded_reason": reason})
        else:
            kept.append(p)

    planned_all = planned
    planned = kept

    moved_100 = [p for p in planned_all if p["move_m"] is not None and p["move_m"] >= 100]
    moved_100.sort(key=lambda x: -(x["move_m"] or 0))
    excl_counts = {
        "moved_100m": sum(1 for e in excluded if e["excluded_reason"] == "moved_100m"),
        "tier_2_3": sum(1 for e in excluded if e["excluded_reason"] == "tier_2_3"),
        "reverse_contain": sum(
            1 for e in excluded if e["excluded_reason"] == "reverse_contain"
        ),
    }

    moves = sorted(p["move_m"] for p in planned if p.get("move_m") is not None)
    move_stats = {
        "n": len(moves),
        "median": round(statistics.median(moves), 1) if moves else None,
        "p90": round(percentile(moves, 90) or 0, 1) if moves else None,
        "p99": round(percentile(moves, 99) or 0, 1) if moves else None,
        "max": round(moves[-1], 1) if moves else None,
    }

    sample = random.sample(planned, min(20, len(planned))) if planned else []

    report = {
        "mode": mode,
        "backup": str(backup_path),
        "targets_source_null": len(targets),
        "matched_before_exclude": len(planned_all),
        "excluded_n": len(excluded),
        "excluded_counts": excl_counts,
        "excluded": [
            {
                "place_id": e["place_id"],
                "name": e["name"],
                "poi_name": e.get("poi_name"),
                "move_m": e.get("move_m"),
                "tier": e.get("tier"),
                "reason": e.get("reason"),
                "dist_m_match": e.get("dist_m_match"),
                "excluded_reason": e["excluded_reason"],
            }
            for e in excluded
        ],
        "planned_replace": len(planned),
        "move_stats": move_stats,
        "move_ge_100m_n": len(moved_100),
        "move_ge_100m": [{"name": p["name"], "move_m": p["move_m"]} for p in moved_100],
        "sample_20": [
            {
                "name": p["name"],
                "before": {
                    "lat": p["before_lat"],
                    "lng": p["before_lng"],
                    "address": p["before_address"],
                },
                "after": {
                    "lat": p["after_lat"],
                    "lng": p["after_lng"],
                    "address": p["after_address"],
                },
                "move_m": p["move_m"],
                "tier": p["tier"],
                "reason": p.get("reason"),
            }
            for p in sample
        ],
        "elapsed_s": round(time.perf_counter() - t0, 1),
    }

    report_path = OUT / "rematch_report.json"
    plan_path = OUT / "rematch_plan_compact.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    plan_path.write_text(
        json.dumps(
            [
                {
                    "place_id": p["place_id"],
                    "poi_id": p["poi_id"],
                    "after_lat": p["after_lat"],
                    "after_lng": p["after_lng"],
                    "after_address": p["after_address"],
                    "move_m": p["move_m"],
                    "tier": p["tier"],
                    "reason": p.get("reason"),
                    "name": p["name"],
                }
                for p in planned
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("\n=== rematch dry-run/apply report ===")
    print(f"backup: {backup_path}")
    print(f"매칭(제외 전): {len(planned_all)} / targets {len(targets)}")
    print(
        f"제외: {len(excluded)} "
        f"(moved_100m={excl_counts['moved_100m']}, "
        f"tier_2_3={excl_counts['tier_2_3']}, "
        f"reverse_contain={excl_counts['reverse_contain']})"
    )
    print(f"교체 예정 건수 (제외 후): {len(planned)}")
    print(
        f"이동거리 median={move_stats['median']} p90={move_stats['p90']} "
        f"p99={move_stats['p99']} max={move_stats['max']}"
    )
    print(f"좌표 100m 이상 이동(참고·전부 제외됨): {len(moved_100)}")
    print("--- sample 20 before/after (제외 후 대상) ---")
    for p in sample:
        print(f"  {p['name']}")
        print(
            f"    before: ({p['before_lat']}, {p['before_lng']}) | {p['before_address']}"
        )
        print(
            f"    after:  ({p['after_lat']}, {p['after_lng']}) | {p['after_address']}"
        )
        print(f"    move_m={p['move_m']} reason={p.get('reason')} tier={p['tier']}")

    if not do_apply:
        print(f"\nDRY-RUN only. report → {report_path}")
        print(f"compact plan → {plan_path}")
        print(">>> STOP: 확인 후 --apply 하세요.")
        conn.close()
        return

    print("\nAPPLY starting…", flush=True)
    conn.autocommit = False
    failures = apply_updates(conn, planned)
    conn.autocommit = True
    fail_path = OUT / "rematch_failures.json"
    fail_path.write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"apply done. failures={len(failures)} → {fail_path}")
    conn.close()
    print(f"elapsed {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
