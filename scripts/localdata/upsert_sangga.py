#!/usr/bin/env python3
"""상가(상권)정보 → public.poi (source='sangga') 배치 upsert.

실행 전 필수: poi_source_check 에 'sangga' 추가.

  scripts/localdata/.venv/bin/python scripts/localdata/upsert_sangga.py

롤백:
  DELETE FROM public.poi WHERE source='sangga';

옵션:
  --match-dry-run   places(kakao/null) 매칭만 (poi 쓰기 없음)
  --prepare-only    필터·dedupe 후 CSV만 작성 (쓰기 없음)
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

from prepare import OUT_DIR, db_url
from poi_match import (
    BBOX_DEG,
    RADIUS_M,
    evaluate_candidate_pair,
    normalize_poi_name,
)
from sangga_common import (
    INCLUDE_CODES,
    SANGGA_MAP,
    SOURCE,
    decode_zip_member_name,
    sangga_guard_reject_reason,
)

RAW_D = Path(__file__).resolve().parent / "raw_d"
BATCH = 5000
HARD_DEDUP_M = 50.0
SELF_CELL = 0.0005  # ~55m


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def find_zip() -> Path:
    zips = sorted(RAW_D.glob("*_20260630.zip"))
    if not zips:
        raise FileNotFoundError(f"zip not found under {RAW_D}")
    return zips[0]


def stream_filtered(zpath: Path) -> list[dict]:
    rows: list[dict] = []
    code_counts: Counter[str] = Counter()
    with zipfile.ZipFile(zpath) as zf:
        members = zf.infolist()
        for mi, info in enumerate(members, 1):
            name = decode_zip_member_name(info.filename)
            if not name.endswith(".csv"):
                continue
            print(f"  stream [{mi}/{len(members)}] {Path(name).name}", flush=True)
            with zf.open(info) as bf:
                text = io.TextIOWrapper(bf, encoding="utf-8-sig", newline="")
                for row in csv.DictReader(text):
                    code = (row.get("상권업종소분류코드") or "").strip()
                    if code not in INCLUDE_CODES:
                        continue
                    try:
                        lat = float(row["위도"])
                        lng = float(row["경도"])
                    except Exception:
                        continue
                    if not (33 <= lat <= 39 and 124 <= lng <= 132):
                        continue
                    nm = (row.get("상호명") or "").strip()
                    if not nm:
                        continue
                    nn = normalize_poi_name(nm)
                    if len(nn) < 2:
                        continue
                    sk = (row.get("상가업소번호") or "").strip()
                    if not sk:
                        continue
                    cat, sub = SANGGA_MAP[code]
                    raw = (row.get("상권업종소분류명") or "").strip()
                    code_counts[code] += 1
                    rows.append(
                        {
                            "source": SOURCE,
                            "source_key": sk,
                            "name": nm,
                            "name_norm": nn,
                            "road_address": (row.get("도로명주소") or "").strip(),
                            "jibun_address": (row.get("지번주소") or "").strip(),
                            "lat": lat,
                            "lng": lng,
                            "raw_category": raw,
                            "category": cat,
                            "subcategory": sub,
                            "code": code,
                            "phone": "",
                        }
                    )
    print(f"  filtered={len(rows):,} by_code={dict(code_counts)}", flush=True)
    return rows


def self_dedupe_50m(rows: list[dict]) -> tuple[list[dict], int]:
    """동일 name_norm + ≤50m → 첫 행만 유지. source_key 중복도 제거."""
    by_key: dict[str, dict] = {}
    for r in rows:
        by_key[r["source_key"]] = r  # 마지막 유지
    uniq = list(by_key.values())
    grid: dict[tuple[int, int, str], list[dict]] = defaultdict(list)
    kept: list[dict] = []
    dup = 0
    for r in uniq:
        i0 = int(r["lat"] / SELF_CELL)
        j0 = int(r["lng"] / SELF_CELL)
        hit = False
        for ii in range(i0 - 1, i0 + 2):
            for jj in range(j0 - 1, j0 + 2):
                for t in grid.get((ii, jj, r["name_norm"]), []):
                    if haversine_m(r["lat"], r["lng"], t["lat"], t["lng"]) <= HARD_DEDUP_M:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            dup += 1
            continue
        grid[(i0, j0, r["name_norm"])].append(r)
        kept.append(r)
    return kept, dup


def load_existing_poi_index(conn) -> dict[tuple[int, int, str], list[tuple[float, float]]]:
    """전체 poi (sangga 제외) name_norm 격자 — hard skip용."""
    grid: dict[tuple[int, int, str], list[tuple[float, float]]] = defaultdict(list)
    with conn.cursor(name="poi_hard_skip") as cur:
        cur.itersize = 20000
        cur.execute(
            """
            SELECT name, lat, lng
            FROM public.poi
            WHERE lat IS NOT NULL AND lng IS NOT NULL
              AND source IS DISTINCT FROM %s
            """,
            (SOURCE,),
        )
        n = 0
        for name, lat, lng in cur:
            nn = normalize_poi_name(name or "")
            if len(nn) < 2:
                continue
            try:
                la, ln = float(lat), float(lng)
            except Exception:
                continue
            grid[(int(la / SELF_CELL), int(ln / SELF_CELL), nn)].append((la, ln))
            n += 1
            if n % 200000 == 0:
                print(f"  existing poi indexed {n:,}", flush=True)
    print(f"  existing poi indexed total={n:,}", flush=True)
    return grid


def hard_skip_existing(
    rows: list[dict],
    grid: dict[tuple[int, int, str], list[tuple[float, float]]],
) -> tuple[list[dict], int]:
    kept: list[dict] = []
    skipped = 0
    for r in rows:
        i0 = int(r["lat"] / SELF_CELL)
        j0 = int(r["lng"] / SELF_CELL)
        hit = False
        for ii in range(i0 - 1, i0 + 2):
            for jj in range(j0 - 1, j0 + 2):
                for la, ln in grid.get((ii, jj, r["name_norm"]), []):
                    if haversine_m(r["lat"], r["lng"], la, ln) <= HARD_DEDUP_M:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            skipped += 1
        else:
            kept.append(r)
    return kept, skipped


def upsert_batches(conn, rows: list[dict]) -> dict:
    total = len(rows)
    inserted = updated = unchanged = 0
    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0")
        cur.execute(
            "SELECT count(*)::bigint FROM public.poi WHERE source = %s",
            (SOURCE,),
        )
        before = int(cur.fetchone()[0])

    for start in range(0, total, BATCH):
        chunk = rows[start : start + BATCH]
        vals = [
            (
                r["source"],
                r["source_key"],
                r["name"],
                r["name_norm"],
                r["road_address"] or None,
                r["jibun_address"] or None,
                r["lat"],
                r["lng"],
                r["raw_category"] or None,
                r["category"] or None,
                r["phone"] or None,
            )
            for r in chunk
        ]
        with conn.cursor() as cur:
            # classify
            cur.execute(
                """
                CREATE TEMP TABLE IF NOT EXISTS sangga_stage (
                  source text, source_key text, name text, name_norm text,
                  road_address text, jibun_address text,
                  lat double precision, lng double precision,
                  raw_category text, category text, phone text
                )
                """
            )
            cur.execute("TRUNCATE sangga_stage")
            execute_values(
                cur,
                """
                INSERT INTO sangga_stage (
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone
                ) VALUES %s
                """,
                vals,
                page_size=1000,
            )
            cur.execute(
                """
                SELECT
                  count(*) FILTER (WHERE p.source_key IS NULL)::bigint AS ins,
                  count(*) FILTER (
                    WHERE p.source_key IS NOT NULL AND (
                      p.name IS DISTINCT FROM s.name
                      OR p.name_norm IS DISTINCT FROM s.name_norm
                      OR p.road_address IS DISTINCT FROM s.road_address
                      OR p.jibun_address IS DISTINCT FROM s.jibun_address
                      OR p.lat IS DISTINCT FROM s.lat
                      OR p.lng IS DISTINCT FROM s.lng
                      OR p.raw_category IS DISTINCT FROM s.raw_category
                      OR p.category IS DISTINCT FROM s.category
                      OR p.phone IS DISTINCT FROM s.phone
                    )
                  )::bigint AS upd,
                  count(*) FILTER (
                    WHERE p.source_key IS NOT NULL AND NOT (
                      p.name IS DISTINCT FROM s.name
                      OR p.name_norm IS DISTINCT FROM s.name_norm
                      OR p.road_address IS DISTINCT FROM s.road_address
                      OR p.jibun_address IS DISTINCT FROM s.jibun_address
                      OR p.lat IS DISTINCT FROM s.lat
                      OR p.lng IS DISTINCT FROM s.lng
                      OR p.raw_category IS DISTINCT FROM s.raw_category
                      OR p.category IS DISTINCT FROM s.category
                      OR p.phone IS DISTINCT FROM s.phone
                    )
                  )::bigint AS unch
                FROM sangga_stage s
                LEFT JOIN public.poi p
                  ON p.source = s.source AND p.source_key = s.source_key
                """
            )
            ins, upd, unch = cur.fetchone()
            inserted += int(ins)
            updated += int(upd)
            unchanged += int(unch)

            cur.execute(
                """
                INSERT INTO public.poi (
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone, updated_at
                )
                SELECT
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone, now()
                FROM sangga_stage
                ON CONFLICT (source, source_key) DO UPDATE SET
                  name = EXCLUDED.name,
                  name_norm = EXCLUDED.name_norm,
                  road_address = EXCLUDED.road_address,
                  jibun_address = EXCLUDED.jibun_address,
                  lat = EXCLUDED.lat,
                  lng = EXCLUDED.lng,
                  raw_category = EXCLUDED.raw_category,
                  category = EXCLUDED.category,
                  phone = EXCLUDED.phone,
                  updated_at = now()
                WHERE
                  public.poi.name IS DISTINCT FROM EXCLUDED.name
                  OR public.poi.name_norm IS DISTINCT FROM EXCLUDED.name_norm
                  OR public.poi.road_address IS DISTINCT FROM EXCLUDED.road_address
                  OR public.poi.jibun_address IS DISTINCT FROM EXCLUDED.jibun_address
                  OR public.poi.lat IS DISTINCT FROM EXCLUDED.lat
                  OR public.poi.lng IS DISTINCT FROM EXCLUDED.lng
                  OR public.poi.raw_category IS DISTINCT FROM EXCLUDED.raw_category
                  OR public.poi.category IS DISTINCT FROM EXCLUDED.category
                  OR public.poi.phone IS DISTINCT FROM EXCLUDED.phone
                """
            )
        conn.commit()
        done = min(start + BATCH, total)
        elapsed = time.time() - t0
        rate = done / elapsed if elapsed else 0
        print(
            f"  upsert {done:,}/{total:,} ({100*done/total:.1f}%) "
            f"+{inserted:,} new / {updated:,} upd / {unchanged:,} same "
            f"[{elapsed:.0f}s, {rate:.0f} rows/s]",
            flush=True,
        )

    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*)::bigint FROM public.poi WHERE source = %s",
            (SOURCE,),
        )
        after = int(cur.fetchone()[0])
    return {
        "before": before,
        "after": after,
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "candidates": total,
    }


def build_sangga_grid(rows: list[dict]):
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        grid[(int(r["lat"] / BBOX_DEG), int(r["lng"] / BBOX_DEG))].append(i)
    return grid


def best_sangga_match(place, rows, grid, *, apply_guard: bool):
    plat, plng = float(place["lat"]), float(place["lng"])
    dlat = RADIUS_M / 111320.0
    dlng = RADIUS_M / (111320.0 * max(0.2, math.cos(math.radians(plat))))
    i0, i1 = int((plat - dlat) / BBOX_DEG), int((plat + dlat) / BBOX_DEG)
    j0, j1 = int((plng - dlng) / BBOX_DEG), int((plng + dlng) / BBOX_DEG)
    best = None
    guarded_partial = None
    guarded_sim = None
    for ii in range(i0, i1 + 1):
        for jj in range(j0, j1 + 1):
            for idx in grid.get((ii, jj), []):
                s = rows[idx]
                dist = haversine_m(plat, plng, s["lat"], s["lng"])
                if dist > RADIUS_M:
                    continue
                scored = evaluate_candidate_pair(
                    place["name"] or "", s["name"], dist, routing=False
                )
                if not scored:
                    continue
                score, reason = scored
                if apply_guard:
                    reject = sangga_guard_reject_reason(
                        place["name"] or "",
                        place.get("category"),
                        s["name"],
                        s["category"],
                        dist,
                    )
                    if reject:
                        row = {
                            "place": place,
                            "sangga": s,
                            "dist_m": dist,
                            "sim": score,
                            "reason": reason,
                            "reject": reject,
                        }
                        if reject == "sangga_partial_guard":
                            if (
                                guarded_partial is None
                                or score > guarded_partial["sim"]
                            ):
                                guarded_partial = row
                        elif reject == "sangga_sim_distance":
                            if guarded_sim is None or score > guarded_sim["sim"]:
                                guarded_sim = row
                        continue
                row = {
                    "place": place,
                    "sangga": s,
                    "dist_m": dist,
                    "sim": score,
                    "reason": reason,
                }
                if best is None or score > best["sim"] or (
                    score == best["sim"] and dist < best["dist_m"]
                ):
                    best = row
    return best, guarded_partial, guarded_sim


def match_dry_run(conn, rows: list[dict]) -> dict:
    grid = build_sangga_grid(rows)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, lat, lng, category, coalesce(source, 'null') AS source
            FROM places
            WHERE (source IS NULL OR source = 'kakao')
              AND lat IS NOT NULL AND lng IS NOT NULL
            """
        )
        places = [dict(r) for r in cur.fetchall()]
    print(f"  places target={len(places):,}", flush=True)

    matched = []
    guarded_partial = []
    guarded_sim = []
    by_cat = Counter()
    unmatched_cat = Counter()
    seen_partial = set()
    seen_sim = set()

    for i, p in enumerate(places):
        m, gp, gs = best_sangga_match(p, rows, grid, apply_guard=True)
        if m:
            matched.append(m)
            by_cat[p.get("category") or "?"] += 1
        else:
            unmatched_cat[p.get("category") or "?"] += 1
            if gp:
                key = (p["id"], gp["sangga"]["source_key"])
                if key not in seen_partial:
                    seen_partial.add(key)
                    guarded_partial.append(gp)
            if gs:
                key = (p["id"], gs["sangga"]["source_key"])
                if key not in seen_sim:
                    seen_sim.add(key)
                    guarded_sim.append(gs)
        if i and i % 2000 == 0:
            print(f"  match progress {i}/{len(places)} hit={len(matched)}", flush=True)

    # samples 30 unique place names, prefer cat-aligned
    samples = []
    used_names = set()
    aligned = [
        m
        for m in matched
        if (m["place"].get("category") or "") == (m["sangga"].get("category") or "")
    ]
    other = [m for m in matched if m not in aligned]
    for pool in (aligned, other):
        for m in pool:
            nm = m["place"]["name"]
            if nm in used_names:
                continue
            used_names.add(nm)
            samples.append(m)
            if len(samples) >= 30:
                break
        if len(samples) >= 30:
            break

    def uniq_samples(pool, n=10):
        out = []
        used = set()
        for g in pool:
            nm = g["place"]["name"]
            if nm in used:
                continue
            used.add(nm)
            out.append(g)
            if len(out) >= n:
                break
        return out

    return {
        "places": len(places),
        "matched": len(matched),
        "by_cat": dict(by_cat),
        "unmatched_cat": dict(unmatched_cat),
        "guarded_partial_n": len(guarded_partial),
        "guarded_sim_n": len(guarded_sim),
        "samples": samples,
        "guard_partial_samples": uniq_samples(guarded_partial, 10),
        "guard_sim_samples": uniq_samples(guarded_sim, 10),
        "sangga_n": len(rows),
    }


