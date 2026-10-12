#!/usr/bin/env python3
"""상가(상권)정보 ↔ places(kakao / source null) 매칭 측정 (SELECT only).

- DB 쓰기 금지. 이름·주소·좌표·user_id 로그 금지 (숫자·카테고리만).
- 매칭: lib/poiMatch.rules.json + poi_match.evaluate_candidate_pair
- 상가 가드: sangga_common.sangga_guard_reject_reason (upsert_sangga 와 동일)

출력: scripts/localdata/out/sangga_match_measure.json
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

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

RAW = Path(__file__).resolve().parent / "raw_sangga"
ZIP_NAME = "sangga_20260630.zip"
HARD_DEDUP_M = 50.0
SELF_CELL = 0.0005
POI_MATCH_M = 100.0  # name+distance overlap vs existing poi (exact/sim cap)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def find_zip() -> Path:
    z = RAW / ZIP_NAME
    if not z.is_file():
        raise FileNotFoundError(z)
    return z


def ensure_extracted(zpath: Path) -> list[Path]:
    RAW.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            name = decode_zip_member_name(info.filename)
            if not name.endswith(".csv"):
                continue
            dest = RAW / Path(name).name
            if not dest.exists():
                with zf.open(info) as src, dest.open("wb") as dst:
                    while True:
                        chunk = src.read(8 * 1024 * 1024)
                        if not chunk:
                            break
                        dst.write(chunk)
    return sorted(RAW.glob("*.csv"))


def inspect_csvs(csvs: list[Path]) -> dict:
    enc = "utf-8-sig"
    cols: list[str] | None = None
    # verify encoding
    with csvs[0].open("r", encoding=enc, newline="") as f:
        cols = list(csv.DictReader(f).fieldnames or [])
    by_da: Counter[str] = Counter()
    by_file: dict[str, int] = {}
    total = 0
    for p in csvs:
        n = 0
        with p.open("r", encoding=enc, newline="") as f:
            for row in csv.DictReader(f):
                n += 1
                by_da[(row.get("상권업종대분류명") or "?").strip() or "?"] += 1
        by_file[p.name] = n
        total += n
        print(f"  csv rows {p.name}={n:,}", flush=True)
    needed = ["상호명", "상권업종대분류명", "상권업종중분류명", "상권업종소분류명", "상권업종소분류코드", "위도", "경도", "도로명주소"]
    return {
        "encoding": enc,
        "csv_file_count": len(csvs),
        "total_rows": total,
        "columns": cols,
        "required_columns_present": {c: c in (cols or []) for c in needed},
        "rows_by_file": by_file,
        "rows_by_daebunryu": dict(by_da.most_common()),
        "closed_related_columns": [
            c
            for c in (cols or [])
            if any(k in c for k in ("폐업", "영업상태", "상태코드", "인허가"))
        ],
        "closed_note": (
            "컬럼에 폐업/영업상태 필드 없음. "
            "소상공인시장진흥공단 상가(상권)정보는 공표 시점 기준 영업 중으로 수집된 "
            "현재 상가 목록이며 폐업 이력을 포함하지 않음(스냅샷)."
        ),
    }


def map_da_to_app_cat(da: str, jung: str, so: str) -> str | None:
    """Rough app-chip bucket for sangga rows (reporting / filter only)."""
    da = (da or "").strip()
    jung = (jung or "").strip()
    so = (so or "").strip()
    if da == "음식":
        if "비알코올" in jung or so == "카페":
            return "카페"
        if "주점" in jung:
            return "술집"
        return "맛집"
    if da == "숙박":
        return "숙소"
    if da == "소매":
        return "쇼핑"
    if da in ("예술·스포츠", "교육"):
        return "놀거리"
    return None


def load_sangga_candidates(csvs: list[Path]) -> tuple[list[dict], dict]:
    """All valid name+coord rows + INCLUDE_CODES subset stats."""
    rows: list[dict] = []
    include_rows: list[dict] = []
    da_counts: Counter[str] = Counter()
    include_by_cat: Counter[str] = Counter()
    skipped = Counter()

    for pi, p in enumerate(csvs, 1):
        print(f"  load [{pi}/{len(csvs)}] {p.name}", flush=True)
        with p.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                nm = (row.get("상호명") or "").strip()
                if not nm:
                    skipped["no_name"] += 1
                    continue
                nn = normalize_poi_name(nm)
                if len(nn) < 2:
                    skipped["name_short"] += 1
                    continue
                try:
                    lat = float(row["위도"])
                    lng = float(row["경도"])
                except Exception:
                    skipped["bad_coord"] += 1
                    continue
                if not (33 <= lat <= 39 and 124 <= lng <= 132):
                    skipped["oob"] += 1
                    continue
                code = (row.get("상권업종소분류코드") or "").strip()
                da = (row.get("상권업종대분류명") or "").strip()
                jung = (row.get("상권업종중분류명") or "").strip()
                so = (row.get("상권업종소분류명") or "").strip()
                da_counts[da or "?"] += 1
                if code in INCLUDE_CODES:
                    cat, sub = SANGGA_MAP[code]
                else:
                    cat = map_da_to_app_cat(da, jung, so)
                    sub = None
                rec = {
                    "source_key": (row.get("상가업소번호") or "").strip(),
                    "name": nm,
                    "name_norm": nn,
                    "lat": lat,
                    "lng": lng,
                    "category": cat,
                    "code": code,
                    "da": da,
                }
                rows.append(rec)
                if code in INCLUDE_CODES:
                    include_rows.append(rec)
                    include_by_cat[cat or "?"] += 1

    stats = {
        "valid_rows": len(rows),
        "include_code_rows": len(include_rows),
        "include_by_mapped_cat": dict(include_by_cat),
        "skipped": dict(skipped),
        "valid_by_daebunryu": dict(da_counts.most_common()),
    }
    return rows, stats


def self_dedupe_50m(rows: list[dict]) -> tuple[list[dict], int]:
    by_key: dict[str, dict] = {}
    for r in rows:
        sk = r.get("source_key") or ""
        if sk:
            by_key[sk] = r
        else:
            by_key[f"_{id(r)}"] = r
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


def build_grid(rows: list[dict]):
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        grid[(int(r["lat"] / BBOX_DEG), int(r["lng"] / BBOX_DEG))].append(i)
    return grid


def best_match(place: dict, rows: list[dict], grid) -> dict | None:
    plat, plng = float(place["lat"]), float(place["lng"])
    dlat = RADIUS_M / 111320.0
    dlng = RADIUS_M / (111320.0 * max(0.2, math.cos(math.radians(plat))))
    i0, i1 = int((plat - dlat) / BBOX_DEG), int((plat + dlat) / BBOX_DEG)
    j0, j1 = int((plng - dlng) / BBOX_DEG), int((plng + dlng) / BBOX_DEG)
    best = None
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
                reject = sangga_guard_reject_reason(
                    place["name"] or "",
                    place.get("category"),
                    s["name"],
                    s.get("category"),
                    dist,
                )
                if reject:
                    continue
                row = {"dist_m": dist, "sim": score, "reason": reason}
                if best is None or score > best["sim"] or (
                    score == best["sim"] and dist < best["dist_m"]
                ):
                    best = row
    return best


def load_places(conn, source_mode: str) -> list[dict]:
    if source_mode == "kakao":
        where = "source = 'kakao'"
    elif source_mode == "null":
        where = "source IS NULL"
    else:
        raise ValueError(source_mode)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT id, name, lat, lng, category
            FROM public.places
            WHERE {where}
              AND lat IS NOT NULL AND lng IS NOT NULL
              AND name IS NOT NULL AND length(trim(name)) >= 2
            """
        )
        return [dict(r) for r in cur.fetchall()]


