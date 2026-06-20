export type LatLng = { lat: number; lng: number };

export type CourseWalkStep = {
  description: string;
  lat: number;
  lng: number;
  turnType?: number;
  pointType?: string;
};

export type CourseWalkSegment = {
  index: number;
  fromName: string;
  toName: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  distanceM: number;
  timeSec: number;
  path: LatLng[];
  steps: CourseWalkStep[];
};

export type CourseWalkNavigation = {
  segments: CourseWalkSegment[];
  totalDistanceM: number;
  totalTimeSec: number;
  placeCount: number;
  mergedPath: LatLng[];
};

type TmapWalkFeature = {
  geometry?: { type?: string; coordinates?: number[] | number[][] };
  properties?: {
    description?: string;
    distance?: number;
    time?: number;
    turnType?: number;
    pointType?: string;
    totalDistance?: number;
    totalTime?: number;
  };
};

type TmapWalkGeoJson = {
  properties?: { totalDistance?: number; totalTime?: number };
  features?: TmapWalkFeature[];
};

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function estimateWalkTimeSec(distanceM: number): number {
  return Math.max(60, Math.round(distanceM / 1.4));
}

function straightLineSegmentPath(origin: LatLng, destination: LatLng): LatLng[] {
  return [origin, destination];
}

export function parseTmapWalkGeoJsonToPath(data: TmapWalkGeoJson): LatLng[] {
  const path: LatLng[] = [];
  data.features?.forEach((feature) => {
    if (feature.geometry?.type !== "LineString") return;
    const coordinates = feature.geometry.coordinates ?? [];
    if (!Array.isArray(coordinates)) return;
    (coordinates as number[][]).forEach((coord) => {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        path.push({ lat, lng });
      }
    });
  });
  return path;
}

export function parseTmapWalkGeoJsonToSegment(
  data: TmapWalkGeoJson,
  origin: LatLng,
  destination: LatLng,
  fromName: string,
  toName: string,
  index: number,
): CourseWalkSegment {
  const path = parseTmapWalkGeoJsonToPath(data);
  const fallbackPath = path.length >= 2 ? path : straightLineSegmentPath(origin, destination);
  const steps: CourseWalkStep[] = [];

  data.features?.forEach((feature) => {
    if (feature.geometry?.type !== "Point") return;
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const props = feature.properties ?? {};
    const description = String(props.description ?? "").trim();
    if (!description) return;
    steps.push({
      description,
      lat,
      lng,
      turnType: Number.isFinite(Number(props.turnType)) ? Number(props.turnType) : undefined,
      pointType: props.pointType ? String(props.pointType) : undefined,
    });
  });

  if (steps.length === 0) {
    steps.push(
      { description: `${fromName} 출발`, lat: origin.lat, lng: origin.lng, pointType: "SP" },
      { description: `${toName} 도착`, lat: destination.lat, lng: destination.lng, pointType: "EP" },
    );
  }

  const topDistance = Number(data.properties?.totalDistance);
  const topTime = Number(data.properties?.totalTime);
  const distanceM =
    Number.isFinite(topDistance) && topDistance > 0
      ? Math.round(topDistance)
      : Math.round(haversineMeters(origin, destination));
  const timeSec =
    Number.isFinite(topTime) && topTime > 0
      ? Math.round(topTime)
      : estimateWalkTimeSec(distanceM);

  return {
    index,
    fromName,
    toName,
    fromLat: origin.lat,
    fromLng: origin.lng,
    toLat: destination.lat,
    toLng: destination.lng,
    distanceM,
    timeSec,
    path: fallbackPath,
    steps,
  };
}

