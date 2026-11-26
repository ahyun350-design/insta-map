/**
 * Classify extract entry from request User-Agent (code only — never persist UA).
 *
 * Share Extension (`ShareExtractClient`): URLSession default UA includes CFNetwork
 * and PRODUCT_NAME "ShareExtension", without AppleWebKit.
 * App WebView (Capacitor WKWebView): Mobile Safari–style UA with AppleWebKit + Mobile.
 *
 * Client may also send body.entry explicitly (e.g. share_fallback for App Group /
 * pindmap://extract deep-link paths). Allowed values only.
 */

export type ExtractEntry = "app" | "share" | "share_fallback" | "unknown";

export type ClientExtractEntry = "app" | "share_fallback";

const ALLOWED_ENTRIES = new Set<ExtractEntry>([
  "app",
  "share",
  "share_fallback",
  "unknown",
]);

export function isExtractEntry(raw: unknown): raw is ExtractEntry {
  return typeof raw === "string" && ALLOWED_ENTRIES.has(raw as ExtractEntry);
}

export function classifyExtractEntry(
  userAgent: string | null | undefined,
): ExtractEntry {
  const ua = typeof userAgent === "string" ? userAgent.trim() : "";
  if (!ua) return "unknown";

  // URLSession (Share Extension): ShareExtension/… CFNetwork/… Darwin/…
  if (/\bShareExtension\//i.test(ua)) return "share";
  if (/\bCFNetwork\b/i.test(ua) && !/\bAppleWebKit\b/i.test(ua)) return "share";

  // Capacitor / WKWebView (and typical in-app Mobile WebView fetch)
  if (/\bAppleWebKit\b/i.test(ua) && /\bMobile\b/i.test(ua)) return "app";

  return "unknown";
}

export function parseExtractEntry(raw: unknown): ExtractEntry {
  if (isExtractEntry(raw)) return raw;
  return "unknown";
}

/**
 * Prefer allowed body.entry; otherwise fall back to UA classification.
 * Invalid/missing body values do not coerce to "unknown" before UA.
 */
export function resolveExtractEntry(
  bodyEntry: unknown,
  userAgent: string | null | undefined,
): ExtractEntry {
  if (isExtractEntry(bodyEntry)) return bodyEntry;
  return classifyExtractEntry(userAgent);
}

/** Client /api/extract/start body — paste → app, share fallback → share_fallback. */
export function buildClientExtractStartBody(input: {
  instagramUrl: string;
  forceRetry?: boolean;
  entry: ClientExtractEntry;
}): {
  instagramUrl: string;
  forceRetry: boolean;
  entry: ClientExtractEntry;
} {
  return {
    instagramUrl: input.instagramUrl,
    forceRetry: input.forceRetry === true,
    entry: input.entry,
  };
}

export function isShareExtractEntry(entry: ExtractEntry): boolean {
  return entry === "share" || entry === "share_fallback";
}