def load_poi_index(conn) -> tuple[
    dict[tuple[int, int], list[int]],
    list[tuple[str, float, float]],
    dict[tuple[int, int, str], list[tuple[float, float]]],
]:
    """POI spatial grid (for pair scoring) + name_norm grid (for hard-skip)."""
    pois: list[tuple[str, float, float]] = []
    spatial: dict[tuple[int, int], list[int]] = defaultdict(list)
    by_norm: dict[tuple[int, int, str], list[tuple[float, float]]] = defaultdict(list)
    prev_ac = conn.autocommit
    conn.autocommit = False
    try:
        with conn.cursor(name="poi_idx") as cur:
            cur.itersize = 20000
            cur.execute(
                """
                SELECT name, lat, lng
                FROM public.poi
                WHERE lat IS NOT NULL AND lng IS NOT NULL
                  AND name IS NOT NULL
                """
            )
            for name, lat, lng in cur:
                nm = (name or "").strip()
                nn = normalize_poi_name(nm)
                if len(nn) < 2:
                    continue
                try:
                    la, ln = float(lat), float(lng)
                except Exception:
                    continue
                idx = len(pois)
                pois.append((nm, la, ln))
                spatial[(int(la / BBOX_DEG), int(ln / BBOX_DEG))].append(idx)
                by_norm[(int(la / SELF_CELL), int(ln / SELF_CELL), nn)].append((la, ln))
                if idx and idx % 300000 == 0:
                    print(f"  poi indexed {idx:,}", flush=True)
        conn.rollback()
    finally:
        conn.autocommit = prev_ac
    print(f"  poi indexed total={len(pois):,}", flush=True)
    return spatial, pois, by_norm


