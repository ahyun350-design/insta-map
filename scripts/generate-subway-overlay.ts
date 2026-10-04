/**
 * Extract Korea metro / urban-rail overlays from OpenStreetMap (Overpass).
 * ODbL — attribution via existing OSM map credit.
 *
 *   npx tsx scripts/generate-subway-overlay.ts
 *
 * Writes:
 *   public/map-overlay/subway.json
 *   public/map-overlay/subway.meta.json
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lookupOfficialColour } from "./subwayColourLut";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/map-overlay");
const OUT_JSON = path.join(OUT_DIR, "subway.json");
const OUT_META = path.join(OUT_DIR, "subway.meta.json");

const BBOX = "33.0,124.5,39.2,132.0"; // south,west,north,east
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "PindMapSubwayOverlay/1.0 (https://pindmap.com; map style research)";

type OsmNode = { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> };
type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };
type OsmRel = {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members: Array<{ type: string; ref: number; role: string }>;
};
type OsmEl = OsmNode | OsmWay | OsmRel;

type LineProps = {
  kind: "line";
  name: string;
  ref: string;
  colour: string;
  network: string;
  route: string;
  city: string;
};
type StationProps = {
  kind: "station";
  name: string;
  colours: string[];
  transfer: 0 | 1;
  city: string;
};
type ExitProps = {
  kind: "exit";
  ref: string;
  name: string;
};

type Fc = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: LineProps | StationProps | ExitProps;
    geometry:
      | { type: "LineString"; coordinates: number[][] }
      | { type: "MultiLineString"; coordinates: number[][][] }
      | { type: "Point"; coordinates: number[] };
  }>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function overpass(query: string): Promise<OsmEl[]> {
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
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
        }
        const json = (await res.json()) as { elements?: OsmEl[] };
        return json.elements ?? [];
      } catch (e) {
        lastErr = e;
        console.warn(`[overpass] ${url} attempt ${attempt + 1} failed:`, String(e));
        await sleep(2500 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

function koName(tags: Record<string, string> | undefined): string {
  if (!tags) return "";
  return (tags["name:ko"] || tags.name || tags.ref || "").trim();
}

function detectCity(name: string, network: string): string {
  const s = `${name} ${network}`;
  if (/부산|busan|김해/i.test(s)) return "부산";
  if (/대구|daegu/i.test(s)) return "대구";
  if (/대전|daejeon/i.test(s)) return "대전";
  if (/광주|gwangju/i.test(s) && !/경기도/.test(s)) return "광주";
  if (/인천|incheon/i.test(s)) return "인천";
  if (/서울|수도권|신분당|경의|수인|분당|경춘|공항|우이|신림|경강|서해|gtx|김포|의정부|용인|everline/i.test(s)) {
    return "서울";
  }
  return "기타";
}

/** Douglas–Peucker simplification in degrees (~8m at Korea lat). */
function simplifyLine(coords: number[][], tol = 0.00007): number[][] {
  if (coords.length <= 3) return coords;
  const sqTol = tol * tol;
  const sqSegDist = (p: number[], a: number[], b: number[]) => {
    let x = a[0]!,
      y = a[1]!;
    let dx = b[0]! - x,
      dy = b[1]! - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0]! - x) * dx + (p[1]! - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0]!;
        y = b[1]!;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0]! - x;
    dy = p[1]! - y;
    return dx * dx + dy * dy;
  };
  const simplify = (pts: number[][]): number[][] => {
    let maxD = 0;
    let idx = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const d = sqSegDist(pts[i]!, pts[0]!, pts[end]!);
      if (d > maxD) {
        idx = i;
        maxD = d;
      }
    }
    if (maxD > sqTol) {
      const left = simplify(pts.slice(0, idx + 1));
      const right = simplify(pts.slice(idx));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0]!, pts[end]!];
  };
  return simplify(coords);
}

function lineLength(coords: number[][]): number {
  let n = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i]![0]! - coords[i - 1]![0]!;
    const dy = coords[i]![1]! - coords[i - 1]![1]!;
    n += Math.hypot(dx, dy);
  }
  return n;
}

function resolveColour(name: string, ref: string, colourTag: string | undefined): string {
  const raw = (colourTag || "").trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.startsWith("#") ? raw : `#${raw}`;
  }
  if (/^#?[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.replace("#", "");
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return lookupOfficialColour(name, ref) || "#666666";
}

function isExcludedNoise(tags: Record<string, string>): boolean {
  const blob = `${tags.name || ""} ${tags.network || ""} ${tags.operator || ""} ${tags["name:en"] || ""}`;
  // Japan / North Korea / tourist / non-metro trains that share the Korea bbox edge cases
  if (
    /福岡|北九州|kitakyushu|fukuoka|筑豊|地下鉄空港線|천리마|만경대|혁신선|대성산|평양|조선민주주의|무궁화|교외선|월미바다|자기부상|셔틀트레인/i.test(
      blob,
    )
  ) {
    return true;
  }
  return false;
}

