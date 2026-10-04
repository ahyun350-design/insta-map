/** Soften OSM/official metro colours for each basemap theme. */
export function softenSubwayColour(
  hex: string,
  theme: "paper" | "white" | "neon" | string,
): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex.startsWith("#") ? hex : `#${hex}`;
  const n = parseInt(m[1]!, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (theme === "white") {
    const avg = (r + g + b) / 3;
    r = Math.round(r * 0.72 + avg * 0.28);
    g = Math.round(g * 0.72 + avg * 0.28);
    b = Math.round(b * 0.72 + avg * 0.28);
  } else if (theme === "neon") {
    r = Math.min(255, Math.round(r * 1.18 + 28));
    g = Math.min(255, Math.round(g * 1.18 + 28));
    b = Math.min(255, Math.round(b * 1.18 + 28));
  }
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
