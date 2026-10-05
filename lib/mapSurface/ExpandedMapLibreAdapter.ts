"use client";

/**
 * Admin fullscreen MapLibre adapter.
 * Thin factory over MapLibreMapAdapter (mode: "expanded") — same pin assets,
 * cluster rules, paper theme, and hit pad as the compact minimap path.
 */

import {
  MapLibreMapAdapter,
  type CreateCompactMapLibreOptions,
} from "./MapLibreMapAdapter";
import type { ExpandedMapSurface } from "./types";

export type CreateExpandedMapLibreOptions = Omit<
  CreateCompactMapLibreOptions,
  "mode"
> & {
  onSearchPinClick?: (pinId: string) => void;
  onCourseStopClick?: (stopId: string) => void;
  onDiscoverPinClick?: (poiId: string) => void;
};

export class ExpandedMapLibreAdapter {
  static async create(
    options: CreateExpandedMapLibreOptions,
  ): Promise<ExpandedMapSurface> {
    return MapLibreMapAdapter.create({
      ...options,
      mode: "expanded",
    });
  }
}