def write_stage_csv(rows: list[dict], path: Path) -> None:
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
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def main() -> int:
    ap = argparse.ArgumentParser(description="상가(상권) → poi sangga upsert")
    ap.add_argument(
        "--match-dry-run",
        action="store_true",
        help="places 매칭 dry-run only (no poi write)",
    )
    ap.add_argument(
        "--prepare-only",
        action="store_true",
        help="filter+dedupe CSV only (no poi write)",
    )
    args = ap.parse_args()

    zpath = find_zip()
    print(f"=== sangga zip: {zpath.name} ===", flush=True)
    t0 = time.time()
    rows = stream_filtered(zpath)
    filtered_n = len(rows)
    rows, self_dup = self_dedupe_50m(rows)
    print(f"  self_dedupe_50m skipped={self_dup:,} kept={len(rows):,}", flush=True)

    if args.match_dry_run:
        conn = psycopg2.connect(db_url(), connect_timeout=60)
        conn.set_session(readonly=True, autocommit=True)
        try:
            report = match_dry_run(conn, rows)
        finally:
            conn.close()
        print("\n=== MATCH DRY-RUN ===", flush=True)
        print(f"sangga_candidates={report['sangga_n']:,}", flush=True)
        print(
            f"matched={report['matched']:,}/{report['places']:,} "
            f"guarded_partial={report['guarded_partial_n']:,} "
            f"guarded_sim_dist={report['guarded_sim_n']:,}",
            flush=True,
        )
        print("by_cat", report["by_cat"], flush=True)
        print("--- guard b sim-distance rejected samples (10) ---", flush=True)
        for g in report["guard_sim_samples"]:
            p, s = g["place"], g["sangga"]
            print(
                f"{p.get('category')}|{p['name']}|{s['name']}|"
                f"{round(g['dist_m'],1)}|{s['category']}|{g['reason']}|"
                f"sim={round(g['sim'],1)}",
                flush=True,
            )
        print("--- match samples (30) ---", flush=True)
        for m in report["samples"]:
            p, s = m["place"], m["sangga"]
            print(
                f"{p.get('category')}|{p['name']}|{s['name']}|"
                f"{round(m['dist_m'],1)}|{s['code']}|{m['reason']}|"
                f"sim={round(m['sim'],1)}",
                flush=True,
            )
        out = OUT_DIR / "sangga_match_dryrun.json"
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        import json

        out.write_text(
            json.dumps(
                {
                    "filtered_n": filtered_n,
                    "self_dup": self_dup,
                    "candidates": len(rows),
                    "matched": report["matched"],
                    "places": report["places"],
                    "by_cat": report["by_cat"],
                    "unmatched_cat": report["unmatched_cat"],
                    "guarded_partial_n": report["guarded_partial_n"],
                    "guarded_sim_n": report["guarded_sim_n"],
                    "elapsed_s": round(time.time() - t0, 1),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"wrote {out}", flush=True)
        return 0

    # hard skip vs existing poi (read)
    print("=== hard-skip vs existing poi (50m) ===", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    try:
        grid = load_existing_poi_index(conn)
        rows, hard_skip = hard_skip_existing(rows, grid)
        print(f"  hard_skip={hard_skip:,} load_candidates={len(rows):,}", flush=True)

        stage = OUT_DIR / "sangga_load_stage.csv"
        write_stage_csv(rows, stage)
        print(f"  wrote {stage} rows={len(rows):,}", flush=True)

        if args.prepare_only:
            print("prepare-only: stop before upsert", flush=True)
            return 0

        print(f"=== upsert source={SOURCE} batches={BATCH} ===", flush=True)
        result = upsert_batches(conn, rows)
        print(
            f"DONE before={result['before']:,} after={result['after']:,} "
            f"+{result['inserted']:,} / upd {result['updated']:,} / "
            f"same {result['unchanged']:,}",
            flush=True,
        )
        print("rollback: DELETE FROM public.poi WHERE source='sangga';", flush=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
