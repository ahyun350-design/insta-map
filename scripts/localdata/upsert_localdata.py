#!/usr/bin/env python3
"""LOCALDATA 7종 전체 CSV → source_key upsert (DELETE/TRUNCATE 금지).

  - 영업/정상만 적재 대상. 폐업 행은 무시(기존 poi 삭제 안 함).
  - source_key: A그룹 general/rest = 관리번호 / hotel·C그룹 = assign_localdata_keys
  - 좌표: convert_xy (EPSG:5174→4326). C그룹은 좌표 필수(기존 prepare_c).
"""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from prepare import (
    C_SOURCES,
    LOCALDATA,
    OUT_DIR,
    RAW_C,
    ROOT,
    SOURCES,
    assign_localdata_keys,
    convert_xy,
    db_url,
    name_norm,
    map_category,
    open_csv,
)

try:
    from poi_match import normalize_poi_name as c_name_norm
except ImportError:
    c_name_norm = name_norm

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

DOWNLOADS = [
    {
        "slug": "general_restaurants",
        "path": LOCALDATA / "general_restaurants.csv",
        "source": "localdata_general",
        "group": "a",
        "file_key": "general_restaurants.csv",
        "raw_field": "업태구분명",
    },
    {
        "slug": "rest_cafes",
        "path": LOCALDATA / "rest_cafes.csv",
        "source": "localdata_rest",
        "group": "a",
        "file_key": "rest_cafes.csv",
        "raw_field": "업태구분명",
    },
    {
        "slug": "tourist_accommodations",
        "path": LOCALDATA / "tourist_accommodations.csv",
        "source": "localdata_hotel",
        "group": "a_hotel",
        "file_key": "tourist_accommodations.csv",
        "raw_field": "관광숙박업상세명",
    },
    {
        "slug": "bakeries",
        "path": RAW_C / "식품_제과점영업.csv",
        "source": "localdata_bakery",
        "group": "c",
        "category": "카페",
        "raw_field": "업태구분명",
    },
    {
        "slug": "instant_food_processors",
        "path": RAW_C / "식품_즉석판매제조가공업.csv",
        "source": "localdata_instant",
        "group": "c",
        "category": "맛집",
        "raw_field": "업태구분명",
    },
    {
        "slug": "beauty_salons",
        "path": RAW_C / "생활_미용업.csv",
        "source": "localdata_beauty",
        "group": "c",
        "category": "쇼핑",
        "raw_field": "업태구분명",
    },
    {
        "slug": "fitness_centers",
        "path": RAW_C / "생활_체력단련장업.csv",
        "source": "localdata_gym",
        "group": "c",
        "category": "놀거리",
        "raw_field": "업태구분명",
    },
]

PREV_COUNTS = {
    "localdata_general": 675_788,
    "localdata_rest": 198_742,
    "localdata_hotel": 3_463,
    "localdata_bakery": 19_233,
    "localdata_instant": 94_573,
    "localdata_beauty": 189_284,
    "localdata_gym": 16_273,
}

FIELDNAMES = [
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
    "data_updated",
]


def download_one(slug: str, dest: Path) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://file.localdata.go.kr/file/download/{slug}/info"
    tmp = dest.with_suffix(dest.suffix + ".part")
    t0 = time.time()
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Referer": "https://www.data.go.kr/"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
        total = 0
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
    tmp.replace(dest)
    return {
        "slug": slug,
        "path": str(dest),
        "bytes": total,
        "elapsed_s": round(time.time() - t0, 1),
        "http": getattr(resp, "status", 200),
    }


def max_data_updated(path: Path) -> str | None:
    max_upd: str | None = None
    with open_csv(path) as f:
        for row in csv.DictReader(f):
            upd = (row.get("데이터갱신시점") or "").strip()
            if upd and (max_upd is None or upd > max_upd):
                max_upd = upd
    return max_upd


