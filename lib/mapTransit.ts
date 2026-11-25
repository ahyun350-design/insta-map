/**
 * Kakao 대중교통 경로 조회 (publictraffic) — parse + display helpers.
 * Live call only; never store/cache results (Kakao terms).
 */
import { subwayRefColour } from "@/lib/mapSurface/poiCategoryIcons";

export const MAP_TRANSIT_MAX_ROUTES = 5;
export const MAP_TRANSIT_TIMEOUT_MS = 10_000;
export const BUS_LINE_COLOUR = "#1E88E5";
export const WALK_LINE_COLOUR = "#8A939C";

export type TransitStepType = "WALKING" | "BUS" | "SUBWAY";

export type TransitApiStatus =
  | "OK"
  | "NO_RESULTS"
  | "EQUAL_POINTS"
  | "STARTNODES_NULL"
  | "ENDNODES_NULL"
  | "INVALID_REQUEST";

/** Client/server error codes (never raw upstream text). */
export type TransitErrorCode =
  | "unauthorized"
  | "forbidden"
  | "bad_json"
  | "bad_input"
  | "no_key"
  | "fetch_failed"
  | "http_401"
  | "http_403"
  | "http_429"
  | "http_502"
  | "http_503"
  | "http_other"
  | "parse_failed"
  | "too_close"
  | "no_results"
  | TransitApiStatus;

export type TransitVehicle = { type: string; name: string };

export type TransitStop = { name: string };

export type TransitStep = {
  type: TransitStepType;
  timeSec: number;
  distanceM: number;
  guidance: string;
  stops: TransitStop[];
  vehicles: TransitVehicle[];
  /** WGS84 path points as {lat,lng}. */
  path: Array<{ lat: number; lng: number }>;
  colour: string;
};

export type TransitRoute = {
  type: "BUS" | "SUBWAY" | "BUS_AND_SUBWAY" | string;
  totalTimeSec: number;
  transfers: number;
  walkTimeSec: number;
  fareWon: number | null;
  vehicles: TransitVehicle[];
  steps: TransitStep[];
};

export type TransitParseOk = {
  ok: true;
  status: "OK";
  routes: TransitRoute[];
};

export type TransitParseEmpty = {
  ok: false;
  status: Exclude<TransitApiStatus, "OK">;
  error: "no_results" | "too_close" | TransitApiStatus;
  routes: [];
};

export type TransitParseResult = TransitParseOk | TransitParseEmpty;

type KakaoFare = { value?: number; min?: number; max?: number };
type KakaoVehicle = { type?: string; name?: string };
type KakaoStop = { name?: string };
type KakaoStep = {
  properties?: {
    guidance?: string;
    type?: string;
    distance?: number;
    time?: number;
    stops?: KakaoStop[];
    vehicles?: KakaoVehicle[];
  };
  path?: { points?: number[][] };
};
type KakaoRoute = {
  properties?: {
    type?: string;
    totalDistance?: number;
    totalTime?: number;
    transfers?: number;
    fare?: KakaoFare;
  };
  steps?: KakaoStep[];
};
type KakaoPublicTraffic = {
  status?: string;
  properties?: { total?: number };
  routes?: KakaoRoute[];
};

export function mapKakaoHttpError(status: number): TransitErrorCode {
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 429) return "http_429";
  if (status === 502) return "http_502";
  if (status === 503) return "http_503";
  return "http_other";
}

export function mapTransitStatusToError(status: string): TransitParseEmpty["error"] {
  if (status === "EQUAL_POINTS") return "too_close";
  if (status === "NO_RESULTS") return "no_results";
  if (
    status === "STARTNODES_NULL" ||
    status === "ENDNODES_NULL" ||
    status === "INVALID_REQUEST"
  ) {
    return status;
  }
  return "no_results";
}

