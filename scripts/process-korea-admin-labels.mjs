/**
 * Stream osmium GeoJSONSeq of OSM administrative boundaries into tippecanoe
 * GeoJSONSeq layers: admin_dong (admin_level=8) + admin_sigungu (6|7).
 *
 * Label point = pole of inaccessibility (polylabel) so the point stays inside
 * the polygon; MultiPolygon uses the largest ring.
 *
 * Usage:
 *   osmium export … -f geojsonseq | node scripts/process-korea-admin-labels.mjs \
 *     --in - --out-dir build/tiles/places-extra-work/layers
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const IN = arg("--in");
const OUT_DIR = arg("--out-dir", "build/tiles/places-extra");
if (!IN) {
  console.error("Missing --in geojsonseq (file path or - for stdin)");
  process.exit(1);
}

const DONG_DEDUP_M = 700;
const SIGUNGU_DEDUP_M = 2500;

function nameOf(p) {
  if (!p) return null;
  const n = p["name:ko"] || p.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

function adminLevelOf(p) {
  const raw = p?.admin_level;
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/** Approx polygon area m² (equirectangular). */
function ringAreaM2(coords) {
  if (!coords || coords.length < 3) return 0;
  let lat0 = 0;
  for (const c of coords) lat0 += c[1];
  lat0 /= coords.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const X1 = x1 * cos * 111320;
    const Y1 = y1 * 110540;
    const X2 = x2 * cos * 111320;
    const Y2 = y2 * 110540;
    a += X1 * Y2 - X2 * Y1;
  }
  return Math.abs(a) / 2;
}

function largestOuterRing(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon") return geom.coordinates?.[0] || null;
  if (geom.type === "MultiPolygon") {
    let best = null;
    let bestA = 0;
    for (const poly of geom.coordinates || []) {
      const ring = poly?.[0];
      if (!ring) continue;
      const a = ringAreaM2(ring);
      if (a > bestA) {
        bestA = a;
        best = ring;
      }
    }
    return best;
  }
  return null;
}

function geomAreaM2(geom) {
  if (!geom) return 0;
  if (geom.type === "Polygon") return ringAreaM2(geom.coordinates[0] || []);
  if (geom.type === "MultiPolygon") {
    let s = 0;
    for (const poly of geom.coordinates) s += ringAreaM2(poly[0] || []);
    return s;
  }
  return 0;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Minimal Mapbox polylabel (pole of inaccessibility). Ring = [[lng,lat],…]. */
function polylabel(ring, precision = 0.00008) {
  if (!ring || ring.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  const cellSize = Math.min(width, height);
  let h = cellSize / 2;

  const getCentroidCell = () => {
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i];
      const b = ring[j];
      const f = a[0] * b[1] - b[0] * a[1];
      x += (a[0] + b[0]) * f;
      y += (a[1] + b[1]) * f;
      area += f * 3;
    }
    if (Math.abs(area) < 1e-18) {
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, d: 0, h: 0 };
    }
    const cx = x / area;
    const cy = y / area;
    return {
      x: cx,
      y: cy,
      d: pointToPolygonDist(cx, cy, ring),
      h: 0,
    };
  };

  const cellQueue = [];
  const enqueue = (cell) => {
    // Max-heap by potential (d + h)
    cellQueue.push(cell);
    let i = cellQueue.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cellQueue[p].max >= cellQueue[i].max) break;
      const t = cellQueue[p];
      cellQueue[p] = cellQueue[i];
      cellQueue[i] = t;
      i = p;
    }
  };
  const dequeue = () => {
    const top = cellQueue[0];
    const last = cellQueue.pop();
    if (!cellQueue.length) return top;
    cellQueue[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let largest = i;
      if (l < cellQueue.length && cellQueue[l].max > cellQueue[largest].max) {
        largest = l;
      }
      if (r < cellQueue.length && cellQueue[r].max > cellQueue[largest].max) {
        largest = r;
      }
      if (largest === i) break;
      const t = cellQueue[i];
      cellQueue[i] = cellQueue[largest];
      cellQueue[largest] = t;
      i = largest;
    }
    return top;
  };

  const makeCell = (x, y, h) => {
    const d = pointToPolygonDist(x, y, ring);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };

  let bestCell = getCentroidCell();
  const bboxCell = makeCell(minX + width / 2, minY + height / 2, 0);
  if (bboxCell.d > bestCell.d) bestCell = bboxCell;

  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      enqueue(makeCell(x + h, y + h, h));
    }
  }

  while (cellQueue.length) {
    const cell = dequeue();
    if (cell.d > bestCell.d) bestCell = cell;
    if (cell.max - bestCell.d <= precision) continue;
    h = cell.h / 2;
    enqueue(makeCell(cell.x - h, cell.y - h, h));
    enqueue(makeCell(cell.x + h, cell.y - h, h));
    enqueue(makeCell(cell.x - h, cell.y + h, h));
    enqueue(makeCell(cell.x + h, cell.y + h, h));
  }

  const pt = [bestCell.x, bestCell.y];
  if (!pointInRing(pt, ring)) {
    // Fallback: first interior-ish sample along centroid→bbox center
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (let t = 0; t <= 1; t += 0.05) {
      const qx = bestCell.x + (cx - bestCell.x) * t;
      const qy = bestCell.y + (cy - bestCell.y) * t;
      if (pointInRing([qx, qy], ring)) return [qx, qy];
    }
    for (const [x, y] of ring) {
      if (pointInRing([x, y], ring)) return [x, y];
    }
  }
  return pt;
}

