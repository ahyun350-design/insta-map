/**
 * Admin expanded MapLibre: which basemap place (shop · 상가 · Tour · landmark ·
 * park · station · bus stop) sits under a tap. Pins / search / course layers are
 * handled earlier by the adapter; this only runs when no pin was hit.
 */

import type { Map as MaplibreMap } from "maplibre-gl";
import {
  poiCategoryBadgeFill,
  poiCategoryIconSvg,
  poiCategoryIdForProps,
  subwayLineBadgeSvg,
  subwayRefColour,
  type PoiCategoryId,
} from "./poiCategoryIcons";

export type MapPoiKind =
  | "shop"
  | "sangga"
  | "tour"
  | "landmark"
  | "park"
  | "station"
  | "bus";

export type MapPoiTap = {
  kind: MapPoiKind;
  layerId: string;
  name: string;
  lat: number;
  lng: number;
  cls: string | null;
  subclass: string | null;
  /** building_kr house number under the place, when the building layer has one. */
  buildingNo: string | null;
  /** Station: line refs (e.g. "5", "경의·중앙") and the primary line colour / ref. */
  lines: string[];
  lineColour: string | null;
  lineRef: string | null;
  /** TourAPI contentTypeId (12 관광지 · 14 문화시설 · 28 레포츠 · 38 쇼핑 …). */
  tourType: string | null;
};