/** "2호선" / "지하철 2호선" / "신분당선" → subwayRefColour key. */
export function subwayRefFromVehicleName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  let n = raw.replace(/^지하철\s*/u, "").replace(/\s+/g, "");
  const num = n.match(/(\d+)\s*호선/u) || n.match(/^(\d+)$/);
  if (num?.[1]) return num[1];
  n = n.replace(/호선$/u, "").replace(/선$/u, "");
  if (n === "수인분당" || n === "수인·분당") return "수인·분당";
  if (n === "경의중앙" || n === "경의·중앙") return "경의·중앙";
  return n;
}

export function transitStepColour(type: TransitStepType, vehicles: TransitVehicle[]): string {
  if (type === "WALKING") return WALK_LINE_COLOUR;
  if (type === "BUS") return BUS_LINE_COLOUR;
  const ref = subwayRefFromVehicleName(vehicles[0]?.name ?? "");
  return subwayRefColour(ref || null);
}

function asStepType(raw: unknown): TransitStepType | null {
  const t = String(raw ?? "").toUpperCase();
  if (t === "WALKING" || t === "WALK") return "WALKING";
  if (t === "BUS") return "BUS";
  if (t === "SUBWAY") return "SUBWAY";
  return null;
}

/** Korea mainland+islands envelope used to drop 0/NaN/swapped garbage points. */
export function isValidKoreaLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= 33 &&
    lat <= 39.5 &&
    lng >= 124 &&
    lng <= 132.5
  );
}

/**
 * Kakao path pairs are [lng, lat]. If values look swapped ([lat, lng]), correct them.
 * Drops 0 / NaN / non-Korea points so fitBounds cannot zoom to the whole country.
 */
export function normalizeKakaoPathPair(
  a: number,
  b: number,
): { lat: number; lng: number } | null {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  // Preferred: [lng, lat]
  if (isValidKoreaLatLng(y, x)) return { lat: y, lng: x };
  // Swapped: [lat, lng]
  if (isValidKoreaLatLng(x, y)) return { lat: x, lng: y };
  return null;
}

function parsePathPoints(points: unknown): Array<{ lat: number; lng: number }> {
  if (!Array.isArray(points)) return [];
  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const pt = normalizeKakaoPathPair(Number(p[0]), Number(p[1]));
    if (pt) out.push(pt);
  }
  return out;
}

export function distanceMetersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Stop / station display name.
 * - SUBWAY: ensure a single trailing `역` (never `…역역` / `삼각지역.전쟁기념관역`).
 * - BUS / other: keep Kakao name as-is (bus stops often already include `역` mid-string).
 */
