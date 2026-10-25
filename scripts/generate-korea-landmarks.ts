/**
 * Fetch Korea landmarks from Overpass → public/map/korea-landmarks.geojson
 *
 *   npx tsx scripts/generate-korea-landmarks.ts
 *
 * Uses Overpass (OSM ODbL). Does not call Kakao. No localStorage.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/map/korea-landmarks.geojson");
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "PindMapKoreaLandmarks/1.0 (https://pindmap.com; ODbL research)";

type Tier = 1 | 2 | 3;

type LandmarkProps = {
  name: string;
  tier: Tier;
  wikidata?: string;
  height?: number;
  levels?: number;
  kind?: string;
};

type Feat = {
  type: "Feature";
  properties: LandmarkProps;
  geometry: { type: "Point"; coordinates: [number, number] };
};

type OsmEl = {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Rough admin boxes (south,west,north,east). */
const REGIONS: Array<{
  name: string;
  s: number;
  w: number;
  n: number;
  e: number;
  /** Include mid-rise (20–29F) buildings for tier3 density near cities. */
  midRise: boolean;
}> = [
  { name: "seoul-metro", s: 37.35, w: 126.7, n: 37.75, e: 127.25, midRise: true },
  { name: "gg-west", s: 37.0, w: 126.4, n: 37.55, e: 126.95, midRise: false },
  { name: "gg-east", s: 37.0, w: 126.95, n: 37.9, e: 127.6, midRise: false },
  { name: "busan", s: 35.0, w: 128.8, n: 35.35, e: 129.3, midRise: true },
  { name: "daegu", s: 35.75, w: 128.45, n: 35.95, e: 128.75, midRise: false },
  { name: "daejeon", s: 36.25, w: 127.25, n: 36.45, e: 127.5, midRise: false },
  { name: "gwangju", s: 35.05, w: 126.75, n: 35.25, e: 127.0, midRise: false },
  { name: "jeju", s: 33.1, w: 126.1, n: 33.6, e: 126.99, midRise: false },
];

