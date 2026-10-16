/**
 * Same-origin MapLibre glyph PBF.
 *
 * 1. Prefer Supabase map-tiles/glyphs (full 0–65535 packs).
 * 2. Optional OFM mirror if Supabase miss (dev / pre-sync).
 * 3. Never 404 — empty PBF (200) so glyph miss cannot poison vector tiles
 *    (MapLibre treats AJAXError status 404 as an empty tile → blank map).
 *
 * Static files under public/map/glyphs/ still win when present.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STACKS = new Set([
  "Noto Sans Regular",
  "Noto Sans Bold",
  "Noto Sans Italic",
]);

const RANGE_RE = /^(\d+)-(\d+)(?:\.pbf)?$/;
const EMPTY_PBF = new Uint8Array(0);

function supabaseGlyphUrl(fontstack: string, range: string): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/map-tiles/glyphs/${encodeURIComponent(fontstack)}/${range}.pbf`;
}

function ofmGlyphUrl(fontstack: string, range: string): string {
  return `https://tiles.openfreemap.org/fonts/${encodeURIComponent(fontstack)}/${range}.pbf`;
}

function emptyGlyphResponse(): Response {
  return new Response(EMPTY_PBF, {
    status: 200,
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": "public, max-age=86400",
      "X-Pindmap-Glyph": "empty",
    },
  });
}

function okGlyphResponse(buf: ArrayBuffer, source: string): Response {
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Pindmap-Glyph": source,
    },
  });
}

async function tryFetch(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      // Glyphs are immutable content-addressed ranges.
      cache: "force-cache",
      headers: { Accept: "application/x-protobuf,*/*" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Treat 0-byte upstream as miss (should not happen for real packs).
    if (buf.byteLength === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ fontstack: string; range: string }> },
) {
  const { fontstack: rawStack, range: rawRange } = await ctx.params;
  const fontstack = decodeURIComponent(rawStack || "");
  const rangeMatch = RANGE_RE.exec(decodeURIComponent(rawRange || ""));
  if (!STACKS.has(fontstack) || !rangeMatch) {
    return emptyGlyphResponse();
  }
  const begin = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    begin < 0 ||
    end > 65535 ||
    begin % 256 !== 0 ||
    end !== begin + 255
  ) {
    return emptyGlyphResponse();
  }
  const range = `${begin}-${end}`;

  const sbUrl = supabaseGlyphUrl(fontstack, range);
  if (sbUrl) {
    const fromSb = await tryFetch(sbUrl);
    if (fromSb) return okGlyphResponse(fromSb, "supabase");
  }

  const fromOfm = await tryFetch(ofmGlyphUrl(fontstack, range));
  if (fromOfm) return okGlyphResponse(fromOfm, "ofm-fallback");

  return emptyGlyphResponse();
}
