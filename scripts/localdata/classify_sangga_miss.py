#!/usr/bin/env python3
"""Classify places that match neither sangga nor existing poi.

Buckets (first match wins):
  (1) name_norm fix within 100m (상호+지점 / soft strip)
  (2) token overlap ≥ 0.5 within 100m
  (3) same norm name at 100m–1km
  (4) popup/temporary keywords in place name
  (5) not in sangga (residual)

SELECT only. Logs: category counts + name pairs (no address/coords/user_id).
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
import time
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
    soft_normalize_display,
)

RAW = Path(__file__).resolve().parent / "raw_sangga"
CELL_100 = 0.001  # ~111m — neighborhood for 100m / 1km searches
POPUP_RE = re.compile(
    r"팝업|popup|pop[\s\-]?up|스토어\s*by|전시|기간한정|한정판매|temporary|popupstore",
    re.I,
)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def strip_branch_noise(raw: str) -> str:
    """Normalize for (1): paren/space/punct + trailing 점/본점/지점."""
    s = soft_normalize_display(raw)
    s = normalize_poi_name(s)
    # extra trailing branch markers after normalize (no spaces)
    for suf in ("본점", "지점", "분점", "점"):
        if s.endswith(suf) and len(s) > len(suf) + 1:
            s = s[: -len(suf)]
    return s


def sangga_display_name(mutual: str, branch: str) -> str:
    m = (mutual or "").strip()
    b = (branch or "").strip()
    if b and b not in m:
        return f"{m} {b}".strip()
    return m


def name_tokens(raw: str) -> set[str]:
    """Tokens for overlap: soft-normalized words + 2+ char hangul chunks."""
    soft = soft_normalize_display(raw)
    toks: set[str] = set()
    for w in soft.split():
        w = re.sub(r"[^\w가-힣]", "", w, flags=re.UNICODE)
        if len(w) >= 2:
            toks.add(w.lower())
    compact = normalize_poi_name(raw)
    # hangul bigrams if few space tokens
    if len(toks) < 2 and len(compact) >= 2:
        for i in range(len(compact) - 1):
            toks.add(compact[i : i + 2])
    if len(compact) >= 2:
        toks.add(compact)
    return toks


def token_overlap(a: str, b: str) -> float:
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    return len(inter) / min(len(ta), len(tb))


def load_sangga() -> list[dict]:
    csvs = sorted(RAW.glob("*.csv"))
    if not csvs:
        raise FileNotFoundError(f"no csv under {RAW}")
    rows: list[dict] = []
    for pi, p in enumerate(csvs, 1):
        print(f"  sangga [{pi}/{len(csvs)}] {p.name}", flush=True)
        with p.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                mutual = (row.get("상호명") or "").strip()
                if not mutual:
                    continue
                branch = (row.get("지점명") or "").strip()
                disp = sangga_display_name(mutual, branch)
                try:
                    lat = float(row["위도"])
                    lng = float(row["경도"])
                except Exception:
                    continue
                if not (33 <= lat <= 39 and 124 <= lng <= 132):
                    continue
                rows.append(
                    {
                        "mutual": mutual,
                        "branch": branch,
                        "display": disp,
                        "norm": normalize_poi_name(disp),
                        "norm_soft": strip_branch_noise(disp),
                        "norm_mutual_only": strip_branch_noise(mutual),
                        "lat": lat,
                        "lng": lng,
                    }
                )
    print(f"  sangga loaded={len(rows):,}", flush=True)
    return rows


def build_grids(rows: list[dict]):
    """Spatial grid + exact-norm grids for far-name lookup."""
    spatial: dict[tuple[int, int], list[int]] = defaultdict(list)
    by_norm: dict[str, list[int]] = defaultdict(list)
    by_soft: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        spatial[(int(r["lat"] / CELL_100), int(r["lng"] / CELL_100))].append(i)
        if len(r["norm"]) >= 2:
            by_norm[r["norm"]].append(i)
        if len(r["norm_soft"]) >= 2:
            by_soft[r["norm_soft"]].append(i)
        if len(r["norm_mutual_only"]) >= 2:
            by_soft[r["norm_mutual_only"]].append(i)
    return spatial, by_norm, by_soft


def neighbors(spatial, lat: float, lng: float, radius_m: float) -> list[int]:
    dlat = radius_m / 111320.0
    dlng = radius_m / (111320.0 * max(0.2, math.cos(math.radians(lat))))
    i0 = int((lat - dlat) / CELL_100)
    i1 = int((lat + dlat) / CELL_100)
    j0 = int((lng - dlng) / CELL_100)
    j1 = int((lng + dlng) / CELL_100)
    out: list[int] = []
    for ii in range(i0, i1 + 1):
        for jj in range(j0, j1 + 1):
            out.extend(spatial.get((ii, jj), []))
    return out


def load_poi_index(conn):
    pois: list[tuple[str, float, float]] = []
    spatial: dict[tuple[int, int], list[int]] = defaultdict(list)
    prev = conn.autocommit
    conn.autocommit = False
    try:
        with conn.cursor(name="poi_cls") as cur:
            cur.itersize = 20000
            cur.execute(
                """
                SELECT name, lat, lng FROM public.poi
                WHERE lat IS NOT NULL AND lng IS NOT NULL AND name IS NOT NULL
                """
            )
            for name, lat, lng in cur:
                nm = (name or "").strip()
                if len(normalize_poi_name(nm)) < 2:
                    continue
                try:
                    la, ln = float(lat), float(lng)
                except Exception:
                    continue
                idx = len(pois)
                pois.append((nm, la, ln))
                spatial[(int(la / BBOX_DEG), int(ln / BBOX_DEG))].append(idx)
        conn.rollback()
    finally:
        conn.autocommit = prev
    print(f"  poi indexed={len(pois):,}", flush=True)
    return spatial, pois


def matches_poi(place, spatial, pois) -> bool:
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


def matches_sangga_strict(place, rows, spatial) -> bool:
    """Same gate as measure_sangga_match (evaluate_candidate_pair, no sangga_guard here —
    misses that only fail guard are still 'matched' for failure-set definition if pair passes).
    Use evaluate only to mirror 'neither' from prior report with guard: we re-apply guard
    lightly by requiring pair score; classification script rebuilds neither set.
    """
    from sangga_common import sangga_guard_reject_reason

    try:
        plat, plng = float(place["lat"]), float(place["lng"])
    except Exception:
        return False
    pname = place.get("name") or ""
    for idx in neighbors(spatial, plat, plng, RADIUS_M):
        s = rows[idx]
        dist = haversine_m(plat, plng, s["lat"], s["lng"])
        if dist > RADIUS_M:
            continue
        scored = evaluate_candidate_pair(pname, s["display"], dist, routing=False)
        if not scored:
            # also try mutual-only name (no branch) — still under official matcher
            scored = evaluate_candidate_pair(pname, s["mutual"], dist, routing=False)
        if not scored:
            continue
        reject = sangga_guard_reject_reason(
            pname, place.get("category"), s["display"], None, dist
        )
        if reject:
            continue
        return True
    return False


def classify_one(place, rows, spatial, by_norm, by_soft) -> tuple[str, dict | None]:
    """Return (bucket, example_info)."""
    pname = place.get("name") or ""
    try:
        plat, plng = float(place["lat"]), float(place["lng"])
    except Exception:
        return "5", None

    p_norm = normalize_poi_name(pname)
    p_soft = strip_branch_noise(pname)

    # --- (1) name normalization within 100m ---
    best1 = None
    for idx in neighbors(spatial, plat, plng, 100.0):
        s = rows[idx]
        dist = haversine_m(plat, plng, s["lat"], s["lng"])
        if dist > 100.0:
            continue
        # place soft == sangga soft (상호+지점) or mutual-only soft
        if p_soft and p_soft in (s["norm_soft"], s["norm_mutual_only"]):
            cand = {"sangga": s["display"], "dist_m": dist, "via": "soft"}
            if best1 is None or dist < best1["dist_m"]:
                best1 = cand
            continue
        # place norm == sangga combined/mutual norm
        if p_norm and p_norm in (s["norm"], normalize_poi_name(s["mutual"])):
            cand = {"sangga": s["display"], "dist_m": dist, "via": "norm"}
            if best1 is None or dist < best1["dist_m"]:
                best1 = cand
            continue
        # place soft equals after stripping branch on both (already in soft)
    if best1:
        return "1", {"place": pname, **best1}

    # --- (2) token overlap ≥ 0.5 within 100m ---
    best2 = None
    for idx in neighbors(spatial, plat, plng, 100.0):
        s = rows[idx]
        dist = haversine_m(plat, plng, s["lat"], s["lng"])
        if dist > 100.0:
            continue
        ov = token_overlap(pname, s["display"])
        if ov < 0.5:
            ov = token_overlap(pname, s["mutual"])
        if ov >= 0.5:
            cand = {"sangga": s["display"], "dist_m": dist, "overlap": round(ov, 3)}
            if best2 is None or ov > best2.get("overlap", 0) or (
                ov == best2.get("overlap") and dist < best2["dist_m"]
            ):
                best2 = cand
    if best2:
        return "2", {"place": pname, **best2}

    # --- (3) same normalized name at 100m–1km ---
    best3 = None
    keys = {p_norm, p_soft}
    keys.discard("")
    for key in keys:
        for idx in by_soft.get(key, []) + by_norm.get(key, []):
            s = rows[idx]
            dist = haversine_m(plat, plng, s["lat"], s["lng"])
            if dist <= 100.0 or dist > 1000.0:
                continue
            # confirm soft/norm equality
            if key not in (s["norm"], s["norm_soft"], s["norm_mutual_only"]):
                continue
            band = "100-300" if dist <= 300 else "300-1000"
            cand = {"sangga": s["display"], "dist_m": dist, "band": band}
            if best3 is None or dist < best3["dist_m"]:
                best3 = cand
    if best3:
        return "3", {"place": pname, **best3}

    # --- (4) popup / temporary ---
    if POPUP_RE.search(pname):
        return "4", {"place": pname}

    # --- (5) residual ---
    return "5", {"place": pname}


def load_places(conn, mode: str) -> list[dict]:
    where = "source = 'kakao'" if mode == "kakao" else "source IS NULL"
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


def main() -> int:
    t0 = time.time()
    sangga = load_sangga()
    spatial, by_norm, by_soft = build_grids(sangga)

    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW transaction_read_only")
            if str(cur.fetchone()[0]).lower() not in ("on", "true", "1"):
                print("ERROR not read-only", flush=True)
                return 2
        poi_spatial, pois = load_poi_index(conn)
        places_a = load_places(conn, "kakao")
        places_b = load_places(conn, "null")
    finally:
        conn.close()

    # Optimized process: single filter pass with by-cat matched counts
    def process_fast(label, places, with_examples):
        print(f"=== {label} places={len(places):,} ===", flush=True)
        by_cat_total: Counter[str] = Counter()
        matched_by_cat: Counter[str] = Counter()
        poi_only_by_cat: Counter[str] = Counter()
        neither: list[dict] = []
        for i, p in enumerate(places):
            cat = (p.get("category") or "?").strip() or "?"
            by_cat_total[cat] += 1
            if matches_sangga_strict(p, sangga, spatial):
                matched_by_cat[cat] += 1
            elif matches_poi(p, poi_spatial, pois):
                poi_only_by_cat[cat] += 1
            else:
                neither.append(p)
            if i and i % 2000 == 0:
                print(f"  filter {i}/{len(places)} neither={len(neither)}", flush=True)

        bucket_by_cat: dict[str, Counter[str]] = defaultdict(Counter)
        band3_by_cat: dict[str, Counter[str]] = defaultdict(Counter)
        examples: dict[str, list[dict]] = {"1": [], "2": [], "3": []}
        for i, p in enumerate(neither):
            cat = (p.get("category") or "?").strip() or "?"
            bucket, info = classify_one(p, sangga, spatial, by_norm, by_soft)
            bucket_by_cat[cat][bucket] += 1
            if bucket == "3" and info and "band" in info:
                band3_by_cat[cat][info["band"]] += 1
            if (
                with_examples
                and bucket in examples
                and info
                and len(examples[bucket]) < 10
            ):
                ex = {
                    "place": info.get("place"),
                    "sangga": info.get("sangga"),
                    "dist_m": round(float(info["dist_m"]), 1)
                    if info.get("dist_m") is not None
                    else None,
                    "category": cat,
                }
                if "band" in info:
                    ex["band"] = info["band"]
                if "overlap" in info:
                    ex["overlap"] = info["overlap"]
                examples[bucket].append(ex)
            if i and i % 2000 == 0:
                print(f"  classify {i}/{len(neither)}", flush=True)

        cats = sorted(by_cat_total.keys(), key=lambda c: -by_cat_total[c])
        table = []
        hypo = []
        for cat in cats:
            b = bucket_by_cat[cat]
            row = {
                "category": cat,
                "neither": sum(b.values()),
                "1_norm": b["1"],
                "2_token": b["2"],
                "3_coord": b["3"],
                "3_band": dict(band3_by_cat[cat]),
                "4_popup": b["4"],
                "5_absent": b["5"],
            }
            table.append(row)
            total = by_cat_total[cat]
            official = matched_by_cat[cat]
            h = official + b["1"] + b["3"]
            hypo.append(
                {
                    "category": cat,
                    "total": total,
                    "official_matched": official,
                    "official_pct": round(100.0 * official / total, 1) if total else 0,
                    "hypo_1_and_3_matched": h,
                    "hypo_pct": round(100.0 * h / total, 1) if total else 0,
                }
            )
        return {
            "label": label,
            "places": len(places),
            "matched_sangga": sum(matched_by_cat.values()),
            "matched_poi_only": sum(poi_only_by_cat.values()),
            "neither": len(neither),
            "neither_by_category": table,
            "hypo_if_1_and_3_count_as_match": hypo,
            "examples": examples if with_examples else {},
        }

    rep_a = process_fast("A_kakao", places_a, True)
    rep_b = process_fast("B_null", places_b, False)

    out = {
        "elapsed_s": round(time.time() - t0, 1),
        "A_kakao": rep_a,
        "B_null": rep_b,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / "sangga_miss_classify.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWROTE {path}", flush=True)

    def dump(rep, show_ex: bool):
        print(f"\n## {rep['label']} neither={rep['neither']:,}/{rep['places']:,}")
        print(
            f"{'cat':8} {'nei':>5} {'(1)':>5} {'(2)':>5} {'(3)':>5} {'(4)':>5} {'(5)':>5}"
        )
        for r in rep["neither_by_category"]:
            print(
                f"{r['category'][:8]:8} {r['neither']:5} {r['1_norm']:5} "
                f"{r['2_token']:5} {r['3_coord']:5} {r['4_popup']:5} {r['5_absent']:5} "
                f"bands={r['3_band']}"
            )
        print("hypo if (1)+(3) count as match:")
        for h in rep["hypo_if_1_and_3_count_as_match"]:
            print(
                f"  {h['category']}: official {h['official_matched']}/{h['total']} "
                f"({h['official_pct']}%) → hypo {h['hypo_1_and_3_matched']} "
                f"({h['hypo_pct']}%)"
            )
        if show_ex:
            for k in ("1", "2", "3"):
                print(f"--- examples ({k}) ---")
                for ex in rep["examples"].get(k, []):
                    print(
                        f"  [{ex['place']}] ↔ [{ex.get('sangga')}] "
                        f"{ex.get('dist_m')}m cat={ex.get('category')}"
                        + (f" band={ex['band']}" if "band" in ex else "")
                        + (f" ov={ex['overlap']}" if "overlap" in ex else "")
                    )

    dump(rep_a, True)
    dump(rep_b, False)
    return 0


if __name__ == "__main__":
    # Remove dead heavy process_cohort from call path — keep file focused
    sys.exit(main())