const CHECKLIST: Array<{
  name: string;
  lng: number;
  lat: number;
  tier: Tier;
  kind: string;
}> = [
  { name: "롯데월드타워", lng: 127.1025, lat: 37.5125, tier: 1, kind: "tower" },
  { name: "63빌딩", lng: 126.9402, lat: 37.5195, tier: 1, kind: "tower" },
  { name: "코엑스", lng: 127.059, lat: 37.5125, tier: 1, kind: "mall" },
  { name: "서울월드컵경기장", lng: 126.89725, lat: 37.5683, tier: 1, kind: "stadium" },
  { name: "경복궁", lng: 126.977, lat: 37.5795, tier: 1, kind: "palace" },
  { name: "N서울타워", lng: 126.9882, lat: 37.5512, tier: 1, kind: "tower" },
  { name: "더현대 서울", lng: 126.9285, lat: 37.5258, tier: 1, kind: "department_store" },
  { name: "IFC몰", lng: 126.9255, lat: 37.5252, tier: 1, kind: "mall" },
  { name: "메세나폴리스", lng: 126.9145, lat: 37.5515, tier: 1, kind: "mall" },
  { name: "AK플라자 홍대", lng: 126.9225, lat: 37.5565, tier: 1, kind: "department_store" },
  { name: "동대문디자인플라자", lng: 127.0095, lat: 37.5668, tier: 1, kind: "attraction" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function overpassQuery(
  s: number,
  w: number,
  n: number,
  e: number,
  midRise: boolean,
): string {
  const bbox = `${s},${w},${n},${e}`;
  const mid = midRise
    ? `nwr["name"]["building"]["building:levels"](if: number(t["building:levels"]) >= 20 && number(t["building:levels"]) < 30)(${bbox});`
    : "";
  return `
[out:json][timeout:90];
(
  nwr["name"]["wikidata"]["building"](${bbox});
  nwr["name"]["wikidata"]["tourism"~"^(attraction|museum|gallery|theme_park)$"](${bbox});
  nwr["name"]["wikidata"]["historic"~"^(castle|palace|monument)$"](${bbox});
  nwr["name"]["wikidata"]["leisure"="stadium"](${bbox});
  nwr["name"]["wikidata"]["man_made"="tower"](${bbox});
  nwr["name"]["wikidata"]["shop"~"^(mall|department_store)$"](${bbox});
  nwr["name"]["wikidata"]["amenity"="university"](${bbox});
  nwr["name"]["building"]["height"](if: number(t["height"]) >= 100)(${bbox});
  nwr["name"]["building"]["building:levels"](if: number(t["building:levels"]) >= 30)(${bbox});
  ${mid}
  nwr["name"]["tourism"~"^(museum|gallery|theme_park)$"](${bbox});
  nwr["name"]["tourism"="attraction"]["wikidata"](${bbox});
  nwr["name"]["historic"~"^(castle|palace|monument)$"](${bbox});
  nwr["name"]["leisure"="stadium"](${bbox});
  nwr["name"]["man_made"="tower"](${bbox});
  nwr["name"]["shop"~"^(mall|department_store)$"](${bbox});
  nwr["name"]["amenity"="university"](${bbox});
);
out center tags;
`.trim();
}

async function fetchOverpass(query: string): Promise<OsmEl[]> {
  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": UA,
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t.slice(0, 180)}`);
        }
        const json = (await res.json()) as { elements?: OsmEl[] };
        return json.elements ?? [];
      } catch (e) {
        lastErr = e;
        console.warn(`[overpass] ${url} attempt ${attempt + 1}:`, String(e));
        await sleep(10000 * (attempt + 1));
      }
    }
  }
  console.warn("[overpass] all mirrors failed:", lastErr);
  return [];
}

function parseHeight(tags: Record<string, string>): number | undefined {
  const h = tags.height || tags["building:height"];
  if (!h) return undefined;
  const m = String(h).match(/([\d.]+)/);
  return m ? Number(m[1]) : undefined;
}

function parseLevels(tags: Record<string, string>): number | undefined {
  const lv = tags["building:levels"];
  if (!lv) return undefined;
  const n = Number(lv);
  return Number.isFinite(n) ? n : undefined;
}

function pickName(tags: Record<string, string>): string | null {
  const ko = (tags["name:ko"] || "").trim();
  const name = (tags.name || "").trim();
  const n = ko || name || null;
  if (!n) return null;
  // Drop apartment-unit / single-letter noise
  if (/^\d+$/.test(n) || /^\d+동$/.test(n) || /^[A-Za-z]{1,2}$/.test(n)) {
    return null;
  }
  if (n.length <= 1) return null;
  return n;
}

function classifyTier(
  tags: Record<string, string>,
  height?: number,
  levels?: number,
): Tier | null {
  const hasWd = !!tags.wikidata;
  const tourism = tags.tourism || "";
  const historic = tags.historic || "";
  const leisure = tags.leisure || "";
  const manMade = tags.man_made || "";
  const shop = tags.shop || "";
  const amenity = tags.amenity || "";

  const isTower = manMade === "tower";
  const isStadium = leisure === "stadium";
  const isPalace = historic === "palace" || historic === "castle";
  const isMall = shop === "mall" || shop === "department_store";
  const isTheme = tourism === "theme_park";
  const isAttraction =
    tourism === "attraction" ||
    tourism === "museum" ||
    tourism === "gallery" ||
    historic === "monument";
  const isUni = amenity === "university";
  const tall200 = (height ?? 0) >= 200;
  const tall100 = (height ?? 0) >= 100;
  const levels30 = (levels ?? 0) >= 30;
  const levels20 = (levels ?? 0) >= 20;

  const listed =
    isAttraction || isPalace || isStadium || isTower || isMall || isUni || isTheme;
  const tallBld = !!tags.building && (tall100 || levels30);
  if (!hasWd && !listed && !tallBld && !levels20) return null;

  if (
    isTower ||
    isStadium ||
    isPalace ||
    isMall ||
    isTheme ||
    tall200
  ) {
    return 1;
  }
  if (hasWd || tall100 || levels30) return 2;
  if (levels20 || isAttraction || isUni) return 3;
  return null;
}

function kindOf(tags: Record<string, string>): string {
  return (
    tags.man_made ||
    tags.leisure ||
    tags.historic ||
    tags.shop ||
    tags.tourism ||
    tags.amenity ||
    tags.building ||
    "landmark"
  );
}

/** Large-box mart / supermarket chains → shopping POI, not landmark star. */
const MART_CHAIN_RE =
  /홈플러스|이마트|롯데마트|코스트코|트레이더스|하나로마트|농협하나로|빅마켓|메가마트|롯데슈퍼|테크노마트|Homeplus|Costco|E-?mart/i;

function elementToFeat(el: OsmEl): Feat | null {
  const tags = el.tags ?? {};
  const name = pickName(tags);
  if (!name) return null;
  if (MART_CHAIN_RE.test(name) || tags.shop === "supermarket") return null;
  // Drop apartment-like noise
  if (/아파트|아파트단지|주상복합|오피스텔|단지/.test(name) && !tags.wikidata) {
    const h = parseHeight(tags) ?? 0;
    if (h < 150) return null;
  }
  const height = parseHeight(tags);
  const levels = parseLevels(tags);
  const tier = classifyTier(tags, height, levels);
  if (!tier) return null;

  const hasWd = !!tags.wikidata;
  const listed =
    /^(attraction|museum|gallery|theme_park)$/.test(tags.tourism || "") ||
    /^(castle|palace|monument)$/.test(tags.historic || "") ||
    tags.leisure === "stadium" ||
    tags.man_made === "tower" ||
    /^(mall|department_store)$/.test(tags.shop || "") ||
    tags.amenity === "university";
  const tallBld =
    !!tags.building && ((height ?? 0) >= 100 || (levels ?? 0) >= 30);
  if (!hasWd && !listed && !tallBld && (levels ?? 0) < 20) return null;

  const lat = el.center?.lat ?? el.lat;
  const lon = el.center?.lon ?? el.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    type: "Feature",
    properties: {
      name,
      tier,
      wikidata: tags.wikidata,
      height,
      levels,
      kind: kindOf(tags),
    },
    geometry: { type: "Point", coordinates: [lon!, lat!] },
  };
}

function dedupeKey(f: Feat): string {
  const [lng, lat] = f.geometry.coordinates;
  return `${f.properties.name}|${lng.toFixed(4)}|${lat.toFixed(4)}`;
}

function normalizeName(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .toLowerCase();
}

function namesSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

function haversineM(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Same/similar name within radiusM → keep best (tier, wikidata, height). */
function spatialNameDedupe(features: Feat[], radiusM = 500): Feat[] {
  const score = (f: Feat) => {
    let s = (4 - f.properties.tier) * 10000;
    if (f.properties.wikidata) s += 1000;
    s += f.properties.height ?? 0;
    s += (f.properties.levels ?? 0) * 10;
    return s;
  };
  const sorted = [...features].sort((a, b) => score(b) - score(a));
  const kept: Feat[] = [];
  for (const f of sorted) {
    const [lng, lat] = f.geometry.coordinates;
    const clash = kept.some((k) => {
      if (!namesSimilar(f.properties.name, k.properties.name)) return false;
      const [klng, klat] = k.geometry.coordinates;
      return haversineM(lng, lat, klng, klat) <= radiusM;
    });
    if (!clash) kept.push(f);
  }
  return kept;
}

function capTier(
  features: Feat[],
  tier: Tier,
  max: number,
  prefer: (f: Feat) => number,
): Feat[] {
  const keep = features.filter((f) => f.properties.tier !== tier);
  const pool = features.filter((f) => f.properties.tier === tier);
  if (pool.length <= max) return features;
  pool.sort((a, b) => prefer(b) - prefer(a));
  return [...keep, ...pool.slice(0, max)];
}

async function main() {
  const byKey = new Map<string, Feat>();

  for (const region of REGIONS) {
    console.log(`fetch ${region.name}…`);
    const q = overpassQuery(region.s, region.w, region.n, region.e, region.midRise);
    const elements = await fetchOverpass(q);
    let added = 0;
    for (const raw of elements) {
      const feat = elementToFeat(raw);
      if (!feat) continue;
      const k = dedupeKey(feat);
      const prev = byKey.get(k);
      if (!prev || feat.properties.tier < prev.properties.tier) {
        byKey.set(k, feat);
        added += 1;
      }
    }
    console.log(
      `  elements=${elements.length} kept+=${added} total=${byKey.size}`,
    );
    await sleep(8000);
  }

  const checklistReport: Array<{ name: string; ok: boolean; reason?: string }> =
    [];
  for (const c of CHECKLIST) {
    const cNorm = normalizeName(c.name);
    const hit = [...byKey.values()].find((f) => {
      const n = normalizeName(f.properties.name);
      // Require substantial name overlap (avoid "IFC몰"≈"Three IFC" false hits)
      if (n === cNorm || n.includes(cNorm) || cNorm.includes(n)) {
        return n.length >= 3 && cNorm.length >= 3;
      }
      return false;
    });
    if (hit) {
      hit.properties.tier = Math.min(hit.properties.tier, c.tier) as Tier;
      // Prefer checklist display name when OSM name is a variant
      if (normalizeName(hit.properties.name) !== cNorm) {
        hit.properties.name = c.name;
      }
      checklistReport.push({ name: c.name, ok: true });
    } else {
      const feat: Feat = {
        type: "Feature",
        properties: { name: c.name, tier: c.tier, kind: c.kind },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      };
      byKey.set(dedupeKey(feat), feat);
      checklistReport.push({
        name: c.name,
        ok: true,
        reason: "seeded (missing from Overpass)",
      });
    }
  }

  let features = [...byKey.values()];

  // Spatial + name dedupe (same/similar name within 500m → one feature)
  {
    const beforeDedupe = features.length;
    features = spatialNameDedupe(features, 500);
    console.log(
      `spatialNameDedupe: ${beforeDedupe} → ${features.length} (−${beforeDedupe - features.length})`,
    );
  }

  // Target bands: tier1 150–300, keep tier2/3 usable under 2MB
  features = capTier(features, 1, 280, (f) => {
    let s = f.properties.wikidata ? 100 : 0;
    s += f.properties.height ?? 0;
    if (CHECKLIST.some((c) => normalizeName(f.properties.name).includes(normalizeName(c.name)))) {
      s += 10000;
    }
    return s;
  });
  features = capTier(features, 2, 900, (f) =>
    (f.properties.wikidata ? 50 : 0) + (f.properties.height ?? 0) + (f.properties.levels ?? 0),
  );
  features = capTier(features, 3, 1200, (f) =>
    (f.properties.levels ?? 0) + (f.properties.wikidata ? 20 : 0),
  );

  let fc = { type: "FeatureCollection" as const, features };
  let json = JSON.stringify(fc);
  if (Buffer.byteLength(json, "utf8") > 2_000_000) {
    console.warn(">2MB — writing tier3 separately");
    const tier3 = features.filter((f) => f.properties.tier === 3);
    features = features.filter((f) => f.properties.tier !== 3);
    fc = { type: "FeatureCollection", features };
    json = JSON.stringify(fc);
    const t3Path = path.join(ROOT, "public/map/korea-landmarks-tier3.geojson");
    fs.writeFileSync(
      t3Path,
      JSON.stringify({ type: "FeatureCollection", features: tier3 }),
    );
    console.log("Wrote tier3", t3Path, tier3.length);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  const bytes = Buffer.byteLength(json, "utf8");
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const f of features) counts[f.properties.tier as 1 | 2 | 3] += 1;
  console.log("Wrote", OUT);
  console.log("bytes", bytes, "tiers", counts);
  console.log("checklist", JSON.stringify(checklistReport, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