export function formatTransitStopLabel(
  name: string,
  mode?: "BUS" | "SUBWAY" | "WALKING" | string,
): string {
  const n = String(name ?? "").trim();
  if (!n) return "";
  if (mode === "BUS" || mode === "WALKING") return n.replace(/역역$/u, "역");
  if (mode === "SUBWAY") {
    if (/\(/u.test(n)) return n.replace(/역역$/u, "역");
    // Already has 역 anywhere (e.g. "삼각지역.전쟁기념관") — do not append another.
    if (/역/u.test(n)) return n.replace(/역역$/u, "역");
    return `${n}역`;
  }
  return n.replace(/역역$/u, "역");
}

function parseStep(raw: KakaoStep): TransitStep | null {
  const type = asStepType(raw.properties?.type);
  if (!type) return null;
  const vehicles: TransitVehicle[] = (raw.properties?.vehicles ?? [])
    .map((v) => ({
      type: String(v.type ?? "").trim(),
      name: String(v.name ?? "").trim(),
    }))
    .filter((v) => v.name);
  const stops: TransitStop[] = (raw.properties?.stops ?? [])
    .map((s) => ({ name: String(s.name ?? "").trim() }))
    .filter((s) => s.name);
  const timeSec = Math.max(0, Math.round(Number(raw.properties?.time) || 0));
  const distanceM = Math.max(0, Math.round(Number(raw.properties?.distance) || 0));
  return {
    type,
    timeSec,
    distanceM,
    guidance: String(raw.properties?.guidance ?? "").trim(),
    stops,
    vehicles,
    path: parsePathPoints(raw.path?.points),
    colour: transitStepColour(type, vehicles),
  };
}

function parseRoute(raw: KakaoRoute): TransitRoute | null {
  const steps = (raw.steps ?? []).map(parseStep).filter((s): s is TransitStep => s != null);
  if (steps.length === 0) return null;
  const totalTimeSec = Math.max(0, Math.round(Number(raw.properties?.totalTime) || 0));
  const transfers = Math.max(0, Math.round(Number(raw.properties?.transfers) || 0));
  const walkTimeSec = steps
    .filter((s) => s.type === "WALKING")
    .reduce((sum, s) => sum + s.timeSec, 0);
  const fareObj = raw.properties?.fare;
  const fareCandidate =
    typeof fareObj?.value === "number" && Number.isFinite(fareObj.value)
      ? fareObj.value
      : typeof fareObj?.min === "number" && Number.isFinite(fareObj.min)
        ? fareObj.min
        : null;
  const fareWon =
    fareCandidate != null && fareCandidate >= 0 ? Math.round(fareCandidate) : null;
  const vehicles: TransitVehicle[] = [];
  for (const s of steps) {
    if (s.type === "WALKING") continue;
    for (const v of s.vehicles) {
      if (!vehicles.some((x) => x.name === v.name && x.type === v.type)) vehicles.push(v);
    }
  }
  return {
    type: String(raw.properties?.type ?? ""),
    totalTimeSec,
    transfers,
    walkTimeSec,
    fareWon,
    vehicles,
    steps,
  };
}

/** Normalize Kakao publictraffic JSON → routes (max 5) or empty/error status. */
export function parseKakaoPublicTraffic(raw: unknown): TransitParseResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: "INVALID_REQUEST", error: "INVALID_REQUEST", routes: [] };
  }
  const data = raw as KakaoPublicTraffic;
  const status = String(data.status ?? "").toUpperCase() as TransitApiStatus | string;
  if (status !== "OK") {
    const st = (
      ["NO_RESULTS", "EQUAL_POINTS", "STARTNODES_NULL", "ENDNODES_NULL", "INVALID_REQUEST"].includes(
        status,
      )
        ? status
        : "NO_RESULTS"
    ) as Exclude<TransitApiStatus, "OK">;
    return { ok: false, status: st, error: mapTransitStatusToError(st), routes: [] };
  }
  const routes = (data.routes ?? [])
    .map(parseRoute)
    .filter((r): r is TransitRoute => r != null)
    .slice(0, MAP_TRANSIT_MAX_ROUTES);
  if (routes.length === 0) {
    return { ok: false, status: "NO_RESULTS", error: "no_results", routes: [] };
  }
  return { ok: true, status: "OK", routes };
}

export function formatTransitMinutes(sec: number): number {
  return Math.max(1, Math.round(sec / 60));
}

/** Step list label: 도보 ○분 / ○호선 ○역 승차 ○정거장 / 하차 … */
export function formatTransitStepLabel(step: TransitStep): string {
  if (step.type === "WALKING") {
    return `도보 ${formatTransitMinutes(step.timeSec)}분`;
  }
  const line = step.vehicles[0]?.name || (step.type === "BUS" ? "버스" : "지하철");
  const board = step.stops[0]?.name || "";
  const alight = step.stops.length > 1 ? step.stops[step.stops.length - 1]!.name : "";
  const hops = Math.max(0, step.stops.length - 1);
  if (step.type === "SUBWAY") {
    const boardPart = board ? ` ${board} 승차` : " 승차";
    const hopPart = hops > 0 ? ` ${hops}정거장` : "";
    const alightPart = alight ? ` → ${alight} 하차` : " → 하차";
    return `${line}${boardPart}${hopPart}${alightPart}`;
  }
  // BUS
  const boardPart = board ? ` ${board} 승차` : " 승차";
  const hopPart = hops > 0 ? ` ${hops}정류장` : "";
  const alightPart = alight ? ` → ${alight} 하차` : " → 하차";
  return `${line}${boardPart}${hopPart}${alightPart}`;
}

