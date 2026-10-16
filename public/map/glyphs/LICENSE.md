# Glyph PBF licenses

MapLibre glyph PBFs are derived from **Noto Sans** (Regular / Bold / Italic).

- Font: [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) — **SIL Open Font License 1.1**
- Upstream ranges mirrored from [OpenFreeMap fonts](https://tiles.openfreemap.org/fonts/)
- Full packs (0–255 … 65280–65535) live in Supabase Storage `map-tiles/glyphs/`
- Same-origin template: `/map/glyphs/{fontstack}/{range}.pbf`
  (`app/map/glyphs/.../route.ts` — never 404; empty PBF on miss)

Hangul / CJK ideographs prefer `localIdeographFontFamily` (device fonts).
Paths are never written to localStorage or IndexedDB.
