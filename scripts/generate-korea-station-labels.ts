/**
 * Build merged subway/rail station name labels for MapLibre.
 * Same display name within 300m → one centroid; colours[] kept for badges.
 *
 *   npx tsx scripts/generate-korea-station-labels.ts
 *
 * Writes public/map/korea-station-labels.geojson
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/map/korea-station-labels.geojson");
const BBOX = "33.0,124.5,39.2,132.0";
/** Same name within this distance → one label. Second pass catches split hubs (e.g. 신촌 ~700m). */
const MERGE_M = 300;
const MERGE_M_SECOND = 750;

/**
 * Curated hubs for z11–13 only (full set at z14+).
 * Sparse enough that phone-width mapo z11 stays in the 15–25 place budget.
 */
const MIDZOOM_NAMES = new Set([
  "서울역",
  "서울",
  "용산",
  "청량리",
  "왕십리",
  "건대입구",
  "잠실",
  "강남",
  "선릉",
  "교대",
  "여의도",
  "당산",
  "합정",
  "홍대입구",
  "공덕",
  "신촌",
  "망원",
  "디지털미디어시티",
  "종로3가",
  "고속터미널",
  "김포공항",
  "부산역",
  "서면",
  "동대구",
  "대전역",
  "수원",
  "인천",
]);
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "PindMapStationLabels/1.0 (https://pindmap.com)";

type Raw = { name: string; lon: number; lat: number; colour: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function koName(tags: Record<string, string> | undefined): string {
  if (!tags) return "";
  let n = (tags["name:ko"] || tags.name || "").trim();
  n = n.replace(/\s*역\s*$/u, "").trim();
  return n;
}

function normalizeName(n: string): string {
  return n.replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
}

function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resolveColour(tags: Record<string, string>): string {
  const raw = (tags.colour || tags.color || "").trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.startsWith("#") ? raw : `#${raw}`;
  }
  return "";
}

async function overpass(query: string): Promise<
  Array<{ type: string; lat?: number; lon?: number; tags?: Record<string, string> }>
> {
  let lastErr: unknown;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": UA,
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          elements?: Array<{
            type: string;
            lat?: number;
            lon?: number;
            tags?: Record<string, string>;
          }>;
        };
        return json.elements ?? [];
      } catch (e) {
        lastErr = e;
        console.warn(`[overpass] ${url} attempt ${attempt + 1}`, String(e));
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

function mergeStations(raw: Raw[]): {
  features: Array<{
    type: "Feature";
    properties: {
      name: string;
      colours: string[];
      colour: string;
      transfer: 0 | 1;
      merged: number;
    };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
  before: number;
  after: number;
  mergedGroups: number;
} {
  const byName = new Map<string, Raw[]>();
  for (const r of raw) {
    const k = normalizeName(r.name);
    if (!k) continue;
    const arr = byName.get(k) || [];
    arr.push(r);
    byName.set(k, arr);
  }

  type Cluster = { name: string; pts: Raw[] };
  const clusters: Cluster[] = [];
  let mergedGroups = 0;

  for (const [, pts] of byName) {
    const remaining = [...pts];
    while (remaining.length) {
      const seed = remaining.shift()!;
      const group = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const p = remaining[i]!;
        if (haversineM(seed.lon, seed.lat, p.lon, p.lat) <= MERGE_M) {
          group.push(p);
          remaining.splice(i, 1);
        }
      }
      // Also merge points that are within 300m of any group member (1-pass expand)
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const p = remaining[i]!;
          if (
            group.some((g) => haversineM(g.lon, g.lat, p.lon, p.lat) <= MERGE_M)
          ) {
            group.push(p);
            remaining.splice(i, 1);
            grew = true;
          }
        }
      }
      if (group.length > 1) mergedGroups += 1;
      clusters.push({ name: seed.name, pts: group });
    }
  }

  const features = clusters.map((c) => {
    const lon = c.pts.reduce((s, p) => s + p.lon, 0) / c.pts.length;
    const lat = c.pts.reduce((s, p) => s + p.lat, 0) / c.pts.length;
    // Prefer shortest Korean display name in the cluster
    const name = [...c.pts].sort(
      (a, b) => a.name.length - b.name.length,
    )[0]!.name;
    const colours = [
      ...new Set(c.pts.map((p) => p.colour).filter(Boolean)),
    ].slice(0, 6);
    return {
      type: "Feature" as const,
      properties: {
        name,
        colours,
        colour: colours[0] || "#5A6570",
        transfer: colours.length > 1 ? (1 as const) : (0 as const),
        merged: c.pts.length,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [+lon.toFixed(6), +lat.toFixed(6)] as [number, number],
      },
    };
  });

  // Second pass: merge leftover same-name centroids within MERGE_M_SECOND
  const byName2 = new Map<string, typeof features>();
  for (const f of features) {
    const k = normalizeName(f.properties.name);
    const arr = byName2.get(k) || [];
    arr.push(f);
    byName2.set(k, arr);
  }
  const features2: typeof features = [];
  for (const [, feats] of byName2) {
    const rem = [...feats];
    while (rem.length) {
      const seed = rem.shift()!;
      const group = [seed];
      for (let i = rem.length - 1; i >= 0; i--) {
        const [lon, lat] = rem[i]!.geometry.coordinates;
        const [slon, slat] = seed.geometry.coordinates;
        if (haversineM(slon, slat, lon, lat) <= MERGE_M_SECOND) {
          group.push(rem[i]!);
          rem.splice(i, 1);
        }
      }
      if (group.length > 1) mergedGroups += 1;
      const lon =
        group.reduce((s, f) => s + f.geometry.coordinates[0], 0) / group.length;
      const lat =
        group.reduce((s, f) => s + f.geometry.coordinates[1], 0) / group.length;
      const merged = group.reduce((s, f) => s + f.properties.merged, 0);
      const name = group
        .map((f) => f.properties.name)
        .sort((a, b) => a.length - b.length)[0]!;
      const colours = [
        ...new Set(group.flatMap((f) => f.properties.colours)),
      ].slice(0, 6);
      features2.push({
        type: "Feature",
        properties: {
          name,
          colours,
          colour: colours[0] || "#5A6570",
          transfer: colours.length > 1 || merged > 1 ? 1 : 0,
          merged,
        },
        geometry: {
          type: "Point",
          coordinates: [+lon.toFixed(6), +lat.toFixed(6)],
        },
      });
    }
  }

  return {
    features: features2,
    before: raw.length,
    after: features2.length,
    mergedGroups,
  };
}