function isUrbanTrain(tags: Record<string, string>): boolean {
  if (isExcludedNoise(tags)) return false;
  const route = tags.route || "";
  if (route === "subway" || route === "light_rail" || route === "monorail") {
    // keep Korean metro; drop leftover foreign subway in bbox
    const blob = `${tags.name || ""} ${tags.network || ""}`;
    if (/[一-龯ぁ-んァ-ン]/.test(blob) && !/[가-힣]/.test(blob)) return false;
    return true;
  }
  if (route !== "train") return false;
  const blob = `${tags.name || ""} ${tags.network || ""} ${tags.ref || ""} ${tags.operator || ""}`;
  return /경의|수인|분당|경춘|공항철도|arex|공항철도|신분당|동해선|서해선|경강|gtx|김포골드|의정부|에버라인|용인\s*경전철|부산김해|도시철도|광역전철|수도권\s*전철|대경선/i.test(
    blob,
  );
}

async function fetchRouteRelations(): Promise<OsmEl[]> {
  const q = `
[out:json][timeout:240];
(
  relation["type"="route"]["route"="subway"](${BBOX});
  relation["type"="route"]["route"="light_rail"](${BBOX});
  relation["type"="route"]["route"="monorail"](${BBOX});
  relation["type"="route"]["route"="train"]["name"~"경의|수인|분당|경춘|공항|신분당|동해|서해|경강|GTX|김포|의정부|에버라인|용인",i](${BBOX});
  relation["type"="route"]["route"="train"]["network"~"수도권|부산|대구|대전|광주|인천|김해|동해|도시철도",i](${BBOX});
);
out body;
>;
out skel qt;
`;
  console.log("[1/2] Fetching route relations + geometry…");
  return overpass(q);
}

async function fetchEntrances(): Promise<OsmEl[]> {
  const q = `
[out:json][timeout:180];
node["railway"="subway_entrance"]["ref"](${BBOX});
out body;
`;
  console.log("[2/2] Fetching subway entrances with ref…");
  return overpass(q);
}

function buildIndex(elements: OsmEl[]) {
  const nodes = new Map<number, OsmNode>();
  const ways = new Map<number, OsmWay>();
  const rels: OsmRel[] = [];
  for (const el of elements) {
    if (el.type === "node") nodes.set(el.id, el);
    else if (el.type === "way") ways.set(el.id, el);
    else if (el.type === "relation") rels.push(el);
  }
  return { nodes, ways, rels };
}

function wayCoords(way: OsmWay, nodes: Map<number, OsmNode>): number[][] | null {
  const coords: number[][] = [];
  for (const id of way.nodes) {
    const n = nodes.get(id);
    if (!n) continue;
    coords.push([+n.lon.toFixed(6), +n.lat.toFixed(6)]);
  }
  return coords.length >= 2 ? coords : null;
}

function assembleRelationLines(
  rel: OsmRel,
  ways: Map<number, OsmWay>,
  nodes: Map<number, OsmNode>,
): number[][][] {
  const lines: number[][][] = [];
  for (const m of rel.members) {
    if (m.type !== "way") continue;
    // skip platforms / stops geometry
    if (/stop|platform|station/i.test(m.role || "")) continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    const c = wayCoords(w, nodes);
    if (c) lines.push(simplifyLine(c));
  }
  return lines;
}

function relationStationNodes(rel: OsmRel, nodes: Map<number, OsmNode>): OsmNode[] {
  const out: OsmNode[] = [];
  for (const m of rel.members) {
    if (m.type !== "node") continue;
    if (!/stop|station/i.test(m.role || "stop")) continue;
    const n = nodes.get(m.ref);
    if (n) out.push(n);
  }
  return out;
}

function dedupeLines(
  items: Array<{ key: string; props: LineProps; coords: number[][][]; length: number }>,
): Array<{ props: LineProps; coords: number[][][] }> {
  const best = new Map<string, { props: LineProps; coords: number[][][]; length: number }>();
  for (const it of items) {
    const prev = best.get(it.key);
    if (!prev || it.length > prev.length) best.set(it.key, it);
  }
  return [...best.values()].map(({ props, coords }) => ({ props, coords }));
}

