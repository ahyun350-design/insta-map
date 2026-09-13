#!/usr/bin/env python3
"""미매칭 원인 진단 (읽기 전용).

SQL 반경 조회 + 배치마다 새 연결 + place id 체크포인트.
Python 메모리 공간검색 금지.
"""
from __future__ import annotations

import csv
import json
import re
import time
from collections import Counter, defaultdict
from difflib import SequenceMatcher
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
    ends_with_facility_block,
    normalize_poi_name,
    score_candidate,
    score_candidate_routing,
    soft_normalize_display,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
DB_URL_FILE = ROOT / ".db_url"
LOCALDATA_DIR = ROOT.parents[1] / "localdata"
RAW_B = ROOT / "raw_b"

BATCH = 500
CHECKPOINT = OUT / "unmatched_diag_checkpoint.txt"
RESULTS = OUT / "unmatched_diag_results.jsonl"
SUMMARY = OUT / "unmatched_diag_summary.json"

FOCUS = [
    "성심당",
    "스파오",
    "뉴뉴 서교점",
    "아치서울 용산점",
    "럭희 행궁동점",
    "카시아타이 김포점",
    "뮬 연남",
    "카페리넘",
    "오야츠",
    "밀토니아",
]

NEAR_NAME = 55.0
GLOBAL_NAME = 85.0


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def redact(err: object) -> str:
    return re.sub(r"(://[^:]+:)([^@]+)(@)", r"\1***\3", str(err))


def connect():
    conn = psycopg2.connect(db_url(), connect_timeout=30)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def load_checkpoint() -> set[str]:
    if not CHECKPOINT.exists():
        return set()
    return {ln.strip() for ln in CHECKPOINT.read_text().splitlines() if ln.strip()}


def append_checkpoint(ids: list[str]) -> None:
    with CHECKPOINT.open("a", encoding="utf-8") as f:
        for i in ids:
            f.write(f"{i}\n")


