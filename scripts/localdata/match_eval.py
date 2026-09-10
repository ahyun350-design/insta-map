#!/usr/bin/env python3
"""places(source IS NULL) → poi 재매칭 측정 (읽기 전용).

일반 업소: 반경 300m + 기존 필터
시설 라우팅: facilityRouting → 해당 source만, 넓은 거리 상한
SELECT만. UPDATE/INSERT/DELETE 금지.
"""

from __future__ import annotations

import json
import random
import re
import statistics
import time
from collections import Counter
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

from poi_match import (
    BBOX_DEG,
    RADIUS_M,
    ROUTING_BBOX_DEG,
    ROUTING_RADIUS_M,
    apply_filters,
    apply_filters_routing,
    detect_facility_route,
    score_candidate,
    score_candidate_routing,
)

OUT = Path(__file__).resolve().parent / "out"
DB_URL_FILE = Path(__file__).resolve().parent / ".db_url"
PAGE_SIZE = 1000
BATCH_SIZE = 150


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


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


def fetch_source_null_places(conn) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, name, lat, lng, address, category
                FROM public.places
                WHERE source IS NULL
                ORDER BY id
                LIMIT %s OFFSET %s
                """,
                (PAGE_SIZE, offset),
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


def _fetch_candidates(
    conn,
    values: list[tuple],
    *,
    bbox: float,
    radius: float,
    poi_source: str | None,
) -> list[dict]:
    if not values:
        return []
    source_filter = "AND p.source = %s" if poi_source else ""
    sql = f"""
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
            )
            SELECT
              n.place_id,
              n.place_name,
              n.qn AS place_norm,
              p.id AS poi_id,
              p.name AS poi_name,
              p.name_norm AS poi_norm,
              p.source AS poi_source,
              p.lat AS poi_lat,
              p.lng AS poi_lng,
              (
                6371000.0 * 2.0 * asin(least(1.0, sqrt(
                  power(sin(radians(p.lat - n.plat) / 2.0), 2) +
                  cos(radians(n.plat)) * cos(radians(p.lat)) *
                  power(sin(radians(p.lng - n.plng) / 2.0), 2)
                )))
              ) AS dist_m,
              (similarity(p.name_norm, n.qn) * 100.0) AS sim_raw
            FROM normed n
            JOIN public.poi p
              ON p.lat IS NOT NULL
             AND p.lng IS NOT NULL
             AND p.lat BETWEEN n.plat - {bbox} AND n.plat + {bbox}
             AND p.lng BETWEEN n.plng - {bbox} AND n.plng + {bbox}
             {source_filter}
            WHERE
              (
                6371000.0 * 2.0 * asin(least(1.0, sqrt(
                  power(sin(radians(p.lat - n.plat) / 2.0), 2) +
                  cos(radians(n.plat)) * cos(radians(p.lat)) *
                  power(sin(radians(p.lng - n.plng) / 2.0), 2)
                )))
              ) <= {radius}
            """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # execute_values puts VALUES first; append source arg after template expansion
        if poi_source:
            # execute_values doesn't mix easily with trailing params — inject safely via quote
            from psycopg2.extensions import adapt

            sql = sql.replace(
                "AND p.source = %s",
                f"AND p.source = {adapt(poi_source).getquoted().decode()}",
            )
        execute_values(
            cur,
            sql,
            values,
            template="(%s::text, %s::text, %s::double precision, %s::double precision)",
            page_size=len(values),
        )
        return [dict(r) for r in cur.fetchall()]


def _pick_best(
    cands: list[dict],
    *,
    routing: bool,
) -> tuple[dict | None, Counter]:
    place_excl: Counter = Counter()
    picked = None
    score_fn = score_candidate_routing if routing else score_candidate
    filter_fn = apply_filters_routing if routing else apply_filters
    for c in cands:
        scored = score_fn(
            c["place_name"] or "",
            c["place_norm"] or "",
            c["poi_name"] or "",
            c["poi_norm"] or "",
            float(c["sim_raw"] or 0),
        )
        if not scored:
            continue
        score, reason = scored
        dist_m = float(c["dist_m"])
        blocked = filter_fn(
            c["place_name"] or "",
            c["place_norm"] or "",
            c["poi_name"] or "",
            c["poi_norm"] or "",
            score,
            reason,
            dist_m,
        )
        if blocked:
            place_excl[blocked] += 1
            continue
        row = {
            "place_id": str(c["place_id"]),
            "place_name": c["place_name"],
            "poi_id": c["poi_id"],
            "poi_name": c["poi_name"],
            "poi_source": c.get("poi_source"),
            "dist_m": dist_m,
            "sim": round(score, 1),
            "sim_raw": round(float(c["sim_raw"] or 0), 1),
            "reason": reason,
            "path": "routing" if routing else "general",
            "route_source": c.get("_route_source"),
        }
        if picked is None or row["sim"] > picked["sim"] or (
            row["sim"] == picked["sim"] and row["dist_m"] < picked["dist_m"]
        ):
            picked = row
    return picked, place_excl


def match_batch(conn, batch: list[dict]) -> tuple[dict[str, dict], Counter]:
    """returns (best_matches, exclusion_counts)."""
    excl: Counter = Counter()
    best: dict[str, dict] = {}

    general: list[dict] = []
    routing_groups: dict[str, list[dict]] = {}
    for p in batch:
        route = detect_facility_route(p.get("name") or "")
        if route:
            routing_groups.setdefault(route, []).append(p)
        else:
            general.append(p)

    def values_of(places: list[dict]) -> list[tuple]:
        return [
            (
                str(p["id"]),
                str(p["name"] or ""),
                float(p["lat"]) if p.get("lat") is not None else None,
                float(p["lng"]) if p.get("lng") is not None else None,
            )
            for p in places
        ]

    # --- general path ---
    if general:
        rows = _fetch_candidates(
            conn,
            values_of(general),
            bbox=BBOX_DEG,
            radius=RADIUS_M,
            poi_source=None,
        )
        by_place: dict[str, list[dict]] = {}
        for r in rows:
            by_place.setdefault(str(r["place_id"]), []).append(r)
        for p in general:
            pid = str(p["id"])
            picked, place_excl = _pick_best(by_place.get(pid, []), routing=False)
            if picked:
                best[pid] = picked
            elif place_excl:
                if place_excl["franchise_prefix"] > 0:
                    excl["franchise_prefix"] += 1
                elif place_excl["facility_keyword"] > 0:
                    excl["facility_keyword"] += 1
                elif place_excl["reverse_contain"] > 0:
                    excl["reverse_contain"] += 1
                elif place_excl["distance"] > 0:
                    excl["distance"] += 1

    # --- routing path ---
    for route_src, places in routing_groups.items():
        rows = _fetch_candidates(
            conn,
            values_of(places),
            bbox=ROUTING_BBOX_DEG,
            radius=ROUTING_RADIUS_M,
            poi_source=route_src,
        )
        for r in rows:
            r["_route_source"] = route_src
        by_place = {}
        for r in rows:
            by_place.setdefault(str(r["place_id"]), []).append(r)
        for p in places:
            pid = str(p["id"])
            picked, place_excl = _pick_best(by_place.get(pid, []), routing=True)
            if picked:
                picked["route_source"] = route_src
                picked["path"] = "routing"
                best[pid] = picked
            elif place_excl:
                if place_excl["reverse_contain"] > 0:
                    excl["reverse_contain"] += 1
                elif place_excl["distance"] > 0:
                    excl["distance"] += 1
                else:
                    excl["routing_miss"] += 1
            else:
                excl["routing_no_candidate"] += 1

    return best, excl


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    print("connecting (readonly)…", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)

    print("loading places WHERE source IS NULL…", flush=True)
    places = fetch_source_null_places(conn)
    total = len(places)
    print(f"(a) targets: {total}", flush=True)

    matches: dict[str, dict] = {}
    excl_total: Counter = Counter()
    for i in range(0, total, BATCH_SIZE):
        batch = places[i : i + BATCH_SIZE]
        bt0 = time.perf_counter()
        part, excl = match_batch(conn, batch)
        matches.update(part)
        excl_total.update(excl)
        done = min(i + BATCH_SIZE, total)
        print(
            f"  match {done}/{total} (+{len(part)} hits, "
            f"gen={sum(1 for m in part.values() if m['path']=='general')} "
            f"route={sum(1 for m in part.values() if m['path']=='routing')}, "
            f"{(time.perf_counter() - bt0) * 1000:.0f}ms)",
            flush=True,
        )

    conn.close()

    matched_n = len(matches)
    matched_list = list(matches.values())
    general_list = [m for m in matched_list if m["path"] == "general"]
    routing_list = [m for m in matched_list if m["path"] == "routing"]
    by_route_src = Counter(m.get("route_source") or m.get("poi_source") for m in routing_list)

    unmatched_names = [
        (p.get("name") or "").strip()
        for p in places
        if str(p["id"]) not in matches
    ]
    unmatched_n = len(unmatched_names)

    dists = sorted(m["dist_m"] for m in matched_list)
    sample_routing = (
        random.sample(routing_list, min(30, len(routing_list))) if routing_list else []
    )
    top_routing = sorted(routing_list, key=lambda x: -x["dist_m"])[:30]
    sample_unmatched = (
        random.sample(unmatched_names, min(50, len(unmatched_names)))
        if unmatched_names
        else []
    )

    def rate(n: int) -> float:
        return round(n / total, 4) if total else 0.0

    summary = {
        "targets": total,
        "matched": {"n": matched_n, "rate": rate(matched_n)},
        "by_path": {
            "general": len(general_list),
            "routing": len(routing_list),
        },
        "routing_by_source": dict(by_route_src),
        "excluded": dict(excl_total),
        "unmatched": {"n": unmatched_n, "rate": rate(unmatched_n)},
        "dist_m": {
            "n": len(dists),
            "median": round(statistics.median(dists), 1) if dists else None,
            "p90": round(percentile(dists, 90) or 0, 1) if dists else None,
            "p99": round(percentile(dists, 99) or 0, 1) if dists else None,
            "max": round(dists[-1], 1) if dists else None,
        },
        "elapsed_s": round(time.perf_counter() - t0, 1),
    }

    out_path = OUT / "match_eval.json"
    out_path.write_text(
        json.dumps(
            {
                "summary": summary,
                "matched": [
                    {
                        "place_id": m["place_id"],
                        "place_name": m["place_name"],
                        "poi_id": m["poi_id"],
                        "poi_name": m["poi_name"],
                        "poi_source": m.get("poi_source"),
                        "path": m["path"],
                        "route_source": m.get("route_source"),
                        "sim": m["sim"],
                        "dist_m": round(m["dist_m"], 1),
                        "reason": m["reason"],
                    }
                    for m in matched_list
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("\n=== match_eval facility-routing ===")
    print(f"(a) 대상: {total}")
    print(f"(b) 매칭: {matched_n} ({rate(matched_n):.1%})")
    print(
        f"(c) 경로별: 일반 업소 {len(general_list)} / 라우팅 {len(routing_list)}"
    )
    print("(d) 라우팅 source별:")
    for src in ("park", "museum", "market", "library", "tourspot"):
        print(f"  {src}: {by_route_src.get(src, 0)}")
    d = summary["dist_m"]
    print(
        f"(e) 이동거리 median={d['median']} p90={d['p90']} p99={d['p99']} max={d['max']}"
    )
    print("(f) 라우팅 신규 매칭 무작위 30:")
    for m in sample_routing:
        print(
            f"  {m['place_name']} → {m['poi_name']} | {m.get('poi_source') or m.get('route_source')} "
            f"| {m['sim']} | {round(m['dist_m'], 1)}m"
        )
    print("(g) 라우팅 거리 상위 30:")
    for m in top_routing:
        print(
            f"  {m['place_name']} → {m['poi_name']} | {m.get('poi_source') or m.get('route_source')} "
            f"| {m['sim']} | {round(m['dist_m'], 1)}m"
        )
    print(f"(h) 미매칭 무작위 50 (전체 {unmatched_n}):")
    for n in sample_unmatched:
        print(f"  - {n}")
    print(f"wrote {out_path} in {summary['elapsed_s']}s")


if __name__ == "__main__":
    main()
