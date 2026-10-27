/**
 * Enrich public/map/korea-station-labels.geojson with primary `ref` + colour
 * from nearby subway overlay lines (OSM colour / Seoul standard fallback).
 * Also writes lib/mapSurface/subwayBadgeColours.generated.ts for badge SVGs.
 * No coordinates printed.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LABELS = path.join(ROOT, "public/map/korea-station-labels.geojson");
const OVERLAY = path.join(ROOT, "public/map-overlay/subway.json");
const GEN = path.join(ROOT, "lib/mapSurface/subwayBadgeColours.generated.ts");

/** Mirrors lib/mapSurface/subwayColour.ts */
const SEOUL_SUBWAY_REF_COLOURS = {
  "1": "#0052A4",
  "2": "#00A84D",
  "3": "#EF7C1C",
  "4": "#00A5DE",
  "5": "#996CAC",
  "6": "#CD7C2F",
  "7": "#747F00",
  "8": "#E6186C",
  "9": "#BDB092",
  BGL: "#77C4A3",
  "수인·분당": "#FABE00",
  수인분당: "#FABE00",
  분당: "#FABE00",
  공항철도: "#0090D2",
  A: "#0090D2",
  AREX: "#0090D2",
  "경의·중앙": "#77C4A3",
  경의중앙: "#77C4A3",
  신분당: "#D4003B",
  경강: "#003DA5",
  서해: "#8FC31F",
  신림: "#6789CA",
  김포: "#A9022D",
  용인: "#56AD2D",
  의정부: "#FDA600",
  경춘: "#0C8E72",
  동해: "#003DA5",
  I2: "#FFCD12",
  U: "#FFCD12",
  W: "#33A23D",
};

function normalizeHex(h) {
  if (!h || typeof h !== "string") return "";
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h.trim());
  return m ? `#${m[1].toUpperCase()}` : "";
}

/** Squared distance from point to segment (lon/lat degrees, local planar). */
function dist2PointSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) {
    const ex = px - x1;
    const ey = py - y1;
    return ex * ex + ey * ey;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  const ex = px - qx;
  const ey = py - qy;
  return ex * ex + ey * ey;
}

/** ~450m at Korea latitude — station labels can sit off the drawn centreline. */
const NEAR_M = 450;
const NEAR_DEG = NEAR_M / 111320;
const NEAR2 = NEAR_DEG * NEAR_DEG;

function minDist2ToLine(lon, lat, coords) {
  const rings = Array.isArray(coords[0]?.[0]) ? coords : [coords];
  let best = Infinity;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if (
        typeof x1 !== "number" ||
        typeof y1 !== "number" ||
        typeof x2 !== "number" ||
        typeof y2 !== "number"
      ) {
        continue;
      }
      best = Math.min(best, dist2PointSeg(lon, lat, x1, y1, x2, y2));
      if (best <= NEAR2) return best;
    }
  }
  return best;
}

function refFromLineName(name, ref) {
  const r = (ref || "").trim();
  if (r) return r;
  const m = String(name || "").match(/(\d)\s*호선/);
  if (m) return m[1];
  if (/신분당/.test(name)) return "신분당";
  if (/공항|AREX/i.test(name)) return "공항철도";
  if (/경의|중앙/.test(name)) return "경의·중앙";
  if (/수인|분당/.test(name)) return "수인·분당";
  if (/신림/.test(name)) return "신림";
  if (/경춘/.test(name)) return "경춘";
  if (/경강/.test(name)) return "경강";
  if (/서해/.test(name)) return "서해";
  if (/우이/.test(name)) return "BGL";
  if (/김포/.test(name)) return "김포";
  return "";
}

function colourForRef(ref, osmColour) {
  const osm = normalizeHex(osmColour);
  if (osm) return osm;
  return SEOUL_SUBWAY_REF_COLOURS[ref] || "#5A6570";
}

const labels = JSON.parse(fs.readFileSync(LABELS, "utf8"));
const overlay = JSON.parse(fs.readFileSync(OVERLAY, "utf8"));
const lines = overlay.features.filter((f) => f.properties?.kind === "line");

/** ref → preferred colour (first OSM wins, else Seoul). */
const badgeColours = { ...SEOUL_SUBWAY_REF_COLOURS };

let withRef = 0;
for (const f of labels.features) {
  const [lon, lat] = f.geometry.coordinates;
  const hits = [];
  for (const ln of lines) {
    const g = ln.geometry;
    if (!g?.coordinates) continue;
    const d2 = minDist2ToLine(lon, lat, g.coordinates);
    if (d2 > NEAR2) continue;
    const ref = refFromLineName(ln.properties.name, ln.properties.ref);
    if (!ref) continue;
    const colour = colourForRef(ref, ln.properties.colour);
    const osm = normalizeHex(ln.properties.colour);
    if (osm && !normalizeHex(badgeColours[ref])) {
      badgeColours[ref] = osm;
    } else if (osm && SEOUL_SUBWAY_REF_COLOURS[ref] === badgeColours[ref]) {
      // Prefer OSM over Seoul default when we see it
      badgeColours[ref] = osm;
    }
    hits.push({ ref, colour, d2 });
  }
  const byRef = new Map();
  for (const h of hits) {
    const prev = byRef.get(h.ref);
    if (!prev || h.d2 < prev.d2) byRef.set(h.ref, h);
  }
  const list = [...byRef.values()].sort((a, b) => {
    const an = /^[1-9]$/.test(a.ref) ? 0 : 1;
    const bn = /^[1-9]$/.test(b.ref) ? 0 : 1;
    if (an !== bn) return an - bn;
    if (a.d2 !== b.d2) return a.d2 - b.d2;
    return a.ref.localeCompare(b.ref, "ko");
  });
  const primary = list[0];
  if (primary) {
    withRef += 1;
    f.properties.ref = primary.ref;
    f.properties.colour = primary.colour;
    f.properties.colours = list.map((x) => x.colour).slice(0, 6);
    f.properties.refs = list.map((x) => x.ref).slice(0, 6);
    f.properties.transfer = list.length > 1 ? 1 : f.properties.transfer || 0;
  } else {
    f.properties.ref = f.properties.ref || "";
    if (!f.properties.colour) f.properties.colour = "#5A6570";
  }
}

fs.writeFileSync(LABELS, JSON.stringify(labels));

const genBody = `/* AUTO-GENERATED by scripts/enrich-station-label-refs.mjs — do not edit */
export const SUBWAY_BADGE_COLOURS: Record<string, string> = ${JSON.stringify(
  badgeColours,
  null,
  2,
)};
`;
fs.writeFileSync(GEN, genBody);

const meta = {
  stations: labels.features.length,
  withRef,
  sampleRefs: labels.features
    .filter((f) => /망원|홍대|합정|공덕|강남|신촌|상수/.test(f.properties.name))
    .map((f) => ({
      name: f.properties.name,
      ref: f.properties.ref,
      refs: f.properties.refs,
      colour: f.properties.colour,
    })),
};
fs.writeFileSync(
  path.join(ROOT, "public/map/korea-station-labels.meta.json"),
  JSON.stringify(meta, null, 2),
);
console.log(JSON.stringify(meta, null, 2));
