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
import type { AdminMapLibreThemeId } from "@/lib/mapSurface/adminMapTheme";
import { MAP_NEON_ACCENT, MAP_NEON_CLUSTER_FILL, MAP_NEON_CORE } from "@/lib/mapSurface/mapBrand";
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
    id: "preview-route-glow-outer",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { ...ROUTE_LAYOUT, visibility: "none" },
    paint: {
      "line-color": MAP_NEON_ACCENT,
      "line-width": 17,
      "line-opacity": 0.35,
      "line-blur": 12,
    },
  });
  map.addLayer({
    id: "preview-route-glow-mid",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { ...ROUTE_LAYOUT, visibility: "none" },
    paint: {
      "line-color": MAP_NEON_ACCENT,
      "line-width": 9,
      "line-opacity": 0.6,
      "line-blur": 4,
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

const GLOW_OUTER = "preview-route-glow-outer";
const GLOW_MID = "preview-route-glow-mid";

function applyGlowLayer(
  map: MlMap,
  layerId: string,
  paint: {
    color: string;
    opacity: number;
    width: unknown;
    dasharray: number[] | null;
    blur?: number;
  } | null,
) {
  if (!map.getLayer(layerId)) return;
  if (!paint) {
    map.setLayoutProperty(layerId, "visibility", "none");
    return;
  }
  map.setLayoutProperty(layerId, "visibility", "visible");
  map.setPaintProperty(layerId, "line-color", paint.color);
  map.setPaintProperty(layerId, "line-opacity", paint.opacity);
  map.setPaintProperty(layerId, "line-width", paint.width);
  map.setPaintProperty(layerId, "line-blur", paint.blur ?? 0);
  try {
    map.setPaintProperty(layerId, "line-dasharray", paint.dasharray ?? [1, 0]);
  } catch {
    /* ignore */
  }
}

function applyPaint(
  map: MlMap,
  mode: RouteVisualMode,
  theme: AdminMapLibreThemeId,
) {
  const visual = routePaintForMode(mode, theme);
  const neon = theme === "neon";

  if (visual.casing) {
    map.setLayoutProperty(ROUTE_CASING, "visibility", "visible");
    map.setPaintProperty(ROUTE_CASING, "line-color", visual.casing.color);
    map.setPaintProperty(ROUTE_CASING, "line-opacity", visual.casing.opacity);
    map.setPaintProperty(ROUTE_CASING, "line-width", visual.casing.width);
  } else {
    map.setLayoutProperty(ROUTE_CASING, "visibility", "none");
  }

  applyGlowLayer(map, GLOW_OUTER, visual.glowOuter);
  applyGlowLayer(map, GLOW_MID, visual.glowMid);

  map.setPaintProperty(ROUTE_LINE, "line-color", visual.line.color);
  map.setPaintProperty(ROUTE_LINE, "line-opacity", visual.line.opacity);
  map.setPaintProperty(ROUTE_LINE, "line-width", visual.line.width);
  try {
    map.setPaintProperty(ROUTE_LINE, "line-blur", visual.line.blur ?? 0);
  } catch {
    /* ignore */
  }
  map.setPaintProperty(
    ROUTE_LINE,
    "line-dasharray",
    visual.line.dasharray ?? [1, 0],
  );

  if (map.getLayer(ORIGIN_SHADOW)) {
    map.setPaintProperty(ORIGIN_SHADOW, "circle-radius", neon ? 12 : 9);
    map.setPaintProperty(
      ORIGIN_SHADOW,
      "circle-color",
      neon ? MAP_NEON_ACCENT : "#000000",
    );
    map.setPaintProperty(ORIGIN_SHADOW, "circle-opacity", neon ? 0.45 : 0.18);
    map.setPaintProperty(ORIGIN_SHADOW, "circle-blur", neon ? 0.85 : 0.55);
  }
  if (map.getLayer(ORIGIN_CIRCLE)) {
    map.setPaintProperty(
      ORIGIN_CIRCLE,
      "circle-color",
      neon ? MAP_NEON_CLUSTER_FILL : "#FFFFFF",
    );
    map.setPaintProperty(ORIGIN_CIRCLE, "circle-stroke-width", neon ? 3.5 : 3);
    map.setPaintProperty(
      ORIGIN_CIRCLE,
      "circle-stroke-color",
      neon ? MAP_NEON_ACCENT : MAP_BRAND_NAVY,
    );
  }
  if (map.getLayer(COURSE_SHADOW)) {
    map.setPaintProperty(COURSE_SHADOW, "circle-radius", [
      "case",
      ["==", ["get", "selected"], 1],
      neon ? 22 : 18,
      neon ? 17 : 15,
    ]);
    map.setPaintProperty(
      COURSE_SHADOW,
      "circle-color",
      neon ? MAP_NEON_ACCENT : "#000000",
    );
    map.setPaintProperty(COURSE_SHADOW, "circle-opacity", neon ? 0.4 : 0.16);
    map.setPaintProperty(COURSE_SHADOW, "circle-blur", neon ? 0.75 : 0.45);
  }
  if (map.getLayer(COURSE_CIRCLE)) {
    map.setPaintProperty(
      COURSE_CIRCLE,
      "circle-color",
      neon ? MAP_NEON_CLUSTER_FILL : MAP_BRAND_NAVY,
    );
    map.setPaintProperty(COURSE_CIRCLE, "circle-stroke-width", neon ? 2.5 : 2);
    map.setPaintProperty(
      COURSE_CIRCLE,
      "circle-stroke-color",
      neon ? MAP_NEON_ACCENT : "#ffffff",
    );
  }
  if (map.getLayer(COURSE_NUM)) {
    map.setPaintProperty(
      COURSE_NUM,
      "text-color",
      neon ? MAP_NEON_CORE : "#ffffff",
    );
  }
  if (map.getLayer(COURSE_LABEL)) {
    map.setPaintProperty(
      COURSE_LABEL,
      "text-color",
      neon ? "#C9CEF5" : "#3A4155",
    );
    map.setPaintProperty(
      COURSE_LABEL,
      "text-halo-color",
      neon ? "#0E1230" : "#ffffff",
    );
  }
}

export async function paintPreviewRouteDemo(
  map: MlMap,
  mode: PreviewRouteMode,
  theme: AdminMapLibreThemeId = "paper",
  routeTheme?: "dark" | "paper" | null,
) {
  ensureRouteLayers(map);
  const path = SEONGSU_DEMO_PATH;
  const routeMode: RouteVisualMode = mode === "course" ? "course" : mode;
  if (routeTheme === "dark" || routeTheme === "paper") {
    const { applyDirectionsBasemap } = await import(
      "@/lib/mapSurface/directionsBasemap"
    );
    const { directionsRoutePaint } = await import("@/lib/mapSurface/routeStyle");
    applyDirectionsBasemap(map, routeTheme);
    const visual = directionsRoutePaint(routeMode, routeTheme);
    // Directions chrome only — avoid neon applyPaint (fires spurious map errors).
    applyGlowLayer(map, GLOW_OUTER, visual.glowOuter);
    applyGlowLayer(map, GLOW_MID, visual.glowMid);
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
    try {
      map.setPaintProperty(ROUTE_LINE, "line-dasharray", [1, 0]);
    } catch {
      /* ignore */
    }
    // Endpoint colors for directions chrome
    const core =
      routeTheme === "dark" ? "#D9F45B" : MAP_BRAND_NAVY;
    const fill = routeTheme === "dark" ? "#0E1230" : "#FFFFFF";
    if (map.getLayer(ORIGIN_SHADOW)) {
      map.setPaintProperty(ORIGIN_SHADOW, "circle-radius", 10);
      map.setPaintProperty(ORIGIN_SHADOW, "circle-color", core);
      map.setPaintProperty(ORIGIN_SHADOW, "circle-opacity", 0.35);
    }
    if (map.getLayer(ORIGIN_CIRCLE)) {
      map.setPaintProperty(ORIGIN_CIRCLE, "circle-radius", 6);
      map.setPaintProperty(ORIGIN_CIRCLE, "circle-color", fill);
      map.setPaintProperty(ORIGIN_CIRCLE, "circle-stroke-color", core);
    }
  } else {
    applyPaint(map, routeMode, theme);
  }

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
  const neon = theme === "neon";
  const icon =
    pinImageKey("focus", category, fill) + (neon ? ":neon" : "");
  const dpr = clampMapPinDpr(
    typeof window !== "undefined" ? window.devicePixelRatio : 2,
  );
  await loadMapImageFromSvg(
    map,
    icon,
    focusMarkerSvg(
      category,
      fill,
      neon ? { stroke: "#ffffff", glow: true } : undefined,
    ),
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

export function parsePreviewRouteTheme(
  raw: string | null | undefined,
): "dark" | "paper" | null {
  if (raw === "dark" || raw === "paper") return raw;
  return null;
}
