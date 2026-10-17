#!/usr/bin/env python3
"""Process TourAPI slim JSON → public/map/korea-tour.geojson.

- Clean titles (strip English-paren, truncate)
- Dedupe vs korea-landmarks.geojson (normalized name + 100m; landmark wins)
- Map contentTypeId/cat → class + rank
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLIM = ROOT / "scripts" / "localdata" / "out" / "tourapi" / "tourapi_slim.json"
LANDMARKS = ROOT / "public" / "map" / "korea-landmarks.geojson"
# Large artifact — keep under build/tiles (gitignored); upload to map-tiles bucket.
OUT_GEO = ROOT / "build" / "tiles" / "korea-tour.geojson"
OUT_SUMMARY = ROOT / "scripts" / "localdata" / "out" / "tourapi" / "build_summary.json"

PAREN_EN = re.compile(r"\s*\([^)]*[A-Za-z][^)]*\)\s*")
MULTI_SPACE = re.compile(r"\s+")
MAX_NAME_LEN = 22  # Korean display; report truncation


def normalize_name(raw: str) -> str:
    s = raw.lower()
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[()[\]{}·・]", "", s)
    s = re.sub(r"(점|본점|지점)$", "", s)
    return s


def clean_title(title: str) -> str | None:
    t = MULTI_SPACE.sub(" ", (title or "").strip())
    if not t:
        return None
    t = PAREN_EN.sub(" ", t)
    t = MULTI_SPACE.sub(" ", t).strip()
    # drop leftover empty parens
    t = re.sub(r"\s*\(\s*\)\s*", " ", t).strip()
    if len(t) < 2:
        return None
    truncated = False
    if len(t) > MAX_NAME_LEN:
        t = t[: MAX_NAME_LEN - 1].rstrip() + "…"
        truncated = True
    return t


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def map_class_rank(ctype: str, cat1: str, cat2: str, cat3: str, title: str) -> tuple[str, int] | None:
    """Return (class, rank). Lower rank = higher priority."""
    c1, c2, c3 = cat1 or "", cat2 or "", cat3 or ""
    # Famous / must-show names
    famous = (
        "경복궁",
        "창덕궁",
        "불국사",
        "석굴암",
        "남산",
        "해운대",
        "광안리",
        "감천",
        "경포",
        "설악",
        "한옥마을",
        "남이섬",
        "춘천",
        "홍천",
    )
    boost = any(f in title for f in famous)

    if ctype == "12":  # 관광지
        if c1 == "A01" or "자연" in c2 or c2.startswith("A0101"):
            cls, rank = "park", 18
        elif "휴양" in c2 or c2.startswith("A0202"):
            cls, rank = "attraction", 22
        else:
            cls, rank = "attraction", 20
    elif ctype == "14":  # 문화시설
        if "박물관" in title or "뮤지엄" in title or "museum" in title.lower():
            cls, rank = "museum", 24
        elif "미술관" in title or "갤러리" in title:
            cls, rank = "museum", 26
        else:
            cls, rank = "attraction", 28
    elif ctype == "28":  # 레포츠
        cls, rank = "sports", 35
    elif ctype == "38":  # 쇼핑
        if "시장" in title or "마켓" in title:
            cls, rank = "shop", 32
        else:
            cls, rank = "shop", 40
    else:
        return None

    if boost:
        rank = max(8, rank - 10)
    # Prefer named major tourism (A02 human culture often denser → slightly lower prio in city)
    if ctype == "12" and c1 == "A02":
        rank = min(50, rank + 4)
    return cls, rank


def load_landmarks() -> list[tuple[str, float, float]]:
    if not LANDMARKS.is_file():
        return []
    data = json.loads(LANDMARKS.read_text(encoding="utf-8"))
    out = []
    for f in data.get("features") or []:
        props = f.get("properties") or {}
        name = normalize_name(str(props.get("name") or ""))
        g = f.get("geometry") or {}
        if g.get("type") != "Point" or not name:
            continue
        c = g.get("coordinates") or []
        if len(c) < 2:
            continue
        out.append((name, float(c[1]), float(c[0])))
    return out


def main() -> int:
    rows = json.loads(SLIM.read_text(encoding="utf-8"))
    landmarks = load_landmarks()
    # grid index landmarks by ~0.01 deg (~1km)
    grid: dict[tuple[int, int], list[tuple[str, float, float]]] = {}
    for name, lat, lng in landmarks:
        key = (int(lat * 100), int(lng * 100))
        grid.setdefault(key, []).append((name, lat, lng))

    features = []
    stats = Counter()
    by_class = Counter()
    truncated = 0
    dropped_name = 0
    dropped_dup_lm = 0
    dropped_map = 0
    cleaned_paren = 0

    for r in rows:
        raw_title = r["title"]
        if PAREN_EN.search(raw_title):
            cleaned_paren += 1
        name = clean_title(raw_title)
        if not name:
            dropped_name += 1
            continue
        if "…" in name:
            truncated += 1
        mapped = map_class_rank(
            str(r["contentTypeId"]),
            r.get("cat1") or "",
            r.get("cat2") or "",
            r.get("cat3") or "",
            name,
        )
        if not mapped:
            dropped_map += 1
            continue
        cls, rank = mapped
        lng = float(r["mapx"])
        lat = float(r["mapy"])
        nrm = normalize_name(name)
        # landmark dedupe 100m
        is_dup = False
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for ln, llat, llng in grid.get(
                    (int(lat * 100) + di, int(lng * 100) + dj), []
                ):
                    if ln != nrm:
                        continue
                    if haversine_m(lat, lng, llat, llng) <= 100:
                        is_dup = True
                        break
                if is_dup:
                    break
            if is_dup:
                break
        if is_dup:
            dropped_dup_lm += 1
            continue

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": name,
                    "class": cls,
                    "rank": rank,
                    "kind": "tour",
                    "contentTypeId": str(r["contentTypeId"]),
                    "contentid": str(r["contentid"]),
                },
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
            }
        )
        by_class[cls] += 1
        stats[str(r["contentTypeId"])] += 1

    fc = {"type": "FeatureCollection", "features": features}
    OUT_GEO.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    OUT_GEO.write_text(text, encoding="utf-8")
    summary = {
        "input": len(rows),
        "output": len(features),
        "dropped_name": dropped_name,
        "dropped_map": dropped_map,
        "dropped_dup_landmark_100m": dropped_dup_lm,
        "cleaned_en_paren": cleaned_paren,
        "truncated_names": truncated,
        "max_name_len": MAX_NAME_LEN,
        "by_contentTypeId": dict(stats),
        "by_class": dict(by_class),
        "geojson_bytes": len(text.encode("utf-8")),
        "geojson_path": str(OUT_GEO.relative_to(ROOT)),
        "delivery": (
            "build/tiles/korea-tour.geojson → Supabase map-tiles/korea-tour.geojson "
            "(~7MB; no git commit; remote GeoJSON is simpler than a new PMTiles protocol)"
        ),
        "name_policy": (
            f"strip English parentheses; truncate to {MAX_NAME_LEN} chars with …"
        ),
    }
    OUT_SUMMARY.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
