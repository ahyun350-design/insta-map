import { supabase } from "@/lib/supabase";

const DEDUPE_MS = 5_000;
const recentByEvent = new Map<string, number>();

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
