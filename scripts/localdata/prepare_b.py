#!/usr/bin/env python3
"""B그룹 공공표준 CSV → poi 적재용 UTF-8 CSV + COPY.

입력: scripts/localdata/raw_b/*.csv (CP949)
출력: scripts/localdata/out/poi_b_load.csv
name_norm: poi_match.normalize_poi_name 재사용 (신규 구현 금지)
기존 LOCALDATA poi 행은 건드리지 않음.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
from collections import Counter
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from poi_match import normalize_poi_name

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw_b"
OUT = ROOT / "out"
DB_URL_FILE = ROOT / ".db_url"

LAT_MIN, LAT_MAX = 33.0, 39.0
LNG_MIN, LNG_MAX = 124.0, 132.0

DATASETS = [
    {
        "file": "전국도시공원정보표준데이터.csv",
        "source": "park",
        "name_col": "공원명",
        "cat_col": "공원구분",
        "category": "공원",
        "has_mgmt": True,
    },
    {
        "file": "전국박물관미술관정보표준데이터.csv",
        "source": "museum",
        "name_col": "시설명",
        "cat_col": "박물관미술관구분",
        "category": "전시",
        "has_mgmt": False,
    },
    {
        "file": "전국전통시장표준데이터.csv",
        "source": "market",
        "name_col": "시장명",
        "cat_col": "시장유형",
        "category": "시장",
        "has_mgmt": False,
    },
    {
        "file": "전국도서관표준데이터.csv",
        "source": "library",
        "name_col": "도서관명",
        "cat_col": "도서관유형",
        "category": "도서관",
        "has_mgmt": False,
    },
    {
        "file": "전국관광지정보표준데이터.csv",
        "source": "tourspot",
        "name_col": "관광지명",
        "cat_col": "관광지구분",
        "category": "관광지",
        "has_mgmt": False,
    },
]

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
]


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def parse_coord(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def open_cp949(path: Path):
    return path.open("r", encoding="cp949", errors="replace", newline="")


def sha1_32(payload: str) -> str:
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:32]


def build_source_keys(
    rows: list[dict], has_mgmt: bool
) -> tuple[list[str], dict]:
    """Return parallel source_key list + key stats.

    park(has_mgmt):
      - 관리번호 (유일)
      - 중복이면 관리번호|제공기관코드
      - 그래도 동일하면 내용 해시(행번호 금지)
    나머지 4종:
      - sha1(이름|도로명|제공기관코드)[:32]
      - 도로명 없으면 지번, 둘 다 없으면 위경도
    """
    stats = {
        "mgmt_dup_keys": 0,
        "mgmt_rows_using_composite": 0,
        "mgmt_still_collided_hashed": 0,
        "no_mgmt": not has_mgmt,
        "hash_used_road": 0,
        "hash_used_jibun": 0,
        "hash_used_coords": 0,
        "empty_key": 0,
        "identical_content_dedup": 0,
    }
    keys: list[str] = [""] * len(rows)

    if has_mgmt:
        mgmt_counts: Counter[str] = Counter()
        for r in rows:
            m = (r.get("_mgmt") or "").strip()
            if m:
                mgmt_counts[m] += 1
        stats["mgmt_dup_keys"] = sum(1 for _, n in mgmt_counts.items() if n > 1)

        provisional: list[str] = []
        for r in rows:
            m = (r.get("_mgmt") or "").strip()
            org = (r.get("_org") or "").strip()
            if not m:
                provisional.append("")
                continue
            if mgmt_counts[m] > 1:
                provisional.append(f"{m}|{org}")
                stats["mgmt_rows_using_composite"] += 1
            else:
                provisional.append(m)

        # remaining collisions on 관리번호|제공기관코드 → content hash (no row index)
        from collections import defaultdict
        groups: dict[str, list[int]] = defaultdict(list)
        for i, k in enumerate(provisional):
            if not k:
                keys[i] = ""
                stats["empty_key"] += 1
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
                stats["mgmt_still_collided_hashed"] += 1
    else:
        for i, r in enumerate(rows):
            name = (r.get("name") or "").strip()
            org = (r.get("_org") or "").strip()
            road = (r.get("road_address") or "").strip()
            jibun = (r.get("jibun_address") or "").strip()
            if road:
                mid = road
                stats["hash_used_road"] += 1
            elif jibun:
                mid = jibun
                stats["hash_used_jibun"] += 1
            else:
                mid = f"{r.get('lat') or ''},{r.get('lng') or ''}"
                stats["hash_used_coords"] += 1
            keys[i] = sha1_32(f"{name}|{mid}|{org}")

    return keys, stats


def prepare() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / "poi_b_load.csv"

    report: dict = {
        "datasets": {},
        "outside_korea": [],
        "key_stats": {},
        "abort": None,
        "rows_out": 0,
    }

    all_out_rows: list[dict] = []

    for spec in DATASETS:
        path = RAW / spec["file"]
        if not path.exists():
            raise FileNotFoundError(path)

        raw_n = 0
        excl = Counter()
        candidates: list[dict] = []
        outside_list: list[dict] = []

        with open_cp949(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                raw_n += 1
                name = (row.get(spec["name_col"]) or "").strip()
                if not name:
                    excl["empty_name"] += 1
                    continue

                lat = parse_coord(row.get("위도", ""))
                lng = parse_coord(row.get("경도", ""))
                if lat is None or lng is None:
                    excl["null_coords"] += 1
                    continue
                if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
                    excl["outside_korea"] += 1
                    outside_list.append(
                        {
                            "source": spec["source"],
                            "name": name,
                            "lat": lat,
                            "lng": lng,
                            "org": (row.get("제공기관명") or "").strip(),
                        }
                    )
                    continue

                road = (row.get("소재지도로명주소") or "").strip()
                jibun = (row.get("소재지지번주소") or "").strip()
                raw_cat = (row.get(spec["cat_col"]) or "").strip()
                mgmt = (row.get("관리번호") or "").strip() if spec["has_mgmt"] else ""
                org_code = (row.get("제공기관코드") or "").strip()

                candidates.append(
                    {
                        "source": spec["source"],
                        "name": name,
                        "name_norm": normalize_poi_name(name),
                        "road_address": road,
                        "jibun_address": jibun,
                        "lat": f"{lat:.8f}",
                        "lng": f"{lng:.8f}",
                        "raw_category": raw_cat,
                        "category": spec["category"],
                        "phone": "",
                        "_mgmt": mgmt,
                        "_org": org_code,
                        "_lat_f": lat,
                        "_lng_f": lng,
                    }
                )

        # drop empty name_norm
        kept: list[dict] = []
        for c in candidates:
            if not c["name_norm"]:
                excl["empty_norm"] += 1
            else:
                kept.append(c)

        keys, key_stats = build_source_keys(kept, spec["has_mgmt"])
        report["key_stats"][spec["source"]] = key_stats

        # assign keys + in-batch unique (source, source_key)
        by_key: dict[str, dict] = {}
        ordered: list[str] = []
        deduped = 0
        empty_key = 0
        for c, sk in zip(kept, keys):
            if not sk:
                empty_key += 1
                excl["empty_key"] += 1
                continue
            c["source_key"] = sk
            if sk in by_key:
                deduped += 1
                # keep first; count collision
                continue
            by_key[sk] = c
            ordered.append(sk)

        final_rows = []
        for sk in ordered:
            c = by_key[sk]
            final_rows.append(
                {
                    "source": c["source"],
                    "source_key": c["source_key"],
                    "name": c["name"],
                    "name_norm": c["name_norm"],
                    "road_address": c["road_address"],
                    "jibun_address": c["jibun_address"],
                    "lat": c["lat"],
                    "lng": c["lng"],
                    "raw_category": c["raw_category"],
                    "category": c["category"],
                    "phone": "",
                }
            )

        final_n = len(final_rows)
        rate = final_n / raw_n if raw_n else 0.0
        report["datasets"][spec["source"]] = {
            "file": spec["file"],
            "raw": raw_n,
            "excluded": dict(excl),
            "deduped_after_key": deduped,
            "final": final_n,
            "keep_rate": round(rate, 4),
            "outside_n": len(outside_list),
        }
        report["outside_korea"].extend(outside_list)
        all_out_rows.extend(final_rows)

        print(
            f"[{spec['source']}] raw={raw_n} final={final_n} "
            f"({rate:.1%}) excl={dict(excl)} key={key_stats}",
            flush=True,
        )

    # --- abort checks ---
    for src, d in report["datasets"].items():
        if d["raw"] and d["final"] / d["raw"] < 0.90:
            report["abort"] = (
                f"ABORT: {src} final {d['final']}/{d['raw']} "
                f"= {d['keep_rate']:.1%} < 90%"
            )
            break

    total_raw = sum(d["raw"] for d in report["datasets"].values())
    outside_n = len(report["outside_korea"])
    # outside ratio vs all original rows processed
    if not report["abort"] and total_raw and outside_n / total_raw > 0.05:
        report["abort"] = (
            f"ABORT: outside_korea {outside_n}/{total_raw} "
            f"= {outside_n / total_raw:.1%} > 5%"
        )

    report["rows_out"] = len(all_out_rows)
    report["total_raw"] = total_raw
    report["outside_n"] = outside_n

    if report["abort"]:
        print(report["abort"], flush=True)
        (OUT / "poi_b_prepare_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return report

    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, lineterminator="\n")
        w.writeheader()
        for r in all_out_rows:
            w.writerow(r)

    report["out_csv"] = str(out_path)
    (OUT / "poi_b_prepare_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote {out_path} rows={len(all_out_rows)}", flush=True)
    return report


def ensure_source_check(conn) -> None:
    """Expand poi_source_check to allow B-group sources. Does not touch rows."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conname = 'poi_source_check' AND conrelid = 'public.poi'::regclass
            """
        )
        row = cur.fetchone()
        ddl = row[0] if row else ""
        needed = ("park", "museum", "market", "library", "tourspot")
        if all(s in ddl for s in needed):
            print("poi_source_check already allows B sources", flush=True)
            return
        cur.execute("ALTER TABLE public.poi DROP CONSTRAINT IF EXISTS poi_source_check")
        cur.execute(
            """
            ALTER TABLE public.poi ADD CONSTRAINT poi_source_check CHECK (
              source IN (
                'localdata_general', 'localdata_rest', 'localdata_hotel',
                'park', 'museum', 'market', 'library', 'tourspot'
              )
            )
            """
        )
    conn.commit()
    print("poi_source_check updated for B sources", flush=True)


def load_b(conn, csv_path: Path) -> dict:
    """COPY into temp, INSERT … ON CONFLICT DO NOTHING. Never truncate/update LOCALDATA."""
    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source, count(*) n FROM public.poi
            WHERE source LIKE 'localdata_%'
            GROUP BY 1 ORDER BY 1
            """
        )
        before_local = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute("SELECT count(*) FROM public.poi")
        before_total = cur.fetchone()[0]
        cur.execute(
            """
            SELECT source, source_key FROM public.poi
            WHERE source IN ('park','museum','market','library','tourspot')
            """
        )
        existing_b = {(r[0], r[1]) for r in cur.fetchall()}

    staged_keys: list[tuple[str, str]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            staged_keys.append((r["source"], r["source_key"]))
    staged = len(staged_keys)
    conflict_by_source: Counter[str] = Counter()
    for sk in staged_keys:
        if sk in existing_b:
            conflict_by_source[sk[0]] += 1
    conflicts_total = sum(conflict_by_source.values())

    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TEMP TABLE poi_b_stage (
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
                COPY poi_b_stage (
                  source, source_key, name, name_norm,
                  road_address, jibun_address, lat, lng,
                  raw_category, category, phone
                ) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')
                """,
                f,
            )
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
            FROM poi_b_stage
            ON CONFLICT (source, source_key) DO NOTHING
            """
        )
        inserted = cur.rowcount
    conn.commit()

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT source, count(*) n FROM public.poi
            WHERE source IN ('park','museum','market','library','tourspot')
            GROUP BY 1 ORDER BY 1
            """
        )
        after_b = {r["source"]: r["n"] for r in cur.fetchall()}
        cur.execute(
            """
            SELECT source, count(*) n FROM public.poi
            WHERE source LIKE 'localdata_%'
            GROUP BY 1 ORDER BY 1
            """
        )
        after_local = {r["source"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT count(*) n FROM public.poi")
        after_total = cur.fetchone()["n"]
        cur.execute("SELECT source, count(*) n FROM public.poi GROUP BY source ORDER BY 1")
        by_source = [(r["source"], r["n"]) for r in cur.fetchall()]

    return {
        "staged": staged,
        "inserted": inserted,
        "conflicts_total": conflicts_total,
        "conflicts_by_source": dict(conflict_by_source),
        "before_local": before_local,
        "after_local": after_local,
        "localdata_unchanged": before_local == after_local,
        "before_total": before_total,
        "after_total": after_total,
        "after_b": after_b,
        "by_source": by_source,
        "elapsed_s": round(time.time() - t0, 1),
    }


def sample_rows(conn) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for src in ("park", "museum", "market", "library", "tourspot"):
            cur.execute(
                """
                SELECT name, COALESCE(road_address, jibun_address, '') AS addr, lat, lng
                FROM public.poi
                WHERE source = %s
                ORDER BY random()
                LIMIT 5
                """,
                (src,),
            )
            out[src] = [dict(r) for r in cur.fetchall()]
    return out


def main() -> None:
    print("=== prepare_b ===", flush=True)
    report = prepare()
    if report.get("abort"):
        print("\n[중단] 적재하지 않음.")
        print(json.dumps(report["datasets"], ensure_ascii=False, indent=2))
        if report["outside_korea"]:
            print("outside_korea sample:")
            for x in report["outside_korea"][:30]:
                print(f"  {x}")
        sys.exit(2)

    # risk check: CSV sources must only be B sources
    with (OUT / "poi_b_load.csv").open(encoding="utf-8", newline="") as f:
        sources = {r["source"] for r in csv.DictReader(f)}
    bad = sources - {"park", "museum", "market", "library", "tourspot"}
    if bad:
        print(f"ABORT: unexpected sources in CSV: {bad}")
        sys.exit(2)

    print("=== load_b ===", flush=True)
    conn = psycopg2.connect(db_url(), connect_timeout=60)
    try:
        ensure_source_check(conn)
        load_result = load_b(conn, OUT / "poi_b_load.csv")
        if not load_result["localdata_unchanged"]:
            print("ABORT RISK: localdata counts changed!", load_result)
            sys.exit(3)
        samples = sample_rows(conn)
    finally:
        conn.close()

    final = {"prepare": report, "load": load_result, "samples": samples}
    (OUT / "poi_b_final_report.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    print("\n========== FINAL ==========")
    for src, d in report["datasets"].items():
        print(
            f"{src}: raw={d['raw']} → excl={d['excluded']} "
            f"dedup={d['deduped_after_key']} → final={d['final']} ({d['keep_rate']:.1%})"
        )
    print("\nkey_stats:")
    for src, ks in report["key_stats"].items():
        print(f"  {src}: {ks}")
    print(f"\noutside_korea n={report['outside_n']}")
    for x in report["outside_korea"][:50]:
        print(f"  {x['source']} | {x['name']} | {x['lat']},{x['lng']} | {x['org']}")
    if len(report["outside_korea"]) > 50:
        print(f"  ... +{len(report['outside_korea']) - 50} more")

    print("\nload:", {k: load_result[k] for k in (
        "staged", "inserted", "conflicts_total", "localdata_unchanged",
        "before_total", "after_total", "elapsed_s"
    )})
    print("by_source:")
    for s, n in load_result["by_source"]:
        print(f"  {s}: {n}")
    print("\nsamples:")
    for src, rows in samples.items():
        print(f"  [{src}]")
        for r in rows:
            print(f"    {r['name']} | {r['addr']} | ({r['lat']}, {r['lng']})")


if __name__ == "__main__":
    main()