export type TransitMapSegment = {
  kind: "walk" | "bus" | "subway";
  colour: string;
  path: Array<{ lat: number; lng: number }>;
};

export type TransitStopMarker = {
  lat: number;
  lng: number;
  colour: string;
  role: "board" | "alight";
};

export type TransitEndpointMarker = {
  lat: number;
  lng: number;
  label: "출발" | "도착";
};

/** Kakao step.path points → map segments (walk dashed / ride solid). */
export function transitRouteToMapSegments(route: TransitRoute): TransitMapSegment[] {
  return route.steps
    .filter((s) => s.path.length >= 2)
    .map((s) => ({
      kind: s.type === "WALKING" ? "walk" : s.type === "BUS" ? "bus" : "subway",
      colour: s.colour,
      path: s.path,
    }));
}

/** Board/alight circles = first & last path point of each bus/subway step. */
export function transitBoardAlightMarkers(route: TransitRoute): TransitStopMarker[] {
  const out: TransitStopMarker[] = [];
  for (const s of route.steps) {
    if (s.type === "WALKING" || s.path.length < 1) continue;
    const first = s.path[0]!;
    const last = s.path[s.path.length - 1]!;
    out.push({ lat: first.lat, lng: first.lng, colour: s.colour, role: "board" });
    if (last.lat !== first.lat || last.lng !== first.lng) {
      out.push({ lat: last.lat, lng: last.lng, colour: s.colour, role: "alight" });
    }
  }
  return out;
}

export function transitRouteEndpoints(route: TransitRoute): {
  start: TransitEndpointMarker;
  end: TransitEndpointMarker;
} | null {
  const segs = transitRouteToMapSegments(route);
  if (segs.length === 0) return null;
  const startPt = segs[0]!.path[0]!;
  const lastSeg = segs[segs.length - 1]!;
  const endPt = lastSeg.path[lastSeg.path.length - 1]!;
  return {
    start: { lat: startPt.lat, lng: startPt.lng, label: "출발" },
    end: { lat: endPt.lat, lng: endPt.lng, label: "도착" },
  };
}

/** Edge inset around the visible map area above the transit panel. */
export const TRANSIT_FIT_EDGE_PAD_PX = 40;

/**
 * fitBounds padding: 40px on all sides of the area above the panel.
 * `panelHeightPx` = measured panel height; bottom = panel + 40.
 * Clamps when map is short so top+bottom padding cannot exceed the map.
 */
export function transitCameraFitPadding(
  panelHeightPx: number,
  mapHeightPx?: number,
): { top: number; right: number; bottom: number; left: number } {
  const edge = TRANSIT_FIT_EDGE_PAD_PX;
  const panel = Math.max(0, Math.round(Number(panelHeightPx) || 0));
  // Panel sits above a ~10px bottom inset (see .transitRoutePanel).
  const sheetBottomGap = 10;
  let bottom = panel + sheetBottomGap + edge;
  if (typeof mapHeightPx === "number" && mapHeightPx > 0) {
    // Only clamp when the map is shorter than panel+edges; leave ≥120px for the route.
    const maxBottom = Math.max(edge, Math.floor(mapHeightPx - edge - 120));
    bottom = Math.min(bottom, maxBottom);
  }
  return { top: edge, right: edge, bottom, left: edge };
}

/**
 * Padding from live map/panel geometry: bottom = mapBottom→panelTop + edge.
 * Prefer this over height-only estimates when both elements are mounted.
 */
