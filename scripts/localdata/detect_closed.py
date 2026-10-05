#!/usr/bin/env python3
"""인허가 폐업 감지 dry-run (DB 읽기 전용, 쓰기 없음).

- 원본은 scripts/localdata/raw_closed_check/ 에만 저장 (기존 raw 덮어쓰기 금지)
- source_key 는 upsert_localdata / prepare.assign_localdata_keys 재사용
- 결과는 out/closed_dryrun_<timestamp>.json (gitignore)

  scripts/localdata/.venv/bin/python scripts/localdata/detect_closed.py
"""

from __future__ import annotations

import csv
import json
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from prepare import (
    LOCALDATA,
    OUT_DIR,
    RAW_C,
    assign_localdata_keys,
    convert_xy,
    db_url,
    name_norm,
    open_csv,
    should_exclude_raw,
)
from upsert_localdata import DOWNLOADS, download_one, max_data_updated

try:
    from poi_match import normalize_poi_name as c_name_norm
except ImportError:
    c_name_norm = name_norm

RAW_CHECK = Path(__file__).resolve().parent / "raw_closed_check"

LOCALDATA_SOURCES = (
    "localdata_general",
    "localdata_rest",
    "localdata_hotel",
    "localdata_bakery",
    "localdata_instant",
    "localdata_beauty",
    "localdata_gym",
)


def remap_download_specs() -> list[dict]:
    """DOWNLOADS 스펙을 재사용하되 경지만 raw_closed_check/ 아래로."""
    specs: list[dict] = []
    for spec in DOWNLOADS:
        src_path: Path = spec["path"]
        if src_path.parent == LOCALDATA or src_path.parent.resolve() == LOCALDATA.resolve():
            dest = RAW_CHECK / "a" / src_path.name
        elif src_path.parent == RAW_C or src_path.parent.resolve() == RAW_C.resolve():
            dest = RAW_CHECK / "c" / src_path.name
        else:
            dest = RAW_CHECK / src_path.name
        specs.append({**spec, "path": dest})
    return specs


def _buffer_row(spec: dict, row: dict, *, for_open_filters: bool) -> dict | None:
    """upsert_localdata.prepare_dataset 과 동일한 필드 추출.

    for_open_filters=True  → 영업/정상 + exclude_raw + (c면 좌표) 등 upsert 동일
    for_open_filters=False → 비정상 상태 행용 (상태 제외 필터는 완화: exclude_raw 적용 안 함)
    """
    group = spec["group"]
    source = spec["source"]
    raw_field = spec["raw_field"]

    status = (row.get("영업상태명") or "").strip()
    if for_open_filters:
        if status != "영업/정상":
            return None
    else:
        if status == "영업/정상" or not status:
            return None

    name = (row.get("사업장명") or "").strip()
    if not name:
        return None
    norm = c_name_norm(name) if group == "c" else name_norm(name)
    if not norm:
        return None

    mgmt = (row.get("관리번호") or "").strip()
    org = (row.get("개방자치단체코드") or "").strip()
    if not mgmt:
        return None

    x_s = (row.get("좌표정보(X)") or "").strip()
    y_s = (row.get("좌표정보(Y)") or "").strip()
    lat = lng = None
    if x_s and y_s:
        try:
            float(x_s)
            float(y_s)
            lat, lng = convert_xy(x_s, y_s)
            if lat is None and group == "c":
                return None
        except ValueError:
            if group == "c":
                return None
    else:
        if group == "c":
            return None

    raw_cat = (row.get(raw_field) or "").strip()
    if source == "localdata_hotel" and not raw_cat:
        raw_cat = (row.get("문화체육업종명") or "관광숙박업").strip()
    if for_open_filters and should_exclude_raw(raw_cat):
        return None

    closed_date = (row.get("폐업일자") or "").strip()
    permit_date = (row.get("인허가일자") or "").strip()
    data_updated = (row.get("데이터갱신시점") or "").strip()

    return {
        "_mgmt": mgmt,
        "_org": org,
        "_status": status,
        "_closed_date": closed_date,
        "_permit_date": permit_date,
        "source": source,
        "name": name,
        "name_norm": norm,
        "road_address": (row.get("도로명주소") or "").strip(),
        "jibun_address": (row.get("지번주소") or "").strip(),
        "lat": "" if lat is None else f"{lat:.8f}",
        "lng": "" if lng is None else f"{lng:.8f}",
        "data_updated": data_updated,
    }


