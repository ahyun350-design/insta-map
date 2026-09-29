import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED = new Set(["public_list_view", "public_list_cta_click"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Anonymous public-list funnel → user_events with user_id null.
 * Requires: ALTER user_events ALTER COLUMN user_id DROP NOT NULL
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      event?: unknown;
      meta?: { list_id?: unknown; domain?: unknown };
    } | null;

    const event = typeof body?.event === "string" ? body.event.trim() : "";
    if (!ALLOWED.has(event)) {
      return NextResponse.json({ error: "invalid_event" }, { status: 400 });
    }

    const listId =
      typeof body?.meta?.list_id === "string" ? body.meta.list_id.trim() : "";
    const domainRaw =
      typeof body?.meta?.domain === "string" ? body.meta.domain.trim() : "";
    const domain = domainRaw.slice(0, 253);
    if (!UUID_RE.test(listId) || !domain || /[^\w.-]/.test(domain)) {
      return NextResponse.json({ error: "invalid_meta" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from("user_events").insert({
      user_id: null,
      event,
      meta: { list_id: listId, domain },
    });
    if (error) {
      console.warn("[public-list/event]", error.message);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[public-list/event]", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
