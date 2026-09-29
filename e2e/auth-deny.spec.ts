import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireE2ECredentials } from "./helpers/env";
import { createE2ESupabase } from "./helpers/supabaseRpc";

loadEnvLocal();

type DenyCase = {
  name: string;
  method: "GET" | "POST";
  url: string;
  data?: Record<string, unknown>;
};

const UNAUTH_CASES: DenyCase[] = [
  { name: "extract/start", method: "POST", url: "/api/extract/start", data: { instagramUrl: "https://www.instagram.com/p/abc123/" } },
  { name: "extract/status", method: "GET", url: "/api/extract/status?jobId=00000000-0000-0000-0000-000000000001" },
  { name: "extract/process", method: "POST", url: "/api/extract/process", data: { jobId: "00000000-0000-0000-0000-000000000001" } },
  { name: "places/upsert", method: "POST", url: "/api/places/upsert", data: { id: "e2e-auth-deny", name: "x", category: "카페" } },
  { name: "search", method: "GET", url: "/api/search?query=test" },
  { name: "kakao-keyword", method: "GET", url: "/api/kakao-keyword?query=test" },
  { name: "naver-images", method: "GET", url: "/api/naver-images?query=test" },
  {
    name: "directions",
    method: "POST",
    url: "/api/directions",
    data: { origin: { lat: 37.5, lng: 127 }, destination: { lat: 37.6, lng: 127.1 } },
  },
  {
    name: "walk-directions",
    method: "POST",
    url: "/api/walk-directions",
    data: { origin: { lat: 37.5, lng: 127 }, destination: { lat: 37.6, lng: 127.1 } },
  },
];

test.describe("API auth denials", () => {
  test("unauthenticated and bad bearer → 401", async ({ request }) => {
    for (const c of UNAUTH_CASES) {
      const res = await request.fetch(c.url, {
        method: c.method,
        data: c.data,
        headers: c.data ? { "Content-Type": "application/json" } : undefined,
      });
      expect(res.status(), `${c.name} no auth`).toBe(401);
    }

    const bad = await request.get("/api/search?query=test", {
      headers: { Authorization: "Bearer bad.token.here" },
    });
    expect(bad.status(), "search bad bearer").toBe(401);
  });

  test("authenticated extract/status missing job → 404", async ({ request }) => {
    requireE2ECredentials();
    const { client } = await createE2ESupabase();
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      const token = session?.access_token;
      expect(token, "e2e access token").toBeTruthy();

      const statusRes = await request.get(
        "/api/extract/status?jobId=00000000-0000-0000-0000-000000000099",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(statusRes.status(), "status missing/foreign job").toBe(404);
    } finally {
      await client.auth.signOut().catch(() => null);
    }
  });

  test("authenticated places/upsert foreign row → 403", async ({ request }) => {
    requireE2ECredentials();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    test.skip(!serviceKey || !supabaseUrl, "SUPABASE_SERVICE_ROLE_KEY unavailable");

    const { client, userId } = await createE2ESupabase();
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      const token = session?.access_token;
      expect(token, "e2e access token").toBeTruthy();

      const admin = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: foreign, error: foreignErr } = await admin
        .from("places")
        .select("id, user_id")
        .neq("user_id", userId)
        .limit(1)
        .maybeSingle<{ id: string; user_id: string }>();
      expect(foreignErr, "foreign place lookup").toBeNull();
      test.skip(!foreign?.id, "no foreign place row available");

      const upsertRes = await request.post("/api/places/upsert", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        data: {
          id: foreign!.id,
          name: "e2e-should-not-overwrite",
          category: "카페",
        },
      });
      expect(upsertRes.status(), "upsert foreign place").toBe(403);
    } finally {
      await client.auth.signOut().catch(() => null);
    }
  });
});
