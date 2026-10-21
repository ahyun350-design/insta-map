/**
 * Admin read/write for app_config.map_gl_enabled (remote MapLibre kill switch).
 * Writes use service role only; clients never get write RLS.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MAP_GL_CONFIG_KEY } from "@/lib/mapSurface/mapGlKillSwitch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USER_ID = "63772749-e01b-4396-a41c-c17a4d3acfe6";

async function requireAdmin(req: Request): Promise<
  | { ok: true; jwt: string }
  | { ok: false; status: number; error: string }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const jwt = authHeader.slice(7).trim();
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (userData.user.id !== ADMIN_USER_ID) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, jwt };
}

function parseEnabled(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("app_config")
      .select("value,updated_at")
      .eq("key", MAP_GL_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      console.error("[admin/map-gl-config] get", error);
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
    const enabled = parseEnabled(data?.value);
    return NextResponse.json({
      key: MAP_GL_CONFIG_KEY,
      enabled: enabled === true,
      unread: data == null || enabled === null,
      updated_at: data?.updated_at ?? null,
    });
  } catch (e) {
    console.error("[admin/map-gl-config] get", e);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
  }
  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await admin.from("app_config").upsert(
      {
        key: MAP_GL_CONFIG_KEY,
        value: body.enabled,
        updated_at: now,
      },
      { onConflict: "key" },
    );
    if (error) {
      console.error("[admin/map-gl-config] put", error);
      return NextResponse.json({ error: "write_failed" }, { status: 500 });
    }
    return NextResponse.json({
      key: MAP_GL_CONFIG_KEY,
      enabled: body.enabled,
      updated_at: now,
    });
  } catch (e) {
    console.error("[admin/map-gl-config] put", e);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
}
