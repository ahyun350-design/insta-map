/**
 * MapLibre basemap attribution (OpenFreeMap / OpenMapTiles / OpenStreetMap).
 * Corner text follows OpenMapTiles LICENSE example + OSM ODbL link practice.
 */

export const MAP_ATTRIB_OPENFREEMAP_URL = "https://openfreemap.org/";
export const MAP_ATTRIB_OPENMAPTILES_URL = "https://openmaptiles.org/";
export const MAP_ATTRIB_OSM_COPYRIGHT_URL =
  "https://www.openstreetmap.org/copyright";

/** Shortest corner credit matching OpenMapTiles browsable-map example. */
export const MAP_CORNER_ATTRIBUTION =
  "© OpenMapTiles © OpenStreetMap contributors";

export type InstallMapLibreAttributionOptions = {
  className: string;
  /**
   * Capacitor: whole credit opens the in-app data-attribution modal.
   * Web: omit — names become official links (new tab).
   */
  onClick?: () => void;
};

/** Imperative corner credit for MapLibreMapAdapter. Returns cleanup. */
export function installMapLibreCornerAttribution(
  container: HTMLElement,
  options: InstallMapLibreAttributionOptions,
): () => void {
  const stopMap = (e: Event) => {
    e.stopPropagation();
  };

  if (options.onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = options.className;
    btn.setAttribute("data-testid", "maplibre-corner-attribution");
    btn.setAttribute("aria-label", "데이터 출처");
    btn.textContent = MAP_CORNER_ATTRIBUTION;
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      options.onClick?.();
    };
    btn.addEventListener("click", onClick);
    btn.addEventListener("pointerdown", stopMap);
    container.appendChild(btn);
    return () => {
      btn.removeEventListener("click", onClick);
      btn.removeEventListener("pointerdown", stopMap);
      btn.remove();
    };
  }

  const el = document.createElement("div");
  el.className = options.className;
  el.setAttribute("data-testid", "maplibre-corner-attribution");

  const omt = document.createElement("a");
  omt.href = MAP_ATTRIB_OPENMAPTILES_URL;
  omt.target = "_blank";
  omt.rel = "noopener noreferrer";
  omt.textContent = "OpenMapTiles";

  const osm = document.createElement("a");
  osm.href = MAP_ATTRIB_OSM_COPYRIGHT_URL;
  osm.target = "_blank";
  osm.rel = "noopener noreferrer";
  osm.textContent = "OpenStreetMap contributors";

  el.append("© ", omt, " © ", osm);
  el.addEventListener("click", stopMap);
  el.addEventListener("pointerdown", stopMap);
  container.appendChild(el);
  return () => {
    el.removeEventListener("click", stopMap);
    el.removeEventListener("pointerdown", stopMap);
    el.remove();
  };
}