export function transitCameraFitPaddingFromRects(
  mapRect: { top: number; bottom: number; height: number },
  panelRect: { top: number },
  /** Search chrome bottom (viewport Y); top pad clears the search bar. */
  searchRect?: { bottom: number } | null,
): { top: number; right: number; bottom: number; left: number } {
  const edge = TRANSIT_FIT_EDGE_PAD_PX;
  const mapH = Math.max(0, Math.round(mapRect.height));
  let top = edge;
  if (searchRect && Number.isFinite(searchRect.bottom)) {
    // Clear the search chrome; small inset (not a full edge) so fit can stay ≥ street zoom.
    top = Math.max(edge, Math.round(searchRect.bottom - mapRect.top + 8));
  }
  let bottom = Math.max(edge, Math.round(mapRect.bottom - panelRect.top + edge));
  if (mapH > 0) {
    const maxBottom = Math.max(edge, Math.floor(mapH - top - 120));
    bottom = Math.min(bottom, maxBottom);
    if (top + bottom > mapH - 120) {
      top = Math.max(edge, Math.min(top, mapH - bottom - 120));
    }
  }
  return { top, right: edge, bottom, left: edge };
}

/** Points used to fit the camera (path + board/alight + endpoints) — Korea-valid only. */
export function transitFitPoints(route: TransitRoute): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = [];
  for (const s of transitRouteToMapSegments(route)) {
    for (const p of s.path) pts.push(p);
  }
  for (const s of transitBoardAlightMarkers(route)) {
    pts.push({ lat: s.lat, lng: s.lng });
  }
  const ends = transitRouteEndpoints(route);
  if (ends) {
    pts.push({ lat: ends.start.lat, lng: ends.start.lng });
    pts.push({ lat: ends.end.lat, lng: ends.end.lng });
  }
  const korea = pts.filter((p) => isValidKoreaLatLng(p.lat, p.lng));
  if (korea.length < 2) return korea;
  // If a bad vertex slipped through the envelope, span explodes and zoom drops
  // country-scale. Fall back to start/end only when span is implausible for a trip.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of korea) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (maxLat - minLat > 1.2 || maxLng - minLng > 1.2) {
    const endsOnly = [
      ends ? { lat: ends.start.lat, lng: ends.start.lng } : null,
      ends ? { lat: ends.end.lat, lng: ends.end.lng } : null,
    ].filter((p): p is { lat: number; lng: number } => !!p && isValidKoreaLatLng(p.lat, p.lng));
    if (endsOnly.length >= 2) return endsOnly;
  }
  return korea;
}

/** Minimum MapLibre zoom after transit fit (street/neighbourhood, not country). */
export const TRANSIT_FIT_MIN_ZOOM = 12;

/**
 * Prepend/append walking legs when Kakao omits origin→first board / last alight→dest.
 * Estimates distance/time from coords (live path not stored).
 */