/** GeoJSON array props come back from queryRenderedFeatures as JSON strings. */
function listProp(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      const a = JSON.parse(v) as unknown;
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const KIND_BY_LAYER: Array<[RegExp, MapPoiKind]> = [
  [/^sangga_shop_label_/, "sangga"],
  [/^shop_poi_label_/, "shop"],
  [/^tour_poi_label_/, "tour"],
  [/^(landmark_(label|priority)|korea_landmark_tier|label_korea_landmark_overlay)/, "landmark"],
  [/^park_name_label_/, "park"],
  [/^poi_transit/, "station"],
  [/^bus_stop_/, "bus"],
];

const TAP_PAD_PX = 12;

export function mapPoiKindOfLayer(layerId: string): MapPoiKind | null {
  for (const [re, kind] of KIND_BY_LAYER) if (re.test(layerId)) return kind;
  return null;
}

function tapLayerIds(map: MaplibreMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .filter((l) => l.type === "symbol" && mapPoiKindOfLayer(l.id) != null)
    .map((l) => l.id)
    .filter((id) => map.getLayer(id));
}

function buildingNoAt(map: MaplibreMap, x: number, y: number): string | null {
  if (!map.getLayer("building_kr_fill")) return null;
  try {
    const hit = map.queryRenderedFeatures([x, y], { layers: ["building_kr_fill"] })[0];
    const no = hit?.properties?.no;
    const s = no == null ? "" : String(no).trim();
    return s || null;
  } catch {
    return null;
  }
}

function toTap(
  map: MaplibreMap,
  f: ReturnType<MaplibreMap["queryRenderedFeatures"]>[number],
): MapPoiTap | null {
  const kind = mapPoiKindOfLayer(f.layer?.id ?? "");
  if (!kind || !f.geometry || f.geometry.type !== "Point") return null;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const name = String(props["name:ko"] || props.name || "").trim();
  if (!name) return null;
  const [lng, lat] = f.geometry.coordinates as [number, number];
  const p = map.project([lng, lat]);
  return {
    kind,
    layerId: f.layer.id,
    name,
    lat,
    lng,
    cls: props.class != null ? String(props.class) : null,
    subclass: props.subclass != null ? String(props.subclass) : null,
    buildingNo: buildingNoAt(map, p.x, p.y),
    lines: kind === "station" ? listProp(props.refs) : [],
    lineColour: kind === "station" && props.colour ? String(props.colour) : null,
    lineRef: kind === "station" && props.ref ? String(props.ref) : null,
    tourType: kind === "tour" && props.contentTypeId != null ? String(props.contentTypeId) : null,
  };
}

/** Focus-pin badge for a tap: same glyph + colour as the map icon; stations use the line badge. */
export function mapTapBadge(tap: MapPoiTap): { key: string; svg: string; fill: string } {
  if (tap.kind === "station") {
    const ref = tap.lineRef ?? "";
    const fill = tap.lineColour || subwayRefColour(ref);
    return { key: `subway-${ref || "x"}-${fill}`, svg: subwayLineBadgeSvg(fill, ref || "?"), fill };
  }
  const cat: PoiCategoryId =
    tap.kind === "bus"
      ? "bus"
      : tap.kind === "park"
        ? "park"
        : tap.kind === "landmark" && !tap.cls
          ? "landmark"
          : tap.kind === "tour" && tap.cls !== "shop" && tap.cls !== "park"
            ? "landmark"
            : poiCategoryIdForProps(tap.cls, tap.subclass);
  return { key: `poi-${cat}`, svg: poiCategoryIconSvg(cat), fill: poiCategoryBadgeFill(cat) };
}

const TOUR_TYPE_LABEL: Record<string, string> = {
  "12": "관광지",
  "14": "문화시설",
  "15": "축제·공연",
  "25": "여행코스",
  "28": "레포츠",
  "32": "숙박",
  "38": "쇼핑",
  "39": "음식점",
};

/** Card category line for stations / Tour POIs (null → app category label). */
export function mapTapCategoryLabel(tap: MapPoiTap): string | null {
  if (tap.kind === "station") {
    const korean = tap.lines.filter((r) => /[0-9가-힣]/.test(r));
    const refs = [...new Set(korean.length ? korean : tap.lines)];
    const named = refs.map((r) => (/^[0-9]+$/.test(r) ? `${r}호선` : r));
    return named.length ? `지하철역 · ${named.join(", ")}` : "지하철역";
  }
  if (tap.kind === "bus") return "버스정류장";
  if (tap.kind === "tour" && tap.tourType) return TOUR_TYPE_LABEL[tap.tourType] ?? null;
  return null;
}

/** Nearest tappable place label to a screen point (null when nothing is there). */
export function pickMapPoiAt(
  map: MaplibreMap,
  point: { x: number; y: number },
): MapPoiTap | null {
  const layers = tapLayerIds(map);
  if (!layers.length) return null;
  let feats: ReturnType<MaplibreMap["queryRenderedFeatures"]> = [];
  try {
    feats = map.queryRenderedFeatures(
      [
        [point.x - TAP_PAD_PX, point.y - TAP_PAD_PX],
        [point.x + TAP_PAD_PX, point.y + TAP_PAD_PX],
      ],
      { layers },
    );
  } catch {
    return null;
  }
  let best: (typeof feats)[number] | null = null;
  let bestD = Infinity;
  for (const f of feats) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const p = map.project(f.geometry.coordinates as [number, number]);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best ? toTap(map, best) : null;
}

/** E2E / QA: screen point of a rendered label of one of `kinds` (center-most). */
export function findRenderedMapPoi(
  map: MaplibreMap,
  kinds: MapPoiKind[],
): { x: number; y: number; name: string; kind: MapPoiKind } | null {
  const layers = tapLayerIds(map).filter((id) => {
    const k = mapPoiKindOfLayer(id);
    return k != null && kinds.includes(k);
  });
  if (!layers.length) return null;
  const canvas = map.getCanvas();
  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;
  let best: { x: number; y: number; name: string; kind: MapPoiKind } | null = null;
  let bestD = Infinity;
  for (const f of map.queryRenderedFeatures({ layers })) {
    const t = toTap(map, f);
    if (!t) continue;
    const p = map.project([t.lng, t.lat]);
    // Keep clear of top chrome and the bottom card band.
    if (p.y < 140 || p.y > canvas.clientHeight * 0.6 || p.x < 30 || p.x > canvas.clientWidth - 30) {
      continue;
    }
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: p.x, y: p.y, name: t.name, kind: t.kind };
    }
  }
  return best;
}