function pointToPolygonDist(x, y, ring) {
  let inside = false;
  let minDistSq = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
    minDistSq = Math.min(minDistSq, segDistSq(x, y, a, b));
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}

function segDistSq(px, py, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function labelPoint(geom) {
  const ring = largestOuterRing(geom);
  if (!ring) {
    if (geom?.type === "Point") return geom.coordinates;
    return null;
  }
  return polylabel(ring);
}

function haversineM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]);
  const dLon = toR(b[0] - a[0]);
  const lat1 = toR(a[1]);
  const lat2 = toR(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function openInput(inPath) {
  if (inPath === "-") return process.stdin;
  return fs.createReadStream(inPath, { encoding: "utf8" });
}

function parseFeatureLine(line) {
  let t = line.trim();
  if (!t) return null;
  if (t.charCodeAt(0) === 0x1e) t = t.slice(1).trim();
  if (!t || t[0] !== "{") return null;
  try {
    const obj = JSON.parse(t);
    return obj?.type === "Feature" ? obj : null;
  } catch {
    return null;
  }
}

function writeGeoJSONSeq(filePath, features) {
  const fd = fs.openSync(filePath, "w");
  try {
    for (const f of features) {
      fs.writeSync(fd, JSON.stringify(f) + "\n");
    }
  } finally {
    fs.closeSync(fd);
  }
}

function dedupeByName(items, distM) {
  /** @type {typeof items} */
  const out = [];
  items.sort((a, b) => b.area - a.area);
  for (const x of items) {
    let near = false;
    for (const y of out) {
      if (y.name !== x.name) continue;
      if (haversineM(x.c, y.c) <= distM) {
        near = true;
        break;
      }
    }
    if (!near) out.push(x);
  }
  return out;
}

async function collect(stream) {
  /** @type {{name:string,c:number[],area:number,level:number,kind:string}[]} */
  const dong = [];
  /** @type {typeof dong} */
  const sigungu = [];
  let lines = 0;
  let features = 0;
  let skipped = 0;

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    const f = parseFeatureLine(line);
    if (!f) continue;
    features++;
    const p = f.properties || {};
    if (p.boundary && p.boundary !== "administrative") {
      skipped++;
      continue;
    }
    const level = adminLevelOf(p);
    if (level !== 6 && level !== 7 && level !== 8) {
      skipped++;
      continue;
    }
    const name = nameOf(p);
    if (!name || name.length < 2) {
      skipped++;
      continue;
    }
    // Skip province-style names that leak into level 6 without 시/군/구/읍/면/동
    const c = labelPoint(f.geometry);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      skipped++;
      continue;
    }
    const area = Math.max(geomAreaM2(f.geometry), 1);
    const row = {
      name,
      c,
      area,
      level,
      kind: level === 8 ? "admin_dong" : "admin_sigungu",
    };
    if (level === 8) dong.push(row);
    else sigungu.push(row);
    if (lines % 200000 === 0) {
      console.error(
        `… admin scan lines=${lines} features=${features} dong=${dong.length} sigungu=${sigungu.length}`,
      );
    }
  }
  return { dong, sigungu, lines, features, skipped };
}

function toFeatures(rows, kind) {
  const sorted = [...rows].sort((a, b) => b.area - a.area);
  return sorted.map((x, i) => {
    const rank = Math.min(
      99,
      1 + Math.floor((i / Math.max(1, sorted.length)) * 80),
    );
    return {
      type: "Feature",
      tippecanoe: {
        minzoom: kind === "admin_sigungu" ? 10 : 13,
        maxzoom: kind === "admin_sigungu" ? 13 : 16,
      },
      properties: {
        name: x.name,
        admin_level: x.level,
        area_m2: Math.round(x.area),
        rank,
        kind,
      },
      geometry: { type: "Point", coordinates: x.c },
    };
  });
}

async function main() {
  const t0 = Date.now();
  console.error(`Reading admin GeoJSONSeq from ${IN === "-" ? "stdin" : IN}…`);
  const { dong, sigungu, lines, features, skipped } = await collect(
    openInput(IN),
  );
  const dongDedup = dedupeByName(dong, DONG_DEDUP_M);
  const sigunguDedup = dedupeByName(sigungu, SIGUNGU_DEDUP_M);
  const dongFeats = toFeatures(dongDedup, "admin_dong");
  const sigunguFeats = toFeatures(sigunguDedup, "admin_sigungu");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeGeoJSONSeq(path.join(OUT_DIR, "admin_dong.geojsonseq"), dongFeats);
  writeGeoJSONSeq(
    path.join(OUT_DIR, "admin_sigungu.geojsonseq"),
    sigunguFeats,
  );

  const summary = {
    input_lines: lines,
    input_features: features,
    skipped,
    admin_dong_raw: dong.length,
    admin_dong: dongFeats.length,
    admin_sigungu_raw: sigungu.length,
    admin_sigungu: sigunguFeats.length,
    elapsed_ms: Date.now() - t0,
    samples_dong: dongFeats.slice(0, 16).map((f) => f.properties.name),
    samples_sigungu: sigunguFeats.slice(0, 16).map((f) => f.properties.name),
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "admin-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
