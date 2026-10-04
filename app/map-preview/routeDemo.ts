import maplibregl, {
  type Map as MlMap,
  type GeoJSONSource,
} from "maplibre-gl";
import { MAP_BRAND_NAVY } from "@/lib/mapSurface/mapBrand";
import {
  ROUTE_LAYOUT,
  routePaintForMode,
  type RouteVisualMode,
} from "@/lib/mapSurface/routeStyle";
import { resolvePinColor } from "@/lib/categoryAppearance";
import {
  MAP_FOCUS_PIN_HEIGHT,
  MAP_FOCUS_PIN_ICON_SIZE,
  MAP_FOCUS_PIN_WIDTH,
  clampMapPinDpr,
  focusMarkerSvg,
  loadMapImageFromSvg,
  pinImageKey,
} from "@/lib/mapPinImages";

export type PreviewRouteMode = "walk" | "car" | "course";

/** Fake Seongsu-dong loop for design QA. */
export const SEONGSU_DEMO_PATH: { lat: number; lng: number }[] = [
  { lat: 37.54455, lng: 127.05585 },
  { lat: 37.5452, lng: 127.0534 },
  { lat: 37.5461, lng: 127.0506 },
  { lat: 37.5470, lng: 127.0478 },
  { lat: 37.5478, lng: 127.0452 },
  { lat: 37.5482, lng: 127.0431 },
  { lat: 37.5474, lng: 127.0416 },
];

export const SEONGSU_DEMO_STOPS = [
  {
    id: "c1",
    name: "성수역",
    lat: 37.54455,
    lng: 127.05585,
    order: 1,
  },
  {
    id: "c2",
    name: "연무장길 카페",
    lat: 37.5461,
    lng: 127.0506,
    order: 2,
  },
  {
    id: "c3",
    name: "서울숲",
    lat: 37.5474,
    lng: 127.0416,
    order: 3,
  },
];

const ROUTE_SOURCE = "preview-route";
const ROUTE_CASING = "preview-route-casing";
const ROUTE_LINE = "preview-route-line";
const ORIGIN_SOURCE = "preview-route-origin";
const ORIGIN_SHADOW = "preview-route-origin-shadow";
const ORIGIN_CIRCLE = "preview-route-origin-circle";
const COURSE_SOURCE = "preview-course";
const COURSE_SHADOW = "preview-course-shadow";
const COURSE_CIRCLE = "preview-course-circles";
const COURSE_NUM = "preview-course-numbers";
const COURSE_LABEL = "preview-course-labels";
const FOCUS_SOURCE = "preview-route-focus";
const FOCUS_LAYER = "preview-route-focus-symbol";

function ensureRouteLayers(map: MlMap) {
  if (map.getSource(ROUTE_SOURCE)) return;

  map.addSource(ROUTE_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: ROUTE_CASING,
    type: "line",
    source: ROUTE_SOURCE,
    layout: { ...ROUTE_LAYOUT },
    paint: {
      "line-color": "#FFFFFF",
      "line-width": 7,
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: ROUTE_LINE,
    type: "line",
    source: ROUTE_SOURCE,
    layout: { ...ROUTE_LAYOUT },
    paint: {
      "line-color": MAP_BRAND_NAVY,
      "line-width": 3,
      "line-opacity": 1,
    },
  });

  map.addSource(ORIGIN_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: ORIGIN_SHADOW,
    type: "circle",
    source: ORIGIN_SOURCE,
    paint: {
      "circle-radius": 9,
      "circle-color": "#000000",
      "circle-opacity": 0.18,
      "circle-blur": 0.55,
    },
  });
  map.addLayer({
    id: ORIGIN_CIRCLE,
    type: "circle",
    source: ORIGIN_SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": "#FFFFFF",
      "circle-stroke-width": 3,
      "circle-stroke-color": MAP_BRAND_NAVY,
    },
  });

  map.addSource(COURSE_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: COURSE_SHADOW,
    type: "circle",
    source: COURSE_SOURCE,
    paint: {
      "circle-radius": ["case", ["==", ["get", "selected"], 1], 18, 15],
      "circle-color": "#000000",
      "circle-opacity": 0.16,
      "circle-blur": 0.45,
    },
  });
  map.addLayer({
    id: COURSE_CIRCLE,
    type: "circle",
    source: COURSE_SOURCE,
    paint: {
      "circle-radius": ["case", ["==", ["get", "selected"], 1], 16, 13],
      "circle-color": MAP_BRAND_NAVY,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: COURSE_NUM,
    type: "symbol",
    source: COURSE_SOURCE,
    layout: {
      "text-field": ["to-string", ["get", "order"]],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["case", ["==", ["get", "selected"], 1], 14, 12],
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: COURSE_LABEL,
    type: "symbol",
    source: COURSE_SOURCE,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 1.7],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#3A4155",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.4,
    },
  });

  map.addSource(FOCUS_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: FOCUS_LAYER,
    type: "symbol",
    source: FOCUS_SOURCE,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": MAP_FOCUS_PIN_ICON_SIZE,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
    },
  });
}

