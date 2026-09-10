#!/usr/bin/env python3
"""search_poi 정확도 평가.

- 성공 케이스: places (카카오 매칭된 저장 장소) 100개 → top-1 정답률
- 실패 케이스: extract_jobs kakao_unresolved 상호 100개 → 회수율
"""

from __future__ import annotations

import json
import math
import re
import time
from collections import Counter
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
DB_URL_FILE = Path(__file__).resolve().parent / ".db_url"


def db_url() -> str:
    return DB_URL_FILE.read_text().strip().strip("\"'")


def haversine_m(lat1, lng1, lat2, lng2) -> float | None:
    if None in (lat1, lng1, lat2, lng2):
        return None
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def parse_unresolved_names(error_message: str) -> list[str]:
    """kakao_unresolved|NAME|tried=N|stages=...;NAME2|..."""
    if not error_message or not error_message.startswith("kakao_unresolved|"):
        return []
    body = error_message[len("kakao_unresolved|") :]
    names: list[str] = []
    for part in body.split(";"):
        part = part.strip()
        if not part:
            continue
        name = part.split("|", 1)[0].strip()
        if name and not name.startswith("tried=") and not name.startswith("stages="):
            names.append(name)
    return names


def region_hint_from_address(address: str | None) -> str | None:
    if not address:
        return None
    # "서울 마포구 ..." / "경기도 수원시 ..." → 구/시 토큰
    parts = address.replace(",", " ").split()
    for p in parts:
        if p.endswith(("구", "시", "군", "동", "읍", "면")) and len(p) >= 2:
            return p
    return parts[1] if len(parts) >= 2 else (parts[0] if parts else None)