def fetch_candidates(
    conn,
    values: list[tuple],
    *,
    bbox: float,
    radius: float,
    poi_source: str | None = None,
) -> list[dict]:
    if not values:
        return []
    source_clause = ""
    if poi_source:
        from psycopg2.extensions import adapt

        source_clause = f"AND p.source = {adapt(poi_source).getquoted().decode()}"
    sql = f"""
        WITH input(place_id, place_name, plat, plng) AS (VALUES %s),
        normed AS (
          SELECT place_id, place_name, plat, plng,
                 public.normalize_poi_name(place_name) AS qn
          FROM input
          WHERE plat IS NOT NULL AND plng IS NOT NULL
            AND length(public.normalize_poi_name(place_name)) >= 2
        )
        SELECT
          n.place_id::text AS place_id,
          n.place_name,
          n.qn AS place_norm,
          p.id AS poi_id,
          p.name AS poi_name,
          p.name_norm AS poi_norm,
          p.source AS poi_source,
          (6371000.0 * 2.0 * asin(least(1.0, sqrt(
            power(sin(radians(p.lat - n.plat)/2.0),2) +
            cos(radians(n.plat))*cos(radians(p.lat))*
            power(sin(radians(p.lng - n.plng)/2.0),2)
          )))) AS dist_m,
          (similarity(p.name_norm, n.qn) * 100.0) AS sim_raw
        FROM normed n
        JOIN public.poi p
          ON p.lat IS NOT NULL AND p.lng IS NOT NULL
         AND p.lat BETWEEN n.plat - {bbox} AND n.plat + {bbox}
         AND p.lng BETWEEN n.plng - {bbox} AND n.plng + {bbox}
         {source_clause}
        WHERE (6371000.0 * 2.0 * asin(least(1.0, sqrt(
            power(sin(radians(p.lat - n.plat)/2.0),2) +
            cos(radians(n.plat))*cos(radians(p.lat))*
            power(sin(radians(p.lng - n.plng)/2.0),2)
          )))) <= {radius}
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        execute_values(
            cur,
            sql,
            values,
            template="(%s::text, %s::text, %s::double precision, %s::double precision)",
            page_size=len(values),
        )
        return [dict(r) for r in cur.fetchall()]


def analyze(place_name: str, place_norm: str, cands: list[dict], *, routing: bool):
    score_fn = score_candidate_routing if routing else score_candidate
    filter_fn = apply_filters_routing if routing else apply_filters
    would = None
    blocked: list[dict] = []
    for c in cands:
        sim_raw = float(c["sim_raw"] or 0)
        soft_a = soft_normalize_display(place_name)
        soft_b = soft_normalize_display(c["poi_name"] or "")
        soft_sim = (
            SequenceMatcher(None, soft_a, soft_b).ratio() * 100.0
            if soft_a and soft_b
            else 0.0
        )
        scored = score_fn(
            place_name,
            place_norm or c.get("place_norm") or "",
            c["poi_name"] or "",
            c["poi_norm"] or "",
            sim_raw,
        )
        if not scored:
            continue
        score, reason = scored
        dist_m = float(c["dist_m"])
        block = filter_fn(
            place_name,
            place_norm or c.get("place_norm") or "",
            c["poi_name"] or "",
            c["poi_norm"] or "",
            score,
            reason,
            dist_m,
        )
        row = {
            "poi_name": c["poi_name"],
            "poi_source": c["poi_source"],
            "dist_m": dist_m,
            "sim_raw": sim_raw,
            "soft_sim": soft_sim,
            "score": score,
            "reason": reason,
            "block": block,
        }
        if block:
            blocked.append(row)
        elif would is None or (score, -dist_m) > (would["score"], -would["dist_m"]):
            would = row
    blocked.sort(key=lambda r: (-r["score"], r["dist_m"]))
    return would, blocked


def best_name(cands: list[dict], place_name: str):
    best = None
    soft_a = soft_normalize_display(place_name)
    pn = soft_a or normalize_poi_name(place_name)
    for c in cands:
        sim_raw = float(c["sim_raw"] or 0)
        soft_b = soft_normalize_display(c["poi_name"] or "")
        soft_sim = (
            SequenceMatcher(None, soft_a, soft_b).ratio() * 100.0
            if soft_a and soft_b
            else 0.0
        )
        ns = max(sim_raw, soft_sim)
        qn = soft_b or (c.get("poi_norm") or "")
        if pn and qn and len(pn) >= 2 and (pn in qn or qn in pn):
            ns = max(ns, 80.0)
        if best is None or ns > best["name_score"]:
            best = {
                "poi_name": c["poi_name"],
                "poi_source": c["poi_source"],
                "dist_m": float(c["dist_m"]),
                "sim_raw": sim_raw,
                "soft_sim": soft_sim,
                "name_score": ns,
            }
    return best


def global_name_sql(conn, place_name: str, plat, plng, limit: int = 8) -> list[dict]:
    qn = normalize_poi_name(place_name)
    if len(qn) < 2:
        return []
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
              p.name AS poi_name,
              p.source AS poi_source,
              (similarity(p.name_norm, %s) * 100.0) AS sim_raw,
              CASE WHEN %s::float8 IS NOT NULL AND p.lat IS NOT NULL THEN
                (6371000.0 * 2.0 * asin(least(1.0, sqrt(
                  power(sin(radians(p.lat - %s)/2.0),2) +
                  cos(radians(%s))*cos(radians(p.lat))*
                  power(sin(radians(p.lng - %s)/2.0),2)
                ))))
              ELSE NULL END AS dist_m
            FROM public.poi p
            WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
              AND (p.name_norm %% %s OR p.name_norm = %s)
            ORDER BY similarity(p.name_norm, %s) DESC
            LIMIT %s
            """,
            (qn, plat, plat, plat, plng, qn, qn, qn, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]

    soft = soft_normalize_display(place_name)
    out: list[dict] = []
    for r in rows:
        sim = float(r["sim_raw"] or 0)
        soft_sim = (
            SequenceMatcher(
                None, soft, soft_normalize_display(r["poi_name"] or "")
            ).ratio()
            * 100.0
            if soft
            else 0.0
        )
        pb = soft_normalize_display(r["poi_name"] or "")
        if soft and pb and soft == pb:
            soft_sim = 100.0
        elif soft and pb:
            shorter = min(len(soft), len(pb))
            longer = max(len(soft), len(pb)) or 1
            if shorter >= 3 and (soft in pb or pb in soft) and shorter / longer >= 0.55:
                soft_sim = max(soft_sim, 70.0 + 30.0 * (shorter / longer))
        if max(sim, soft_sim) < GLOBAL_NAME:
            continue
        out.append(
            {
                "poi_name": r["poi_name"],
                "poi_source": r["poi_source"],
                "sim_raw": sim,
                "soft_sim": soft_sim,
                "dist_m": None if r["dist_m"] is None else float(r["dist_m"]),
            }
        )
    out.sort(key=lambda x: (-max(x["sim_raw"], x["soft_sim"]), x["dist_m"] or 1e18))
    return out[:limit]


