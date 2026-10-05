"use client";

import {
  MAP_ATTRIB_OPENMAPTILES_URL,
  MAP_ATTRIB_OSM_COPYRIGHT_URL,
  MAP_CORNER_ATTRIBUTION,
} from "@/lib/mapSurface/mapAttribution";

type Props = {
  className: string;
  /**
   * Capacitor: open in-app data-attribution modal.
   * Web (omit): official links in a new tab.
   */
  onClick?: () => void;
};

/** MapLibre corner credit — linked on web, modal trigger on native when onClick set. */
export default function MapLibreCornerAttribution({ className, onClick }: Props) {
  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        data-testid="maplibre-corner-attribution"
        aria-label="데이터 출처"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
      >
        {MAP_CORNER_ATTRIBUTION}
      </button>
    );
  }

  return (
    <div className={className} data-testid="maplibre-corner-attribution">
      ©{" "}
      <a
        href={MAP_ATTRIB_OPENMAPTILES_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        OpenMapTiles
      </a>{" "}
      ©{" "}
      <a
        href={MAP_ATTRIB_OSM_COPYRIGHT_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        OpenStreetMap contributors
      </a>
    </div>
  );
}