function roundPt(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

async function main() {
  const routeEls = await fetchRouteRelations();
  await sleep(1500);
  const entranceEls = await fetchEntrances();

  const { nodes, ways, rels } = buildIndex(routeEls);
  console.log(`Loaded nodes=${nodes.size} ways=${ways.size} rels=${rels.length}`);

  const lineItems: Array<{ key: string; props: LineProps; coords: number[][][]; length: number }> =
    [];
  const stationMap = new Map<
    string,
    { lon: number; lat: number; name: string; colours: Set<string>; city: string }
  >();

  const lineStats: Record<string, string[]> = {};

  for (const rel of rels) {
    const tags = rel.tags || {};
    if (tags.type !== "route") continue;
    if (!isUrbanTrain(tags)) continue;
    // skip route_master
    if (tags.route_master) continue;

    const name = koName(tags) || tags.ref || `route-${rel.id}`;
    const ref = (tags.ref || "").trim();
    const network = (tags.network || "").trim();
    const colour = resolveColour(name, ref, tags.colour || tags.color);
    const city = detectCity(name, network);
    const route = tags.route || "";

    const coords = assembleRelationLines(rel, ways, nodes);
    if (coords.length === 0) continue;
    const length = coords.reduce((s, c) => s + lineLength(c), 0);
    // Collapse inbound/outbound / express variants of the same corridor.
    const canonName = name
      .replace(/:.+$/u, "")
      .replace(/\s*(급행|일반|직통|내선순환|외선순환|내선|외선)\s*$/u, "")
      .trim();
    const key = `${city}|${(ref || canonName).toLowerCase()}|${colour}`;
    lineItems.push({
      key,
      props: {
        kind: "line",
        name: canonName || name,
        ref,
        colour,
        network,
        route,
        city,
      },
      coords,
      length,
    });
    for (const sn of relationStationNodes(rel, nodes)) {
      const sName = koName(sn.tags) || name;
      if (!sName) continue;
      const k = roundPt(sn.lon, sn.lat);
      let row = stationMap.get(k);
      if (!row) {
        row = { lon: sn.lon, lat: sn.lat, name: sName, colours: new Set(), city };
        stationMap.set(k, row);
      }
      row.colours.add(colour);
      if (sName.length > row.name.length) row.name = sName;
    }
  }

  const lines = dedupeLines(lineItems);
  for (const ln of lines) {
    const city = ln.props.city;
    (lineStats[city] ||= []);
    const label = ln.props.ref
      ? `${ln.props.name} (${ln.props.ref})`
      : ln.props.name;
    if (!lineStats[city]!.includes(label)) lineStats[city]!.push(label);
  }

  // Entrances
  const exits: Array<{ lon: number; lat: number; ref: string; name: string }> = [];
  for (const el of entranceEls) {
    if (el.type !== "node") continue;
    const ref = (el.tags?.ref || "").trim();
    if (!ref) continue;
    // keep short exit numbers / letters (skip long descriptions)
    if (ref.length > 6) continue;
    exits.push({
      lon: el.lon,
      lat: el.lat,
      ref,
      name: koName(el.tags),
    });
  }

  const features: Fc["features"] = [];

  for (const ln of lines) {
    const geom =
      ln.coords.length === 1
        ? { type: "LineString" as const, coordinates: ln.coords[0]! }
        : { type: "MultiLineString" as const, coordinates: ln.coords };
    features.push({ type: "Feature", properties: ln.props, geometry: geom });
  }

  for (const st of stationMap.values()) {
    const colours = [...st.colours];
    features.push({
      type: "Feature",
      properties: {
        kind: "station",
        name: st.name,
        colours,
        transfer: colours.length > 1 ? 1 : 0,
        city: st.city,
        // MapLibre data-driven: primary colour
        colour: colours[0] || "#666666",
      } as StationProps & { colour: string },
      geometry: {
        type: "Point",
        coordinates: [+st.lon.toFixed(6), +st.lat.toFixed(6)],
      },
    });
  }

  for (const ex of exits) {
    features.push({
      type: "Feature",
      properties: { kind: "exit", ref: ex.ref, name: ex.name },
      geometry: {
        type: "Point",
        coordinates: [+ex.lon.toFixed(6), +ex.lat.toFixed(6)],
      },
    });
  }

  const fc: Fc = { type: "FeatureCollection", features };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(fc);
  fs.writeFileSync(OUT_JSON, json);

  const gz = zlib.gzipSync(Buffer.from(json));
  const meta = {
    generatedAt: new Date().toISOString(),
    attribution: "© OpenStreetMap contributors (ODbL)",
    counts: {
      lines: lines.length,
      stations: stationMap.size,
      exits: exits.length,
      features: features.length,
    },
    bytes: { json: Buffer.byteLength(json), gzip: gz.length },
    linesByCity: Object.fromEntries(
      Object.entries(lineStats).map(([c, names]) => [c, names.sort()]),
    ),
  };
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "subway.json.gz"), gz);

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(meta, null, 2));
  if (gz.length > 1.5 * 1024 * 1024) {
    console.warn(
      `\nWARNING: gzip ${gz.length} bytes exceeds 1.5MB. Consider dropping exits outside metro cities or heavier simplify.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