def matches_existing_poi(
    place: dict,
    spatial: dict[tuple[int, int], list[int]],
    pois: list[tuple[str, float, float]],
) -> bool:
    """True if evaluate_candidate_pair accepts any nearby existing poi."""
    try:
        plat, plng = float(place["lat"]), float(place["lng"])
    except Exception:
        return False
    pname = place.get("name") or ""
    dlat = RADIUS_M / 111320.0
    dlng = RADIUS_M / (111320.0 * max(0.2, math.cos(math.radians(plat))))
    i0, i1 = int((plat - dlat) / BBOX_DEG), int((plat + dlat) / BBOX_DEG)
    j0, j1 = int((plng - dlng) / BBOX_DEG), int((plng + dlng) / BBOX_DEG)
    for ii in range(i0, i1 + 1):
        for jj in range(j0, j1 + 1):
            for idx in spatial.get((ii, jj), []):
                oname, la, ln = pois[idx]
                dist = haversine_m(plat, plng, la, ln)
                if dist > RADIUS_M:
                    continue
                if evaluate_candidate_pair(pname, oname, dist, routing=False):
                    return True
    return False


def hard_skip_existing_count(rows: list[dict], by_norm) -> tuple[int, int]:
    """Return (kept_as_new_estimate, skipped_as_dup) via name_norm ≤50m."""
    kept = 0
    skipped = 0
    for r in rows:
        i0 = int(r["lat"] / SELF_CELL)
        j0 = int(r["lng"] / SELF_CELL)
        hit = False
        for ii in range(i0 - 1, i0 + 2):
            for jj in range(j0 - 1, j0 + 2):
                for la, ln in by_norm.get((ii, jj, r["name_norm"]), []):
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
            kept += 1
    return kept, skipped


def measure_cohort(
    label: str,
    places: list[dict],
    sangga_rows: list[dict],
    sangga_grid,
    poi_spatial,
    pois,
) -> dict:
    print(f"=== match {label} n={len(places):,} vs sangga={len(sangga_rows):,} ===", flush=True)
    total_by_cat: Counter[str] = Counter()
    matched_by_cat: Counter[str] = Counter()
    unmatched_but_poi_by_cat: Counter[str] = Counter()
    unmatched_no_poi_by_cat: Counter[str] = Counter()
    matched = 0

    for i, p in enumerate(places):
        cat = (p.get("category") or "?").strip() or "?"
        total_by_cat[cat] += 1
        m = best_match(p, sangga_rows, sangga_grid)
        if m:
            matched += 1
            matched_by_cat[cat] += 1
        else:
            if matches_existing_poi(p, poi_spatial, pois):
                unmatched_but_poi_by_cat[cat] += 1
            else:
                unmatched_no_poi_by_cat[cat] += 1
        if i and i % 2000 == 0:
            print(
                f"  {label} progress {i}/{len(places)} matched={matched}",
                flush=True,
            )

    cats = sorted(
        set(total_by_cat)
        | set(matched_by_cat)
        | set(unmatched_but_poi_by_cat)
        | set(unmatched_no_poi_by_cat)
    )
    table = []
    for c in cats:
        table.append(
            {
                "category": c,
                "total": total_by_cat[c],
                "matched_sangga": matched_by_cat[c],
                "unmatched_but_in_poi": unmatched_but_poi_by_cat[c],
                "unmatched_and_not_in_poi": unmatched_no_poi_by_cat[c],
            }
        )
    table.sort(key=lambda r: -r["total"])
    return {
        "label": label,
        "places": len(places),
        "matched_sangga": matched,
        "match_rate": round(matched / len(places), 4) if places else 0.0,
        "by_category": table,
    }