def build_key_status_index(spec: dict) -> tuple[dict[str, dict], dict, str | None]:
    """source_key → {status, closed_date, name, name_norm} + 메타."""
    path: Path = spec["path"]
    group = spec["group"]
    open_buf: list[dict] = []
    closed_buf: list[dict] = []
    status_all = Counter()
    max_upd: str | None = None
    raw_n = 0

    with open_csv(path) as f:
        for row in csv.DictReader(f):
            raw_n += 1
            upd = (row.get("데이터갱신시점") or "").strip()
            if upd and (max_upd is None or upd > max_upd):
                max_upd = upd
            st = (row.get("영업상태명") or "").strip() or "(empty)"
            status_all[st] += 1

            o = _buffer_row(spec, row, for_open_filters=True)
            if o is not None:
                open_buf.append(o)
                continue
            c = _buffer_row(spec, row, for_open_filters=False)
            if c is not None:
                closed_buf.append(c)

    # Keys: open set exactly like upsert; closed keys via assign on open+closed (hotel/c)
    # so uniqueness matches "mgmt unique among peers that get keys".
    if group in ("a_hotel", "c"):
        combined = open_buf + closed_buf
        keys = assign_localdata_keys(combined)
        keyed_items = list(zip(combined, keys))
    else:
        keyed_items = [(r, r["_mgmt"]) for r in (open_buf + closed_buf)]

    by_key: dict[str, dict] = {}
    open_name_norms: set[str] = set()
    open_by_norm: dict[str, list[str]] = defaultdict(list)

    for item, key in keyed_items:
        if not key:
            continue
        st = item["_status"]
        if st == "영업/정상":
            open_name_norms.add(item["name_norm"])
            open_by_norm[item["name_norm"]].append(key)
        # Prefer non-open when overwriting same key
        prev = by_key.get(key)
        if prev is None or (prev["status"] == "영업/정상" and st != "영업/정상"):
            by_key[key] = {
                "status": st,
                "closed_date": item.get("_closed_date") or "",
                "name": item["name"],
                "name_norm": item["name_norm"],
                "data_updated": item.get("data_updated") or "",
            }

    meta = {
        "raw_rows": raw_n,
        "open_buffered": len(open_buf),
        "closed_buffered": len(closed_buf),
        "keys_indexed": len(by_key),
        "status_all_raw": dict(status_all),
        "max_data_updated": max_upd,
        "open_name_norms": open_name_norms,
        "open_by_norm": open_by_norm,
    }
    return by_key, meta, max_upd


def load_poi_keys(conn, source: str) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, source_key, name
            FROM public.poi
            WHERE source = %s
              AND source_key IS NOT NULL
              AND btrim(source_key) <> ''
            """,
            (source,),
        )
        return [dict(r) for r in cur.fetchall()]


def load_places_for_poi_ids(conn, poi_ids: list[int]) -> list[dict]:
    if not poi_ids:
        return []
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, user_id, name, poi_id
            FROM public.places
            WHERE poi_id = ANY(%s)
            """,
            (poi_ids,),
        )
        return [dict(r) for r in cur.fetchall()]


def month_bucket(closed_date: str) -> str:
    s = (closed_date or "").strip()
    if not s:
        return "(empty)"
    # YYYY-MM-DD or YYYYMMDD or YYYY-MM
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) >= 6:
        return f"{digits[:4]}-{digits[4:6]}"
    return s[:7] if len(s) >= 7 else s


