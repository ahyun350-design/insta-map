#!/usr/bin/env node
/**
 * 로컬 전용: 구/신 Claude 추출 프롬프트 회귀 비교.
 * 캡션 원문은 파일·DB에 쓰지 않음. 비교표만 stdout.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// load .env.local without printing
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MODEL = "claude-haiku-4-5-20251001";
const API = "https://api.anthropic.com/v1/messages";
const SYSTEM =
  'You must return only pure JSON array. Output format: [{"name":"...","hint":"...","region":null,"category":"카페"}]. region is optional string or null (only if explicitly in caption). category must be exactly one of: 맛집, 카페, 쇼핑, 숙소, 놀거리, 여행지 (Korean strings). Do not include markdown, code fences, explanations, or any extra text.';

const OLD_FIXED = [
  "아래 인스타그램 캡션에서 언급된 모든 장소를 추출하세요.",
  "장소가 여러 개면 모두 포함하고, 없으면 빈 배열을 반환하세요.",
  '반드시 JSON 배열만 반환하세요. 형식: [{"name":"장소명","hint":"동네명또는역이름","region":"캡션에명시된지역또는null","category":"맛집|카페|쇼핑|숙소|놀거리|여행지"}]',
  "hint는 반드시 캡션에 직접 언급된 동네명, 역이름, 구명 중 가장 구체적인 것 하나만 넣으세요.",
  "예: 망원동, 합정, 성수, 용산역 처럼 짧고 구체적인 지역명 하나만.",
  "절대로 서울, 한국 같은 넓은 지역명은 쓰지 마세요. 구체적인 동네명이 없으면 빈 문자열.",
  'region은 캡션에 그 장소와 함께 명시된 지역명만 넣으세요. 예: "성수", "연남동", "강남역", "부산 서면".',
  "캡션에 지역이 없으면 region은 null. 추측·추론·힌트 보강 금지. 없으면 반드시 null.",
  "hint와 region이 같아도 됩니다. region만 없고 hint만 있으면 region은 null.",
  'category는 반드시 "맛집", "카페", "쇼핑", "숙소", "놀거리", "여행지" 중 하나만 사용하세요.',
  "카테고리는 장소의 주된 목적(먹는 곳 / 사는 곳 / 노는 곳 / 자는 곳 / 보는 곳)을 기준으로 가장 가까운 것을 고르세요. 애매하다고 맛집·카페로 몰지 마세요.",
  "맛집: 식사 중심 음식점(밥·요리 파는 곳). 레스토랑, 식당, 술집, 바.",
  "카페: 커피·음료·디저트 중심.",
  "쇼핑: 물건 파는 곳 전반 — 편집샵, 소품샵, 편집매장, 브랜드 스토어·플래그십, 팝업스토어, 쇼핑몰, 백화점, 패션·의류·잡화 매장, 라이프스타일 스토어, 복합 리테일 공간(예: 무신사 메가스토어). 이름에 매장/스토어/샵/메가스토어/플래그십/편집샵/소품샵/팝업이 있으면 쇼핑을 우선 고려하세요.",
  "숙소: 호텔·펜션·게스트하우스·숙박.",
  "놀거리: 노래방, 볼링장, 영화관, 오락실, 방탈출, 액티비티·체험, 전시·팝업 체험형.",
  "여행지: 관광명소, 공원, 랜드마크, 자연경관, 포토스팟.",
  "복합공간(카페+매장 등)은 주된 기능으로 판단하되, 매장·쇼핑 비중이 크면 쇼핑으로 분류하세요.",
  "게시물이 실제로 소개하는 장소만 추출한다.",
  "지나가듯 언급된 지명, 만나는 장소, 근처 랜드마크는 추출하지 않는다.",
  '예: "스타필드에서 만나서 ○○카페 갔어요" → ○○카페만 추출. 스타필드는 제외.',
  "백화점, 쇼핑몰, 역 이름 같은 큰 시설은 그 안의 특정 가게를 소개하는 경우에만 추출한다.",
  "확신이 없으면 넣지 않는다. 적게 뽑는 쪽이 낫다.",
  "카테고리는 그 장소의 주된 용도로 판단한다. 술집·바·전시·공연장은 카페가 아니다.",
].join("\n");

const NEW_EXTRA = [
  "",
  "상호명이 아닌 일반명사·보통명사는 장소로 뽑지 마세요.",
  "(예: 공원, 저수지, 모노레일, 우리집, 바다, 카페, 식당, 숙소)",
  '캡션에서 그 단어가 "고유한 가게·시설 이름"으로 쓰였는지 판단하세요.',
  '"공원에서 산책했다" → 장소 아님',
  '"○○공원에 갔다" → 장소 맞음',
  "브랜드명만 있고 지점이 불명확한 경우도 뽑지 마세요.",
  '("현대" 하나만 있으면 백화점인지 자동차인지 알 수 없음)',
  "확신이 없으면 뽑지 마세요. 잘못된 핀보다 없는 게 낫습니다.",
].join("\n");

const NEW_FIXED = OLD_FIXED + NEW_EXTRA;

const FALSE_POSITIVE_NAMES = new Set([
  "우리집",
  "공원",
  "현대",
  "픽셀",
  "모노레일",
  "온기 우편함",
  "온기우편함",
  "저수지",
  "오브제",
  "바다",
  "카페",
  "식당",
  "숙소",
]);

function parsePlaces(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => (typeof x?.name === "string" ? x.name.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function callClaude(fixed, caption) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content: `${fixed}\n\ncaption: ${caption}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 300));
  const text = data.content?.find((c) => c.type === "text")?.text?.trim() || "";
  return parsePlaces(text);
}

function judge(oldNames, newNames) {
  const oldFp = oldNames.filter((n) => FALSE_POSITIVE_NAMES.has(n.replace(/\s+/g, "")) || FALSE_POSITIVE_NAMES.has(n));
  const newFp = newNames.filter((n) => FALSE_POSITIVE_NAMES.has(n.replace(/\s+/g, "")) || FALSE_POSITIVE_NAMES.has(n));
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const lostGood = [...oldSet].filter((n) => !newSet.has(n) && !FALSE_POSITIVE_NAMES.has(n) && !FALSE_POSITIVE_NAMES.has(n.replace(/\s+/g, "")));
  const clearedFp = oldFp.length > 0 && newFp.length < oldFp.length;
  const addedFp = newFp.length > oldFp.length;
  if (addedFp || lostGood.length >= 2) return "악화";
  if (clearedFp && lostGood.length === 0) return "개선";
  if (lostGood.length === 1 && !clearedFp) return "악화";
  if (JSON.stringify([...oldSet].sort()) === JSON.stringify([...newSet].sort())) return "동일";
  if (clearedFp) return "개선";
  // fewer names without known FP clearance — treat carefully
  if (newNames.length < oldNames.length && lostGood.length > 0) return "악화";
  if (newNames.length < oldNames.length) return "개선";
  return "동일";
}

const SYNTHETIC = [
  { id: "S1", caption: "오늘 공원에서 산책했다. 날씨 좋음." },
  { id: "S2", caption: "주말에 서울숲공원에 갔다. 피크닉 최고." },
  { id: "S3", caption: "우리집에서 저녁 먹었어요." },
  { id: "S4", caption: "현대 보고 왔어요. 좋더라." },
  { id: "S5", caption: "모노레일 타고 시내 한 바퀴." },
  { id: "S6", caption: "저수지 뷰가 예뻤다." },
  { id: "S7", caption: "성수 오브제 매장 들렀다가 카페도 감." },
  { id: "S8", caption: "망원 카페 투어 — 어니언이랑 블루보틀." },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await admin
    .from("extract_jobs")
    .select("id, caption, status, created_at")
    .not("caption", "is", null)
    .neq("caption", "")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;

  const real = [];
  const seen = new Set();
  for (const r of rows || []) {
    const c = String(r.caption || "").trim();
    if (c.length < 20) continue;
    const keyC = c.slice(0, 80);
    if (seen.has(keyC)) continue;
    seen.add(keyC);
    real.push({ id: `R${real.length + 1}`, caption: c });
    if (real.length >= 22) break;
  }

  const samples = [...SYNTHETIC, ...real].slice(0, 30);
  console.log(`samples=${samples.length} (synthetic=${SYNTHETIC.length}, real=${samples.length - SYNTHETIC.length})`);
  console.log("캡션번호 | 구프롬프트 결과 | 신프롬프트 결과 | 판정");

  let improve = 0,
    same = 0,
    worse = 0;
  for (const s of samples) {
    const oldNames = await callClaude(OLD_FIXED, s.caption);
    // small delay to be nice
    await new Promise((r) => setTimeout(r, 200));
    const newNames = await callClaude(NEW_FIXED, s.caption);
    const verdict = judge(oldNames, newNames);
    if (verdict === "개선") improve++;
    else if (verdict === "악화") worse++;
    else same++;
    const fmt = (arr) => (arr.length ? arr.join(", ") : "(없음)");
    console.log(`${s.id} | ${fmt(oldNames)} | ${fmt(newNames)} | ${verdict}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\n요약: 개선=${improve} 동일=${same} 악화=${worse}`);
  if (worse >= 3) {
    console.log("ABORT_SIGNAL: 악화 3건 이상 — 규칙 완화 필요");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
