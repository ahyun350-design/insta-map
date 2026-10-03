#!/usr/bin/env python3
"""places(source null|kakao) → sangga poi 재매칭 적용.

기본 --dry-run (쓰기 없음). --apply 일 때만 UPDATE.
롤백: --rollback BACKUP_JSON

적용 조건 (둘 중 하나):
  1) 매칭 거리 ≤ 30m
  2) 정규화 이름 완전일치 AND places.address ↔ sangga 도로명+건물번호 동일

변경: lat, lng, address, poi_id, source='poi'
category 변경 금지. subcategory는 기존 null일 때만 sangga 매핑으로 채움.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import sys
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor, execute_batch

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
APPLY_DIST_M = 30.0
BATCH = 200

_RULES = json.loads(
    (Path(__file__).resolve().parents[2] / "lib" / "sanggaGuard.rules.json").read_text(
        encoding="utf-8"
    )
)
RAW_TO_SUB = _RULES.get("rawCategoryToSubcategory") or {}

# 도로명(+로/길/거리) + 건물번호
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


def find_zip() -> Path:
    zips = sorted(RAW_D.glob("*_20260630.zip"))
    if not zips:
        raise FileNotFoundError(f"zip not found under {RAW_D}")
    return zips[0]


def stream_sangga(zpath: Path) -> list[dict]:
    rows: list[dict] = []
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            name = decode_zip_member_name(info.filename)
            if not name.endswith(".csv"):
                continue
            print(f"  stream {Path(name).name}", flush=True)
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
                    nn = normalize_poi_name(nm)
                    if len(nn) < 2:
                        continue
                    sk = (row.get("상가업소번호") or "").strip()
                    if not sk:
                        continue
                    cat, sub = SANGGA_MAP[code]
                    road = (row.get("도로명주소") or "").strip()
                    jibun = (row.get("지번주소") or "").strip()
                    raw = (row.get("상권업종소분류명") or "").strip()
                    rows.append(
                        {
                            "source_key": sk,
                            "name": nm,
                            "name_norm": nn,
                            "lat": lat,
                            "lng": lng,
                            "road": road,
                            "jibun": jibun,
                            "address": road or jibun,
                            "category": cat,
                            "subcategory": sub,
                            "raw_category": raw,
                            "code": code,
                        }
                    )
    print(f"  sangga filtered={len(rows):,}", flush=True)
    return rows


def build_grid(rows: list[dict]):
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        grid[(int(r["lat"] / BBOX_DEG), int(r["lng"] / BBOX_DEG))].append(i)
    return grid


def best_sangga(place: dict, rows: list[dict], grid) -> dict | None:
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
                    s["category"],
                    dist,
                )
                if reject:
                    continue
                row = {
                    "sangga": s,
                    "dist_m": dist,
                    "sim": score,
                    "reason": reason,
                }
                if best is None or score > best["sim"] or (
                    score == best["sim"] and dist < best["dist_m"]
                ):
                    best = row
    return best


def apply_eligible(place: dict, match: dict) -> tuple[bool, str, bool]:
    """returns (ok, rule, addr_match)."""
    s = match["sangga"]
    dist = match["dist_m"]
    place_nn = normalize_poi_name(place["name"] or "")
    sangga_nn = s["name_norm"]
    exact = bool(place_nn) and place_nn == sangga_nn
    pk = road_building_key(place.get("address"))
    sk = road_building_key(s.get("road") or s.get("address"))
    addr_match = bool(pk and sk and pk == sk)

    if dist <= APPLY_DIST_M:
        return True, "dist_le_30", addr_match
    if exact and addr_match:
        return True, "exact_name_and_road_bn", addr_match
    return False, "excluded", addr_match


def subcategory_fill(place_sub: str | None, sangga: dict) -> str | None:
    if place_sub:
        return None  # keep existing — signal no change
    mapped = sangga.get("subcategory")
    if mapped:
        return mapped
    raw = sangga.get("raw_category") or ""
    v = RAW_TO_SUB.get(raw)
    return v if v else None


def fetch_places(conn) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, lat, lng, address, category, subcategory,
                   coalesce(source, 'null') AS source, poi_id
            FROM places
            WHERE (source IS NULL OR source = 'kakao')
              AND lat IS NOT NULL AND lng IS NOT NULL
            """
        )
        return [dict(r) for r in cur.fetchall()]