async function fetchWalkDirectionsSegment(
  origin: LatLng,
  destination: LatLng,
  fromName: string,
  toName: string,
  index: number,
): Promise<CourseWalkSegment> {
  try {
    const res = await fetch("/api/walk-directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination }),
    });
    if (!res.ok) {
      const distanceM = Math.round(haversineMeters(origin, destination));
      return {
        index,
        fromName,
        toName,
        fromLat: origin.lat,
        fromLng: origin.lng,
        toLat: destination.lat,
        toLng: destination.lng,
        distanceM,
        timeSec: estimateWalkTimeSec(distanceM),
        path: straightLineSegmentPath(origin, destination),
        steps: [
          { description: `${fromName} 출발`, lat: origin.lat, lng: origin.lng, pointType: "SP" },
          { description: `${toName} 도착`, lat: destination.lat, lng: destination.lng, pointType: "EP" },
        ],
      };
    }
    const data = (await res.json()) as TmapWalkGeoJson;
    return parseTmapWalkGeoJsonToSegment(data, origin, destination, fromName, toName, index);
  } catch {
    const distanceM = Math.round(haversineMeters(origin, destination));
    return {
      index,
      fromName,
      toName,
      fromLat: origin.lat,
      fromLng: origin.lng,
      toLat: destination.lat,
      toLng: destination.lng,
      distanceM,
      timeSec: estimateWalkTimeSec(distanceM),
      path: straightLineSegmentPath(origin, destination),
      steps: [
        { description: `${fromName} 출발`, lat: origin.lat, lng: origin.lng, pointType: "SP" },
        { description: `${toName} 도착`, lat: destination.lat, lng: destination.lng, pointType: "EP" },
      ],
    };
  }
}

/** 코스 장소 순서대로 Tmap 보행 경로 + 구간별 안내 데이터 생성 */
export async function buildCourseWalkNavigationFromTmap(
  stops: LatLng[],
  stopNames: string[],
): Promise<CourseWalkNavigation> {
  if (stops.length < 2) {
    return {
      segments: [],
      totalDistanceM: 0,
      totalTimeSec: 0,
      placeCount: stops.length,
      mergedPath: stops,
    };
  }

  const segmentResults = await Promise.all(
    Array.from({ length: stops.length - 1 }, (_, i) =>
      fetchWalkDirectionsSegment(
        stops[i]!,
        stops[i + 1]!,
        stopNames[i] ?? `장소 ${i + 1}`,
        stopNames[i + 1] ?? `장소 ${i + 2}`,
        i,
      ),
    ),
  );

  const merged: LatLng[] = [];
  for (const segment of segmentResults) {
    if (merged.length === 0) merged.push(...segment.path);
    else merged.push(...segment.path.slice(1));
  }

  const totalDistanceM = segmentResults.reduce((sum, seg) => sum + seg.distanceM, 0);
  const totalTimeSec = segmentResults.reduce((sum, seg) => sum + seg.timeSec, 0);

  return {
    segments: segmentResults,
    totalDistanceM,
    totalTimeSec,
    placeCount: stops.length,
    mergedPath: merged.length >= 2 ? merged : stops,
  };
}

/** @deprecated path-only — use buildCourseWalkNavigationFromTmap */
export async function buildCourseWalkPathFromTmap(stops: LatLng[]): Promise<LatLng[]> {
  const names = stops.map((_, i) => `장소 ${i + 1}`);
  const nav = await buildCourseWalkNavigationFromTmap(stops, names);
  return nav.mergedPath;
}

export function formatWalkDuration(totalSec: number): string {
  const minutes = Math.max(1, Math.round(totalSec / 60));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}시간 ${rem}분` : `${hours}시간`;
}

export function formatWalkDistance(totalM: number): string {
  if (totalM >= 1000) {
    const km = totalM / 1000;
    return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
  }
  return `${Math.round(totalM)} m`;
}

export function formatSegmentLabel(segment: CourseWalkSegment): string {
  return `${segment.index + 1}. ${segment.fromName} → ${segment.index + 2}. ${segment.toName} (도보 ${formatWalkDuration(segment.timeSec)}·${formatWalkDistance(segment.distanceM)})`;
}