async function main() {
  const q = `
[out:json][timeout:240];
(
  node["railway"="station"]["name"](${BBOX});
  node["railway"="halt"]["station"="subway"]["name"](${BBOX});
  node["station"="subway"]["name"](${BBOX});
  node["railway"="station"]["station"="subway"]["name"](${BBOX});
);
out body;
`;
  console.log("Fetching station nodes…");
  const els = await overpass(q);
  const raw: Raw[] = [];
  for (const el of els) {
    if (el.type !== "node" || el.lat == null || el.lon == null) continue;
    const name = koName(el.tags);
    if (!name || !/[가-힣]/.test(name)) continue;
    // Drop noisy long route-like names
    if (/호선:|전철:|계통|순환/.test(name)) continue;
    if (name.length > 20) continue;
    raw.push({
      name,
      lon: el.lon,
      lat: el.lat,
      colour: resolveColour(el.tags || {}),
    });
  }
  console.log(`raw named stations: ${raw.length}`);
  const { features, before, after, mergedGroups } = mergeStations(raw);
  for (const f of features) {
    (f.properties as { midzoom?: 0 | 1 }).midzoom = MIDZOOM_NAMES.has(
      f.properties.name,
    )
      ? 1
      : 0;
  }
  const fc = { type: "FeatureCollection" as const, features };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const midzoom = features.filter((f) => (f.properties as { midzoom?: number }).midzoom === 1)
    .length;
  const report = {
    before,
    after,
    mergedGroups,
    removed: before - after,
    midzoom,
    bytes: Buffer.byteLength(JSON.stringify(fc)),
    sample: features
      .filter((f) => /홍대|공덕|망원|여의도|신촌/.test(f.properties.name))
      .slice(0, 12)
      .map((f) => ({
        name: f.properties.name,
        merged: f.properties.merged,
        transfer: f.properties.transfer,
        midzoom: (f.properties as { midzoom?: number }).midzoom,
        colours: f.properties.colours.length,
      })),
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(ROOT, "public/map/korea-station-labels.meta.json"),
    JSON.stringify(report, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
