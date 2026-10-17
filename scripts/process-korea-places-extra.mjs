/**
 * Stream osmium GeoJSONSeq (one Feature per line) into tippecanoe-ready
 * GeoJSONSeq layers: apt_complex + named_building.
 *
 * Keeps only clustering aggregates in memory — never loads the full export.
 *
 * Usage:
 *   osmium export … -f geojsonseq | node --max-old-space-size=4096 \
 *     scripts/process-korea-places-extra.mjs \
 *     --in - \
 *     --landmarks public/map/korea-landmarks.geojson \
 *     --out-dir build/tiles/places-extra
 *
 *   # or from a .geojsonseq file:
 *   node … --in raw.geojsonseq --out-dir …
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
const LANDMARKS = arg("--landmarks", "public/map/korea-landmarks.geojson");
if (!IN) {
  console.error("Missing --in geojsonseq (file path or - for stdin)");
  process.exit(1);
}

const APT_KW =
  /아파트|빌라|타워|오피스텔|푸르지오|래미안|자이|아이파크|e편한세상|힐스테이트|롯데캐슬|더샵|센트레빌|주공|맨션|단지|파크|캐슬|위브|휴먼시아/;
/** Trailing unit markers: "101동", "A동", "제1동" */
const DONG_SUFFIX = /(?:\s*(?:제\s*)?[0-9０-９]{1,4}\s*동|\s*[A-Za-z]\s*동)\s*$/u;
const DEDUP_M = 300;
const COMPLEX_CLUSTER_M = 180;
/** Absolute footprint (m²) — neighborhood-scale complexes beat shops in style. */
const LARGE_AREA_M2 = 2000;

function nameOf(p) {
  if (!p) return null;
  const n = p["name:ko"] || p.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

function stripDong(n) {
  return n.replace(DONG_SUFFIX, "").replace(/\s+/g, " ").trim();
}

/**
 * Drop labels that are only a unit / dong number:
 * "101", "102동", "제1동", "A동", "제 A동"
 */
function isBareUnitName(name) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n) return true;
  if (/^[0-9０-９]{1,5}$/u.test(n)) return true;
  if (/^(?:제\s*)?[0-9０-９]{1,4}\s*동$/u.test(n)) return true;
  if (/^(?:제\s*)?[A-Za-z]\s*동$/u.test(n)) return true;
  const stripped = stripDong(n);
  if (!stripped) return true;
  if (/^[0-9０-９]{1,5}$/u.test(stripped)) return true;
  if (/^[A-Za-z]$/u.test(stripped)) return true;
  return false;
}

