/**
 * Admin expanded MapLibre category chips → Kakao Local category / keyword search.
 * Live call per request, pages fetched concurrently. Kakao results are passed through for
 * display only: no server or memory cache, nothing stored or logged (Kakao terms).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminRouteGate";
import {
  CATEGORY_PAGES,
  CATEGORY_PAGE_SIZE,
  categoryChip,
  categorySearchArea,
  mergeKakaoPages,
  type KakaoPlaceDoc,
  type SortMode,
} from "@/lib/adminMapCategory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KAKAO_TIMEOUT_MS = 4000;

type Body = {
  chip?: unknown;
  lat?: unknown;
  lng?: unknown;
  sw?: { lat?: unknown; lng?: unknown } | null;
  ne?: { lat?: unknown; lng?: unknown } | null;
  sort?: unknown;
};

export type MapCategoryApiResponse = {
  docs: KakaoPlaceDoc[];
  diag: { ms: number; area: "rect" | "radius"; error: string | null };
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const latLng = (o: { lat?: unknown; lng?: unknown } | null | undefined) => {
  const lat = num(o?.lat);
  const lng = num(o?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

async function kakaoPage(
  key: string,
  path: "category" | "keyword",
  params: Record<string, string>,
): Promise<KakaoPlaceDoc[]> {
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${path}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const data = (await res.json()) as { documents?: KakaoPlaceDoc[] };
  return Array.isArray(data.documents) ? data.documents : [];
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const chip = typeof body.chip === "string" ? categoryChip(body.chip) : null;
  const center = latLng({ lat: body.lat, lng: body.lng });
  if (!chip || !center) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const sort: SortMode = body.sort === "accuracy" ? "accuracy" : "distance";
  const sw = latLng(body.sw);
  const ne = latLng(body.ne);
  const area = categorySearchArea(center, sw && ne ? { sw, ne } : null);

  const base: Record<string, string> = {
    x: String(center.lng),
    y: String(center.lat),
    sort,
    size: String(CATEGORY_PAGE_SIZE),
    ...("rect" in area ? { rect: area.rect } : { radius: String(area.radius) }),
  };
  const queries: Array<{ path: "category" | "keyword"; params: Record<string, string> }> =
    "queries" in chip.kakao
      ? chip.kakao.queries.map((query) => ({
          path: "keyword" as const,
          params: {
            ...base,
            query,
            ...(chip.kakao.code ? { category_group_code: chip.kakao.code } : {}),
          },
        }))
      : [{ path: "category" as const, params: { ...base, category_group_code: chip.kakao.code } }];

  const t0 = Date.now();
  let error: string | null = null;
  const perQuery = await Promise.all(
    queries.map(async (q) => {
      const pages = await Promise.all(
        Array.from({ length: CATEGORY_PAGES }, (_, i) =>
          kakaoPage(key, q.path, { ...q.params, page: String(i + 1) }).catch((e: unknown) => {
            error = e instanceof Error ? e.message.slice(0, 40) : "fetch_failed";
            return [] as KakaoPlaceDoc[];
          }),
        ),
      );
      return pages.flat();
    }),
  );
  const docs = mergeKakaoPages(perQuery, sort);
  const payload: MapCategoryApiResponse = {
    docs,
    diag: { ms: Date.now() - t0, area: "rect" in area ? "rect" : "radius", error },
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