def load_sangga_poi_index(conn) -> dict[str, int]:
    """source_key → poi.id for actually loaded sangga rows."""
    out: dict[str, int] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_key, id
            FROM public.poi
            WHERE source = %s
              AND source_key IS NOT NULL
              AND btrim(source_key) <> ''
            """,
            (SOURCE,),
        )
        for sk, pid in cur:
            out[str(sk)] = int(pid)
    print(f"  loaded sangga poi keys={len(out):,}", flush=True)
    return out


def run_match(conn) -> dict:
    """CSV로 매칭하되, 적용은 poi에 적재된 source_key만.

    미적재 키(hard-skip/self-dedupe 등으로 upsert 안 된 행)를 가리키면
    다른 후보로 대체하지 않고 skipped_not_loaded 로 제외.
    """
    zpath = find_zip()
    print(f"=== sangga zip: {zpath.name} ===", flush=True)
    id_by_key = load_sangga_poi_index(conn)
    rows = stream_sangga(zpath)
    # 매칭 후보 자체도 적재된 행만 (미적재 키로 best가 잡히지 않게)
    rows_loaded = [r for r in rows if r["source_key"] in id_by_key]
    skipped_csv_not_in_poi = len(rows) - len(rows_loaded)
    print(
        f"  csv_filtered={len(rows):,} loaded_candidates={len(rows_loaded):,} "
        f"csv_not_in_poi={skipped_csv_not_in_poi:,}",
        flush=True,
    )
    # 미적재 키 탐지용: full CSV 그리드 + loaded-only 그리드
    grid_all = build_grid(rows)
    grid_loaded = build_grid(rows_loaded)
    places = fetch_places(conn)
    print(f"  places target={len(places):,}", flush=True)

    matched = []
    apply_rows = []
    excluded = []
    skipped_not_loaded_rows = []
    by_rule = Counter()
    skipped_not_loaded = 0

    for i, p in enumerate(places):
        # 1) full CSV best — 미적재 키면 제외만 (대체 매핑 금지)
        m_all = best_sangga(p, rows, grid_all)
        if m_all and m_all["sangga"]["source_key"] not in id_by_key:
            skipped_not_loaded += 1
            by_rule["skipped_not_loaded"] += 1
            skipped_not_loaded_rows.append({"place": p, "match": m_all})
            if i and i % 2000 == 0:
                print(
                    f"  progress {i}/{len(places)} matched={len(matched)} "
                    f"apply={len(apply_rows)} skip_nl={skipped_not_loaded}",
                    flush=True,
                )
            continue

        # 2) 적재된 후보만으로 매칭 (m_all이 이미 loaded면 동일)
        m = best_sangga(p, rows_loaded, grid_loaded)
        if not m:
            continue
        # poi.id 부착
        m["sangga"]["poi_id"] = id_by_key[m["sangga"]["source_key"]]
        matched.append((p, m))
        ok, rule, addr_match = apply_eligible(p, m)
        if ok:
            by_rule[rule] += 1
            apply_rows.append(
                {
                    "place": p,
                    "match": m,
                    "rule": rule,
                    "addr_match": addr_match,
                    "sub_fill": subcategory_fill(p.get("subcategory"), m["sangga"]),
                }
            )
        else:
            by_rule["excluded"] += 1
            excluded.append(
                {
                    "place": p,
                    "match": m,
                    "addr_match": addr_match,
                    "exact": normalize_poi_name(p["name"] or "")
                    == m["sangga"]["name_norm"],
                }
            )
        if i and i % 2000 == 0:
            print(
                f"  progress {i}/{len(places)} matched={len(matched)} "
                f"apply={len(apply_rows)} skip_nl={skipped_not_loaded}",
                flush=True,
            )

    return {
        "sangga_n": len(rows),
        "sangga_loaded_n": len(rows_loaded),
        "places_n": len(places),
        "matched_n": len(matched),
        "apply_n": len(apply_rows),
        "excluded_n": len(excluded),
        "skipped_not_loaded": skipped_not_loaded,
        "by_rule": dict(by_rule),
        "apply_rows": apply_rows,
        "excluded": excluded,
        "skipped_not_loaded_rows": skipped_not_loaded_rows,
    }


def print_report(report: dict) -> None:
    print("\n=== APPLY ELIGIBILITY ===", flush=True)
    print(f"sangga_csv_filtered={report['sangga_n']:,}", flush=True)
    print(f"sangga_loaded_candidates={report['sangga_loaded_n']:,}", flush=True)
    print(f"sangga_guard_matched={report['matched_n']:,}", flush=True)
    print(f"apply_eligible={report['apply_n']:,}", flush=True)
    print(f"excluded_from_apply={report['excluded_n']:,}", flush=True)
    print(f"skipped_not_loaded={report['skipped_not_loaded']:,}", flush=True)
    print("by_rule", report["by_rule"], flush=True)
    print("--- skipped_not_loaded sample (max 10) ---", flush=True)
    for e in report.get("skipped_not_loaded_rows", [])[:10]:
        p, m = e["place"], e["match"]
        s = m["sangga"]
        print(
            f"{p.get('category')}|{p['name']}|{s['name']}|"
            f"{round(m['dist_m'],1)}|key={s['source_key']}",
            flush=True,
        )
    print("--- excluded sample (max 30) ---", flush=True)
    for e in report["excluded"][:30]:
        p, m = e["place"], e["match"]
        s = m["sangga"]
        print(
            f"{p.get('category')}|{p['name']}|{s['name']}|"
            f"{round(m['dist_m'],1)}|exact={e['exact']}|addr_match={e['addr_match']}|"
            f"place_addr={(p.get('address') or '')[:40]}|"
            f"sangga_addr={(s.get('road') or s.get('address') or '')[:40]}",
            flush=True,
        )


def backup_path() -> Path:
    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d_%H%M%S")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUT_DIR / f"sangga_rematch_backup_{stamp}.json"


def do_apply(conn, apply_rows: list[dict], bak_path: Path) -> None:
    # Safety: only rows whose source_key is loaded (should already be filtered)
    id_by_key = load_sangga_poi_index(conn)
    final_rows = []
    skipped_nl = 0
    for item in apply_rows:
        sk = item["match"]["sangga"]["source_key"]
        if sk not in id_by_key:
            skipped_nl += 1
            continue
        item["match"]["sangga"]["poi_id"] = id_by_key[sk]
        final_rows.append(item)
    if skipped_nl:
        print(f"  apply-time skipped_not_loaded={skipped_nl}", flush=True)
    if not final_rows:
        print("nothing to apply after loaded-key filter", flush=True)
        return

    backup = []
    for item in final_rows:
        p = item["place"]
        backup.append(
            {
                "id": p["id"],
                "lat": p["lat"],
                "lng": p["lng"],
                "address": p.get("address"),
                "source": None if p.get("source") == "null" else p.get("source"),
                "poi_id": p.get("poi_id"),
                "subcategory": p.get("subcategory"),
            }
        )
    bak_path.write_text(
        json.dumps(
            {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "n": len(backup),
                "rows": backup,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"  backup wrote {bak_path} n={len(backup):,}", flush=True)

    updates = []
    for item in final_rows:
        p = item["place"]
        s = item["match"]["sangga"]
        pid = int(s["poi_id"])
        addr = (s.get("road") or s.get("jibun") or s.get("address") or "").strip()
        row = {
            "id": p["id"],
            "lat": s["lat"],
            "lng": s["lng"],
            "address": addr or p.get("address"),
            "poi_id": pid,
            "source": "poi",
            "subcategory": p.get("subcategory"),
        }
        fill = item.get("sub_fill")
        if fill and not p.get("subcategory"):
            row["subcategory"] = fill
        updates.append(row)

    t0 = time.time()
    with conn.cursor() as cur:
        for i in range(0, len(updates), BATCH):
            chunk = updates[i : i + BATCH]
            execute_batch(
                cur,
                """
                UPDATE public.places SET
                  lat = %(lat)s,
                  lng = %(lng)s,
                  address = %(address)s,
                  poi_id = %(poi_id)s,
                  source = %(source)s,
                  subcategory = %(subcategory)s
                WHERE id = %(id)s
                """,
                chunk,
                page_size=BATCH,
            )
            conn.commit()
            done = min(i + BATCH, len(updates))
            print(
                f"  apply {done:,}/{len(updates):,} "
                f"[{time.time()-t0:.0f}s]",
                flush=True,
            )
    print(f"DONE applied={len(updates):,}", flush=True)


def do_rollback(conn, bak_path: Path) -> None:
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
                UPDATE public.places SET
                  lat = %(lat)s,
                  lng = %(lng)s,
                  address = %(address)s,
                  poi_id = %(poi_id)s,
                  source = %(source)s,
                  subcategory = %(subcategory)s
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply",
        action="store_true",
        help="실제로 places UPDATE (기본은 dry-run)",
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

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    if not args.apply:
        conn.set_session(readonly=True, autocommit=True)
    try:
        report = run_match(conn)
        print_report(report)
        summary = {
            "sangga_n": report["sangga_n"],
            "sangga_loaded_n": report["sangga_loaded_n"],
            "places_n": report["places_n"],
            "matched_n": report["matched_n"],
            "apply_n": report["apply_n"],
            "excluded_n": report["excluded_n"],
            "skipped_not_loaded": report["skipped_not_loaded"],
            "by_rule": report["by_rule"],
        }
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "sangga_rematch_apply_dryrun.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        if args.apply:
            if report["apply_n"] == 0:
                print("nothing to apply", flush=True)
                return 0
            # reopen writable
            conn.close()
            conn = psycopg2.connect(db_url(), connect_timeout=60)
            do_apply(conn, report["apply_rows"], backup_path())
        else:
            print("\n(dry-run only — pass --apply to write)", flush=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
