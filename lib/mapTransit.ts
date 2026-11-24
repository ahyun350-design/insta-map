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

function parsePathPoints(points: unknown): Array<{ lat: number; lng: number }> {
  if (!Array.isArray(points)) return [];
  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng });
  }
  return out;
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
  const fareRaw = raw.properties?.fare?.value;
  const fareWon =
    typeof fareRaw === "number" && Number.isFinite(fareRaw) && fareRaw >= 0
      ? Math.round(fareRaw)
      : null;
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

/** Padding so the full path sits above the bottom transit panel (~390×844). */
export function transitCameraFitPadding(panelMaxPx = 360): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  // Top: search + chips; bottom: detail panel (not the full 52vh max).
  const bottom = Math.min(Math.max(panelMaxPx, 280), 380);
  return { top: 140, right: 40, bottom, left: 40 };
}

/** Points used to fit the camera (path + board/alight + endpoints). */
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
  return pts;
}

export const TRANSIT_NO_RESULTS_MESSAGE =
  "대중교통 경로가 없어요, 도보를 이용해 보세요";
