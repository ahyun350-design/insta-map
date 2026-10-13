/**
 * MapLibre asset warm-up (memory + HTTP cache).
 * Does not persist style/tile URLs or tile bytes to disk / localStorage / IndexedDB.
 */

import { fetchLibertyStyle } from "@/lib/pindmapMapStyle";
import { prefetchZ14Around } from "./tilePrefetch";
import {
  prefetchSelfGlyphs,
  prefetchSelfTilesZ14Around,
  readSelfTilesEnabled,
  warmSelfTilesOrBreak,
  ensureSelfTilesProtocolRegistered,
} from "./selfTiles";

let prefetchStarted = false;

function glyphUrl(template: string, fontstack: string, range: string): string {
  return template
    .replace("{fontstack}", encodeURIComponent(fontstack))
    .replace("{range}", range);
}

/** Fire-and-forget; safe to call multiple times (session-once). */
export function prefetchAdminMapGlAssets(opts?: {
  lat?: number;
  lng?: number;
}): void {
  if (typeof window === "undefined") return;
  if (prefetchStarted) return;
  prefetchStarted = true;
  void (async () => {
    try {
      const self = readSelfTilesEnabled();
      if (self) {
        ensureSelfTilesProtocolRegistered();
        // Header + root directory before any map open.
        await warmSelfTilesOrBreak();
        prefetchSelfGlyphs();
        const lat = opts?.lat;
        const lng = opts?.lng;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          void prefetchSelfTilesZ14Around(lat!, lng!);
        }
        return;
      }

      const style = await fetchLibertyStyle();
      const sprite =
        typeof style.sprite === "string" ? style.sprite : null;
      if (sprite) {
        // Common DPR variants — browser HTTP cache only.
        void fetch(`${sprite}.json`, { mode: "cors", credentials: "omit" }).catch(
          () => {},
        );
        void fetch(`${sprite}.png`, { mode: "cors", credentials: "omit" }).catch(
          () => {},
        );
        void fetch(`${sprite}@2x.json`, {
          mode: "cors",
          credentials: "omit",
        }).catch(() => {});
        void fetch(`${sprite}@2x.png`, {
          mode: "cors",
          credentials: "omit",
        }).catch(() => {});
      }
      const glyphs =
        typeof style.glyphs === "string" ? style.glyphs : null;
      if (glyphs) {
        // First label range used by liberty / Noto — warm HTTP cache.
        for (const stack of ["Noto Sans Regular", "Noto Sans Bold"]) {
          void fetch(glyphUrl(glyphs, stack, "0-255"), {
            mode: "cors",
            credentials: "omit",
          }).catch(() => {});
        }
      }
      // z14 3×3 around last / my location (HTTP cache only)
      const lat = opts?.lat;
      const lng = opts?.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        void prefetchZ14Around(lat!, lng!);
      }
    } catch {
      /* never block boot */
    }
  })();
}

/** Test helper */
export function resetAdminMapGlPrefetchForTests(): void {
  prefetchStarted = false;
}
