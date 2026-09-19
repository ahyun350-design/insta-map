import { LIST_COLOR_PRESETS } from "@/lib/categoryAppearance";

export { LIST_COLOR_PRESETS, type ListColorPresetId } from "@/lib/categoryAppearance";

/** Resolve list preset id → hex. Invalid id → null (caller falls back to category color). */
export function resolveListColor(presetId: string | null | undefined): string | null {
  if (typeof presetId !== "string") return null;
  const key = presetId.trim();
  if (!key) return null;
  return LIST_COLOR_PRESETS[key] ?? null;
}