/** Approximate polygon area in m² (equirectangular). */
function ringAreaM2(coords) {
  if (!coords || coords.length < 3) return 0;
  const R = 6371000;
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

function centroid(geom) {
  if (!geom) return null;
  if (geom.type === "Point") return geom.coordinates;
  let ring = null;
  if (geom.type === "Polygon") ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0]?.[0];
  if (!ring || !ring.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    n++;
  }
  if (!n) return null;
  return [sx / n, sy / n];
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

function loadLandmarks(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (j.features || [])
      .map((f) => {
        const name = nameOf(f.properties);
        const c = f.geometry?.type === "Point" ? f.geometry.coordinates : null;
        return name && c ? { name, c } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function openInput(inPath) {
  if (inPath === "-") return process.stdin;
  return fs.createReadStream(inPath, { encoding: "utf8" });
}

/** @param {string} line */
function parseFeatureLine(line) {
  // osmium -f geojsonseq uses RFC 8142: RS (0x1E) + JSON + LF
  let t = line.trim();
  if (!t) return null;
  if (t.charCodeAt(0) === 0x1e) t = t.slice(1).trim();
  if (!t || t[0] !== "{") return null;
  try {
    const obj = JSON.parse(t);
    if (obj.type === "Feature") return obj;
    // Rare: FeatureCollection line — ignore (we expect seq)
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<{name:string, base:string, c:number[], area:number, levels:number, kind:string}[]>}
 */
async function collectCandidates(stream) {
  /** @type {{name:string, base:string, c:number[], area:number, levels:number, kind:string}[]} */
  const candidates = [];
  let inputFeatures = 0;
  let lines = 0;
  let excludedUnitNames = 0;

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    const f = parseFeatureLine(line);
    if (!f) continue;
    inputFeatures++;
    const p = f.properties || {};
    const name = nameOf(p);
    if (!name) continue;
    if (isBareUnitName(name)) {
      excludedUnitNames++;
      continue;
    }
    const c = centroid(f.geometry);
    if (!c) continue;
    const area = geomAreaM2(f.geometry);
    const levels = Number(p["building:levels"] || p.levels || 0) || 0;
    const landuseRes = p.landuse === "residential";
    const bApt = p.building === "apartments" || p.building === "residential";
    const bAny = !!p.building && p.building !== "no";
    const base = stripDong(name);
    if (!base || isBareUnitName(base)) {
      excludedUnitNames++;
      continue;
    }
    if (landuseRes) {
      candidates.push({
        name: base,
        base,
        c,
        area: Math.max(area, 500),
        levels,
        kind: "complex",
      });
    } else if (bApt || (bAny && APT_KW.test(name))) {
      candidates.push({
        name: base,
        base,
        c,
        area: Math.max(area, 50),
        levels,
        kind: bApt || APT_KW.test(name) ? "complex_or_apt" : "building",
      });
    } else if (bAny) {
      candidates.push({
        name: base,
        base,
        c,
        area: Math.max(area, 20),
        levels,
        kind: "building",
      });
    }
    if (lines % 500000 === 0) {
      console.error(
        `… scanned ${lines} lines, features=${inputFeatures}, candidates=${candidates.length}, excluded_unit=${excludedUnitNames}`,
      );
    }
  }

  return { candidates, inputFeatures, lines, excludedUnitNames };
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

async function main() {
  const landmarks = loadLandmarks(LANDMARKS);
  const t0 = Date.now();
  console.error(`Reading GeoJSONSeq from ${IN === "-" ? "stdin" : IN}…`);
  const { candidates, inputFeatures, lines, excludedUnitNames } =
    await collectCandidates(openInput(IN));
  console.error(
    `Scan done in ${((Date.now() - t0) / 1000).toFixed(1)}s: lines=${lines} features=${inputFeatures} candidates=${candidates.length} excluded_unit=${excludedUnitNames}`,
  );

  // Cluster complex-like features by stripped base name within COMPLEX_CLUSTER_M.
  // Bucket by base first so clustering is O(sum n_base²) not O(N²) nationwide.
  const complexPool = candidates.filter(
    (x) => x.kind === "complex" || x.kind === "complex_or_apt",
  );
  /** @type {Map<string, typeof candidates>} */
  const byBase = new Map();
  for (const x of complexPool) {
    const list = byBase.get(x.base);
    if (list) list.push(x);
    else byBase.set(x.base, [x]);
  }

  /** @type {typeof candidates} */
  const complexes = [];
  for (const [, pool] of byBase) {
    pool.sort((a, b) => b.area - a.area);
    const used = new Array(pool.length).fill(false);
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const seed = pool[i];
      const group = [seed];
      used[i] = true;
      for (let j = i + 1; j < pool.length; j++) {
        if (used[j]) continue;
        const o = pool[j];
        if (haversineM(seed.c, o.c) > COMPLEX_CLUSTER_M) continue;
        used[j] = true;
        group.push(o);
      }
      const area = group.reduce((s, g) => s + g.area, 0);
      const levels = Math.max(...group.map((g) => g.levels));
      complexes.push({
        name: seed.base,
        base: seed.base,
        c: seed.c,
        area,
        levels,
        kind: "complex",
      });
    }
  }

  function nearLandmark(name, c) {
    for (const lm of landmarks) {
      if (lm.name !== name) continue;
      if (haversineM(lm.c, c) <= DEDUP_M) return true;
    }
    return false;
  }

  const aptFeatures = [];
  let excludedAptUnit = 0;
  for (const x of complexes) {
    if (nearLandmark(x.name, x.c)) continue;
    if (x.name.length < 2 || isBareUnitName(x.name)) {
      excludedAptUnit++;
      continue;
    }
    const rank = Math.max(
      1,
      Math.min(99, Math.round(1000000 / Math.max(x.area, 1))),
    );
    aptFeatures.push({
      type: "Feature",
      properties: {
        name: x.name,
        area_m2: Math.round(x.area),
        levels: x.levels,
        rank,
        kind: "apt_complex",
        size_class: "small",
      },
      geometry: { type: "Point", coordinates: x.c },
    });
  }
  aptFeatures.sort(
    (a, b) => (b.properties.area_m2 || 0) - (a.properties.area_m2 || 0),
  );
  let aptLarge = 0;
  aptFeatures.forEach((f, i) => {
    f.properties.rank = Math.min(
      99,
      1 + Math.floor((i / Math.max(1, aptFeatures.length)) * 80),
    );
    const large = f.properties.area_m2 >= LARGE_AREA_M2;
    f.properties.size_class = large ? "large" : "small";
    if (large) aptLarge++;
  });

  const buildingPool = candidates.filter((x) => x.kind === "building");
  const namedBuilding = [];
  let excludedBldUnit = 0;
  for (const x of buildingPool) {
    if (isBareUnitName(x.name)) {
      excludedBldUnit++;
      continue;
    }
    if (nearLandmark(x.name, x.c)) continue;
    let nearComplex = false;
    for (const cx of complexes) {
      if (
        haversineM(cx.c, x.c) < 80 &&
        (cx.base === x.base || x.name.includes(cx.base))
      ) {
        nearComplex = true;
        break;
      }
    }
    if (nearComplex) continue;
    if (x.area < 400 && x.levels < 5) continue;
    namedBuilding.push({
      type: "Feature",
      properties: {
        name: x.name,
        area_m2: Math.round(x.area),
        levels: x.levels,
        rank: Math.max(1, Math.min(99, Math.round(50000 / Math.max(x.area, 1)))),
        kind: "named_building",
      },
      geometry: { type: "Point", coordinates: x.c },
    });
  }
  namedBuilding.sort(
    (a, b) =>
      (b.properties.levels || 0) * 1000 +
      (b.properties.area_m2 || 0) -
      ((a.properties.levels || 0) * 1000 + (a.properties.area_m2 || 0)),
  );
  namedBuilding.forEach((f, i) => {
    f.properties.rank = Math.min(
      99,
      1 + Math.floor((i / Math.max(1, namedBuilding.length)) * 80),
    );
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const aptPath = path.join(OUT_DIR, "apt_complex.geojsonseq");
  const bldPath = path.join(OUT_DIR, "named_building.geojsonseq");
  writeGeoJSONSeq(aptPath, aptFeatures);
  writeGeoJSONSeq(bldPath, namedBuilding);

  const excluded_unit_names =
    excludedUnitNames + excludedAptUnit + excludedBldUnit;
  const summary = {
    input_features: inputFeatures,
    input_lines: lines,
    candidates: candidates.length,
    apt_complex: aptFeatures.length,
    apt_complex_large: aptLarge,
    apt_complex_small: aptFeatures.length - aptLarge,
    named_building: namedBuilding.length,
    excluded_unit_names,
    landmarks_ref: landmarks.length,
    elapsed_ms: Date.now() - t0,
    samples_apt: aptFeatures.slice(0, 12).map((f) => f.properties.name),
    samples_bld: namedBuilding.slice(0, 12).map((f) => f.properties.name),
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
