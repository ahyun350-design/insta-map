#!/usr/bin/env python3
"""Phase 4 rematch 전수 검증 (읽기 전용).

입력: places_backup_*.json + 현재 places(source=poi) + poi
SELECT만. UPDATE/INSERT/DELETE 금지.
"""

from __future__ import annotations

import json
import math
import re
import statistics
import time
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

OUT = Path(__file__).resolve().parent / "out"
DB_URL_FILE = Path(__file__).resolve().parent / ".db_url"
BACKUP = OUT / "places_backup_20260911.json"
PLAN = OUT / "rematch_plan_compact.json"
PAGE = 1000

# 한국 대략 영토
LAT_MIN, LAT_MAX = 33.0, 39.0
LNG_MIN, LNG_MAX = 124.0, 132.0


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def haversine_m(lat1, lng1, lat2, lng2) -> float | None:
    if None in (lat1, lng1, lat2, lng2):
        return None
    try:
        lat1, lng1, lat2, lng2 = float(lat1), float(lng1), float(lat2), float(lng2)
    except (TypeError, ValueError):
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


def name_similarity(a: str, b: str) -> float:
    """0~100. 공백 제거 후 SequenceMatcher ratio."""
    na = re.sub(r"\s+", "", (a or "").lower())
    nb = re.sub(r"\s+", "", (b or "").lower())
    if not na and not nb:
        return 100.0
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio() * 100.0


# --- 주소 파싱 (시/도, 시군구) ---
SIDO_ALIASES = {
    "서울": "서울",
    "서울시": "서울",
    "서울특별시": "서울",
    "부산": "부산",
    "부산시": "부산",
    "부산광역시": "부산",
    "대구": "대구",
    "대구시": "대구",
    "대구광역시": "대구",
    "인천": "인천",
    "인천시": "인천",
    "인천광역시": "인천",
    "광주": "광주",
    "광주시": "광주",
    "광주광역시": "광주",
    "대전": "대전",
    "대전시": "대전",
    "대전광역시": "대전",
    "울산": "울산",
    "울산시": "울산",
    "울산광역시": "울산",
    "세종": "세종",
    "세종시": "세종",
    "세종특별자치시": "세종",
    "경기": "경기",
    "경기도": "경기",
    "강원": "강원",
    "강원도": "강원",
    "강원특별자치도": "강원",
    "충북": "충북",
    "충청북도": "충북",
    "충남": "충남",
    "충청남도": "충남",
    "전북": "전북",
    "전라북도": "전북",
    "전북특별자치도": "전북",
    "전남": "전남",
    "전라남도": "전남",
    "경북": "경북",
    "경상북도": "경북",
    "경남": "경남",
    "경상남도": "경남",
    "제주": "제주",
    "제주도": "제주",
    "제주특별자치도": "제주",
    "전남광주통합특별시": "광주",  # LOCALDATA 표기
}


def parse_region(address: str | None) -> tuple[str | None, str | None]:
    """(sido, sigungu). 파싱 실패 시 (None, None)."""
    if not address or not str(address).strip():
        return None, None
    tokens = str(address).replace(",", " ").split()
    if not tokens:
        return None, None

    sido = None
    idx = 0
    t0 = tokens[0]
    if t0 in SIDO_ALIASES:
        sido = SIDO_ALIASES[t0]
        idx = 1
    else:
        # "서울특별시마포구" 붙어있는 경우 등 — 앞 토큰만
        for k, v in sorted(SIDO_ALIASES.items(), key=lambda x: -len(x[0])):
            if t0.startswith(k):
                sido = v
                rest = t0[len(k) :]
                if rest:
                    tokens = [rest] + tokens[1:]
                    idx = 0
                else:
                    idx = 1
                break

    sigungu = None
    if idx < len(tokens):
        t = tokens[idx]
        # 시/군/구 (자치구·일반구·시·군)
        if t.endswith(("구", "군", "시")) and len(t) >= 2:
            sigungu = t
        elif idx + 1 < len(tokens):
            # "성남시 분당구" — 시 + 구
            t2 = tokens[idx + 1]
            if t.endswith("시") and t2.endswith(("구", "군")):
                sigungu = f"{t} {t2}"
            elif t.endswith(("구", "군", "시")):
                sigungu = t

    return sido, sigungu