def is_correct_match(place: dict, hit: dict) -> tuple[bool, str]:
    """정답 판정: 좌표 근접 > 정규화 이름 관계 > 주소 토큰."""
    d = haversine_m(place.get("lat"), place.get("lng"), hit.get("lat"), hit.get("lng"))
    if d is not None and d <= 200:
        return True, f"coords<{d:.0f}m"

    # DB normalize
    return False, f"coords={None if d is None else round(d)}m"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    conn = psycopg2.connect(db_url(), connect_timeout=30)
    conn.autocommit = True

    # apply search migration
    mig = ROOT / "supabase/migrations/20260907_poi_search.sql"
    with conn.cursor() as cur:
        cur.execute(mig.read_text(encoding="utf-8"))
    print("applied", mig.name)

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # --- A) unresolved names ---
        cur.execute(
            """
            SELECT error_message
            FROM extract_jobs
            WHERE error_message LIKE 'kakao_unresolved|%'
            ORDER BY coalesce(updated_at, created_at) DESC
            LIMIT 800
            """
        )
        unresolved: list[str] = []
        seen_u: set[str] = set()
        for row in cur.fetchall():
            for name in parse_unresolved_names(row["error_message"] or ""):
                if name not in seen_u:
                    seen_u.add(name)
                    unresolved.append(name)
                if len(unresolved) >= 100:
                    break
            if len(unresolved) >= 100:
                break

        # --- B) success places ---
        cur.execute(
            """
            SELECT id, name, address, lat, lng, category
            FROM places
            WHERE name IS NOT NULL AND btrim(name) <> ''
              AND lat IS NOT NULL AND lng IS NOT NULL
              AND address IS NOT NULL AND btrim(address) <> ''
            ORDER BY created_at DESC NULLS LAST
            LIMIT 100
            """
        )
        success_places = [dict(r) for r in cur.fetchall()]

        print(f"eval set: success={len(success_places)} unresolved={len(unresolved)}")

        def search(q: str, hint: str | None = None, lat=None, lng=None, n=5):
            cur.execute(
                "SELECT * FROM public.search_poi(%s, %s, %s, %s, %s)",
                (q, hint, lat, lng, n),
            )
            return [dict(r) for r in cur.fetchall()]

        # warm-up + latency samples
        latencies = []
        for q in ["묵무키", "스타벅스", "본죽", success_places[0]["name"] if success_places else "카페"]:
            t0 = time.perf_counter()
            search(q)
            latencies.append((q, (time.perf_counter() - t0) * 1000))

        # --- success accuracy ---
        success_results = []
        ok = 0
        no_hit = 0
        for place in success_places:
            hint = region_hint_from_address(place.get("address"))
            t0 = time.perf_counter()
            hits = search(place["name"], hint, place.get("lat"), place.get("lng"), 5)
            ms = (time.perf_counter() - t0) * 1000
            latencies.append((place["name"], ms))

            top = hits[0] if hits else None
            correct = False
            reason = "no_hit"
            if not top:
                no_hit += 1
            else:
                # coord match
                d = haversine_m(place["lat"], place["lng"], top.get("lat"), top.get("lng"))
                if d is not None and d <= 200:
                    correct, reason = True, f"coords<{d:.0f}m"
                else:
                    # name_norm relation via SQL
                    cur.execute(
                        """
                        SELECT
                          public.normalize_poi_name(%s) AS pn,
                          %s AS hn,
                          public.normalize_poi_name(%s) LIKE public.normalize_poi_name(%s) || '%%' AS place_prefix_of_hit,
                          public.normalize_poi_name(%s) LIKE public.normalize_poi_name(%s) || '%%' AS hit_prefix_of_place,
                          similarity(public.normalize_poi_name(%s), %s) AS s
                        """,
                        (
                            place["name"],
                            top["name_norm"],
                            top["name"],
                            place["name"],
                            place["name"],
                            top["name"],
                            place["name"],
                            top["name_norm"],
                        ),
                    )
                    rel = dict(cur.fetchone())
                    if rel["pn"] == rel["hn"] or rel["place_prefix_of_hit"] or rel["hit_prefix_of_place"]:
                        # require also not too far if both have coords (>5km = different branch)
                        if d is None or d <= 5000:
                            correct, reason = True, f"name_rel+d={None if d is None else round(d)}"
                        else:
                            correct, reason = False, f"name_rel_but_far_{d:.0f}m"
                    elif (rel["s"] or 0) >= 0.5 and (d is None or d <= 1500):
                        correct, reason = True, f"sim={rel['s']:.2f}+d={None if d is None else round(d)}"
                    else:
                        correct, reason = False, f"mismatch d={None if d is None else round(d)} sim={rel['s']}"

            if correct:
                ok += 1
            success_results.append(
                {
                    "input": place["name"],
                    "address": place.get("address"),
                    "hint": hint,
                    "top": None
                    if not top
                    else {
                        "name": top["name"],
                        "road_address": top.get("road_address"),
                        "score": top.get("score"),
                        "lat": top.get("lat"),
                        "lng": top.get("lng"),
                    },
                    "correct": correct,
                    "reason": reason,
                    "ms": round(ms, 1),
                }
            )

        # --- unresolved recovery ---
        unresolved_results = []
        recovered = 0
        high_conf = 0
        low_conf = 0
        none_count = 0
        for name in unresolved:
            t0 = time.perf_counter()
            hits = search(name, None, None, None, 5)
            ms = (time.perf_counter() - t0) * 1000
            latencies.append((name, ms))
            top = hits[0] if hits else None
            if not top:
                none_count += 1
                status = "none"
            else:
                recovered += 1
                sc = float(top["score"] or 0)
                if sc >= 85:
                    high_conf += 1
                    status = "high"
                elif sc >= 60:
                    low_conf += 1
                    status = "mid"
                else:
                    low_conf += 1
                    status = "low"
            unresolved_results.append(
                {
                    "input": name,
                    "status": status,
                    "top": None
                    if not top
                    else {
                        "name": top["name"],
                        "road_address": top.get("road_address"),
                        "score": top.get("score"),
                        "sim": top.get("sim"),
                        "category": top.get("category"),
                    },
                    "ms": round(ms, 1),
                }
            )

        # wrong top-1 from success (up to 20)
        wrong = [r for r in success_results if not r["correct"]][:20]

        # pattern classify wrong
        patterns = Counter()
        for w in wrong:
            reason = w["reason"]
            if reason == "no_hit":
                patterns["데이터없음/미회수"] += 1
            elif "far" in reason:
                patterns["동명이인(원거리)"] += 1
            elif reason.startswith("mismatch"):
                patterns["이름변형/오매칭"] += 1
            else:
                patterns["기타"] += 1

        # also classify unresolved none vs junk
        # latency stats
        ms_vals = [ms for _, ms in latencies]
        ms_vals_sorted = sorted(ms_vals)

        def pct(p):
            if not ms_vals_sorted:
                return None
            i = min(len(ms_vals_sorted) - 1, int(len(ms_vals_sorted) * p))
            return round(ms_vals_sorted[i], 1)

        report = {
            "success_n": len(success_places),
            "success_top1_correct": ok,
            "success_accuracy": round(ok / max(len(success_places), 1), 4),
            "success_no_hit": no_hit,
            "unresolved_n": len(unresolved),
            "unresolved_recovered": recovered,
            "unresolved_recovery_rate": round(recovered / max(len(unresolved), 1), 4),
            "unresolved_none": none_count,
            "unresolved_high_conf_ge85": high_conf,
            "unresolved_mid_low_conf": low_conf,
            "wrong_top1_patterns": dict(patterns),
            "wrong_top1_samples": wrong,
            "unresolved_samples_high": [r for r in unresolved_results if r["status"] == "high"][:15],
            "unresolved_samples_none": [r for r in unresolved_results if r["status"] == "none"][:15],
            "latency_ms": {
                "n": len(ms_vals),
                "avg": round(sum(ms_vals) / max(len(ms_vals), 1), 1),
                "p50": pct(0.50),
                "p95": pct(0.95),
                "max": round(max(ms_vals), 1) if ms_vals else None,
            },
            "threshold_proposal": {},
        }

        # threshold proposal from score distributions
        correct_scores = [
            r["top"]["score"]
            for r in success_results
            if r["correct"] and r.get("top") and r["top"].get("score") is not None
        ]
        wrong_scores = [
            r["top"]["score"]
            for r in success_results
            if (not r["correct"]) and r.get("top") and r["top"].get("score") is not None
        ]
        report["score_dist"] = {
            "correct_avg": round(sum(correct_scores) / len(correct_scores), 1) if correct_scores else None,
            "correct_min": round(min(correct_scores), 1) if correct_scores else None,
            "wrong_avg": round(sum(wrong_scores) / len(wrong_scores), 1) if wrong_scores else None,
            "wrong_max": round(max(wrong_scores), 1) if wrong_scores else None,
        }

        # Propose thresholds
        # auto-accept if score>=90 (exact/strong prefix); confirm if 70-90; reject below 70
        auto = 90
        confirm = 70
        # validate on success set
        auto_ok = auto_total = confirm_ok = confirm_total = reject_missed = 0
        for r in success_results:
            sc = (r.get("top") or {}).get("score")
            if sc is None:
                if r["correct"]:
                    reject_missed += 1
                continue
            if sc >= auto:
                auto_total += 1
                if r["correct"]:
                    auto_ok += 1
            elif sc >= confirm:
                confirm_total += 1
                if r["correct"]:
                    confirm_ok += 1
        report["threshold_proposal"] = {
            "auto_save_score_ge": auto,
            "ask_user_score_ge": confirm,
            "reject_below": confirm,
            "rationale": {
                "on_success_auto_precision": round(auto_ok / max(auto_total, 1), 4),
                "on_success_auto_count": auto_total,
                "on_success_confirm_precision": round(confirm_ok / max(confirm_total, 1), 4),
                "on_success_confirm_count": confirm_total,
                "correct_score_avg": report["score_dist"]["correct_avg"],
                "wrong_score_avg": report["score_dist"]["wrong_avg"],
            },
            "text": (
                f"score>={auto}: 자동 저장 후보 (성공셋 정밀도 "
                f"{round(auto_ok / max(auto_total, 1), 3)}). "
                f"{confirm}<=score<{auto}: 사용자 확인. "
                f"score<{confirm}: 버림."
            ),
        }

    out_path = OUT / "search_eval.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    print("wrote", out_path)
    conn.close()


if __name__ == "__main__":
    main()
