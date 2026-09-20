/**
 * Post-image thumbnail URL helpers.
 * Convention: `foo.jpg` → `foo_thumb.jpg` (same bucket path).
 */

const POST_IMAGES_MARKER = "/post-images/";

/** Insert `_thumb` before the file extension. Already-thumb URLs are returned as-is. */
export function derivePostImageThumbUrl(originalUrl: string): string {
  const raw = (originalUrl || "").trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const path = u.pathname;
    const m = path.match(/^(.*\/)([^/]+?)(\.[^./]+)?$/);
    if (!m) return raw;
    const dir = m[1]!;
    const base = m[2]!;
    const ext = m[3] ?? "";
    if (base.endsWith("_thumb")) {
      return raw;
    }
    u.pathname = `${dir}${base}_thumb${ext}`;
    return u.toString();
  } catch {
    // Relative / malformed — best-effort string replace on last segment
    const qIdx = raw.indexOf("?");
    const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const query = qIdx >= 0 ? raw.slice(qIdx) : "";
    if (/_thumb(\.[^./]+)?$/.test(pathPart)) return raw;
    const replaced = pathPart.replace(/(\.[^./]+)?$/, (ext) => `_thumb${ext || ""}`);
    return `${replaced}${query}`;
  }
}

/** Storage object path (`post-images/` relative) → thumb path, or null. */
export function thumbStoragePathFromOriginal(path: string): string | null {
  const p = (path || "").trim();
  if (!p) return null;
  if (/_thumb(\.[^./]+)?$/.test(p)) return null;
  return p.replace(/(\.[^./]+)?$/, (ext) => `_thumb${ext || ".jpg"}`);
}

/** `fileName.jpg` → `fileName_thumb.jpg` */
export function thumbFileNameFromOriginal(fileName: string): string {
  const name = (fileName || "").trim() || "image.jpg";
  if (/_thumb(\.[^./]+)?$/i.test(name)) return name;
  return name.replace(/(\.[^./]+)?$/, (ext) => `_thumb${ext || ".jpg"}`);
}

export function isPostImagesPublicUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes(POST_IMAGES_MARKER);
  } catch {
    return url.includes(POST_IMAGES_MARKER);
  }
}
