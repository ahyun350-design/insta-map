/**
 * Classify extract entry from request User-Agent (code only — never persist UA).
 *
 * Share Extension (`ShareExtractClient`): URLSession default UA includes CFNetwork
 * and PRODUCT_NAME "ShareExtension", without AppleWebKit.
 * App WebView (Capacitor WKWebView): Mobile Safari–style UA with AppleWebKit + Mobile.
 */

export type ExtractEntry = "app" | "share" | "unknown";

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
  if (raw === "app" || raw === "share" || raw === "unknown") return raw;
  return "unknown";
}
