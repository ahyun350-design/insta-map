import { PIND_MAP_APP_SCHEME } from "@/lib/pindmapLinks";

export type PindmapDeepLinkAction =
  | { type: "extract"; instagramUrl: string }
  | { type: "place"; placeId: string }
  | { type: "course"; courseId: string }
  | { type: "home" };

/** hostname only — never log or persist the full URL. */
export function safeUrlHostname(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Parse inbound `pindmap://` URLs.
 * Unknown / malformed → `{ type: "home" }` (no throw).
 */
export function parsePindmapDeepLink(rawUrl: string): PindmapDeepLinkAction {
  const raw = (rawUrl ?? "").trim();
  if (!raw) return { type: "home" };

  try {
    const u = new URL(raw);
    const scheme = u.protocol.replace(/:$/, "").toLowerCase();
    if (scheme !== PIND_MAP_APP_SCHEME) return { type: "home" };

    const host = (u.hostname || "").trim().toLowerCase();
    const pathFirst = (u.pathname || "")
      .replace(/^\/+/, "")
      .split("/")[0]
      ?.trim()
      .toLowerCase();
    const kind = host || pathFirst || "";

    if (kind === "extract") {
      const ig = (u.searchParams.get("url") ?? "").trim();
      if (!ig) return { type: "home" };
      return { type: "extract", instagramUrl: ig };
    }
    if (kind === "place") {
      const id = (u.searchParams.get("id") ?? "").trim();
      if (!id) return { type: "home" };
      return { type: "place", placeId: id };
    }
    if (kind === "course") {
      const id = (u.searchParams.get("id") ?? "").trim();
      if (!id) return { type: "home" };
      return { type: "course", courseId: id };
    }
    return { type: "home" };
  } catch {
    return { type: "home" };
  }
}

/** Domain-only telemetry for extract links; route kind otherwise. Never includes query params. */
export function deepLinkTelemetry(action: PindmapDeepLinkAction): {
  kind: PindmapDeepLinkAction["type"];
  domain?: string;
} {
  if (action.type === "extract") {
    const domain = safeUrlHostname(action.instagramUrl) ?? undefined;
    return domain ? { kind: "extract", domain } : { kind: "extract" };
  }
  return { kind: action.type };
}