export function augmentTransitRouteWithEndpointWalks(
  route: TransitRoute,
  opts: {
    origin: { lat: number; lng: number } | null;
    dest: { lat: number; lng: number } | null;
    /** Optional boarding-exit hint for the synthesized first walk (e.g. "1번 출구"). */
    boardExit?: string | null;
  },
): TransitRoute {
  let steps = route.steps.map((s) => ({
    ...s,
    // Keep Kakao polyline vertices as parsed — only drop non-Korea garbage.
    path: s.path.filter((p) => isValidKoreaLatLng(p.lat, p.lng)),
    stops: [...s.stops],
    vehicles: [...s.vehicles],
  }));
  let addedSec = 0;

  const firstPt = steps.find((s) => s.path.length > 0)?.path[0] ?? null;
  const origin = opts.origin && isValidKoreaLatLng(opts.origin.lat, opts.origin.lng) ? opts.origin : null;
  if (origin && firstPt) {
    const d = distanceMetersBetween(origin, firstPt);
    const nearWalk =
      steps[0]?.type === "WALKING" &&
      steps[0].path[0] &&
      distanceMetersBetween(origin, steps[0].path[0]) < 80;
    if (d > 50 && !nearWalk) {
      const firstRide = steps.find((s) => s.type !== "WALKING");
      const boardName = formatTransitStopLabel(
        firstRide?.stops[0]?.name ?? "",
        firstRide?.type,
      );
      const exit =
        (opts.boardExit && String(opts.boardExit).trim()) ||
        extractTransitExitFromGuidance(steps.find((s) => s.type === "WALKING")?.guidance ?? "") ||
        null;
      const timeSec = Math.max(60, Math.round(d / 1.25));
      addedSec += timeSec;
      const exitBit = exit ? ` (${exit})` : "";
      steps = [
        {
          type: "WALKING",
          timeSec,
          distanceM: Math.round(d),
          guidance: boardName
            ? `${boardName}${exitBit}까지 도보로 이동`
            : "출발지까지 도보로 이동",
          stops: boardName
            ? [{ name: "내 위치" }, { name: firstRide?.stops[0]?.name ?? boardName }]
            : [{ name: "내 위치" }],
          vehicles: [],
          path: [origin, firstPt],
          colour: WALK_LINE_COLOUR,
        },
        ...steps,
      ];
    }
  }

  const lastStep = [...steps].reverse().find((s) => s.path.length > 0);
  const lastPt = lastStep?.path[lastStep.path.length - 1] ?? null;
  const dest = opts.dest && isValidKoreaLatLng(opts.dest.lat, opts.dest.lng) ? opts.dest : null;
  if (dest && lastPt) {
    const d = distanceMetersBetween(lastPt, dest);
    const last = steps[steps.length - 1];
    const nearWalk =
      last?.type === "WALKING" &&
      last.path[last.path.length - 1] &&
      distanceMetersBetween(last.path[last.path.length - 1]!, dest) < 80;
    if (d > 50 && !nearWalk) {
      const timeSec = Math.max(60, Math.round(d / 1.25));
      addedSec += timeSec;
      steps = [
        ...steps,
        {
          type: "WALKING",
          timeSec,
          distanceM: Math.round(d),
          guidance: "도착지까지 도보",
          stops: [{ name: "하차" }, { name: "도착" }],
          vehicles: [],
          path: [lastPt, dest],
          colour: WALK_LINE_COLOUR,
        },
      ];
    }
  }

  const walkTimeSec = steps
    .filter((s) => s.type === "WALKING")
    .reduce((sum, s) => sum + s.timeSec, 0);
  return {
    ...route,
    steps,
    walkTimeSec,
    totalTimeSec: Math.max(route.totalTimeSec, route.totalTimeSec + addedSec),
  };
}

export const TRANSIT_NO_RESULTS_MESSAGE =
  "대중교통 경로가 없어요, 도보를 이용해 보세요";

/** Badge text: drop spaces, flatten parentheses — e.g. N15(심야) → N15심야. Never hard-truncate. */
export function formatTransitBadgeName(name: string): string {
  let n = String(name ?? "").trim();
  if (!n) return "";
  n = n.replace(/\(([^)]*)\)/gu, "$1");
  n = n.replace(/\s+/gu, "");
  return n;
}

/** Exit number only appears in Kakao guidance text, e.g. "(9번 출구)". */
export function extractTransitExitFromGuidance(guidance: string): string | null {
  const m = String(guidance ?? "").match(/(\d+)\s*번\s*출구/u);
  return m?.[1] ? `${m[1]}번 출구` : null;
}

/** Subway "방면": next stop name when available (Kakao has no dedicated bound field). */
export function transitStepBoundLabel(step: TransitStep): string | null {
  if (step.type === "WALKING") return null;
  const next = step.stops[1]?.name?.trim();
  return next ? `${next} 방면` : null;
}

export type TransitVehicleGroup = {
  typeLabel: string;
  badges: TransitVehicle[];
  extraCount: number;
  colour: string;
};

/** Prefer 2 badge names + "외 N대" for the rest (same-step alternate lines). */
export function groupTransitVehicles(
  vehicles: TransitVehicle[],
  colour: string,
  maxBadges = 2,
): TransitVehicleGroup {
  const list = vehicles.filter((v) => v.name);
  const badges = list.slice(0, Math.max(0, maxBadges));
  const extraCount = Math.max(0, list.length - badges.length);
  const typeLabel = list[0]?.type?.trim() || "";
  return { typeLabel, badges, extraCount, colour };
}