def prepare_dataset(spec: dict) -> tuple[list[dict], dict]:
    path: Path = spec["path"]
    source = spec["source"]
    group = spec["group"]
    raw_field = spec["raw_field"]

    stats = Counter()
    buffered: list[dict] = []
    max_upd: str | None = None
    open_with_xy = 0
    korea_out = 0

    with open_csv(path) as f:
        for row in csv.DictReader(f):
            stats["raw"] += 1
            upd = (row.get("데이터갱신시점") or "").strip()
            if upd and (max_upd is None or upd > max_upd):
                max_upd = upd

            if (row.get("영업상태명") or "").strip() != "영업/정상":
                stats["skipped_not_open"] += 1
                continue
            stats["open"] += 1

            name = (row.get("사업장명") or "").strip()
            if not name:
                stats["empty_name"] += 1
                continue
            norm = c_name_norm(name) if group == "c" else name_norm(name)
            if not norm:
                stats["empty_norm"] += 1
                continue

            mgmt = (row.get("관리번호") or "").strip()
            org = (row.get("개방자치단체코드") or "").strip()
            if not mgmt:
                stats["empty_mgmt"] += 1
                continue

            x_s = (row.get("좌표정보(X)") or "").strip()
            y_s = (row.get("좌표정보(Y)") or "").strip()
            lat = lng = None
            if x_s and y_s:
                try:
                    float(x_s)
                    float(y_s)
                    open_with_xy += 1
                    lat, lng = convert_xy(x_s, y_s)
                    if lat is None:
                        korea_out += 1
                        if group == "c":
                            stats["korea_out"] += 1
                            continue
                except ValueError:
                    stats["xy_parse_fail"] += 1
                    if group == "c":
                        continue
            else:
                stats["null_xy"] += 1
                if group == "c":
                    continue

            raw_cat = (row.get(raw_field) or "").strip()
            if source == "localdata_hotel" and not raw_cat:
                raw_cat = (row.get("문화체육업종명") or "관광숙박업").strip()

            if group == "c":
                category = spec["category"]
            else:
                category = map_category(source, raw_cat)

            buffered.append(
                {
                    "_mgmt": mgmt,
                    "_org": org,
                    "source": source,
                    "name": name,
                    "name_norm": norm,
                    "road_address": (row.get("도로명주소") or "").strip(),
                    "jibun_address": (row.get("지번주소") or "").strip(),
                    "lat": "" if lat is None else f"{lat:.8f}",
                    "lng": "" if lng is None else f"{lng:.8f}",
                    "raw_category": raw_cat,
                    "category": category,
                    "phone": (row.get("전화번호") or "").strip(),
                    "data_updated": upd,
                }
            )

    # source_key
    if group in ("a_hotel", "c"):
        keys = assign_localdata_keys(buffered)
    else:
        keys = [r["_mgmt"] for r in buffered]

    by_key: dict[str, dict] = {}
    ordered: list[str] = []
    for item, k in zip(buffered, keys):
        if not k:
            stats["empty_key"] += 1
            continue
        if k not in by_key:
            ordered.append(k)
        else:
            stats["deduped"] += 1
        out = {fn: item.get(fn, "") for fn in FIELDNAMES}
        out["source"] = source
        out["source_key"] = k
        by_key[k] = out

    rows = [by_key[k] for k in ordered]
    korea_ratio = (korea_out / open_with_xy) if open_with_xy else 0.0
    meta = {
        "source": source,
        "slug": spec["slug"],
        "max_data_updated": max_upd,
        "raw": stats["raw"],
        "open": stats["open"],
        "rows_out": len(rows),
        "skipped_not_open": stats["skipped_not_open"],
        "korea_out": korea_out,
        "open_with_xy": open_with_xy,
        "korea_out_ratio": round(korea_ratio, 4),
        "abort_korea": korea_ratio > 0.05,
        "stats": dict(stats),
    }
    return rows, meta


