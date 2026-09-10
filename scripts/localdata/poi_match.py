"""POI 매칭 규칙 — lib/poiMatch.ts 와 동일 알고리즘.

규칙 데이터: lib/poiMatch.rules.json (앱·배치 단일 소스)

facility:
  - facilityRouting → source 라우팅 (차단 아님, 넓은 거리 상한)
  - facilitySuffixes (+ facilityExactEnd) → 차단 유지
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

_RULES_PATH = Path(__file__).resolve().parents[2] / "lib" / "poiMatch.rules.json"
_RULES = json.loads(_RULES_PATH.read_text(encoding="utf-8"))

FACILITY_SUFFIXES = tuple(
    sorted(_RULES["facilitySuffixes"], key=len, reverse=True)
)
FACILITY_EXACT_END = frozenset(_RULES["facilityExactEnd"])
FRANCHISE_PREFIXES = tuple(
    sorted(_RULES["franchisePrefixes"], key=len, reverse=True)
)
INDUSTRY_PREFIXES = tuple(
    sorted(_RULES["industryPrefixes"], key=len, reverse=True)
)
REGION_PREFIXES = frozenset(_RULES["regionPrefixes"])
RADIUS_M = float(_RULES["radiusM"])
BBOX_DEG = float(_RULES["bboxDeg"])
CAPS = _RULES["distanceCaps"]
REVERSE = _RULES["reverseContain"]

ROUTING_RADIUS_M = float(_RULES.get("facilityRoutingRadiusM", 500))
ROUTING_BBOX_DEG = float(_RULES.get("facilityRoutingBboxDeg", 0.006))
ROUTING_CAPS = _RULES.get(
    "facilityRoutingCaps",
    {"simGe90OrExact": 500, "sim70to90": 300, "contain": 300},
)
PARK_GENERIC_MAX_M = float(_RULES.get("parkGenericMaxM", 200))
PARK_GENERIC_SUFFIXES = tuple(
    sorted(_RULES.get("parkGenericSuffixes") or [], key=len, reverse=True)
)

# (keyword, poi_source) longest-first for suffix match
_ROUTING_PAIRS: list[tuple[str, str]] = []
for src, kws in (_RULES.get("facilityRouting") or {}).items():
    for kw in kws:
        _ROUTING_PAIRS.append((kw, src))
_ROUTING_PAIRS.sort(key=lambda x: len(x[0]), reverse=True)


def normalize_poi_name(raw: str) -> str:
    s = (raw or "").strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\([^()]*\)", "", s)
        s = re.sub(r"（[^）]*）", "", s)
    s = re.sub(r"[·,&/\-_.''\"`~!@#$%^*+=?<>\[\]{}|\\:;]", "", s)
    s = re.sub(r"\s+", "", s)
    return s.lower()


def soft_normalize_display(name: str) -> str:
    s = (name or "").strip()
    prev = None
    cur = s
    while prev != cur:
        prev = cur
        cur = re.sub(r"\([^()]*\)", "", cur)
        cur = re.sub(r"（[^）]*）", "", cur)
    s = re.sub(r"\s+", " ", cur).strip()
    tokens = s.split()
    while tokens and tokens[0] in REGION_PREFIXES:
        tokens = tokens[1:]
    if tokens and tokens[-1] == "본점":
        tokens = tokens[:-1]
    if tokens and tokens[-1].endswith("점") and tokens[-1] != "점":
        tokens = tokens[:-1]
    s = "".join(tokens) if tokens else ""
    if s.endswith("본점") and len(s) > 2:
        s = s[: -len("본점")]
    s = re.sub(r"[·,&/\-_.''\"`~!@#$%^*+=?<>\[\]{}|\\:;]", "", s)
    return s.lower()


def contains_norm(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if len(a) < 2 or len(b) < 2:
        return False
    return a in b or b in a


def compact_place_name(place_name: str) -> str:
    return re.sub(r"\s+", "", (place_name or "").strip())


def detect_facility_route(place_name: str) -> str | None:
    """Place 이름이 라우팅 접미로 끝나면 대상 poi source 반환."""
    n = compact_place_name(place_name)
    if not n:
        return None
    for kw, src in _ROUTING_PAIRS:
        if n.endswith(kw):
            return src
    return None


def is_park_generic_name(place_name: str) -> bool:
    """park 일반명: 지정 접미 + 앞 수식어 1어절 이하 → 짧은 거리 상한."""
    raw = re.sub(r"\s+", " ", (place_name or "").strip())
    if not raw:
        return False
    compact = re.sub(r"\s+", "", raw)
    for suf in PARK_GENERIC_SUFFIXES:
        if not compact.endswith(suf):
            continue
        prefix_c = compact[: -len(suf)]
        if not prefix_c:
            return True
        tokens = raw.split()
        built = ""
        n_prefix = 0
        for t in tokens:
            if built == prefix_c:
                break
            built += re.sub(r"\s+", "", t)
            n_prefix += 1
            if built == prefix_c:
                break
        if built != prefix_c:
            n_prefix = 1
        return n_prefix <= 1
    return False


def ends_with_facility_block(place_name: str) -> bool:
    """차단(B) 시설 접미. 라우팅(A) 키워드는 여기 포함하지 않음."""
    n = compact_place_name(place_name)
    if not n:
        return False
    # 라우팅이 잡히면 차단하지 않음
    if detect_facility_route(place_name):
        return False
    for kw in FACILITY_SUFFIXES:
        if n.endswith(kw):
            return True
    for kw in FACILITY_EXACT_END:
        if n.endswith(kw):
            return True
    return False


def ends_with_facility(place_name: str) -> bool:
    """하위호환: 차단 시설만 True (라우팅은 False)."""
    return ends_with_facility_block(place_name)


def franchise_prefix_blocked(place_name: str, poi_name: str) -> bool:
    place_compact = re.sub(r"\s+", "", (place_name or "")).lower()
    poi_compact = re.sub(r"\s+", "", (poi_name or "")).lower()
    for brand in FRANCHISE_PREFIXES:
        brand_key = re.sub(r"\s+", "", brand).lower()
        if not brand_key:
            continue
        if not poi_compact.startswith(brand_key):
            continue
        if brand_key not in place_compact:
            return True
    return False


def compact_name(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip()).lower()


def strip_industry_prefix(place_name: str) -> str:
    n = compact_name(place_name)
    for pref in INDUSTRY_PREFIXES:
        p = pref.lower()
        if n.startswith(p) and len(n) > len(p):
            return n[len(p) :]
    return n


def is_reverse_contain(
    place_norm: str,
    poi_norm: str,
    place_name: str,
    poi_name: str,
    move_m: float | None,
) -> bool:
    pn = (place_norm or "").strip()
    qn = (poi_norm or "").strip()
    if not pn or not qn:
        return False
    if len(qn) >= len(pn):
        return False
    if qn not in pn:
        return False
    if move_m is None:
        return False
    stripped = strip_industry_prefix(place_name)
    poi_c = compact_name(poi_name)
    poi_n = compact_name(qn)
    industry_exact = bool(stripped) and (stripped == poi_c or stripped == poi_n)
    if industry_exact:
        return move_m > float(REVERSE["industryExactMaxM"])
    return move_m > float(REVERSE["maxM"])


def distance_cap(reason: str, sim: float, exact: bool) -> float:
    if reason == "sim":
        if exact or sim >= 90:
            return float(CAPS["simGe90OrExact"])
        return float(CAPS["sim70to90"])
    if reason == "contain":
        return float(CAPS["contain"])
    return float(CAPS["strip"])


def routing_distance_cap(reason: str, sim: float, exact: bool) -> float:
    if reason == "sim":
        if exact or sim >= 90:
            return float(ROUTING_CAPS["simGe90OrExact"])
        return float(ROUTING_CAPS["sim70to90"])
    # contain only
    return float(ROUTING_CAPS["contain"])


def score_candidate(
    place_name: str,
    place_norm: str,
    poi_name: str,
    poi_norm: str,
    sim_raw: float,
) -> tuple[float, str] | None:
    exact = bool(place_norm) and place_norm == poi_norm
    if sim_raw >= 70 or exact:
        return float(sim_raw if not exact else max(float(sim_raw), 100.0)), "sim"

    if contains_norm(place_norm, poi_norm):
        shorter = min(len(place_norm), len(poi_norm))
        longer = max(len(place_norm), len(poi_norm)) or 1
        return 70.0 + 30.0 * (shorter / longer), "contain"

    pa = soft_normalize_display(place_name)
    pb = soft_normalize_display(poi_name)
    if len(pa) >= 2 and len(pb) >= 2:
        sim3 = SequenceMatcher(None, pa, pb).ratio() * 100.0
        if sim3 >= 70:
            return sim3, "strip"
        if contains_norm(pa, pb):
            shorter = min(len(pa), len(pb))
            longer = max(len(pa), len(pb)) or 1
            return 70.0 + 30.0 * (shorter / longer), "strip"
    return None


def score_candidate_routing(
    place_name: str,
    place_norm: str,
    poi_name: str,
    poi_norm: str,
    sim_raw: float,
) -> tuple[float, str] | None:
    """라우팅: sim(≥70)/contain 만. strip·sim<70 불가."""
    exact = bool(place_norm) and place_norm == poi_norm
    if sim_raw >= 70 or exact:
        return float(sim_raw if not exact else max(float(sim_raw), 100.0)), "sim"

    if contains_norm(place_norm, poi_norm):
        shorter = min(len(place_norm), len(poi_norm))
        longer = max(len(place_norm), len(poi_norm)) or 1
        return 70.0 + 30.0 * (shorter / longer), "contain"
    return None


def apply_filters(
    place_name: str,
    place_norm: str,
    poi_name: str,
    poi_norm: str,
    score: float,
    reason: str,
    dist_m: float,
) -> str | None:
    """일반 업소 경로."""
    if franchise_prefix_blocked(place_name, poi_name):
        return "franchise_prefix"

    facility = ends_with_facility_block(place_name)
    exact = bool(place_norm) and place_norm == poi_norm

    if facility:
        if reason in ("contain", "strip"):
            return "facility_keyword"
        if reason == "sim" and score < 95 and not exact:
            return "facility_keyword"

    if reason == "contain" and is_reverse_contain(
        place_norm, poi_norm, place_name, poi_name, dist_m
    ):
        return "reverse_contain"

    cap = distance_cap(reason, score, exact)
    if dist_m > cap:
        return "distance"
    return None


def apply_filters_routing(
    place_name: str,
    place_norm: str,
    poi_name: str,
    poi_norm: str,
    score: float,
    reason: str,
    dist_m: float,
) -> str | None:
    """라우팅 경로: franchise/facility 차단 없음. 넓은 거리 상한."""
    if reason not in ("sim", "contain"):
        return "distance"
    exact = bool(place_norm) and place_norm == poi_norm
    if reason == "contain" and is_reverse_contain(
        place_norm, poi_norm, place_name, poi_name, dist_m
    ):
        return "reverse_contain"
    cap = routing_distance_cap(reason, score, exact)
    if detect_facility_route(place_name) == "park" and is_park_generic_name(place_name):
        cap = min(cap, PARK_GENERIC_MAX_M)
    if dist_m > cap:
        return "distance"
    return None
