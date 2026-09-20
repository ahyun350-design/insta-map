#!/usr/bin/env node
/**
 * Claude country / caption_country 회귀 측정.
 * extract_jobs (status=completed, caption 있음) 최대 300건 재추출.
 * 캡션 원문은 로그·파일에 쓰지 않음. 집계·장소명만.
 *
 * Usage: node scripts/regress-overseas-country.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MODEL = "claude-haiku-4-5-20251001";
const API = "https://api.anthropic.com/v1/messages";
const SAMPLE = 300;
const CONCURRENCY = 5;
const FP_THRESHOLD = 0.02;

const SYSTEM =
  'You must return only pure JSON object. Output format: {"caption_country":"KR","places":[{"name":"...","hint":"...","region":null,"category":"카페","country":"KR"}]}. caption_country and each places[].country must be ISO 3166-1 alpha-2 (KR, JP, TW, TH, VN, US, …) or "unknown". region is optional string or null (only if explicitly in caption). category must be exactly one of: 맛집, 술집, 카페, 쇼핑, 숙소, 놀거리, 여행지 (Korean strings). Do not include markdown, code fences, explanations, or any extra text.';

const FIXED = [
  "아래 인스타그램 캡션에서 언급된 모든 장소를 추출하세요.",
  "장소가 여러 개면 모두 포함하고, 없으면 places를 빈 배열로 두세요.",
  '반드시 JSON 객체만 반환하세요. 형식: {"caption_country":"KR|JP|TW|TH|VN|US|unknown","places":[{"name":"장소명","hint":"동네명또는역이름","region":"캡션에명시된지역또는null","category":"맛집|술집|카페|쇼핑|숙소|놀거리|여행지","country":"KR|JP|TW|TH|VN|US|unknown"}]}',
  "caption_country: 캡션 전체가 어느 나라 여행·맛집 글인지 하나로 판정. ISO 3166-1 alpha-2 또는 unknown.",
  "places[].country: 그 장소의 실제 소재 국가. ISO 2자리 또는 unknown.",
  "장소의 실제 소재 국가를 판정하라. 캡션 전체의 맥락(언급된 도시·역·지역명, '현지인', '여행', 환율·통화 표기 등)을 근거로 쓴다.",
  "장소명이 한글로 음차되어 있어도 실제 소재지가 해외면 해외로 판정하라.",
  "예: '잇푸도 긴자점', '야키니쿠코코카라 야에스구치점'은 일본(JP)이다.",
  "컨셉이나 분위기가 외국풍인 것과 실제 소재지를 구분하라. 서울에 있는 일본식 이자카야는 KR이다.",
  "hint는 반드시 캡션에 직접 언급된 동네명, 역이름, 구명 중 가장 구체적인 것 하나만 넣으세요.",
  "구체적인 동네명이 없으면 빈 문자열. region은 캡션에 명시된 지역만, 없으면 null.",
  'category는 "맛집", "술집", "카페", "쇼핑", "숙소", "놀거리", "여행지" 중 하나만.',
  "게시물이 실제로 소개하는 장소만 추출한다. 확신이 없으면 넣지 않는다.",
].join("\n");

function normalizeCountry(raw) {
  if (typeof raw !== "string") return "unknown";
  const t = raw.trim().toUpperCase();
  if (!t || t === "UNKNOWN" || t === "NULL" || t === "N/A") return "unknown";
  if (/^[A-Z]{2}$/.test(t)) return t;
  return "unknown";
}

function isConcreteNonKr(code) {
  const c = normalizeCountry(code);
  return c !== "unknown" && c !== "KR";
}

function isDomesticCoord(lat, lng) {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

function parseExtract(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  // Prefer object when `{` precedes `[`
  const objStart = t.indexOf("{");
  const arrStart = t.indexOf("[");
  let payload = t;
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    payload = t.slice(objStart, t.lastIndexOf("}") + 1);
  } else if (arrStart >= 0) {
    payload = t.slice(arrStart, t.lastIndexOf("]") + 1);
  }
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      return { captionCountry: "unknown", places: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return {
        captionCountry: normalizeCountry(parsed.caption_country ?? parsed.captionCountry),
        places: Array.isArray(parsed.places) ? parsed.places : [],
      };
    }
  } catch {
    // fallthrough
  }
  return { captionCountry: "unknown", places: [] };
}

async function callClaude(caption) {
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
      messages: [{ role: "user", content: `${FIXED}\n\ncaption: ${caption}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 300));
  const text = data.content?.find((c) => c.type === "text")?.text?.trim() || "";
  const usage = data.usage || {};
  return {
    ...parseExtract(text),
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.ANTHROPIC_API_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("extract_jobs")
    .select("id, user_id, caption, status, created_at, claude_places")
    .eq("status", "completed")
    .not("caption", "is", null)
    .neq("caption", "")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(SAMPLE);
  if (error) throw error;

  const samples = (rows || []).filter((r) => String(r.caption || "").trim().length >= 10).slice(0, SAMPLE);
  console.log(`samples=${samples.length} (cap=${SAMPLE}, concurrency=${CONCURRENCY})`);

  let totalPlaces = 0;
  let overseasPlaces = 0;
  let domesticCoordOverseas = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const overseasNames = [];
  const fpNames = [];

  const results = await mapPool(samples, CONCURRENCY, async (row) => {
    const caption = String(row.caption || "").trim();
    try {
      const extracted = await callClaude(caption);
      return { ok: true, row, extracted };
    } catch (e) {
      return { ok: false, row, error: String(e?.message || e).slice(0, 120) };
    }
  });

  const failCount = results.filter((r) => !r.ok).length;
  const placeNameSet = new Set();

  for (const r of results) {
    if (!r.ok) continue;
    const { extracted } = r;
    inputTokens += extracted.inputTokens;
    outputTokens += extracted.outputTokens;
    const cap = extracted.captionCountry;
    for (const p of extracted.places) {
      const name = typeof p?.name === "string" ? p.name.trim() : "";
      if (!name) continue;
      totalPlaces += 1;
      const placeCountry = normalizeCountry(p.country);
      const effectiveOverseas =
        isConcreteNonKr(placeCountry) ||
        (placeCountry === "unknown" && isConcreteNonKr(cap));
      if (effectiveOverseas) {
        overseasPlaces += 1;
        overseasNames.push(name);
        placeNameSet.add(name);
      }
    }
  }

  // Look up existing places coords by name (domestic bbox check)
  const names = [...placeNameSet].slice(0, 500);
  const nameToCoords = new Map();
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50);
    const { data: places, error: pErr } = await admin
      .from("places")
      .select("name, lat, lng")
      .in("name", chunk)
      .limit(2000);
    if (pErr) {
      console.error("places lookup error:", pErr.message);
      break;
    }
    for (const pl of places || []) {
      const n = String(pl.name || "").trim();
      if (!n || nameToCoords.has(n)) continue;
      const lat = Number(pl.lat);
      const lng = Number(pl.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      nameToCoords.set(n, { lat, lng });
    }
  }

  for (const name of overseasNames) {
    const coords = nameToCoords.get(name);
    if (!coords) continue;
    if (isDomesticCoord(coords.lat, coords.lng)) {
      domesticCoordOverseas += 1;
      if (fpNames.length < 30) fpNames.push(name);
    }
  }

  const sampleN = samples.length;
  const fpRate = sampleN > 0 ? domesticCoordOverseas / sampleN : 0;
  const overseasRate = totalPlaces > 0 ? overseasPlaces / totalPlaces : 0;

  console.log("---");
  console.log(`jobs_ok=${sampleN - failCount} jobs_fail=${failCount}`);
  console.log(`places_total=${totalPlaces} places_overseas=${overseasPlaces} overseas_place_rate=${(overseasRate * 100).toFixed(1)}%`);
  console.log(`domestic_coord_but_overseas=${domesticCoordOverseas} / samples=${sampleN} rate=${(fpRate * 100).toFixed(2)}% (threshold=${(FP_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`tokens_input=${inputTokens} tokens_output=${outputTokens} tokens_total=${inputTokens + outputTokens}`);
  console.log(`avg_input_per_job=${sampleN ? Math.round(inputTokens / sampleN) : 0} avg_output_per_job=${sampleN ? Math.round(outputTokens / sampleN) : 0}`);
  if (fpNames.length) {
    console.log("fp_place_names_sample:", fpNames.join(" | "));
  }
  if (fpRate > FP_THRESHOLD) {
    console.log("WARN: false-positive rate exceeds 2% — prompt needs adjustment");
    process.exitCode = 2;
  } else {
    console.log("OK: false-positive rate within 2%");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