def upsert_all(conn, rows: list[dict]) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stage_csv = OUT_DIR / "poi_upsert_stage.csv"
    with stage_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    sources = sorted({r["source"] for r in rows})
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SET statement_timeout = 0")
        cur.execute(
            "SELECT source, count(*)::bigint AS n FROM public.poi "
            "WHERE source = ANY(%s) GROUP BY source",
            (sources,),
        )
        before = {r["source"]: int(r["n"]) for r in cur.fetchall()}
        for s in sources:
            before.setdefault(s, 0)

        cur.execute(
            """
            CREATE TEMP TABLE poi_upsert_stage (
              source text, source_key text, name text, name_norm text,
              road_address text, jibun_address text,
              lat double precision, lng double precision,
              raw_category text, category text, phone text,
              data_updated text
            ) ON COMMIT DROP
            """
        )
        with stage_csv.open("r", encoding="utf-8", newline="") as f:
            cur.copy_expert(
                """
                COPY poi_upsert_stage (
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone, data_updated
                ) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')
                """,
                f,
            )

        # classify before write
        cur.execute(
            """
            SELECT s.source,
              count(*) FILTER (
                WHERE p.source_key IS NULL
              )::bigint AS inserted,
              count(*) FILTER (
                WHERE p.source_key IS NOT NULL AND (
                  p.name IS DISTINCT FROM s.name
                  OR p.name_norm IS DISTINCT FROM s.name_norm
                  OR p.road_address IS DISTINCT FROM NULLIF(s.road_address, '')
                  OR p.jibun_address IS DISTINCT FROM NULLIF(s.jibun_address, '')
                  OR p.lat IS DISTINCT FROM s.lat
                  OR p.lng IS DISTINCT FROM s.lng
                  OR p.raw_category IS DISTINCT FROM NULLIF(s.raw_category, '')
                  OR p.category IS DISTINCT FROM NULLIF(s.category, '')
                  OR p.phone IS DISTINCT FROM NULLIF(s.phone, '')
                )
              )::bigint AS updated,
              count(*) FILTER (
                WHERE p.source_key IS NOT NULL AND NOT (
                  p.name IS DISTINCT FROM s.name
                  OR p.name_norm IS DISTINCT FROM s.name_norm
                  OR p.road_address IS DISTINCT FROM NULLIF(s.road_address, '')
                  OR p.jibun_address IS DISTINCT FROM NULLIF(s.jibun_address, '')
                  OR p.lat IS DISTINCT FROM s.lat
                  OR p.lng IS DISTINCT FROM s.lng
                  OR p.raw_category IS DISTINCT FROM NULLIF(s.raw_category, '')
                  OR p.category IS DISTINCT FROM NULLIF(s.category, '')
                  OR p.phone IS DISTINCT FROM NULLIF(s.phone, '')
                )
              )::bigint AS unchanged
            FROM poi_upsert_stage s
            LEFT JOIN public.poi p
              ON p.source = s.source AND p.source_key = s.source_key
            GROUP BY s.source
            """
        )
        classified = {r["source"]: dict(r) for r in cur.fetchall()}

        cur.execute(
            """
            INSERT INTO public.poi (
              source, source_key, name, name_norm,
              road_address, jibun_address, lat, lng,
              raw_category, category, phone, updated_at
            )
            SELECT
              source, source_key, name, name_norm,
              NULLIF(road_address, ''), NULLIF(jibun_address, ''),
              lat, lng,
              NULLIF(raw_category, ''), NULLIF(category, ''),
              NULLIF(phone, ''), now()
            FROM poi_upsert_stage
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
        write_rowcount = cur.rowcount

        cur.execute(
            "SELECT source, count(*)::bigint AS n FROM public.poi "
            "WHERE source = ANY(%s) GROUP BY source",
            (sources,),
        )
        after = {r["source"]: int(r["n"]) for r in cur.fetchall()}
        for s in sources:
            after.setdefault(s, 0)

        # samples: random 10 with data_updated from stage (joined after upsert)
        cur.execute(
            """
            SELECT p.name,
                   COALESCE(p.road_address, p.jibun_address, '') AS addr,
                   s.data_updated,
                   p.source
            FROM public.poi p
            JOIN poi_upsert_stage s
              ON s.source = p.source AND s.source_key = p.source_key
            WHERE s.data_updated IS NOT NULL AND s.data_updated <> ''
            ORDER BY random()
            LIMIT 10
            """
        )
        samples = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT source, count(*)::bigint AS n FROM public.poi "
            "GROUP BY source ORDER BY source"
        )
        all_sources = {r["source"]: int(r["n"]) for r in cur.fetchall()}

    conn.commit()

    shrink = {
        s: {"before": before[s], "after": after[s]}
        for s in sources
        if after[s] < before[s]
    }
    return {
        "before": before,
        "after": after,
        "classified": classified,
        "write_rowcount": write_rowcount,
        "shrink": shrink,
        "samples": samples,
        "all_sources": all_sources,
        "stage_csv": str(stage_csv),
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LOCALDATA.mkdir(parents=True, exist_ok=True)
    RAW_C.mkdir(parents=True, exist_ok=True)

    print("=== [1] download ===", flush=True)
    dl_report = []
    for spec in DOWNLOADS:
        print(f"downloading {spec['slug']} → {spec['path'].name} …", flush=True)
        info = download_one(spec["slug"], spec["path"])
        max_upd = max_data_updated(spec["path"])
        info["max_data_updated"] = max_upd
        info["source"] = spec["source"]
        dl_report.append(info)
        print(
            f"  {spec['slug']}: bytes={info['bytes']:,} "
            f"max_데이터갱신시점={max_upd} ({info['elapsed_s']}s)",
            flush=True,
        )

    stale = [
        d for d in dl_report
        if not d["max_data_updated"] or d["max_data_updated"] < "2026-09-13"
    ]
    if stale:
        print("\n[경고] 일부 파일 max 데이터갱신시점이 9/13 미만:", flush=True)
        for d in stale:
            print(f"  {d['slug']}: {d['max_data_updated']}", flush=True)

    print("\n=== [2] prepare ===", flush=True)
    all_rows: list[dict] = []
    metas = []
    abort = False
    for spec in DOWNLOADS:
        rows, meta = prepare_dataset(spec)
        metas.append(meta)
        print(
            f"  {meta['source']}: out={meta['rows_out']:,} open={meta['open']:,} "
            f"max_upd={meta['max_data_updated']} "
            f"korea_out_ratio={meta['korea_out_ratio']:.2%}",
            flush=True,
        )
        if meta["abort_korea"]:
            print(
                f"[중단] {meta['source']}: 한국 밖 좌표 "
                f"{meta['korea_out_ratio']:.1%} > 5%",
                flush=True,
            )
            abort = True
        all_rows.extend(rows)

    if abort:
        (OUT_DIR / "upsert_abort.json").write_text(
            json.dumps({"downloads": dl_report, "prepare": metas}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return 2

    print(f"\n=== [3] upsert rows={len(all_rows):,} ===", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    try:
        result = upsert_all(conn, all_rows)
    finally:
        conn.close()

    if result["shrink"]:
        print("[중단] upsert 후 건수 감소:", json.dumps(result["shrink"], ensure_ascii=False), flush=True)
        (OUT_DIR / "upsert_abort.json").write_text(
            json.dumps(
                {"downloads": dl_report, "prepare": metas, "upsert": result},
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        return 3

    print("\n=== upsert by source ===", flush=True)
    for src in sorted(result["classified"]):
        c = result["classified"][src]
        print(
            f"  {src}: +{c['inserted']:,} new / {c['updated']:,} updated / "
            f"{c['unchanged']:,} unchanged | "
            f"count {result['before'].get(src, 0):,} → {result['after'].get(src, 0):,}",
            flush=True,
        )

    print("\n=== select source, count(*) ===", flush=True)
    for src, n in sorted(result["all_sources"].items()):
        prev = PREV_COUNTS.get(src)
        delta = f" ({n - prev:+,})" if prev is not None else ""
        print(f"  {src}: {n:,}{delta}", flush=True)

    print("\n=== random 10 (name | addr | 데이터갱신시점) ===", flush=True)
    for s in result["samples"]:
        print(
            f"  [{s['source']}] {s['name']} | {s['addr']} | {s['data_updated']}",
            flush=True,
        )

    report = {
        "downloads": dl_report,
        "prepare": metas,
        "upsert": {
            "before": result["before"],
            "after": result["after"],
            "classified": result["classified"],
            "write_rowcount": result["write_rowcount"],
            "all_sources": result["all_sources"],
            "samples": result["samples"],
        },
    }
    out = OUT_DIR / "upsert_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nwrote {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