def main() -> int:
    t0 = time.time()
    zpath = find_zip()
    print(f"zip={zpath.name}", flush=True)
    csvs = ensure_extracted(zpath)
    print(f"csv_files={len(csvs)}", flush=True)

    meta = inspect_csvs(csvs)
    print(
        f"TOTAL_ROWS={meta['total_rows']:,} encoding={meta['encoding']}",
        flush=True,
    )
    print("BY_DA", meta["rows_by_daebunryu"], flush=True)

    rows_all, load_stats = load_sangga_candidates(csvs)
    print(
        f"valid_sangga={load_stats['valid_rows']:,} "
        f"include_codes={load_stats['include_code_rows']:,}",
        flush=True,
    )

    # Dedup estimates on INCLUDE subset (what upsert_sangga would load)
    include_rows = [r for r in rows_all if r["code"] in INCLUDE_CODES]
    include_deduped, include_self_dup = self_dedupe_50m(include_rows)

    # Full-set dedup for upper-bound new inserts (memory-heavy but needed once)
    print("  self-dedupe full set…", flush=True)
    all_deduped, all_self_dup = self_dedupe_50m(rows_all)
    print(
        f"  dedupe include: {len(include_rows):,}→{len(include_deduped):,} "
        f"(dup={include_self_dup:,}); "
        f"full: {len(rows_all):,}→{len(all_deduped):,} (dup={all_self_dup:,})",
        flush=True,
    )

    # Match grids: use FULL valid sangga (coverage of moving kakao→our DB)
    sangga_grid = build_grid(rows_all)

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)
    try:
        # refuse writes
        with conn.cursor() as cur:
            cur.execute("SHOW transaction_read_only")
            ro = cur.fetchone()[0]
            if str(ro).lower() not in ("on", "true", "1"):
                print("ERROR: connection not read-only", flush=True)
                return 2

        poi_spatial, pois, poi_by_norm = load_poi_index(conn)
        places_a = load_places(conn, "kakao")
        places_b = load_places(conn, "null")
        print(f"places A kakao={len(places_a):,} B null={len(places_b):,}", flush=True)

        report_a = measure_cohort(
            "A_kakao", places_a, rows_all, sangga_grid, poi_spatial, pois
        )
        report_b = measure_cohort(
            "B_null", places_b, rows_all, sangga_grid, poi_spatial, pois
        )

        # Also match against INCLUDE-only (current upsert filter)
        include_grid = build_grid(include_deduped)
        report_a_inc = measure_cohort(
            "A_kakao_include_codes_only",
            places_a,
            include_deduped,
            include_grid,
            poi_spatial,
            pois,
        )

        new_full, skip_full = hard_skip_existing_count(all_deduped, poi_by_norm)
        new_inc, skip_inc = hard_skip_existing_count(include_deduped, poi_by_norm)

        # overlap rate: sangga rows that look like existing poi
        overlap_full_rate = round(skip_full / len(all_deduped), 4) if all_deduped else 0.0
        overlap_inc_rate = (
            round(skip_inc / len(include_deduped), 4) if include_deduped else 0.0
        )
    finally:
        conn.close()

    out = {
        "as_of_file": ZIP_NAME,
        "elapsed_s": round(time.time() - t0, 1),
        "csv": meta,
        "load": load_stats,
        "poi_match_rules": {
            "rules_file": "lib/poiMatch.rules.json",
            "radiusM_candidate_search": RADIUS_M,
            "distanceCaps_simGe90OrExact_m": 100,
            "sangga_guard": True,
        },
        "match_A_kakao_vs_all_sangga": report_a,
        "match_B_null_vs_all_sangga": report_b,
        "match_A_kakao_vs_include_codes_only": report_a_inc,
        "dedupe_new_estimate": {
            "full_sangga_after_self_dedupe_50m": len(all_deduped),
            "full_overlap_existing_poi_name_50m": skip_full,
            "full_overlap_rate": overlap_full_rate,
            "full_estimated_new_poi_rows": new_full,
            "include_codes_after_self_dedupe_50m": len(include_deduped),
            "include_overlap_existing_poi_name_50m": skip_inc,
            "include_overlap_rate": overlap_inc_rate,
            "include_estimated_new_poi_rows": new_inc,
            "note": (
                "full = 전 업종 유효행; include_codes = 현재 upsert_sangga 필터"
                f"(source={SOURCE}, {len(INCLUDE_CODES)} codes → 쇼핑/술집 중심)."
            ),
        },
        "closed_businesses": {
            "columns": meta["closed_related_columns"],
            "includes_closed": False,
            "note": meta["closed_note"],
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "sangga_match_measure.json"
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n=== WROTE {out_path} (counts only) ===", flush=True)

    def print_table(title: str, rep: dict) -> None:
        print(f"\n{title}: places={rep['places']:,} matched={rep['matched_sangga']:,} "
              f"({rep['match_rate']*100:.1f}%)", flush=True)
        print(
            f"{'cat':12} {'total':>8} {'sangga':>8} {'poi_fail':>8} {'neither':>8}",
            flush=True,
        )
        for r in rep["by_category"]:
            print(
                f"{r['category'][:12]:12} {r['total']:8,} {r['matched_sangga']:8,} "
                f"{r['unmatched_but_in_poi']:8,} {r['unmatched_and_not_in_poi']:8,}",
                flush=True,
            )

    print_table("A source=kakao vs ALL sangga", report_a)
    print_table("B source=null vs ALL sangga", report_b)
    print_table("A vs INCLUDE_CODES only", report_a_inc)
    print(
        "\nNEW ESTIMATE full:",
        f"overlap={skip_full:,}/{len(all_deduped):,} ({overlap_full_rate*100:.1f}%)",
        f"new≈{new_full:,}",
        flush=True,
    )
    print(
        "NEW ESTIMATE include_codes:",
        f"overlap={skip_inc:,}/{len(include_deduped):,} ({overlap_inc_rate*100:.1f}%)",
        f"new≈{new_inc:,}",
        flush=True,
    )
    print("CLOSED:", out["closed_businesses"]["note"], flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