def decimal_places(x) -> int | None:
    if x is None:
        return None
    try:
        s = f"{float(x):.10f}".rstrip("0")
        if "." not in s:
            return 0
        return len(s.split(".")[1])
    except (TypeError, ValueError):
        return None


def fetch_poi_places(conn) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, name, address, lat, lng, source, poi_id
                FROM public.places
                WHERE source = 'poi'
                ORDER BY id
                LIMIT %s OFFSET %s
                """,
                (PAGE, offset),
            )
            page = cur.fetchall()
        if not page:
            break
        rows.extend([dict(r) for r in page])
        print(f"  places source=poi loaded {len(rows)}", flush=True)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def fetch_pois(conn, poi_ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for i in range(0, len(poi_ids), 500):
            chunk = poi_ids[i : i + 500]
            cur.execute(
                """
                SELECT id, name, road_address, jibun_address, lat, lng
                FROM public.poi
                WHERE id = ANY(%s)
                """,
                (chunk,),
            )
            for r in cur.fetchall():
                out[int(r["id"])] = dict(r)
    return out


def main() -> None:
    t0 = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)

    print("loading backup…", flush=True)
    backup_list = json.loads(BACKUP.read_text(encoding="utf-8"))
    backup = {str(r["id"]): r for r in backup_list}
    print(f"  backup rows: {len(backup)} ({BACKUP.name})", flush=True)

    round2_ids: set[str] = set()
    if PLAN.exists():
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        round2_ids = {str(p["place_id"]) for p in plan}
        print(f"  round2 plan ids: {len(round2_ids)} ({PLAN.name})", flush=True)
    else:
        print(f"  WARNING: {PLAN.name} missing — [B] will use all source=poi", flush=True)

    print("connecting (readonly)…", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)

    print("loading places source=poi…", flush=True)
    places = fetch_poi_places(conn)
    poi_ids = sorted({int(p["poi_id"]) for p in places if p.get("poi_id") is not None})
    print(f"loading poi ({len(poi_ids)})…", flush=True)
    pois = fetch_pois(conn, poi_ids)
    conn.close()

    # ---------- A: 행정구역 ----------
    sido_changed: list[dict] = []
    sigungu_changed: list[dict] = []
    for p in places:
        pid = str(p["id"])
        b = backup.get(pid)
        if not b:
            continue
        before_addr = b.get("address")
        after_addr = p.get("address")
        bs, bg = parse_region(before_addr)
        as_, ag = parse_region(after_addr)
        move = haversine_m(b.get("lat"), b.get("lng"), p.get("lat"), p.get("lng"))
        name = p.get("name") or ""
        if bs and as_ and bs != as_:
            sido_changed.append(
                {
                    "name": name,
                    "before": f"{bs}/{bg or '?'}",
                    "after": f"{as_}/{ag or '?'}",
                    "before_address": before_addr,
                    "after_address": after_addr,
                    "move_m": round(move, 1) if move is not None else None,
                }
            )
        if bg and ag and bg != ag:
            sigungu_changed.append(
                {
                    "name": name,
                    "before": f"{bs or '?'}/{bg}",
                    "after": f"{as_ or '?'}/{ag}",
                    "before_address": before_addr,
                    "after_address": after_addr,
                    "move_m": round(move, 1) if move is not None else None,
                    "move_lt_100": move is not None and move < 100,
                }
            )

    # ---------- B: 이름 유사도 (2차 apply 2898건만) ----------
    places_b = [p for p in places if str(p["id"]) in round2_ids] if round2_ids else places
    print(f"[B] name-sim targets: {len(places_b)} (round2 only)", flush=True)
    sims: list[float] = []
    sim_rows: list[dict] = []
    for p in places_b:
        poi = pois.get(int(p["poi_id"])) if p.get("poi_id") is not None else None
        poi_name = (poi or {}).get("name") or ""
        place_name = p.get("name") or ""
        sim = name_similarity(place_name, poi_name)
        sims.append(sim)
        b = backup.get(str(p["id"]))
        move = None
        if b:
            move = haversine_m(b.get("lat"), b.get("lng"), p.get("lat"), p.get("lng"))
        poi_addr = ""
        if poi:
            poi_addr = (poi.get("road_address") or poi.get("jibun_address") or "") or ""
        sim_rows.append(
            {
                "place_name": place_name,
                "poi_name": poi_name,
                "sim": round(sim, 1),
                "move_m": round(move, 1) if move is not None else None,
                "poi_address": poi_addr,
            }
        )
    sims_sorted = sorted(sims)
    bottom100 = sorted(sim_rows, key=lambda x: (x["sim"], x["place_name"]))[:100]

    # ---------- C: 좌표 위생 ----------
    outside: list[dict] = []
    zero_coord = 0
    short_precision = 0
    for p in places:
        lat, lng = p.get("lat"), p.get("lng")
        if lat is None or lng is None:
            continue
        try:
            flat, flng = float(lat), float(lng)
        except (TypeError, ValueError):
            continue
        if flat == 0.0 or flng == 0.0:
            zero_coord += 1
        if not (LAT_MIN <= flat <= LAT_MAX and LNG_MIN <= flng <= LNG_MAX):
            outside.append({"name": p.get("name"), "lat": flat, "lng": flng})
        dp_lat, dp_lng = decimal_places(flat), decimal_places(flng)
        # 비정상적으로 짧음: 둘 다 소수점 3자리 미만 (약 100m 격자)
        if dp_lat is not None and dp_lng is not None and max(dp_lat, dp_lng) < 3:
            short_precision += 1

    # ---------- D: 다대일 ----------
    by_poi: dict[int, list[dict]] = defaultdict(list)
    for p in places:
        if p.get("poi_id") is None:
            continue
        by_poi[int(p["poi_id"])].append(p)

    merge_suspects: list[dict] = []
    for poi_id, group in by_poi.items():
        if len(group) < 2:
            continue
        backup_names = []
        for p in group:
            b = backup.get(str(p["id"]))
            nm = (b or p).get("name") or ""
            backup_names.append(nm.strip())
        unique_names = sorted({n for n in backup_names if n})
        if len(unique_names) < 2:
            continue  # 동일 이름 다수 = 정상
        poi = pois.get(poi_id) or {}
        merge_suspects.append(
            {
                "poi_id": poi_id,
                "poi_name": poi.get("name"),
                "backup_names": unique_names,
                "n": len(group),
            }
        )
    merge_suspects.sort(key=lambda x: -x["n"])

    # ---------- E: 이동거리 ----------
    moves: list[float] = []
    move_ge_100: list[dict] = []
    for p in places:
        b = backup.get(str(p["id"]))
        if not b:
            continue
        d = haversine_m(b.get("lat"), b.get("lng"), p.get("lat"), p.get("lng"))
        if d is None:
            continue
        moves.append(d)
        if d >= 100:
            move_ge_100.append(
                {
                    "name": p.get("name"),
                    "move_m": round(d, 1),
                    "poi_id": p.get("poi_id"),
                }
            )
    moves_sorted = sorted(moves)

    report = {
        "n_source_poi": len(places),
        "elapsed_s": round(time.perf_counter() - t0, 1),
        "A_admin": {
            "sido_changed_n": len(sido_changed),
            "sido_changed": [
                {"name": x["name"], "before": x["before"], "after": x["after"], "move_m": x["move_m"]}
                for x in sido_changed
            ],
            "sigungu_changed_n": len(sigungu_changed),
            "sigungu_changed": [
                {
                    "name": x["name"],
                    "before": x["before"],
                    "after": x["after"],
                    "move_m": x["move_m"],
                    "move_lt_100": x["move_lt_100"],
                }
                for x in sigungu_changed
            ],
            "sigungu_changed_and_move_lt_100_n": sum(
                1 for x in sigungu_changed if x["move_lt_100"]
            ),
        },
        "B_name_sim": {
            "scope": "round2_plan_only",
            "n": len(sims_sorted),
            "median": round(statistics.median(sims_sorted), 1) if sims_sorted else None,
            "p10": round(percentile(sims_sorted, 10) or 0, 1) if sims_sorted else None,
            "p5": round(percentile(sims_sorted, 5) or 0, 1) if sims_sorted else None,
            "min": round(sims_sorted[0], 1) if sims_sorted else None,
            "bottom_100": bottom100,
        },
        "C_coords": {
            "outside_korea_n": len(outside),
            "outside_korea": outside,
            "zero_lat_or_lng_n": zero_coord,
            "short_precision_n": short_precision,
        },
        "D_many_to_one": {
            "suspect_groups_n": len(merge_suspects),
            "suspect_groups": merge_suspects,
        },
        "E_move": {
            "n": len(moves_sorted),
            "median": round(statistics.median(moves_sorted), 2) if moves_sorted else None,
            "p90": round(percentile(moves_sorted, 90) or 0, 2) if moves_sorted else None,
            "p99": round(percentile(moves_sorted, 99) or 0, 2) if moves_sorted else None,
            "max": round(moves_sorted[-1], 2) if moves_sorted else None,
            "ge_100m_n": len(move_ge_100),
            "ge_100m": move_ge_100,
        },
    }

    out_path = OUT / "verify_rematch.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- stdout ----
    A = report["A_admin"]
    B = report["B_name_sim"]
    C = report["C_coords"]
    D = report["D_many_to_one"]
    E = report["E_move"]

    print("\n========== [A] 행정구역 ==========")
    print(f"시도 변경: {A['sido_changed_n']}")
    for x in A["sido_changed"]:
        print(f"  {x['name']} → {x['before']} → {x['after']} (move={x['move_m']}m)")
    print(f"시군구 변경: {A['sigungu_changed_n']} (그중 이동<100m: {A['sigungu_changed_and_move_lt_100_n']})")
    for x in A["sigungu_changed"]:
        print(f"  {x['name']} → {x['before']} → {x['after']} (move={x['move_m']}m)")

    print("\n========== [B] 이름 유사도 ==========")
    print(f"(round2 plan only, n={B['n']})")
    print(
        f"n={B['n']} median={B['median']} p10={B['p10']} p5={B['p5']} min={B['min']}"
    )
    print("--- 하위 100건 ---")
    for x in B["bottom_100"]:
        print(
            f"  {x['place_name']} → {x['poi_name']} | {x['sim']} | "
            f"{x['move_m']}m | {x['poi_address']}"
        )

    print("\n========== [C] 좌표 위생 ==========")
    print(f"한국 밖: {C['outside_korea_n']}")
    for x in C["outside_korea"]:
        print(f"  {x['name']} ({x['lat']}, {x['lng']})")
    print(f"lat/lng=0: {C['zero_lat_or_lng_n']}")
    print(f"정밀도 의심(소수<3자리): {C['short_precision_n']}")

    print("\n========== [D] 다대일 병합 ==========")
    print(f"서로 다른 백업이름 공유 poi_id 그룹: {D['suspect_groups_n']}")
    for g in D["suspect_groups"]:
        names = " / ".join(g["backup_names"])
        print(f"  {g['poi_name']} | {names} | n={g['n']}")

    print("\n========== [E] 이동거리 ==========")
    print(
        f"n={E['n']} median={E['median']} p90={E['p90']} p99={E['p99']} max={E['max']}"
    )
    print(f">=100m: {E['ge_100m_n']}")
    for x in E["ge_100m"]:
        print(f"  {x['name']} → {x['move_m']}m")

    print(f"\nwrote {out_path} ({report['elapsed_s']}s)")


if __name__ == "__main__":
    main()
