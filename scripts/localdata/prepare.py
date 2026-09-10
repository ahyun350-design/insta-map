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
OUT_DIR = Path(__file__).resolve().parent / "out"

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

    # (source, source_key) 중복 시 마지막 행 유지 (관광숙박업 원본에 중복 관리번호 존재)
    ordered_keys: list[tuple[str, str]] = []
    rows_by_key: dict[tuple[str, str], dict] = {}

    for spec in SOURCES:
        path = LOCALDATA / spec["file"]
        if not path.exists():
            raise FileNotFoundError(path)
        with open_csv(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("영업상태명") != "영업/정상":
                    stats["skipped_not_open"] += 1
                    continue
                name = (row.get("사업장명") or "").strip()
                key = (row.get("관리번호") or "").strip()
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

                sk = (spec["source"], key)
                if sk not in rows_by_key:
                    ordered_keys.append(sk)
                else:
                    stats["deduped"] = stats.get("deduped", 0) + 1
                rows_by_key[sk] = {
                    "source": spec["source"],
                    "source_key": key,
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
                if limit and len(ordered_keys) >= limit:
                    break
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args()
    if args.validate_only:
        print(json.dumps(validate_known_points(), ensure_ascii=False, indent=2))
        return
    summary = prepare(limit=args.limit)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
