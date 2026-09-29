import { supabase } from "@/lib/supabase";

const DEDUPE_MS = 5_000;
const recentByEvent = new Map<string, number>();

export type PublicListTrackEvent =
  | "list_share_click"
  | "public_list_view"
  | "public_list_cta_click";

export type PublicListTrackMeta = {
  list_id: string;
  domain: string;
};

/**
 * 사용자 행동 로그 — fire-and-forget.
 * 실패·미로그인·5초 내 동일 event 연타는 무시. 앱 동작에 영향 없음.
 */
export function track(event: string, meta?: object): void {
  void (async () => {
    try {
      const name = String(event ?? "").trim();
      if (!name) return;

      const now = Date.now();
      const last = recentByEvent.get(name) ?? 0;
      if (now - last < DEDUPE_MS) return;
      recentByEvent.set(name, now);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { error } = await supabase.from("user_events").insert({
        user_id: userId,
        event: name,
        ...(meta != null ? { meta } : {}),
      });
      if (error) {
        console.warn("[track]", name, error.message);
      }
    } catch (err) {
      console.warn("[track]", event, err);
    }
  })();
}

/**
 * 공개 목록 퍼널 이벤트.
 * - 로그인: 기존 user_events INSERT (user_id = auth.uid)
 * - 비로그인: POST /api/public-list/event → service role, user_id null
 *   (migration 20260929_user_events_nullable_user.sql 필요)
 */
export function trackPublicListEvent(
  event: PublicListTrackEvent,
  meta: PublicListTrackMeta,
): void {
  void (async () => {
    try {
      const name = String(event ?? "").trim() as PublicListTrackEvent;
      if (!name) return;

      const listId = String(meta?.list_id ?? "").trim();
      const domain = String(meta?.domain ?? "").trim().slice(0, 253);
      if (!listId || !domain) return;

      const dedupeKey = `${name}:${listId}`;
      const now = Date.now();
      const last = recentByEvent.get(dedupeKey) ?? 0;
      if (now - last < DEDUPE_MS) return;
      recentByEvent.set(dedupeKey, now);

      const safeMeta: PublicListTrackMeta = { list_id: listId, domain };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        const { error } = await supabase.from("user_events").insert({
          user_id: userId,
          event: name,
          meta: safeMeta,
        });
        if (error) console.warn("[trackPublicList]", name, error.message);
        return;
      }

      if (name === "list_share_click") return;

      await fetch("/api/public-list/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: name, meta: safeMeta }),
        keepalive: true,
      });
    } catch (err) {
      console.warn("[trackPublicList]", event, err);
    }
  })();
}
