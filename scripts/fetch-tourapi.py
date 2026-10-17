#!/usr/bin/env python3
"""Fetch TourAPI KorService2 areaBasedList2 (content types 12/14/28/38).

Reads key from scripts/localdata/.tourapi_key only.
Caches raw pages under scripts/localdata/out/tourapi/ (gitignored).
Never prints the service key; URLs in logs mask serviceKey=***.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY_PATH = ROOT / "scripts" / "localdata" / ".tourapi_key"
OUT = ROOT / "scripts" / "localdata" / "out" / "tourapi"
BASE = "https://apis.data.go.kr/B551011/KorService2/areaBasedList2"
CONTENT_TYPES = ("12", "14", "28", "38")  # 관광지·문화·레포츠·쇼핑
NUM_ROWS = 1000  # maximize page size
MOBILE_APP = "PindMap"
DAILY_BUDGET = 900  # leave headroom under 1000
CALLS_FILE = OUT / "call_count.json"


def mask_url(url: str) -> str:
    return re.sub(r"(serviceKey=)[^&]+", r"\1***", url, flags=re.I)


def load_key() -> str:
    if not KEY_PATH.is_file():
        print("missing key file", file=sys.stderr)
        raise SystemExit(2)
    key = KEY_PATH.read_text(encoding="utf-8").strip()
    if not key:
        print("empty key file", file=sys.stderr)
        raise SystemExit(2)
    return key


def load_calls() -> dict:
    if CALLS_FILE.is_file():
        return json.loads(CALLS_FILE.read_text(encoding="utf-8"))
    return {"date": time.strftime("%Y-%m-%d"), "count": 0}


def save_calls(c: dict) -> None:
    CALLS_FILE.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")


def bump_call(c: dict) -> dict:
    today = time.strftime("%Y-%m-%d")
    if c.get("date") != today:
        c = {"date": today, "count": 0}
    c["count"] = int(c.get("count") or 0) + 1
    save_calls(c)
    return c


def fetch_page(key: str, content_type: str, page: int) -> dict:
    params = {
        "serviceKey": key,  # already decoded; API accepts raw or encoded
        "numOfRows": str(NUM_ROWS),
        "pageNo": str(page),
        "MobileOS": "ETC",
        "MobileApp": MOBILE_APP,
        "_type": "json",
        "arrange": "A",
        "contentTypeId": content_type,
    }
    # serviceKey from portal is often URL-encoded already — use quote via urlencode
    # but don't double-encode if it contains %
    q = urllib.parse.urlencode(params, safe="%")
    url = f"{BASE}?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": "PindMap-TourAPI/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {mask_url(url)}", file=sys.stderr)
        if e.code == 429:
            print("RATE_LIMIT 429 — stop", file=sys.stderr)
            raise SystemExit(3)
        raise
    except Exception as e:
        print(f"request failed {mask_url(url)}: {type(e).__name__}", file=sys.stderr)
        raise
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # sometimes returns XML error
        low = body.lower()
        if "limit" in low or "exceed" in low or "트래픽" in body:
            print("LIMIT_EXCEEDED in body — stop", file=sys.stderr)
            raise SystemExit(3)
        print(f"bad json {mask_url(url)} bytes={len(body)}", file=sys.stderr)
        raise


def items_from(data: dict) -> tuple[list, int, int]:
    """Return (items, total_count, num_of_rows)."""
    resp = (data.get("response") or {})
    header = resp.get("header") or {}
    result = str(header.get("resultCode") or "")
    if result and result not in ("0000", "0"):
        msg = header.get("resultMsg") or result
        print(f"API error code={result} msg={msg}", file=sys.stderr)
        if "LIMIT" in str(msg).upper() or "초과" in str(msg):
            raise SystemExit(3)
        raise SystemExit(4)
    body = resp.get("body") or {}
    total = int(body.get("totalCount") or 0)
    items = body.get("items")
    if items is None or items == "":
        return [], total, int(body.get("numOfRows") or NUM_ROWS)
    if isinstance(items, dict):
        item = items.get("item")
        if item is None:
            return [], total, int(body.get("numOfRows") or NUM_ROWS)
        if isinstance(item, list):
            return item, total, int(body.get("numOfRows") or NUM_ROWS)
        return [item], total, int(body.get("numOfRows") or NUM_ROWS)
    return [], total, int(body.get("numOfRows") or NUM_ROWS)


def slim(item: dict) -> dict | None:
    title = str(item.get("title") or "").strip()
    mapx = item.get("mapx")
    mapy = item.get("mapy")
    cid = item.get("contentid")
    ctype = item.get("contenttypeid") or item.get("contentTypeId")
    if not title or mapx in (None, "") or mapy in (None, "") or cid in (None, ""):
        return None
    try:
        lng = float(mapx)
        lat = float(mapy)
    except (TypeError, ValueError):
        return None
    if not (124.0 <= lng <= 132.5 and 33.0 <= lat <= 39.5):
        return None
    return {
        "title": title,
        "mapx": lng,
        "mapy": lat,
        "contentTypeId": str(ctype),
        "cat1": str(item.get("cat1") or ""),
        "cat2": str(item.get("cat2") or ""),
        "cat3": str(item.get("cat3") or ""),
        "contentid": str(cid),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    key = load_key()
    calls = load_calls()
    print(f"calls_today={calls.get('count', 0)} budget={DAILY_BUDGET}")

    all_rows: list[dict] = []
    summary: dict = {"by_type": {}, "api_calls": 0, "cached_pages": 0}

    for ctype in CONTENT_TYPES:
        page = 1
        total = None
        type_rows: list[dict] = []
        while True:
            cache = OUT / f"areaBasedList2_ct{ctype}_p{page}.json"
            if cache.is_file():
                data = json.loads(cache.read_text(encoding="utf-8"))
                summary["cached_pages"] += 1
                print(f"cache hit ct={ctype} page={page}")
            else:
                if int(calls.get("count") or 0) >= DAILY_BUDGET:
                    print(
                        f"STOP daily budget {DAILY_BUDGET} reached "
                        f"(calls={calls.get('count')})",
                        file=sys.stderr,
                    )
                    raise SystemExit(3)
                print(f"fetch ct={ctype} page={page} …")
                data = fetch_page(key, ctype, page)
                calls = bump_call(calls)
                summary["api_calls"] += 1
                cache.write_text(
                    json.dumps(data, ensure_ascii=False), encoding="utf-8"
                )
                time.sleep(0.25)

            items, tot, _nrows = items_from(data)
            if total is None:
                total = tot
                print(f"  totalCount={total}")
            for it in items:
                if isinstance(it, dict):
                    s = slim(it)
                    if s:
                        type_rows.append(s)
            if not items:
                break
            if total is not None and page * NUM_ROWS >= total:
                break
            if len(items) < NUM_ROWS:
                break
            page += 1

        summary["by_type"][ctype] = {
            "raw_kept": len(type_rows),
            "totalCount": total,
            "pages": page,
        }
        all_rows.extend(type_rows)

    # dedupe by contentid
    by_id: dict[str, dict] = {}
    for r in all_rows:
        by_id[r["contentid"]] = r
    merged = list(by_id.values())
    slim_path = OUT / "tourapi_slim.json"
    slim_path.write_text(
        json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    summary["kept_unique"] = len(merged)
    summary["calls_today"] = calls.get("count")
    summary["license_note"] = (
        "data.go.kr 이용허락범위 제한 없음; 이미지 미저장; "
        "텍스트·좌표는 출처표시(한국관광공사)로 사용"
    )
    (OUT / "fetch_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"wrote {slim_path} n={len(merged)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
