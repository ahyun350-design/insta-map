"""상가(상권)정보 공통: 업종 매핑 + sangga 전용 매칭 가드.

규칙 단일 소스: lib/sanggaGuard.rules.json
poiMatch.rules.json 은 수정하지 않는다. sangga 후보에만 추가 제한.
"""

from __future__ import annotations

import json
from pathlib import Path

from poi_match import normalize_poi_name, soft_normalize_display

_RULES_PATH = Path(__file__).resolve().parents[2] / "lib" / "sanggaGuard.rules.json"
_RULES = json.loads(_RULES_PATH.read_text(encoding="utf-8"))

SOURCE: str = _RULES["source"]
PARTIAL_MIN_SHORTER_LEN: int = int(_RULES["partialMinShorterLen"])
NON_EXACT_SIM_MAX_M: float = float(_RULES["nonExactSimMaxM"])

# 소분류코드 → (category, subcategory|None)
SANGGA_MAP: dict[str, tuple[str, str | None]] = {
    code: (pair[0], pair[1])
    for code, pair in _RULES["codeToCategorySubcategory"].items()
}
INCLUDE_CODES = frozenset(SANGGA_MAP.keys())


def decode_zip_member_name(name: str) -> str:
    try:
        return name.encode("cp437").decode("cp949")
    except Exception:
        try:
            return name.encode("latin1").decode("cp949")
        except Exception:
            return name


def _proper_contain(a: str, b: str) -> bool:
    """진부분문자열 포함만 True (완전 동일은 부분일치 아님)."""
    if not a or not b or a == b:
        return False
    if len(a) < 2 or len(b) < 2:
        return False
    return a in b or b in a


def is_containment_match(place_name: str, sangga_name: str) -> bool:
    """정규화(또는 soft) 이름 진포함관계 여부. 동일명은 False."""
    pn = normalize_poi_name(place_name)
    sn = normalize_poi_name(sangga_name)
    if _proper_contain(pn, sn):
        return True
    pa = soft_normalize_display(place_name)
    pb = soft_normalize_display(sangga_name)
    return _proper_contain(pa, pb)


def sangga_guard_reject_reason(
    place_name: str,
    place_category: str | None,
    sangga_name: str,
    sangga_category: str | None,
    dist_m: float,
) -> str | None:
    """통과 시 None. 거절 시 'sangga_partial_guard' | 'sangga_sim_distance'."""
    pn = normalize_poi_name(place_name)
    sn = normalize_poi_name(sangga_name)
    exact = bool(pn) and pn == sn
    if exact:
        return None

    if is_containment_match(place_name, sangga_name):
        shorter = min(len(pn), len(sn))
        if shorter < PARTIAL_MIN_SHORTER_LEN:
            return "sangga_partial_guard"
        pc = (place_category or "").strip()
        sc = (sangga_category or "").strip()
        if not pc or pc != sc:
            return "sangga_partial_guard"
        return None

    if dist_m > NON_EXACT_SIM_MAX_M:
        return "sangga_sim_distance"
    return None


def sangga_partial_guard_ok(
    place_name: str,
    place_category: str | None,
    sangga_name: str,
    sangga_category: str | None,
    dist_m: float = 0.0,
) -> bool:
    """하위 호환: dist 없는 호출은 유사거리 가드(b)를 건너뛴다 → dist 전달 권장."""
    return (
        sangga_guard_reject_reason(
            place_name, place_category, sangga_name, sangga_category, dist_m
        )
        is None
    )