def main() -> int:
    t0 = time.time()
    specs = remap_download_specs()
    RAW_CHECK.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=== [1] download → raw_closed_check/ ===", flush=True)
    dl_report = []
    for spec in specs:
        dest: Path = spec["path"]
        print(f"downloading {spec['slug']} → {dest} …", flush=True)
        info = download_one(spec["slug"], dest)
        info["source"] = spec["source"]
        info["max_data_updated"] = max_data_updated(dest)
        dl_report.append(info)
        print(
            f"  bytes={info['bytes']:,} max_데이터갱신시점={info['max_data_updated']} "
            f"({info['elapsed_s']}s)",
            flush=True,
        )

    print("\n=== [2] index raw + compare poi (read-only) ===", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    conn.set_session(readonly=True, autocommit=True)

    by_source: dict[str, dict] = {}
    closed_detail: list[dict] = []
    closed_poi_ids: list[int] = []
    reopen_candidates = 0
    reopen_samples: list[dict] = []

    try:
        for spec in specs:
            source = spec["source"]
            print(f"  indexing {source} …", flush=True)
            key_map, meta, _ = build_key_status_index(spec)
            pois = load_poi_keys(conn, source)
            found = 0
            not_found = 0
            status_of_found = Counter()
            closed_n = 0

            open_norms: set[str] = meta.pop("open_name_norms")
            open_by_norm: dict = meta.pop("open_by_norm")

            for p in pois:
                sk = (p["source_key"] or "").strip()
                hit = key_map.get(sk)
                if hit is None:
                    not_found += 1
                    continue
                found += 1
                st = hit["status"]
                status_of_found[st] += 1
                if st != "영업/정상":
                    closed_n += 1
                    closed_poi_ids.append(int(p["id"]))
                    closed_detail.append(
                        {
                            "poi_id": int(p["id"]),
                            "source": source,
                            "source_key": sk,
                            "status": st,
                            "closed_date": hit.get("closed_date") or "",
                        }
                    )
                    # same name_norm still open under a different key?
                    nn = hit.get("name_norm") or ""
                    if nn and nn in open_norms:
                        other_keys = [k for k in open_by_norm.get(nn, []) if k != sk]
                        if other_keys:
                            reopen_candidates += 1
                            if len(reopen_samples) < 10:
                                reopen_samples.append(
                                    {
                                        "closed_poi_id": int(p["id"]),
                                        "closed_source_key": sk,
                                        "open_source_keys_sample": other_keys[:3],
                                        "name": hit.get("name") or p.get("name") or "",
                                    }
                                )

            by_source[source] = {
                "poi_n": len(pois),
                "found_n": found,
                "not_found_n": not_found,
                "closed_or_not_open_n": closed_n,
                "status_of_found": dict(status_of_found),
                "raw_meta": {
                    "raw_rows": meta["raw_rows"],
                    "open_buffered": meta["open_buffered"],
                    "closed_buffered": meta["closed_buffered"],
                    "keys_indexed": meta["keys_indexed"],
                    "status_all_raw": meta["status_all_raw"],
                    "max_data_updated": meta["max_data_updated"],
                },
            }
            print(
                f"    poi={len(pois):,} found={found:,} not_found={not_found:,} "
                f"not_open={closed_n:,}",
                flush=True,
            )

        print("\n=== [3] places linked to closed poi ===", flush=True)
        places = load_places_for_poi_ids(conn, closed_poi_ids)
        user_ids = {str(r["user_id"]) for r in places if r.get("user_id") is not None}
        place_names = []
        seen_names: set[str] = set()
        for r in places:
            nm = (r.get("name") or "").strip()
            if nm and nm not in seen_names:
                seen_names.add(nm)
                place_names.append(nm)
            if len(place_names) >= 10:
                break

        all_closed_month = Counter(
            month_bucket(d.get("closed_date") or "") for d in closed_detail
        )
        closed_month = Counter(
            month_bucket(d.get("closed_date") or "")
            for d in closed_detail
            if d["status"] == "폐업" or "폐업" in (d["status"] or "")
        )

    finally:
        conn.close()

    max_upd_global = None
    for d in dl_report:
        u = d.get("max_data_updated")
        if u and (max_upd_global is None or u > max_upd_global):
            max_upd_global = u

    elapsed = round(time.time() - t0, 1)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = OUT_DIR / f"closed_dryrun_{stamp}.json"

    report = {
        "generated_at": stamp,
        "elapsed_s": elapsed,
        "downloads": [
            {
                "slug": d["slug"],
                "source": d["source"],
                "bytes": d["bytes"],
                "elapsed_s": d["elapsed_s"],
                "max_data_updated": d.get("max_data_updated"),
            }
            for d in dl_report
        ],
        "by_source": {
            src: {
                k: v
                for k, v in meta.items()
                if k != "raw_meta"
            }
            | {"raw_meta": meta["raw_meta"]}
            for src, meta in by_source.items()
        },
        "closed_poi_n": len(closed_detail),
        "places_linked_to_closed_n": len(places),
        "users_with_closed_place_n": len(user_ids),
        "closed_date_month_all_not_open": dict(sorted(all_closed_month.items())),
        "closed_date_month_status_contains_폐업": dict(sorted(closed_month.items())),
        "place_name_samples": place_names[:10],
        "max_data_updated_global": max_upd_global,
        "not_found_totals": {
            src: by_source[src]["not_found_n"] for src in by_source
        },
        "reopen_same_name_norm_different_key_n": reopen_candidates,
        "reopen_samples": [
            {"name": s["name"], "closed_poi_id": s["closed_poi_id"]}
            for s in reopen_samples
        ],
        "closed_details": closed_detail,
    }

    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # Console summary (no addresses/phones/coords)
    print("\n========== CLOSED DRY-RUN SUMMARY ==========", flush=True)
    for src, m in by_source.items():
        print(
            f"{src}: poi={m['poi_n']:,} found={m['found_n']:,} "
            f"not_found={m['not_found_n']:,} status_found={m['status_of_found']}",
            flush=True,
        )
    print(
        f"closed_poi={len(closed_detail):,} places_linked={len(places):,} "
        f"users={len(user_ids):,}",
        flush=True,
    )
    print(f"closed_date months (all not-open): {dict(sorted(all_closed_month.items()))}", flush=True)
    print(f"max_data_updated_global={max_upd_global}", flush=True)
    print(f"reopen_same_name_norm={reopen_candidates}", flush=True)
    print(f"place_name_samples={place_names[:10]}", flush=True)
    print(f"wrote {out_path} elapsed={elapsed}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
