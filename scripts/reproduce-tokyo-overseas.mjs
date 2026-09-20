#!/usr/bin/env node
/**
 * 도쿄 맛집 릴스 7장소 해외 판정 재현.
 * 캡션 원문은 출력하지 않음 — 장소명·country만.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TARGETS = [
  "야키니쿠코코카라 야에스구치점",
  "코스시",
  "시부야 돈카츠 아키라",
  "잇타이칸",
  "잇푸도 긴자점",
  "하카타 꼬치전문점 조우몬",
  "돈카츠 마루시치 긴자",
];

const MODEL = "claude-haiku-4-5-20251001";
const API = "https://api.anthropic.com/v1/messages";

const SYSTEM =
  'You must return only pure JSON object. Output format: {"caption_country":"KR","places":[{"name":"...","hint":"...","region":null,"category":"카페","country":"KR"}]}. caption_country and each places[].country must be ISO 3166-1 alpha-2 or "unknown". category must be exactly one of: 맛집, 술집, 카페, 쇼핑, 숙소, 놀거리, 여행지. No markdown.';

const FIXED = [
  "아래 인스타그램 캡션에서 언급된 모든 장소를 추출하세요.",
  '반드시 JSON 객체만 반환: {"caption_country":"KR|JP|unknown","places":[{"name":"...","hint":"...","region":null,"category":"맛집","country":"KR|JP|unknown"}]}',
  "장소의 실제 소재 국가를 판정하라. 캡션 맥락(도시·역·지역명, 현지인, 여행 등)을 근거로 쓴다.",
  "한글 음차여도 실제 소재지가 해외면 해외로 판정. 예: 잇푸도 긴자점, 야키니쿠코코카라 야에스구치점 → JP.",
  "서울의 일본식 이자카야는 KR. 컨셉과 실제 소재지를 구분하라.",
  "게시물이 소개하는 장소만. 확신이 없으면 넣지 마세요.",
].join("\n");

function normalizeCountry(raw) {
  if (typeof raw !== "string") return "unknown";
  const t = raw.trim().toUpperCase();
  if (!t || t === "UNKNOWN") return "unknown";
  if (/^[A-Z]{2}$/.test(t)) return t;
  return "unknown";
}

function isOverseas(placeCountry, captionCountry) {
  const pc = normalizeCountry(placeCountry);
  const cc = normalizeCountry(captionCountry);
  if (pc !== "unknown" && pc !== "KR") return true;
  if (pc === "unknown" && cc !== "unknown" && cc !== "KR") return true;
  return false;
}

function parseExtract(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const objStart = t.indexOf("{");
  const arrStart = t.indexOf("[");
  let payload = t;
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    payload = t.slice(objStart, t.lastIndexOf("}") + 1);
  }
  const parsed = JSON.parse(payload);
  if (Array.isArray(parsed)) return { captionCountry: "unknown", places: parsed };
  return {
    captionCountry: normalizeCountry(parsed.caption_country),
    places: Array.isArray(parsed.places) ? parsed.places : [],
  };
}

async function callClaude(caption) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
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
  return {
    ...parseExtract(text),
    usage: data.usage || {},
  };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Prefer jobs that mention distinctive Tokyo tokens (no caption print)
  const needles = ["야에스구치", "잇푸도", "마루시치", "조우몬"];
  let hit = null;
  for (const needle of needles) {
    const { data, error } = await admin
      .from("extract_jobs")
      .select("id, caption, claude_places, status, created_at")
      .ilike("caption", `%${needle}%`)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    for (const r of data || []) {
      const places = Array.isArray(r.claude_places) ? r.claude_places : [];
      const names = places
        .map((p) => (typeof p?.name === "string" ? p.name.trim() : ""))
        .filter(Boolean);
      const matched = TARGETS.filter((t) =>
        names.some(
          (n) =>
            n.includes(t) ||
            t.includes(n) ||
            n.replace(/\s+/g, "") === t.replace(/\s+/g, ""),
        ),
      );
      if (matched.length >= 3 || names.length >= 5) {
        hit = { row: r, matched, names };
        break;
      }
      if (!hit && String(r.caption || "").length > 20) {
        hit = { row: r, matched: [needle], names };
      }
    }
    if (hit && hit.names.length >= 5) break;
  }

  if (!hit) {
    console.log("NO_REEL_FOUND — cannot reproduce with DB sample");
    process.exit(1);
  }

  console.log(`job_id=${hit.row.id} prior_names=${hit.names.length} matched_tokens=${hit.matched.length}`);
  const extracted = await callClaude(String(hit.row.caption));
  console.log(`caption_country=${extracted.captionCountry}`);
  console.log(`usage_in=${extracted.usage.input_tokens ?? "?"} usage_out=${extracted.usage.output_tokens ?? "?"}`);

  const results = [];
  for (const target of TARGETS) {
    const found = extracted.places.find((p) => {
      const n = typeof p?.name === "string" ? p.name.trim() : "";
      return (
        n === target ||
        n.replace(/\s+/g, "") === target.replace(/\s+/g, "") ||
        n.includes(target) ||
        target.includes(n)
      );
    });
    if (!found) {
      results.push({ target, found: false, country: null, overseas: false });
      continue;
    }
    const country = normalizeCountry(found.country);
    const overseas = isOverseas(country, extracted.captionCountry);
    results.push({
      target,
      found: true,
      name: String(found.name).trim(),
      country,
      overseas,
    });
  }

  for (const r of results) {
    if (!r.found) {
      console.log(`MISS\t${r.target}`);
    } else {
      console.log(`${r.overseas ? "OVERSEAS" : "DOMESTIC"}\t${r.name}\tcountry=${r.country}`);
    }
  }
  const overseasCount = results.filter((r) => r.overseas).length;
  const foundCount = results.filter((r) => r.found).length;
  console.log(`summary found=${foundCount}/7 overseas=${overseasCount}/7`);
  if (overseasCount < 7) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