export type TransitTimelineSeg = {
  kind: "walk" | "bus" | "subway";
  colour: string;
  minutes: number;
  /** 0–1 share of total ride+walk time for bar width. */
  ratio: number;
};

export function transitTimelineSegments(route: TransitRoute): TransitTimelineSeg[] {
  const parts = route.steps
    .map((s) => ({
      kind: (s.type === "WALKING" ? "walk" : s.type === "BUS" ? "bus" : "subway") as
        | "walk"
        | "bus"
        | "subway",
      colour: s.colour,
      minutes: formatTransitMinutes(s.timeSec),
      timeSec: Math.max(1, s.timeSec),
    }))
    .filter((p) => p.minutes > 0);
  const sum = parts.reduce((a, p) => a + p.timeSec, 0) || 1;
  return parts.map(({ kind, colour, minutes, timeSec }) => ({
    kind,
    colour,
    minutes,
    ratio: timeSec / sum,
  }));
}

export function transitDepartureArrivalLabel(
  totalTimeSec: number,
  now: Date = new Date(),
): { depart: string; arrive: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const arrive = new Date(now.getTime() + Math.max(0, totalTimeSec) * 1000);
  return { depart: fmt(now), arrive: fmt(arrive) };
}

export type TransitRideSummaryPart =
  | { kind: "ride"; badge: string; colour: string; board: string; alts?: string; typeLabel?: string }
  | { kind: "alight"; stop: string };

/** List card ride line: [6호선] 망원 → [간선] 정류장 '151·752 외 11대' → 하차 노들섬 */
export function transitRideSummaryParts(route: TransitRoute): TransitRideSummaryPart[] {
  const parts: TransitRideSummaryPart[] = [];
  const rides = route.steps.filter((s) => s.type !== "WALKING");
  rides.forEach((s, i) => {
    const group = groupTransitVehicles(s.vehicles, s.colour, 2);
    const badgeNames = group.badges.map((v) => formatTransitBadgeName(v.name)).filter(Boolean);
    const badge =
      badgeNames[0] || (s.type === "BUS" ? "버스" : "지하철");
    const alts =
      badgeNames.length > 1 || group.extraCount > 0
        ? `${badgeNames.join("·")}${group.extraCount > 0 ? ` 외 ${group.extraCount}대` : ""}`
        : undefined;
    const board = s.stops[0]?.name?.trim() || "";
    parts.push({
      kind: "ride",
      badge,
      colour: s.colour,
      board,
      typeLabel: group.typeLabel || undefined,
      alts,
    });
    if (i === rides.length - 1) {
      const alight = s.stops[s.stops.length - 1]?.name?.trim();
      if (alight) parts.push({ kind: "alight", stop: alight });
    }
  });
  return parts;
}

export type TransitDetailRow =
  | {
      id: string;
      kind: "place";
      role: "origin" | "dest";
      label: string;
      atSec: number;
      emphasis: true;
    }
  | {
      id: string;
      kind: "walk";
      minutes: number;
      distanceM: number;
      exit: string | null;
      toLabel: string;
      /** True when this leg is origin → first board (show "내 위치 → …"). */
      fromOrigin: boolean;
      atSec: number;
      emphasis: false;
      rail: "walk";
    }
  | {
      id: string;
      kind: "board";
      line: string;
      colour: string;
      /** e.g. "망원역 승차" — line name not repeated. */
      stopLabel: string;
      bound: string | null;
      mode: "BUS" | "SUBWAY";
      atSec: number;
      emphasis: true;
      rail: "ride";
    }
  | {
      id: string;
      kind: "ride";
      minutes: number;
      hopCount: number;
      hopLabel: string;
      /** Intermediate stops only (board/alight excluded). */
      middleStops: string[];
      colour: string;
      atSec: number;
      emphasis: false;
      rail: "ride";
    }
  | {
      id: string;
      kind: "alight";
      stopLabel: string;
      colour: string;
      atSec: number;
      emphasis: true;
      rail: "ride";
    };

