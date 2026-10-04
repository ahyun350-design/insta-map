/**
 * Official Korean metro / urban-rail colours (fallback when OSM `colour` is missing).
 * Keys match normalized name/ref fragments (lowercase, no spaces).
 */
export const SUBWAY_COLOUR_LUT: Record<string, string> = {
  // Seoul Metro
  "1호선": "#0052A4",
  "서울1호선": "#0052A4",
  "2호선": "#00A84D",
  "서울2호선": "#00A84D",
  "3호선": "#EF7C1C",
  "서울3호선": "#EF7C1C",
  "4호선": "#00A5DE",
  "서울4호선": "#00A5DE",
  "5호선": "#996CAC",
  "서울5호선": "#996CAC",
  "6호선": "#CD7C2F",
  "서울6호선": "#CD7C2F",
  "7호선": "#747F00",
  "서울7호선": "#747F00",
  "8호선": "#E6186C",
  "서울8호선": "#E6186C",
  "9호선": "#BDB092",
  "서울9호선": "#BDB092",
  신분당선: "#D4003B",
  신분당: "#D4003B",
  경의중앙선: "#77C4A3",
  경의중앙: "#77C4A3",
  수인분당선: "#FABE00",
  수인분당: "#FABE00",
  분당선: "#FABE00",
  수인선: "#FABE00",
  공항철도: "#0090D2",
  arex: "#0090D2",
  우이신설선: "#B7C452",
  우이신설: "#B7C452",
  신림선: "#6789CA",
  신림: "#6789CA",
  경춘선: "#0C8E72",
  경춘: "#0C8E72",
  경강선: "#003DA5",
  경강: "#003DA5",
  서해선: "#8FC31F",
  서해: "#8FC31F",
  "gtx-a": "#9A6292",
  gtxa: "#9A6292",
  "gtx a": "#9A6292",
  김포골드라인: "#A97C50",
  김포도시철도: "#A97C50",
  의정부경전철: "#FDA600",
  용인에버라인: "#56AD01",
  에버라인: "#56AD01",

  // Incheon
  "인천1호선": "#6CA502",
  "인천2호선": "#ED8B00",

  // Busan
  "부산1호선": "#F06A00",
  "부산2호선": "#3CB44A",
  "부산3호선": "#BB8036",
  "부산4호선": "#217DCB",
  동해선: "#90CDC4",
  부산김해경전철: "#8652A1",
  김해경전철: "#8652A1",

  // Daegu
  "대구1호선": "#D93339",
  "대구2호선": "#00AA80",
  "대구3호선": "#FFB100",

  // Daejeon / Gwangju
  "대전1호선": "#007448",
  대전도시철도: "#007448",
  "광주1호선": "#009088",
  광주도시철도: "#009088",
};

/** Normalize for LUT lookup. */
export function normalizeLineKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]（）]/g, "")
    .replace(/선$/u, "선");
}

export function lookupOfficialColour(name: string, ref: string): string | null {
  const candidates = [name, ref, `${name}`, name.replace(/지하철/g, ""), name.replace(/도시철도/g, "")];
  for (const c of candidates) {
    if (!c) continue;
    const k = normalizeLineKey(c);
    if (SUBWAY_COLOUR_LUT[k]) return SUBWAY_COLOUR_LUT[k];
    // partial: "서울 지하철 2호선" → contains 2호선
    for (const [lutKey, colour] of Object.entries(SUBWAY_COLOUR_LUT)) {
      if (k.includes(normalizeLineKey(lutKey)) || normalizeLineKey(lutKey).includes(k)) {
        if (lutKey.length >= 2) return colour;
      }
    }
  }
  // ref-only numeric with city hints in name
  const refNum = ref.replace(/[^0-9]/g, "");
  if (refNum && /부산|busan/i.test(name)) {
    const hit = SUBWAY_COLOUR_LUT[`부산${refNum}호선`];
    if (hit) return hit;
  }
  if (refNum && /대구|daegu/i.test(name)) {
    const hit = SUBWAY_COLOUR_LUT[`대구${refNum}호선`];
    if (hit) return hit;
  }
  if (refNum && /인천|incheon/i.test(name)) {
    const hit = SUBWAY_COLOUR_LUT[`인천${refNum}호선`];
    if (hit) return hit;
  }
  if (refNum && (/서울|metro|지하철/i.test(name) || !name)) {
    const hit = SUBWAY_COLOUR_LUT[`${refNum}호선`];
    if (hit) return hit;
  }
  return null;
}

export function softenColour(hex: string, theme: "paper" | "white" | "neon"): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (theme === "white") {
    // lower saturation toward gray
    const avg = (r + g + b) / 3;
    r = Math.round(r * 0.72 + avg * 0.28);
    g = Math.round(g * 0.72 + avg * 0.28);
    b = Math.round(b * 0.72 + avg * 0.28);
  } else if (theme === "neon") {
    // lift toward lighter for dark basemap
    r = Math.min(255, Math.round(r * 1.15 + 24));
    g = Math.min(255, Math.round(g * 1.15 + 24));
    b = Math.min(255, Math.round(b * 1.15 + 24));
  }
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
