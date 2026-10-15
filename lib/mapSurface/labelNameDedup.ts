/**
 * Cross-label-source dedupe helpers.
 * MapLibre cannot spatialize across sources — we keep longer names in GeoJSON
 * and expand an OMT name blocklist with shorter inclusion variants.
 */

export function normalizeLabelName(s: string): string {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .toLowerCase();
}

/** True when one normalized name contains the other (len ≥ 3). */
export function namesInclusionSimilar(a: string, b: string): boolean {
  const na = normalizeLabelName(a);
  const nb = normalizeLabelName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

export function haversineMeters(
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

export type NamedPoint = {
  name: string;
  lng: number;
  lat: number;
};

/**
 * Within radiusM, if names are inclusion-similar, keep the longer display name.
 */
export function dedupeNamedPointsByInclusion<T extends NamedPoint>(
  items: readonly T[],
  radiusM = 300,
): T[] {
  const sorted = [...items].sort(
    (a, b) => normalizeLabelName(b.name).length - normalizeLabelName(a.name).length,
  );
  const kept: T[] = [];
  for (const item of sorted) {
    const clash = kept.some((k) => {
      if (!namesInclusionSimilar(item.name, k.name)) return false;
      return haversineMeters(item.lng, item.lat, k.lng, k.lat) <= radiusM;
    });
    if (!clash) kept.push(item);
  }
  return kept;
}

/**
 * Expand a display name into OMT blocklist variants (exact + shorter forms).
 * e.g. "서울동교초등학교" → also "동교초등학교"
 */
export function labelNameBlocklistVariants(name0: string): string[] {
  const name = String(name0 || "").trim();
  if (!name) return [];
  const out = new Set<string>([name]);
  const parenStripped = name
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s*（[^）]*）\s*/g, "")
    .trim();
  if (parenStripped) out.add(parenStripped);

  const dropPrefixes = [
    /^서울특별시/,
    /^서울/,
    /^부산광역시/,
    /^부산/,
    /^대구광역시/,
    /^인천광역시/,
    /^광주광역시/,
    /^대전광역시/,
    /^울산광역시/,
    /^세종특별자치시/,
    /^제주특별자치도/,
    /^[가-힣]{1,4}(?:특별시|광역시|특별자치시|특별자치도|도)/,
    /^[가-힣]{1,3}시/,
    /^[가-힣]{1,3}군/,
    /^[가-힣]{1,3}구/,
  ];
  let cur = parenStripped || name;
  for (const re of dropPrefixes) {
    const next = cur.replace(re, "").trim();
    if (next && next !== cur && next.length >= 3) {
      out.add(next);
      cur = next;
    }
  }
  return [...out];
}
