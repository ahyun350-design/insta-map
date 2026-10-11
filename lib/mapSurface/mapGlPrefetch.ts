/**
 * Admin-only MapLibre asset warm-up (memory + HTTP cache).
 * Does not persist style/tile URLs to disk.
 */

import { fetchLibertyStyle } from "@/lib/pindmapMapStyle";

let prefetchStarted = false;

function glyphUrl(template: string, fontstack: string, range: string): string {
  return template
    .replace("{fontstack}", encodeURIComponent(fontstack))
    .replace("{range}", range);
}

/** Fire-and-forget; safe to call multiple times (session-once). */
export function prefetchAdminMapGlAssets(): void {
  if (typeof window === "undefined") return;
  if (prefetchStarted) return;
  prefetchStarted = true;
  void (async () => {
    try {
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
    } catch {
      /* never block boot */
    }
  })();
}

/** Test helper */
export function resetAdminMapGlPrefetchForTests(): void {
  prefetchStarted = false;
}
