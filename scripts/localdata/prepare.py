#!/usr/bin/env python3
"""LOCALDATA CSV → poi 적재용 UTF-8 CSV 전처리.

입력:  repo root/localdata/{general_restaurants,rest_cafes,tourist_accommodations}.csv (CP949)
출력:  scripts/localdata/out/poi_load.csv (+ stats.json)
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[2]
LOCALDATA = ROOT / "localdata"
RAW_C = Path(__file__).resolve().parent / "raw_c"
OUT_DIR = Path(__file__).resolve().parent / "out"

# C그룹: EPSG:5174 → 4326 (A그룹과 동일). B그룹(WGS84)과 혼동 금지.
C_SOURCES = [
    {
        "file": "식품_제과점영업.csv",
        "source": "localdata_bakery",
        "category": "카페",  # 앱 칩 (kakao도 제과·베이커리→카페)
        "raw_field": "업태구분명",
    },
    {
        "file": "식품_즉석판매제조가공업.csv",
        "source": "localdata_instant",
        "category": "맛집",  # 앱 칩
        "raw_field": "업태구분명",
    },
    {
        "file": "생활_미용업.csv",
        "source": "localdata_beauty",
        "category": "쇼핑",  # 앱 칩 최근접 (뷰티 칩 없음)
        "raw_field": "업태구분명",
    },
    {
        "file": "생활_체력단련장업.csv",
        "source": "localdata_gym",
        "category": "놀거리",  # 앱 칩 최근접 (운동 칩 없음)
        "raw_field": "업태구분명",
    },
]

# EPSG:5174 — Korean 1985 / Modified Central Belt
# 보정계수 없는 Bessel 중부원점 TM + 명시적 towgs84 (EPSG 레지스트리 정의)
CRS_5174 = CRS.from_proj4(
    "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 "
    "+x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs "
    "+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43"
)
CRS_4326 = CRS.from_epsg(4326)
TRANSFORMER = Transformer.from_crs(CRS_5174, CRS_4326, always_xy=True)

SOURCES = [
    {
        "file": "general_restaurants.csv",
        "source": "localdata_general",
        "raw_field": "업태구분명",
    },
    {
        "file": "rest_cafes.csv",
        "source": "localdata_rest",
        "raw_field": "업태구분명",
    },
    {
        "file": "tourist_accommodations.csv",
        "source": "localdata_hotel",
        "raw_field": "관광숙박업상세명",
    },
]

# 업태구분명 → 핀맵 category
CAFE = {
    "까페",
    "커피숍",
    "다방",
    "아이스크림",
    "전통찻집",
    "과자점",
    "떡카페",
}
PLAY = {
    "라이브카페",
    "단란주점",
    "감성주점",
    "키즈카페",
}
# hotel source → always 숙소
# everything else → 맛집

PAREN_RE = re.compile(r"\([^)]*\)")
SPECIAL_RE = re.compile(r"[·,&/\-_.''\"`~!@#$%^*+=?<>\[\]{}|\\:;]")
SPACE_RE = re.compile(r"\s+")


def name_norm(name: str) -> str:
    s = (name or "").strip().lower()
    s = PAREN_RE.sub("", s)
    s = SPECIAL_RE.sub("", s)
    s = SPACE_RE.sub("", s)
    return s


def map_category(source: str, raw: str) -> str:
    if source == "localdata_hotel":
        return "숙소"
    raw = (raw or "").strip()
    if raw in CAFE:
        return "카페"
    if raw in PLAY:
        return "놀거리"
    return "맛집"


def convert_xy(x_raw: str, y_raw: str):
    x_s = (x_raw or "").strip()
    y_s = (y_raw or "").strip()
    if not x_s or not y_s:
        return None, None
    try:
        x = float(x_s)
        y = float(y_s)
    except ValueError:
        return None, None
    lng, lat = TRANSFORMER.transform(x, y)
    if not (33.0 <= lat <= 39.0 and 124.0 <= lng <= 132.0):
        return None, None
    return lat, lng


def open_csv(path: Path):
    # CP949; incomplete multibyte at EOF handled by replace
    return path.open("r", encoding="cp949", errors="replace", newline="")


def assign_localdata_keys(rows: list[dict]) -> list[str]:
    """park 방식 복합키.
    관리번호 유일 → 그대로
    중복 → 관리번호|개방자치단체코드
    그래도 충돌 → sha1(내용) (행번호 금지)
    """
    import hashlib
    from collections import defaultdict

    def sha1_32(payload: str) -> str:
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:32]

    mgmt_counts: Counter[str] = Counter(
        (r.get("_mgmt") or "").strip() for r in rows if (r.get("_mgmt") or "").strip()
    )
    provisional: list[str] = []
    for r in rows:
        m = (r.get("_mgmt") or "").strip()
        org = (r.get("_org") or "").strip()
        if not m:
            provisional.append("")
            continue
        if mgmt_counts[m] > 1:
            provisional.append(f"{m}|{org}")
        else:
            provisional.append(m)

    keys: list[str] = [""] * len(rows)
    groups: dict[str, list[int]] = defaultdict(list)
    for i, k in enumerate(provisional):
        if not k:
            keys[i] = ""
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
    return keys


def prepare(limit: int | None = None) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "poi_load.csv"
    fieldnames = [
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

    stats = {
        "by_source": Counter(),
        "by_category": Counter(),
        "raw_category": Counter(),
        "with_coords": 0,
        "without_coords": 0,
        "skipped_not_open": 0,
        "skipped_empty_name": 0,
        "skipped_empty_key": 0,
        "skipped_empty_norm": 0,
        "deduped": 0,
        "coord_out_of_bounds": 0,
        "rows_out": 0,
    }
    t0 = time.time()

    # (source, source_key) 중복 시 마지막 행 유지
    ordered_keys: list[tuple[str, str]] = []
    rows_by_key: dict[tuple[str, str], dict] = {}

    for spec in SOURCES:
        path = LOCALDATA / spec["file"]
        if not path.exists():
            raise FileNotFoundError(path)

        # hotel: 먼저 전부 모은 뒤 복합키 부여 (관리번호 단독 붕괴 방지)
        buffered: list[dict] = []

        with open_csv(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("영업상태명") != "영업/정상":
                    stats["skipped_not_open"] += 1
                    continue
                name = (row.get("사업장명") or "").strip()
                key = (row.get("관리번호") or "").strip()
                org = (row.get("개방자치단체코드") or "").strip()
                if not name:
                    stats["skipped_empty_name"] += 1
                    continue
                if not key:
                    stats["skipped_empty_key"] += 1
                    continue
                norm = name_norm(name)
                if not norm:
                    stats["skipped_empty_norm"] += 1
                    continue

                raw = (row.get(spec["raw_field"]) or "").strip()
                if spec["source"] == "localdata_hotel" and not raw:
                    raw = (row.get("문화체육업종명") or "관광숙박업").strip()

                lat, lng = convert_xy(row.get("좌표정보(X)", ""), row.get("좌표정보(Y)", ""))
                x_s = (row.get("좌표정보(X)") or "").strip()
                y_s = (row.get("좌표정보(Y)") or "").strip()
                if lat is None:
                    if x_s and y_s:
                        try:
                            float(x_s)
                            float(y_s)
                            stats["coord_out_of_bounds"] += 1
                        except ValueError:
                            pass

                category = map_category(spec["source"], raw)
                phone = (row.get("전화번호") or "").strip() or None
                road = (row.get("도로명주소") or "").strip() or None
                jibun = (row.get("지번주소") or "").strip() or None

                item = {
                    "_mgmt": key,
                    "_org": org,
                    "source": spec["source"],
                    "name": name,
                    "name_norm": norm,
                    "road_address": road or "",
                    "jibun_address": jibun or "",
                    "lat": "" if lat is None else f"{lat:.8f}",
                    "lng": "" if lng is None else f"{lng:.8f}",
                    "raw_category": raw,
                    "category": category,
                    "phone": phone or "",
                }
                if spec["source"] == "localdata_hotel":
                    buffered.append(item)
                else:
                    sk = (spec["source"], key)
                    if sk not in rows_by_key:
                        ordered_keys.append(sk)
                    else:
                        stats["deduped"] = stats.get("deduped", 0) + 1
                    rows_by_key[sk] = {
                        "source": item["source"],
                        "source_key": key,
                        "name": item["name"],
                        "name_norm": item["name_norm"],
                        "road_address": item["road_address"],
                        "jibun_address": item["jibun_address"],
                        "lat": item["lat"],
                        "lng": item["lng"],
                        "raw_category": item["raw_category"],
                        "category": item["category"],
                        "phone": item["phone"],
                    }
                if limit and len(ordered_keys) + len(buffered) >= limit:
                    break
        if spec["source"] == "localdata_hotel" and buffered:
            hotel_keys = assign_localdata_keys(buffered)
            for item, hk in zip(buffered, hotel_keys):
                if not hk:
                    stats["skipped_empty_key"] += 1
                    continue
                sk = (spec["source"], hk)
                if sk not in rows_by_key:
                    ordered_keys.append(sk)
                else:
                    stats["deduped"] = stats.get("deduped", 0) + 1
                rows_by_key[sk] = {
                    "source": item["source"],
                    "source_key": hk,
                    "name": item["name"],
                    "name_norm": item["name_norm"],
                    "road_address": item["road_address"],
                    "jibun_address": item["jibun_address"],
                    "lat": item["lat"],
                    "lng": item["lng"],
                    "raw_category": item["raw_category"],
                    "category": item["category"],
                    "phone": item["phone"],
                }
        if limit and len(ordered_keys) >= limit:
            break

    with out_path.open("w", encoding="utf-8", newline="") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for sk in ordered_keys:
            row = rows_by_key[sk]
            writer.writerow(row)
            stats["by_source"][row["source"]] += 1
            stats["by_category"][row["category"]] += 1
            stats["raw_category"][f"{row['source']}|{row['raw_category']}"] += 1
            if row["lat"] and row["lng"]:
                stats["with_coords"] += 1
            else:
                stats["without_coords"] += 1
            stats["rows_out"] += 1

    elapsed = time.time() - t0
    summary = {
        "elapsed_sec": round(elapsed, 1),
        "out_path": str(out_path),
        "rows_out": stats["rows_out"],
        "by_source": dict(stats["by_source"]),
        "by_category": dict(stats["by_category"]),
        "with_coords": stats["with_coords"],
        "without_coords": stats["without_coords"],
        "coord_out_of_bounds": stats["coord_out_of_bounds"],
        "skipped_not_open": stats["skipped_not_open"],
        "skipped_empty_name": stats["skipped_empty_name"],
        "skipped_empty_key": stats["skipped_empty_key"],
        "skipped_empty_norm": stats["skipped_empty_norm"],
        "deduped": stats.get("deduped", 0),
        "raw_category_top": stats["raw_category"].most_common(50),
        "name_norm_examples": {
            "요믹스(YO-MIX)": name_norm("요믹스(YO-MIX)"),
            "묵무키 문래": name_norm("묵무키 문래"),
        },
    }
    (OUT_DIR / "stats.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return summary


def prepare_c(limit: int | None = None) -> dict:
    """C그룹 4업종 → out/poi_c_load.csv. convert_xy·assign_localdata_keys·name_norm 재사용."""
    # 매칭과 동일 정규화 (poi_match.normalize_poi_name)
    try:
        from poi_match import normalize_poi_name as _norm
    except ImportError:
        _norm = name_norm

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "poi_c_load.csv"
    fieldnames = [
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

    report: dict = {
        "out_path": str(out_path),
        "category_mapping": {
            "localdata_bakery": "카페 (앱 칩; 사용자안 베이커리→칩 매핑)",
            "localdata_instant": "맛집 (앱 칩; 사용자안 간식→칩 매핑)",
            "localdata_beauty": "쇼핑 (앱 칩 최근접; 사용자안 뷰티)",
            "localdata_gym": "놀거리 (앱 칩 최근접; 사용자안 운동)",
        },
        "datasets": {},
        "abort": False,
        "abort_reasons": [],
    }
    all_rows: list[dict] = []
    t0 = time.time()

    for spec in C_SOURCES:
        path = RAW_C / spec["file"]
        if not path.exists():
            raise FileNotFoundError(path)

        raw_n = 0
        open_n = 0
        excl = Counter()
        buffered: list[dict] = []
        max_upd: str | None = None

        with open_csv(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                raw_n += 1
                if limit and open_n >= limit:
                    break
                upd = (row.get("데이터갱신시점") or "").strip()
                if upd and (max_upd is None or upd > max_upd):
                    max_upd = upd

                if (row.get("영업상태명") or "").strip() != "영업/정상":
                    excl["not_open"] += 1
                    continue
                open_n += 1

                name = (row.get("사업장명") or "").strip()
                if not name:
                    excl["empty_name"] += 1
                    continue
                norm = _norm(name)
                if not norm:
                    excl["empty_norm"] += 1
                    continue

                mgmt = (row.get("관리번호") or "").strip()
                org = (row.get("개방자치단체코드") or "").strip()
                if not mgmt:
                    excl["empty_mgmt"] += 1
                    continue

                x_s = (row.get("좌표정보(X)") or "").strip()
                y_s = (row.get("좌표정보(Y)") or "").strip()
                if not x_s or not y_s:
                    excl["null_xy"] += 1
                    continue
                try:
                    float(x_s)
                    float(y_s)
                except ValueError:
                    excl["xy_parse_fail"] += 1
                    continue
                # convert_xy 재사용 (EPSG:5174→4326 + 한국 bbox)
                lat, lng = convert_xy(x_s, y_s)
                if lat is None:
                    excl["korea_out"] += 1
                    continue

                raw_cat = (row.get(spec["raw_field"]) or "").strip()
                buffered.append(
                    {
                        "_mgmt": mgmt,
                        "_org": org,
                        "source": spec["source"],
                        "name": name,
                        "name_norm": norm,
                        "road_address": (row.get("도로명주소") or "").strip(),
                        "jibun_address": (row.get("지번주소") or "").strip(),
                        "lat": f"{lat:.8f}",
                        "lng": f"{lng:.8f}",
                        "raw_category": raw_cat,
                        "category": spec["category"],
                        "phone": (row.get("전화번호") or "").strip(),
                    }
                )

        # source_key: 관리번호 → |개방자치단체코드 → sha1 (행번호 금지)
        # 중복 통계는 최종 후보(buffered) 기준
        mgmt_counts = Counter(
            (r.get("_mgmt") or "").strip()
            for r in buffered
            if (r.get("_mgmt") or "").strip()
        )
        dup_mgmt_n = sum(1 for m, c in mgmt_counts.items() if c > 1)
        dup_mgmt_rows = sum(c for m, c in mgmt_counts.items() if c > 1)

        keys = assign_localdata_keys(buffered)
        # 해결 방식 분해
        key_plain = key_org = key_sha = 0
        for item, k in zip(buffered, keys):
            m = item["_mgmt"]
            org = item["_org"]
            if k == m:
                key_plain += 1
            elif k == f"{m}|{org}":
                key_org += 1
            else:
                key_sha += 1

        by_key: dict[str, dict] = {}
        ordered: list[str] = []
        deduped = 0
        empty_key = 0
        for item, k in zip(buffered, keys):
            if not k:
                empty_key += 1
                excl["empty_key"] += 1
                continue
            if k in by_key:
                deduped += 1
                continue
            by_key[k] = {
                "source": item["source"],
                "source_key": k,
                "name": item["name"],
                "name_norm": item["name_norm"],
                "road_address": item["road_address"],
                "jibun_address": item["jibun_address"],
                "lat": item["lat"],
                "lng": item["lng"],
                "raw_category": item["raw_category"],
                "category": item["category"],
                "phone": item["phone"],
            }
            ordered.append(k)

        final_rows = [by_key[k] for k in ordered]
        final_n = len(final_rows)
        keep_rate = final_n / open_n if open_n else 0.0
        # 한국 밖 비율은 영업정상 대비 (중단조건)
        out_ratio = excl["korea_out"] / open_n if open_n else 0.0

        ds = {
            "file": spec["file"],
            "csv_total": raw_n,
            "open_ok": open_n,
            "excluded": dict(excl),
            "final": final_n,
            "keep_rate_vs_open": round(keep_rate, 4),
            "korea_out_ratio_vs_open": round(out_ratio, 4),
            "max_data_updated": max_upd,
            "category": spec["category"],
            "key_stats": {
                "mgmt_values_with_dup": dup_mgmt_n,
                "rows_with_dup_mgmt": dup_mgmt_rows,
                "keys_plain_mgmt": key_plain,
                "keys_mgmt_org": key_org,
                "keys_sha1": key_sha,
                "deduped_after_key": deduped,
                "empty_key": empty_key,
            },
        }
        report["datasets"][spec["source"]] = ds
        all_rows.extend(final_rows)

        print(
            f"[{spec['source']}] csv={raw_n} open={open_n} final={final_n} "
            f"({keep_rate:.1%}) korea_out={excl['korea_out']}({out_ratio:.1%}) "
            f"excl={dict(excl)} "
            f"keys plain={key_plain} org={key_org} sha1={key_sha} dedup={deduped}",
            flush=True,
        )

        if keep_rate < 0.90:
            report["abort"] = True
            report["abort_reasons"].append(
                f"{spec['source']}: final/open={keep_rate:.1%} < 90%"
            )
        if out_ratio > 0.05:
            report["abort"] = True
            report["abort_reasons"].append(
                f"{spec['source']}: korea_out/open={out_ratio:.1%} > 5%"
            )

    with out_path.open("w", encoding="utf-8", newline="") as out_f:
        w = csv.DictWriter(out_f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        for row in all_rows:
            w.writerow(row)

    report["rows_out"] = len(all_rows)
    report["elapsed_s"] = round(time.time() - t0, 1)
    (OUT_DIR / "poi_c_stats.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote {out_path} rows={len(all_rows)} abort={report['abort']}", flush=True)
    return report


def load_c(conn, csv_path: Path) -> dict:
    """C그룹만 INSERT. 다른 source 절대 변경 금지."""
    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0")
        cur.execute(
            "SELECT source, count(*) n FROM public.poi GROUP BY 1 ORDER BY 1"
        )
        before = {r[0]: r[1] for r in cur.fetchall()}

        # constraint expand
        cur.execute(
            """
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conname = 'poi_source_check' AND conrelid = 'public.poi'::regclass
            """
        )
        row = cur.fetchone()
        ddl = row[0] if row else ""
        needed = (
            "localdata_bakery",
            "localdata_instant",
            "localdata_beauty",
            "localdata_gym",
        )
        if not all(s in ddl for s in needed):
            cur.execute("ALTER TABLE public.poi DROP CONSTRAINT IF EXISTS poi_source_check")
            cur.execute(
                """
                ALTER TABLE public.poi ADD CONSTRAINT poi_source_check CHECK (
                  source IN (
                    'localdata_general', 'localdata_rest', 'localdata_hotel',
                    'park', 'museum', 'market', 'library', 'tourspot',
                    'localdata_bakery', 'localdata_instant',
                    'localdata_beauty', 'localdata_gym'
                  )
                )
                """
            )
            print("poi_source_check updated for C sources", flush=True)
        else:
            print("poi_source_check already allows C sources", flush=True)
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0")
        cur.execute(
            """
            CREATE TEMP TABLE poi_c_stage (
              source text, source_key text, name text, name_norm text,
              road_address text, jibun_address text,
              lat double precision, lng double precision,
              raw_category text, category text, phone text
            ) ON COMMIT DROP
            """
        )
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            cur.copy_expert(
                """
                COPY poi_c_stage (
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone
                ) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')
                """,
                f,
            )
        cur.execute("SELECT count(*) FROM poi_c_stage")
        staged = cur.fetchone()[0]
        print(f"staged={staged}, inserting…", flush=True)
        cur.execute(
            """
            INSERT INTO public.poi (
              source, source_key, name, name_norm,
              road_address, jibun_address, lat, lng,
              raw_category, category, phone
            )
            SELECT
              source, source_key, name, name_norm,
              NULLIF(road_address, ''), NULLIF(jibun_address, ''),
              lat, lng,
              NULLIF(raw_category, ''), NULLIF(category, ''),
              NULLIF(phone, '')
            FROM poi_c_stage
            ON CONFLICT (source, source_key) DO NOTHING
            """
        )
        inserted = cur.rowcount
    conn.commit()

    with conn.cursor() as cur:
        cur.execute(
            "SELECT source, count(*) n FROM public.poi GROUP BY 1 ORDER BY 1"
        )
        after = {r[0]: r[1] for r in cur.fetchall()}

    # other sources must not shrink/grow except new C sources
    protected = {
        k: v
        for k, v in before.items()
        if k
        not in (
            "localdata_bakery",
            "localdata_instant",
            "localdata_beauty",
            "localdata_gym",
        )
    }
    after_prot = {k: after.get(k, 0) for k in protected}
    unchanged = protected == after_prot

    return {
        "staged": staged,
        "inserted": inserted,
        "before": before,
        "after": after,
        "other_sources_unchanged": unchanged,
        "elapsed_s": round(time.time() - t0, 1),
    }


def validate_known_points() -> list[dict]:
    """조사에서 확보한 TM 좌표 → WGS84 변환 결과."""
    cases = [
        {
            "label": "경원집",
            "x": 197589.395081387,
            "y": 452654.995095917,
            "expect_area": "종로",
            # 카카오/구글에서 도로명으로 확인할 주소
            "address": "서울특별시 종로구 사직로 133-6",
        },
        {
            "label": "묵무키 문래",
            "x": 190613.41742845,
            "y": 445889.19553609,
            "expect_area": "영등포",
            "address": "서울특별시 영등포구 도림로 440-19",
        },
        {
            "label": "요믹스",
            "x": 204669.766218859,
            "y": 449087.756734084,
            "expect_area": "성수",
            "address": "서울특별시 성동구 연무장5가길 7",
        },
    ]
    out = []
    for c in cases:
        lng, lat = TRANSFORMER.transform(c["x"], c["y"])
        out.append({**c, "lat": lat, "lng": lng})
    return out


def db_url() -> str:
    p = Path(__file__).resolve().parent / ".db_url"
    return p.read_text(encoding="utf-8").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--validate-only", action="store_true")
    ap.add_argument("--group", choices=["a", "c"], default="a")
    ap.add_argument("--load", action="store_true", help="prepare 후 DB COPY (group=c)")
    args = ap.parse_args()
    if args.validate_only:
        print(json.dumps(validate_known_points(), ensure_ascii=False, indent=2))
        return

    if args.group == "c":
        print("=== prepare_c ===", flush=True)
        report = prepare_c(limit=args.limit)
        print(json.dumps({
            "abort": report["abort"],
            "abort_reasons": report["abort_reasons"],
            "rows_out": report["rows_out"],
            "category_mapping": report["category_mapping"],
            "datasets": report["datasets"],
            "elapsed_s": report["elapsed_s"],
        }, ensure_ascii=False, indent=2))
        if report["abort"]:
            print("\n[중단] 적재하지 않음.", flush=True)
            for r in report["abort_reasons"]:
                print(f"  - {r}", flush=True)
            sys.exit(2)
        if not args.load:
            return

        # CSV sources must only be C
        with (OUT_DIR / "poi_c_load.csv").open(encoding="utf-8", newline="") as f:
            sources = {r["source"] for r in csv.DictReader(f)}
        allowed = {
            "localdata_bakery",
            "localdata_instant",
            "localdata_beauty",
            "localdata_gym",
        }
        bad = sources - allowed
        if bad:
            print(f"ABORT: unexpected sources in CSV: {bad}", flush=True)
            sys.exit(2)

        import psycopg2
        from psycopg2.extras import RealDictCursor

        print("=== load_c ===", flush=True)
        conn = psycopg2.connect(db_url(), connect_timeout=60)
        try:
            load_result = load_c(conn, OUT_DIR / "poi_c_load.csv")
            if not load_result["other_sources_unchanged"]:
                print("ABORT RISK: other source counts changed!", load_result, flush=True)
                sys.exit(3)

            samples: dict[str, list[dict]] = {}
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                for src in (
                    "localdata_bakery",
                    "localdata_instant",
                    "localdata_beauty",
                    "localdata_gym",
                ):
                    cur.execute(
                        """
                        SELECT name,
                               COALESCE(road_address, jibun_address, '') AS addr,
                               lat, lng
                        FROM public.poi
                        WHERE source = %s
                        ORDER BY random()
                        LIMIT 5
                        """,
                        (src,),
                    )
                    samples[src] = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    """
                    SELECT source, name,
                           COALESCE(road_address, jibun_address, '') AS addr,
                           lat, lng
                    FROM public.poi
                    WHERE name LIKE %s OR name_norm LIKE %s
                    ORDER BY source, name
                    LIMIT 20
                    """,
                    ("%성심당%", "%성심당%"),
                )
                sungsimdang = [dict(r) for r in cur.fetchall()]

            with conn.cursor() as cur2:
                cur2.execute(
                    "SELECT source, count(*) n FROM public.poi GROUP BY 1 ORDER BY 1"
                )
                by_source = [(r[0], r[1]) for r in cur2.fetchall()]
        finally:
            conn.close()

        final = {
            "prepare": report,
            "load": load_result,
            "by_source": by_source,
            "samples": samples,
            "sungsimdang": sungsimdang,
        }
        (OUT_DIR / "poi_c_final_report.json").write_text(
            json.dumps(final, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        print("\n========== FINAL ==========", flush=True)
        for src, d in report["datasets"].items():
            print(
                f"{src}: csv={d['csv_total']} → open={d['open_ok']} → "
                f"excl={d['excluded']} → final={d['final']} "
                f"({d['keep_rate_vs_open']:.1%}) max_upd={d['max_data_updated']}",
                flush=True,
            )
            print(f"  key_stats: {d['key_stats']}", flush=True)
        print("\ncategory_mapping:", report["category_mapping"], flush=True)
        print(
            f"\nload staged={load_result['staged']} inserted={load_result['inserted']} "
            f"other_unchanged={load_result['other_sources_unchanged']}",
            flush=True,
        )
        print("\nby_source:", flush=True)
        for s, n in by_source:
            print(f"  {s}: {n}", flush=True)
        print("\nsamples:", flush=True)
        for src, rows in samples.items():
            print(f"  [{src}]", flush=True)
            for r in rows:
                print(
                    f"    {r['name']} | {r['addr']} | {r['lat']},{r['lng']}",
                    flush=True,
                )
        print("\n성심당:", flush=True)
        if not sungsimdang:
            print("  (poi에 성심당 없음)", flush=True)
        else:
            for r in sungsimdang:
                print(
                    f"  [{r['source']}] {r['name']} | {r['addr']} | {r['lat']},{r['lng']}",
                    flush=True,
                )
        return

    summary = prepare(limit=args.limit)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
