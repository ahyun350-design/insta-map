export type CameraPadding = { top: number; right: number; bottom: number; left: number };

/**
 * easeTo / jumpTo padding for a result camera. No bottom inset → no `padding` key at all:
 * MapLibre reads `'padding' in options`, and an undefined value throws inside easeTo
 * (the camera then never moves).
 */
export function resultCameraPadding(opts?: {
  paddingBottom?: number;
  paddingTop?: number;
}): { padding?: CameraPadding } {
  const bottom = Math.max(0, Math.round(opts?.paddingBottom ?? 0));
  if (bottom <= 0) return {};
  const top = Math.max(48, Math.round(opts?.paddingTop ?? 96));
  return { padding: { top, right: 36, bottom, left: 36 } };
}