def classify(place_name, n_300, would, blocked, best300, global_hits, facility_block):
    d_blocks = [
        b
        for b in blocked
        if b["block"] in ("franchise_prefix", "facility_keyword", "reverse_contain")
    ]
    c_blocks = [b for b in blocked if b["block"] == "distance"]

    if would:
        return "E", f"규칙상 매칭 가능: {would['poi_name']} {would['dist_m']:.1f}m"

    if d_blocks:
        b0 = d_blocks[0]
        if not c_blocks or b0["score"] >= c_blocks[0]["score"] - 5:
            return (
                "D",
                f"{b0['block']}: {b0['poi_name']} score={b0['score']:.1f} {b0['dist_m']:.1f}m",
            )

    if c_blocks:
        b0 = c_blocks[0]
        return (
            "C",
            f"distance: {b0['poi_name']} score={b0['score']:.1f} {b0['dist_m']:.1f}m",
        )

    if facility_block:
        return "D", "facility_keyword (장소명 시설 접미, 통과 후보 없음)"

    if best300 and best300["name_score"] >= NEAR_NAME:
        return (
            "B",
            f"근처 유사·스코어미달: {best300['poi_name']} "
            f"raw={best300['sim_raw']:.1f} soft={best300['soft_sim']:.1f} "
            f"ns={best300['name_score']:.1f} {best300['dist_m']:.1f}m",
        )

    good_g = [
        g for g in global_hits if max(g["sim_raw"], g["soft_sim"]) >= GLOBAL_NAME
    ]
    if good_g:
        good_g.sort(key=lambda g: g["dist_m"] if g["dist_m"] is not None else 1e18)
        g0 = good_g[0]
        d = g0["dist_m"]
        if d is not None and d > RADIUS_M:
            return (
                "C",
                f"전국 유사 POI far: {g0['poi_name']} {d:.0f}m "
                f"sim={max(g0['sim_raw'], g0['soft_sim']):.1f}",
            )
        if d is not None and d <= RADIUS_M:
            return "B", f"전국검색 유사·로컬스코어실패: {g0['poi_name']} {d:.1f}m"
        return "C", f"전국 유사 POI: {g0['poi_name']}"

    if n_300 == 0:
        return "A", "반경300m POI 0 + 전국 유사명 없음"
    return "A", f"반경300m POI {n_300} + 유사명/전국매칭 없음"


def diagnose_place(conn, p, cands_g, cands_r) -> dict:
    name = p["name"] or ""
    pn = normalize_poi_name(name)
    would, blocked = analyze(name, pn, cands_g, routing=False)
    best300 = best_name(cands_g, name)
    fac = ends_with_facility_block(name)
    label, detail = classify(
        name, len(cands_g), would, blocked, best300, [], fac
    )
    if cands_r:
        would_r, blocked_r = analyze(name, pn, cands_r, routing=True)
        if would_r:
            label, detail = "E", f"routing would match: {would_r['poi_name']}"
        else:
            best_r = best_name(cands_r, name)
            label2, detail2 = classify(
                name, len(cands_r), would_r, blocked_r, best_r, [], fac
            )
            if label2 in ("C", "D") or (label2 == "B" and label == "A"):
                label, detail = label2, "routing:" + detail2

    ghits: list[dict] = []
    if label in ("A", "B"):
        ghits = global_name_sql(conn, name, p.get("lat"), p.get("lng"))
        label, detail = classify(
            name, len(cands_g), would, blocked, best300, ghits, fac
        )

    return {
        "place_id": str(p["id"]),
        "name": name,
        "lat": p.get("lat"),
        "lng": p.get("lng"),
        "address": p.get("address"),
        "label": label,
        "detail": detail,
        "n_300": len(cands_g),
        "best300": best300,
        "global_top": ghits[:3],
        "facility_block": fac,
    }


