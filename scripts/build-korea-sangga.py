#!/usr/bin/env python3
"""Build korea-sangga.pmtiles from 소상공인시장진흥공단 상가(상권)정보 CSVs.

Streams GeoJSONSeq (one Feature per line) into tippecanoe — never loads all rows.

Usage:
  python3 scripts/build-korea-sangga.py
  OUT_DIR=build/tiles python3 scripts/build-korea-sangga.py

Requires: tippecanoe on PATH.
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "scripts" / "localdata" / "raw_sangga"
OUT_DIR = Path(os.environ.get("OUT_DIR", str(ROOT / "build" / "tiles")))
SEQ_PATH = OUT_DIR / "sangga.geojsonseq"
PMTILES = OUT_DIR / "korea-sangga.pmtiles"
SUMMARY = OUT_DIR / "sangga-build-summary.json"

# 대분류 전체 제외
EXCLUDE_DAE = frozenset(
    {
        "부동산",
        "과학·기술",
        "시설관리·임대",
        "교육",  # 학교는 OMT landmark; 학원 등은 지도 밀도만 해침
    }
)

# 수리·개인 중 지도에 쓸 중분류만
REPAIR_INCLUDE_JUNG = frozenset({"이용·미용", "세탁", "욕탕·신체관리"})

# 소매 중 제외(부품·가정용연료·담배·중고차 등). 주유·LPG·충전은 map_category에서 별도 포함.
RETAIL_EXCLUDE_JUNG = frozenset(
    {
        "자동차 부품 소매",
        "모터사이클 소매",
        "담배 소매",
        "중고 상품 소매",
        "철물·건설자재 소매",
    }
)

PAREN_EN = re.compile(r"\s*\([^)]*[A-Za-z][^)]*\)\s*")
MULTI_SPACE = re.compile(r"\s+")


def clean_name(mutual: str, branch: str) -> str | None:
    m = MULTI_SPACE.sub(" ", (mutual or "").strip())
    b = MULTI_SPACE.sub(" ", (branch or "").strip())
    if not m:
        return None
    m = PAREN_EN.sub(" ", m).strip()
    m = MULTI_SPACE.sub(" ", m).strip()
    if b:
        b = PAREN_EN.sub(" ", b).strip()
        b = MULTI_SPACE.sub(" ", b).strip()
        if b and b not in m:
            m = f"{m} {b}"
    m = MULTI_SPACE.sub(" ", m).strip()
    return m if len(m) >= 2 else None


def map_category(
    dae: str, jung: str, so: str
) -> tuple[str, str | None, int] | None:
    """Return (class, subclass|None, rank) — lower rank = higher priority.
    Aligns with OMT shop_poi class/subclass for icon/color reuse.
    """
    if dae in EXCLUDE_DAE:
        return None

    if dae == "수리·개인":
        if jung not in REPAIR_INCLUDE_JUNG:
            return None
        if jung == "이용·미용":
            return ("hairdresser", None, 65)
        if jung == "세탁":
            return ("laundry", None, 70)
        if jung == "욕탕·신체관리":
            return ("shop", None, 72)
        return None

    if dae == "음식":
        if jung == "비알코올":
            return ("cafe", None, 12)
        if jung == "주점":
            return ("bar", None, 18)
        if jung == "기타 간이":
            if "빵" in so or "도넛" in so or "떡" in so or "한과" in so or "베이글" in so:
                return ("bakery", None, 16)
            if "아이스크림" in so or "빙수" in so:
                return ("bakery", None, 18)
            if (
                "치킨" in so
                or "햄버거" in so
                or "피자" in so
                or "샌드위치" in so
                or "도시락" in so
            ):
                return ("fast_food", None, 16)
            return ("fast_food", None, 22)
        if jung in (
            "한식",
            "중식",
            "일식",
            "서양식",
            "동남아시아",
            "기타 외국",
            "구내식당·뷔페",
        ):
            return ("restaurant", None, 14)
        return ("restaurant", None, 20)

    if dae == "소매":
        if jung == "연료 소매":
            # 주유소 / LPG·가스 충전소 / 전기차 충전 (가정용 연료 등은 제외)
            if "주유" in so:
                return ("fuel", None, 45)
            if "충전" in so or "LPG" in so.upper() or "전기" in so:
                return ("fuel", None, 48)
            return None
        if jung in RETAIL_EXCLUDE_JUNG:
            return None
        if jung == "종합 소매":
            if "편의점" in so:
                return ("shop", "convenience", 35)
            if "슈퍼" in so:
                return ("grocery", "supermarket", 28)
            return ("shop", None, 40)
        if jung == "식료품 소매":
            if "시장" in so or "마트" in so:
                return ("grocery", "marketplace", 30)
            return ("grocery", None, 38)
        if jung == "의약·화장품 소매":
            if "약국" in so:
                return ("pharmacy", None, 32)
            return ("shop", None, 55)  # 화장품
        if jung == "섬유·의복·신발 소매":
            if "신발" in so:
                return ("shoes", None, 58)
            return ("clothes", None, 55)
        if jung == "시계·귀금속 소매":
            return ("jewelry", None, 60)
        if jung == "가전·통신 소매":
            return ("electronics", None, 62)
        if jung == "가구 소매":
            return ("furniture", None, 68)
        if jung == "식물 소매":
            return ("florist", None, 60)
        if jung == "안경·정밀기기 소매":
            return ("optician", None, 55)
        if jung == "오락용품 소매":
            if "서적" in so or "문구" in so:
                return ("books", None, 58)
            return ("toys", None, 62)
        if jung == "장식품 소매":
            return ("gift", None, 65)
        if jung == "애완동물·용품 소매":
            return ("shop", None, 65)
        if jung == "기타 생활용품 소매" or jung == "기타 상품 소매":
            return ("shop", None, 68)
        return ("shop", None, 70)

    if dae == "숙박":
        return ("lodging", None, 25)

    if dae == "보건의료":
        if jung == "병원":
            return ("hospital", None, 30)
        if jung == "의원":
            return ("doctors", None, 40)
        if "약국" in so or "약국" in jung:
            return ("pharmacy", None, 32)
        return ("doctors", None, 45)

    if dae == "예술·스포츠":
        if jung == "유원지·오락":
            if "영화" in so or "극장" in so:
                return ("cinema", None, 26)
            return ("attraction", None, 50)
        if jung == "스포츠 서비스":
            return ("sports", None, 55)
        if jung == "도서관·사적지":
            return ("library", None, 48)
        return ("attraction", None, 55)

    return None


def iter_csv_rows():
    csvs = sorted(RAW.glob("*.csv"))
    if not csvs:
        raise FileNotFoundError(f"No CSVs in {RAW}")
    for p in csvs:
        with p.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                yield p.name, row


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    excluded_dae: Counter[str] = Counter()
    excluded_other = 0
    excluded_bad = 0
    by_class: Counter[str] = Counter()
    kept = 0
    scanned = 0

    print(f"Writing {SEQ_PATH} …", flush=True)
    with SEQ_PATH.open("w", encoding="utf-8") as out:
        for _fname, row in iter_csv_rows():
            scanned += 1
            if scanned % 500_000 == 0:
                print(
                    f"  … scanned={scanned:,} kept={kept:,} excluded_dae={sum(excluded_dae.values()):,}",
                    flush=True,
                )
            dae = (row.get("상권업종대분류명") or "").strip()
            jung = (row.get("상권업종중분류명") or "").strip()
            so = (row.get("상권업종소분류명") or "").strip()
            if dae in EXCLUDE_DAE:
                excluded_dae[dae] += 1
                continue
            mapped = map_category(dae, jung, so)
            if not mapped:
                excluded_other += 1
                continue
            cls, sub, rank = mapped
            try:
                lng = float(row.get("경도") or "")
                lat = float(row.get("위도") or "")
            except ValueError:
                excluded_bad += 1
                continue
            if not (124.0 <= lng <= 132.5 and 33.0 <= lat <= 39.5):
                excluded_bad += 1
                continue
            if not math.isfinite(lng) or not math.isfinite(lat):
                excluded_bad += 1
                continue
            name = clean_name(row.get("상호명") or "", row.get("지점명") or "")
            if not name:
                excluded_bad += 1
                continue
            props: dict = {
                "name": name,
                "class": cls,
                "rank": rank,
                "kind": "sangga",
            }
            if sub:
                props["subclass"] = sub
            feat = {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
            }
            out.write(json.dumps(feat, ensure_ascii=False, separators=(",", ":")))
            out.write("\n")
            kept += 1
            by_class[cls] += 1

    seq_bytes = SEQ_PATH.stat().st_size
    print(
        f"GeoJSONSeq done: kept={kept:,} scanned={scanned:,} bytes={seq_bytes:,}",
        flush=True,
    )

    tippe = [
        "tippecanoe",
        "-o",
        str(PMTILES),
        "--force",
        "--name=korea-sangga",
        "--attribution=소상공인시장진흥공단",
        "--minimum-zoom=14",
        "--maximum-zoom=16",
        # No per-tile byte/feature caps → no densest drop at z16 (or below).
        # order-by=rank still controls within-tile feature order for clients.
        "--no-feature-limit",
        "--no-tile-size-limit",
        "--order-by=rank",
        "-l",
        "sangga",
        str(SEQ_PATH),
    ]
    print("Running:", " ".join(tippe), flush=True)
    t1 = time.time()
    subprocess.run(tippe, check=True)
    tippe_s = time.time() - t1
    pm_bytes = PMTILES.stat().st_size

    # Drop bulky seq after successful pmtiles (keep summary)
    SEQ_PATH.unlink(missing_ok=True)

    summary = {
        "scanned": scanned,
        "kept": kept,
        "excluded_dae": dict(excluded_dae),
        "excluded_dae_total": sum(excluded_dae.values()),
        "excluded_other": excluded_other,
        "excluded_bad_coords_or_name": excluded_bad,
        "by_class": dict(by_class.most_common()),
        "pmtiles_bytes": pm_bytes,
        "pmtiles_path": str(PMTILES),
        "tippecanoe_seconds": round(tippe_s, 1),
        "total_seconds": round(time.time() - t0, 1),
        "minzoom": 14,
        "maxzoom": 16,
        "exclude_dae_list": sorted(EXCLUDE_DAE),
        "repair_include_jung": sorted(REPAIR_INCLUDE_JUNG),
        "retail_exclude_jung": sorted(RETAIL_EXCLUDE_JUNG),
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Wrote {PMTILES} ({pm_bytes / 1024 / 1024:.1f} MiB)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as e:
        print("tippecanoe failed", e, file=sys.stderr)
        raise SystemExit(1)