export function formatClockFromOffset(
  offsetSec: number,
  now: Date = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(now.getTime() + Math.max(0, offsetSec) * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildTransitDetailRows(
  route: TransitRoute,
  opts: { originLabel: string; destLabel: string },
): TransitDetailRow[] {
  const rows: TransitDetailRow[] = [];
  let cursor = 0;
  rows.push({
    id: "origin",
    kind: "place",
    role: "origin",
    label: opts.originLabel,
    atSec: 0,
    emphasis: true,
  });
  route.steps.forEach((s, i) => {
    if (s.type === "WALKING") {
      const nextRide = route.steps.slice(i + 1).find((x) => x.type !== "WALKING");
      const toMode = nextRide?.type === "BUS" ? "BUS" : "SUBWAY";
      const toLabel = formatTransitStopLabel(
        s.stops[s.stops.length - 1]?.name?.trim() || "",
        toMode,
      );
      const fromOrigin =
        s.stops[0]?.name?.trim() === "내 위치" ||
        (i === 0 && s.stops.some((x) => x.name?.trim() === "내 위치"));
      rows.push({
        id: `walk-${i}`,
        kind: "walk",
        minutes: formatTransitMinutes(s.timeSec),
        distanceM: s.distanceM,
        exit: extractTransitExitFromGuidance(s.guidance),
        toLabel,
        fromOrigin,
        atSec: cursor,
        emphasis: false,
        rail: "walk",
      });
      cursor += Math.max(0, s.timeSec);
      return;
    }
    const line = formatTransitBadgeName(
      s.vehicles[0]?.name || (s.type === "BUS" ? "버스" : "지하철"),
    );
    const boardRaw = s.stops[0]?.name?.trim() || "";
    const alightRaw =
      s.stops.length > 1 ? s.stops[s.stops.length - 1]!.name.trim() : "";
    const board = formatTransitStopLabel(boardRaw, s.type);
    const alight = formatTransitStopLabel(alightRaw, s.type);
    const hopCount = Math.max(0, s.stops.length - 1);
    const middleStops = s.stops.slice(1, -1).map((x) => x.name);
    rows.push({
      id: `board-${i}`,
      kind: "board",
      line,
      colour: s.colour,
      stopLabel: board ? `${board} 승차` : "승차",
      bound: transitStepBoundLabel(s),
      mode: s.type,
      atSec: cursor,
      emphasis: true,
      rail: "ride",
    });
    rows.push({
      id: `ride-${i}`,
      kind: "ride",
      minutes: formatTransitMinutes(s.timeSec),
      hopCount,
      hopLabel: s.type === "SUBWAY" ? `${hopCount}개 역` : `${hopCount}개 정류장`,
      middleStops,
      colour: s.colour,
      atSec: cursor,
      emphasis: false,
      rail: "ride",
    });
    cursor += Math.max(0, s.timeSec);
    if (alight) {
      rows.push({
        id: `alight-${i}`,
        kind: "alight",
        stopLabel: `${alight} 하차`,
        colour: s.colour,
        atSec: cursor,
        emphasis: true,
        rail: "ride",
      });
    }
  });
  rows.push({
    id: "dest",
    kind: "place",
    role: "dest",
    label: opts.destLabel,
    atSec: Math.max(cursor, route.totalTimeSec),
    emphasis: true,
  });
  return rows;
}

export type TransitLineLabel = {
  lat: number;
  lng: number;
  text: string;
  colour: string;
};

/** Mid-path labels for ride legs: "6호선 ›". */
export function transitLineLabels(route: TransitRoute): TransitLineLabel[] {
  const out: TransitLineLabel[] = [];
  for (const s of route.steps) {
    if (s.type === "WALKING" || s.path.length < 2) continue;
    const mid = s.path[Math.floor(s.path.length / 2)]!;
    const name = formatTransitBadgeName(
      s.vehicles[0]?.name || (s.type === "BUS" ? "버스" : "지하철"),
    );
    if (!name) continue;
    out.push({ lat: mid.lat, lng: mid.lng, text: `${name} ›`, colour: s.colour });
  }
  return out;
}