def csv_max(path: Path, col: str, open_only: bool = False) -> str | None:
    mx = None
    with open(path, encoding="cp949", newline="") as f:
        for row in csv.DictReader(f):
            if open_only and row.get("영업상태명") != "영업/정상":
                continue
            v = (row.get(col) or "").strip()
            if v and (mx is None or v > mx):
                mx = v
    return mx


def run_part1_dates() -> None:
    print("=== [1] LOCALDATA 기준일 ===", flush=True)
    conn = connect()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT source, count(*) AS n,
                   min(updated_at) AS min_u, max(updated_at) AS max_u
            FROM public.poi
            GROUP BY source
            ORDER BY 1
            """
        )
        for r in cur.fetchall():
            print(
                f"  poi {r['source']}: n={r['n']} updated_at {r['min_u']} .. {r['max_u']}",
                flush=True,
            )
    conn.close()

    a_specs = [
        ("localdata_general", "general_restaurants.csv", "데이터갱신시점"),
        ("localdata_rest", "rest_cafes.csv", "데이터갱신시점"),
        ("localdata_hotel", "tourist_accommodations.csv", "데이터갱신시점"),
    ]
    print("CSV 원본:", flush=True)
    for label, fname, col in a_specs:
        path = LOCALDATA_DIR / fname
        if not path.exists():
            print(f"  {label}: MISSING {path}", flush=True)
            continue
        mx = csv_max(path, col)
        mx_open = csv_max(path, col, open_only=True)
        print(f"  {label}: max {col}={mx} (영업/정상={mx_open})", flush=True)

    if RAW_B.exists():
        for path in sorted(RAW_B.glob("*.csv")):
            mx = csv_max(path, "데이터기준일자")
            print(f"  B {path.name}: max 데이터기준일자={mx}", flush=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    try:
        run_part1_dates()
    except Exception as e:
        print("PART1 FAIL:", redact(e), flush=True)
        print("연결 실패 — 중단", flush=True)
        return

    done = load_checkpoint()
    print(f"checkpoint done={len(done)}", flush=True)

    try:
        conn = connect()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id::text AS id, name, lat, lng, address
                FROM public.places
                WHERE source IS NULL
                ORDER BY id
                """
            )
            places = [dict(r) for r in cur.fetchall()]
        conn.close()
    except Exception as e:
        print("LOAD PLACES FAIL:", redact(e), flush=True)
        print("연결 실패 — 중단", flush=True)
        return

    remaining = [p for p in places if str(p["id"]) not in done]
    print(f"unmatched total={len(places)} remaining={len(remaining)}", flush=True)

    print("\n=== [2] focus ===", flush=True)
    focus_out: list[dict] = []
    try:
        conn = connect()
        for nm in FOCUS:
            hits = [p for p in places if (p["name"] or "") == nm]
            if not hits:
                hits = [p for p in places if nm in (p["name"] or "")]
            if not hits:
                print(f"{nm}: NOT FOUND in unmatched", flush=True)
                focus_out.append({"name": nm, "error": "not_found"})
                continue
            p = hits[0]
            vals = [(str(p["id"]), p["name"], p["lat"], p["lng"])]
            cands = fetch_candidates(conn, vals, bbox=BBOX_DEG, radius=RADIUS_M)
            rcands: list[dict] = []
            rk = detect_facility_route(p["name"] or "")
            if rk:
                rcands = fetch_candidates(
                    conn,
                    vals,
                    bbox=ROUTING_BBOX_DEG,
                    radius=ROUTING_RADIUS_M,
                    poi_source=rk,
                )
            d = diagnose_place(conn, p, cands, rcands)
            focus_out.append(d)
            print(f"\n## {nm}", flush=True)
            print(f"  ({p['lat']}, {p['lng']}) {p.get('address')}", flush=True)
            print(f"  n_300={d['n_300']} facility={d['facility_block']}", flush=True)
            b = d["best300"]
            if b:
                print(
                    f"  best300: {b['poi_name']} | {b['poi_source']} | "
                    f"raw={b['sim_raw']:.1f} soft={b['soft_sim']:.1f} | {b['dist_m']:.1f}m",
                    flush=True,
                )
            print(f"  => {d['label']}: {d['detail']}", flush=True)
            for g in d["global_top"][:3]:
                print(
                    f"  global: {g['poi_name']} | sim={max(g['sim_raw'], g['soft_sim']):.1f} | "
                    f"{None if g['dist_m'] is None else round(g['dist_m'], 1)}m",
                    flush=True,
                )
        conn.close()
    except Exception as e:
        print("FOCUS FAIL:", redact(e), flush=True)
        print("연결 실패 — 중단", flush=True)
        return

    print("\n=== [3] full batches ===", flush=True)
    dist: Counter = Counter()
    if RESULTS.exists() and done:
        with RESULTS.open(encoding="utf-8") as f:
            for line in f:
                try:
                    dist[json.loads(line)["label"]] += 1
                except Exception:
                    pass
        print(f"resumed counts: {dict(dist)}", flush=True)

    for i in range(0, len(remaining), BATCH):
        batch = remaining[i : i + BATCH]
        bi = i // BATCH + 1
        total_b = (len(remaining) + BATCH - 1) // BATCH
        print(f"batch {bi}/{total_b} size={len(batch)} …", flush=True)
        try:
            conn = connect()
            vals = [
                (str(p["id"]), p["name"], p["lat"], p["lng"])
                for p in batch
                if p.get("lat") is not None and p.get("lng") is not None
            ]
            cands = fetch_candidates(conn, vals, bbox=BBOX_DEG, radius=RADIUS_M)
            by_g: dict[str, list] = defaultdict(list)
            for c in cands:
                by_g[str(c["place_id"])].append(c)

            by_r: dict[str, list] = defaultdict(list)
            route_groups: dict[str, list] = defaultdict(list)
            for p in batch:
                rk = detect_facility_route(p["name"] or "")
                if rk and p.get("lat") is not None:
                    route_groups[rk].append(p)
            for rk, ps in route_groups.items():
                rvals = [(str(p["id"]), p["name"], p["lat"], p["lng"]) for p in ps]
                for c in fetch_candidates(
                    conn,
                    rvals,
                    bbox=ROUTING_BBOX_DEG,
                    radius=ROUTING_RADIUS_M,
                    poi_source=rk,
                ):
                    by_r[str(c["place_id"])].append(c)

            batch_ids: list[str] = []
            with RESULTS.open("a", encoding="utf-8") as rf:
                for p in batch:
                    pid = str(p["id"])
                    d = diagnose_place(
                        conn, p, by_g.get(pid, []), by_r.get(pid, [])
                    )
                    dist[d["label"]] += 1
                    rf.write(json.dumps(d, ensure_ascii=False, default=str) + "\n")
                    batch_ids.append(pid)
            conn.close()
            append_checkpoint(batch_ids)
            print(
                f"  done {min(i + BATCH, len(remaining))}/{len(remaining)} "
                f"counts={dict(dist)}",
                flush=True,
            )
        except Exception as e:
            print(f"BATCH {bi} FAIL:", redact(e), flush=True)
            print("연결/쿼리 실패 — 중단 (체크포인트 유지)", flush=True)
            break

    summary = {
        "focus": focus_out,
        "distribution": dict(dist),
        "checkpoint_n": len(load_checkpoint()),
        "elapsed_s": round(time.time() - t0, 1),
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    print("\nDISTRIBUTION", flush=True)
    total = sum(dist.values())
    for k in "ABCDE":
        n = dist.get(k, 0)
        pct = 100.0 * n / total if total else 0
        print(f"  {k}: {n} ({pct:.1f}%)", flush=True)
    print(f"wrote {SUMMARY} ({summary['elapsed_s']}s)", flush=True)


if __name__ == "__main__":
    main()
