/**
 * Soften OSM/official metro colours for each basemap theme,
 * plus Seoul/metro ref → colour fallback when feature colour is missing.
 */

/** Official-ish Seoul metro line colours by `ref` (and common name tokens). */
export const SEOUL_SUBWAY_REF_COLOURS: Record<string, string> = {
  "1": "#0052A4",
  "2": "#00A84D",
  "3": "#EF7C1C",
  "4": "#00A5DE",
  "5": "#996CAC",
  "6": "#CD7C2F",
  "7": "#747F00",
  "8": "#E6186C",
  "9": "#BDB092",
  "BGL": "#77C4A3", // 우이신설
  "수인·분당": "#FABE00",
  "수인분당": "#FABE00",
  "분당": "#FABE00",
  "공항철도": "#0090D2",
  "A": "#0090D2",
  "경의·중앙": "#77C4A3",
  "경의중앙": "#77C4A3",
  "신분당": "#D4003B",
  "경강": "#003DA5",
  "서해": "#8FC31F",
  "신림": "#6789CA",
  "김포": "#A9022D",
  "용인": "#56AD2D",
  "의정부": "#FDA600",
  "경춘": "#0C8E72",
  "동해": "#003DA5",
  "I2": "#FFCD12", // 인천2
  "U": "#FFCD12",
  "W": "#33A23D",
};

/** MapLibre match expression: coalesce colour → ref table → gray. */
export function subwayLineColourExpr(
  fallbackGray: string,
): ["coalesce", ...unknown[]] {
  const matchArgs: unknown[] = [
    "match",
    ["to-string", ["coalesce", ["get", "ref"], ""]],
  ];
  for (const [ref, colour] of Object.entries(SEOUL_SUBWAY_REF_COLOURS)) {
    matchArgs.push(ref, colour);
  }
  matchArgs.push(fallbackGray);
  return ["coalesce", ["get", "colour"], matchArgs, fallbackGray];
}

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
  // paper: keep official hues readable (line 2 green etc.)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