function applyPaint(map: MlMap, mode: RouteVisualMode) {
  const visual = routePaintForMode(mode);
  if (visual.casing) {
    map.setLayoutProperty(ROUTE_CASING, "visibility", "visible");
    map.setPaintProperty(ROUTE_CASING, "line-color", visual.casing.color);
    map.setPaintProperty(ROUTE_CASING, "line-opacity", visual.casing.opacity);
    map.setPaintProperty(ROUTE_CASING, "line-width", visual.casing.width);
  } else {
    map.setLayoutProperty(ROUTE_CASING, "visibility", "none");
  }
  map.setPaintProperty(ROUTE_LINE, "line-color", visual.line.color);
  map.setPaintProperty(ROUTE_LINE, "line-opacity", visual.line.opacity);
  map.setPaintProperty(ROUTE_LINE, "line-width", visual.line.width);
  map.setPaintProperty(
    ROUTE_LINE,
    "line-dasharray",
    visual.line.dasharray ?? [1, 0],
  );
}

export async function paintPreviewRouteDemo(
  map: MlMap,
  mode: PreviewRouteMode,
) {
  ensureRouteLayers(map);
  const path = SEONGSU_DEMO_PATH;
  const routeMode: RouteVisualMode = mode === "course" ? "course" : mode;
  applyPaint(map, routeMode);

  (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: path.map((p) => [p.lng, p.lat]),
        },
      },
    ],
  });

  const start = path[0]!;
  const end = path[path.length - 1]!;
  (map.getSource(ORIGIN_SOURCE) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [start.lng, start.lat] },
      },
    ],
  });

  if (mode === "course") {
    (map.getSource(COURSE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: SEONGSU_DEMO_STOPS.map((s) => ({
        type: "Feature",
        properties: {
          id: s.id,
          name: s.name,
          order: s.order,
          selected: s.order === 2 ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    });
  } else {
    (map.getSource(COURSE_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  const category = "카페";
  const fill = resolvePinColor(category);
  const icon = pinImageKey("focus", category, fill);
  const dpr = clampMapPinDpr(
    typeof window !== "undefined" ? window.devicePixelRatio : 2,
  );
  await loadMapImageFromSvg(
    map,
    icon,
    focusMarkerSvg(category, fill),
    MAP_FOCUS_PIN_WIDTH,
    MAP_FOCUS_PIN_HEIGHT,
    dpr,
  );
  (map.getSource(FOCUS_SOURCE) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { icon },
        geometry: { type: "Point", coordinates: [end.lng, end.lat] },
      },
    ],
  });

  const bounds = new maplibregl.LngLatBounds(
    [path[0]!.lng, path[0]!.lat],
    [path[0]!.lng, path[0]!.lat],
  );
  for (const p of path) bounds.extend([p.lng, p.lat]);
  map.fitBounds(bounds, {
    padding: { top: 72, right: 36, bottom: 72, left: 36 },
    maxZoom: 15,
    duration: 0,
  });
}

export function parsePreviewRouteMode(
  raw: string | null | undefined,
): PreviewRouteMode | null {
  if (raw === "walk" || raw === "car" || raw === "course") return raw;
  return null;
}
