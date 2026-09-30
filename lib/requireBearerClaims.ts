import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type BearerClaimsUser = {
  id: string;
  email?: string;
};

let warnedSymmetricFallback = false;

function decodeJwtHeader(jwt: string): { alg?: string; kid?: string } | null {
  try {
    const part = jwt.split(".")[0];
    if (!part) return null;
    const json = Buffer.from(part, "base64url").toString("utf8");
    return JSON.parse(json) as { alg?: string; kid?: string };
  } catch {
    return null;
  }
}

/**
 * Bearer JWT auth via local JWKS verify (`getClaims`) when the project uses
 * asymmetric signing keys. Falls back to `getUser()` for HS* tokens (with a
 * one-time server warning). Prefer this for high-frequency read APIs.
 *
 * JWKS is cached in-process by supabase-js (`GLOBAL_JWKS`, TTL 10 minutes).
 */
export async function requireBearerClaims(
  req: Request,
): Promise<{ user: BearerClaimsUser } | { error: NextResponse }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return {
      error: NextResponse.json(
        { error: "서버 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      ),
    };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const jwt = authHeader.slice(7).trim();
  if (!jwt) {
    return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const header = decodeJwtHeader(jwt);
  const alg = header?.alg ?? "";
  const isSymmetric = !alg || alg.startsWith("HS");

  if (isSymmetric) {
    if (!warnedSymmetricFallback) {
      warnedSymmetricFallback = true;
      console.warn(
        "[auth] requireBearerClaims: symmetric JWT — falling back to getUser(); local JWKS verify unavailable",
        { alg: alg || "(missing)" },
      );
    }
    const { data, error } = await userClient.auth.getUser(jwt);
    if (error || !data?.user?.id) {
      return {
        error: NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 }),
      };
    }
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? undefined,
      },
    };
  }

  const { data, error } = await userClient.auth.getClaims(jwt);
  if (error || !data?.claims?.sub) {
    return {
      error: NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 }),
    };
  }

  const claims = data.claims as { sub?: string; email?: unknown };
  const id = typeof claims.sub === "string" ? claims.sub : "";
  if (!id) {
    return {
      error: NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 401 }),
    };
  }

  return {
    user: {
      id,
      email: typeof claims.email === "string" ? claims.email : undefined,
    },
  };
}
