import { supabase } from "./supabase";
import { toUserMessage } from "./userErrorMessage";

export type PlaceListSummary = {
  id: string;
  user_id: string;
  title: string;
  /** Preset id or null (null → category pin colors) */
  color: string | null;
  /** Owner-only field from place_lists; public RPC rows omit this */
  is_public?: boolean;
  place_count: number;
  created_at: string;
  updated_at: string;
};

export type PublicPlaceListSummary = {
  id: string;
  title: string;
  color: string | null;
  place_count: number;
};

/** Single public list (SECURITY DEFINER RPC) — includes owner username */
export type PublicPlaceListDetail = PublicPlaceListSummary & {
  owner_username: string | null;
};

export type PublicPlaceListPlace = {
  place_id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  category: string;
  subcategory?: string | null;
  list_color: string | null;
};

export type PlaceListPlace = {
  id: string;
  name: string;
  address: string;
  category: string;
  lat?: number;
  lng?: number;
  created_at?: string;
  memo?: string | null;
  sort_order: number;
};

const LIST_COLOR_PRESET_IDS = [
  "sunOrange",
  "beetroot",
  "peach",
  "foliage",
  "spring",
  "bronze",
  "persian",
  "windward",
  "violet",
] as const;

export type PlaceListColorPresetId = (typeof LIST_COLOR_PRESET_IDS)[number];

const PLACE_LIST_SELECT =
  "id, user_id, title, color, is_public, created_at, updated_at, place_list_items(count)";

function mapDbError(error: { code?: string; message?: string }, fallback: string): string {
  return toUserMessage(error, fallback);
}

function validateListTitle(trimmed: string): string | null {
  if (!trimmed) return "이름을 입력해주세요";
  if (trimmed.length > 60) return "이름은 60자 이내로 입력해주세요";
  return null;
}

export function normalizeListColor(
  color: string | null | undefined,
): PlaceListColorPresetId | null {
  if (typeof color !== "string") return null;
  const key = color.trim();
  if (!key) return null;
  return (LIST_COLOR_PRESET_IDS as readonly string[]).includes(key)
    ? (key as PlaceListColorPresetId)
    : null;
}

function mapListRow(row: Record<string, unknown>): PlaceListSummary {
  const nested = row.place_list_items;
  let placeCount = 0;
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object" && nested[0] !== null) {
    const count = (nested[0] as { count?: unknown }).count;
    if (typeof count === "number") placeCount = count;
    else if (typeof count === "string") placeCount = Number(count) || 0;
  } else if (typeof row.place_count === "number") {
    placeCount = row.place_count;
  }

  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    title: String(row.title ?? ""),
    color: normalizeListColor(typeof row.color === "string" ? row.color : null),
    is_public: row.is_public === true,
    place_count: placeCount,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

/** Preview tiles for saved-tab list rows (category only — no names in UI meta) */
export type ListPlacePreview = {
  placeId: string;
  name: string;
  category: string;
  lat: number | null;
  lng: number | null;
};

/** Up to 3 places per list (sort_order) for thumb tiles — category + coords for photo match. */
export async function fetchListsPlacePreviews(
  listIds: string[],
): Promise<{ data: Record<string, ListPlacePreview[]>; error: string | null }> {
  const ids = [...new Set(listIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { data: {}, error: null };

  const { data, error } = await supabase
    .from("place_list_items")
    .select("list_id, sort_order, places ( id, name, category, lat, lng )")
    .in("list_id", ids)
    .order("sort_order", { ascending: true });

  if (error) {
    return { data: {}, error: mapDbError(error, "목록 미리보기를 불러오지 못했어요.") };
  }

  const out: Record<string, ListPlacePreview[]> = {};
  for (const id of ids) out[id] = [];

  for (const row of data ?? []) {
    const r = row as {
      list_id?: string;
      places?:
        | {
            id?: string;
            name?: string;
            category?: string;
            lat?: number | null;
            lng?: number | null;
          }
        | {
            id?: string;
            name?: string;
            category?: string;
            lat?: number | null;
            lng?: number | null;
          }[]
        | null;
    };
    const listId = typeof r.list_id === "string" ? r.list_id : "";
    if (!listId || !out[listId] || out[listId]!.length >= 3) continue;
    const raw = Array.isArray(r.places) ? r.places[0] : r.places;
    const placeId =
      raw && typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    const name =
      raw && typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "";
    const category =
      raw && typeof raw.category === "string" && raw.category.trim()
        ? raw.category.trim()
        : "";
    if (!placeId || !name || !category) continue;
    const lat =
      raw && typeof raw.lat === "number" && Number.isFinite(raw.lat) ? raw.lat : null;
    const lng =
      raw && typeof raw.lng === "number" && Number.isFinite(raw.lng) ? raw.lng : null;
    out[listId]!.push({ placeId, name, category, lat, lng });
  }

  return { data: out, error: null };
}

/** 내 목록 전체 + 각 목록의 장소 수 */
export async function fetchMyLists(
  userId: string,
): Promise<{ data: PlaceListSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from("place_lists")
    .select(PLACE_LIST_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error: mapDbError(error, "목록을 불러오지 못했어요.") };
  }

  return {
    data: (data ?? []).map((row) => mapListRow(row as Record<string, unknown>)),
    error: null,
  };
}

/** 목록 생성 — color는 프리셋 id 또는 null */
export async function createList(
  userId: string,
  title: string,
  color?: string | null,
): Promise<{ data: PlaceListSummary | null; error: string | null }> {
  const trimmed = title.trim();
  const validationError = validateListTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const normalizedColor = normalizeListColor(color);
  const { data, error } = await supabase
    .from("place_lists")
    .insert({
      user_id: userId,
      title: trimmed,
      color: normalizedColor,
    })
    .select("id, user_id, title, color, created_at, updated_at")
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "목록을 만들지 못했어요.") };
  }

  return {
    data: mapListRow({ ...(data as Record<string, unknown>), place_count: 0 }),
    error: null,
  };
}

/** 이름 수정 (updated_at 갱신) — 색은 건드리지 않음 */
export async function renameList(
  listId: string,
  title: string,
): Promise<{ data: PlaceListSummary | null; error: string | null }> {
  const trimmed = title.trim();
  const validationError = validateListTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const { data, error } = await supabase
    .from("place_lists")
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq("id", listId)
    .select(PLACE_LIST_SELECT)
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "이름을 바꾸지 못했어요.") };
  }

  return { data: mapListRow(data as Record<string, unknown>), error: null };
}

/** Public / private toggle (owner RLS) */
export async function updateListPublic(
  listId: string,
  isPublic: boolean,
): Promise<{ data: PlaceListSummary | null; error: string | null }> {
  const { data, error } = await supabase
    .from("place_lists")
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq("id", listId)
    .select(PLACE_LIST_SELECT)
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "공개 설정을 바꾸지 못했어요.") };
  }

  return { data: mapListRow(data as Record<string, unknown>), error: null };
}

/** One public list by id (SECURITY DEFINER RPC — anon-safe) */
export async function fetchPublicPlaceList(
  listId: string,
): Promise<{ data: PublicPlaceListDetail | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_public_place_list", {
    p_list_id: listId,
  });

  if (error) {
    return { data: null, error: mapDbError(error, "목록을 불러오지 못했어요.") };
  }

  const rows = Array.isArray(data) ? data : data != null ? [data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row?.id) {
    return { data: null, error: null };
  }

  const countRaw = row.place_count;
  const place_count =
    typeof countRaw === "number"
      ? countRaw
      : typeof countRaw === "string"
        ? Number(countRaw) || 0
        : 0;

  return {
    data: {
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      color: normalizeListColor(typeof row.color === "string" ? row.color : null),
      place_count,
      owner_username:
        typeof row.owner_username === "string" && row.owner_username.trim()
          ? row.owner_username.trim()
          : null,
    },
    error: null,
  };
}

/** Public lists for a profile (SECURITY DEFINER RPC) */
export async function fetchPublicPlaceLists(
  ownerId: string,
): Promise<{ data: PublicPlaceListSummary[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_public_place_lists", {
    p_owner_id: ownerId,
  });

  if (error) {
    return { data: [], error: mapDbError(error, "공개 목록을 불러오지 못했어요.") };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    data: rows.map((row) => {
      const r = row as Record<string, unknown>;
      const countRaw = r.place_count;
      const place_count =
        typeof countRaw === "number"
          ? countRaw
          : typeof countRaw === "string"
            ? Number(countRaw) || 0
            : 0;
      return {
        id: String(r.id ?? ""),
        title: String(r.title ?? ""),
        color: normalizeListColor(typeof r.color === "string" ? r.color : null),
        place_count,
      };
    }),
    error: null,
  };
}

/** Places in a public list (SECURITY DEFINER RPC — no memo) */
export async function fetchPublicPlaceListPlaces(
  listId: string,
): Promise<{ data: PublicPlaceListPlace[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_public_place_list_places", {
    p_list_id: listId,
  });

  if (error) {
    return { data: [], error: mapDbError(error, "목록 장소를 불러오지 못했어요.") };
  }

  const rows = Array.isArray(data) ? data : [];
  const places: PublicPlaceListPlace[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const place_id = String(r.place_id ?? "").trim();
    if (!place_id) continue;
    const lat = typeof r.lat === "number" ? r.lat : Number(r.lat);
    const lng = typeof r.lng === "number" ? r.lng : Number(r.lng);
    places.push({
      place_id,
      name: String(r.name ?? ""),
      address: String(r.address ?? ""),
      category: String(r.category ?? ""),
      subcategory:
        typeof r.subcategory === "string"
          ? r.subcategory
          : r.subcategory === null
            ? null
            : undefined,
      list_color: normalizeListColor(typeof r.list_color === "string" ? r.list_color : null),
      ...(Number.isFinite(lat) ? { lat } : {}),
      ...(Number.isFinite(lng) ? { lng } : {}),
    });
  }
  return { data: places, error: null };
}

/** 목록 색만 변경 (이름과 분리) */
export async function updateListColor(
  listId: string,
  color: string | null,
): Promise<{ data: PlaceListSummary | null; error: string | null }> {
  const normalizedColor = normalizeListColor(color);
  if (color != null && color.trim() !== "" && normalizedColor === null) {
    return { data: null, error: "지원하지 않는 색이에요." };
  }

  const { data, error } = await supabase
    .from("place_lists")
    .update({ color: normalizedColor, updated_at: new Date().toISOString() })
    .eq("id", listId)
    .select(PLACE_LIST_SELECT)
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "색을 바꾸지 못했어요.") };
  }

  return { data: mapListRow(data as Record<string, unknown>), error: null };
}

/** 목록 삭제 */
export async function deleteList(listId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("place_lists").delete().eq("id", listId);
  if (error) {
    return { error: mapDbError(error, "목록을 삭제하지 못했어요.") };
  }
  return { error: null };
}

/** 목록의 장소들 (places 조인, sort_order 순) */
export async function fetchListPlaces(
  listId: string,
): Promise<{ data: PlaceListPlace[]; error: string | null }> {
  const { data, error } = await supabase
    .from("place_list_items")
    .select(
      "sort_order, places ( id, name, address, category, lat, lng, created_at, memo )",
    )
    .eq("list_id", listId)
    .order("sort_order", { ascending: true });

  if (error) {
    return { data: [], error: mapDbError(error, "목록 장소를 불러오지 못했어요.") };
  }

  const places: PlaceListPlace[] = [];
  for (const row of data ?? []) {
    const r = row as {
      sort_order?: number;
      places?: Record<string, unknown> | Record<string, unknown>[] | null;
    };
    const raw = Array.isArray(r.places) ? r.places[0] : r.places;
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id) continue;
    const lat = typeof raw.lat === "number" ? raw.lat : Number(raw.lat);
    const lng = typeof raw.lng === "number" ? raw.lng : Number(raw.lng);
    places.push({
      id,
      name: String(raw.name ?? ""),
      address: String(raw.address ?? ""),
      category: String(raw.category ?? ""),
      ...(Number.isFinite(lat) ? { lat } : {}),
      ...(Number.isFinite(lng) ? { lng } : {}),
      ...(typeof raw.created_at === "string" ? { created_at: raw.created_at } : {}),
      ...(typeof raw.memo === "string"
        ? { memo: raw.memo }
        : raw.memo === null
          ? { memo: null }
          : {}),
      sort_order: typeof r.sort_order === "number" ? r.sort_order : places.length,
    });
  }

  return { data: places, error: null };
}

async function nextSortOrder(listId: string): Promise<number> {
  const { data, error } = await supabase
    .from("place_list_items")
    .select("sort_order")
    .eq("list_id", listId)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (error || !data?.length) return 0;
  const max = data[0]?.sort_order;
  return typeof max === "number" && Number.isFinite(max) ? max + 1 : 0;
}

/** 장소 담기 — max(sort_order)+1, 이미 있으면 조용히 무시 */
export async function addPlaceToList(
  listId: string,
  placeId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("place_list_items")
    .select("list_id")
    .eq("list_id", listId)
    .eq("place_id", placeId)
    .maybeSingle();

  if (existingError) {
    return { error: mapDbError(existingError, "목록에 담지 못했어요.") };
  }
  if (existing) {
    return { error: null };
  }

  const sortOrder = await nextSortOrder(listId);
  const { error } = await supabase.from("place_list_items").insert({
    list_id: listId,
    place_id: placeId,
    sort_order: sortOrder,
  });

  if (error) {
    // 23505 unique_violation — 경쟁 상태로 이미 담긴 경우
    if (error.code === "23505") return { error: null };
    return { error: mapDbError(error, "목록에 담지 못했어요.") };
  }

  await supabase
    .from("place_lists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", listId);

  return { error: null };
}

export async function removePlaceFromList(
  listId: string,
  placeId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("place_list_items")
    .delete()
    .eq("list_id", listId)
    .eq("place_id", placeId);

  if (error) {
    return { error: mapDbError(error, "목록에서 빼지 못했어요.") };
  }

  await supabase
    .from("place_lists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", listId);

  return { error: null };
}

/** placeIds 배열 순서대로 sort_order 0..n-1 일괄 갱신 */
export async function reorderListPlaces(
  listId: string,
  placeIds: string[],
): Promise<{ error: string | null }> {
  const updates = placeIds.map((placeId, index) =>
    supabase
      .from("place_list_items")
      .update({ sort_order: index })
      .eq("list_id", listId)
      .eq("place_id", placeId),
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: mapDbError(failed.error, "순서를 저장하지 못했어요.") };
  }

  await supabase
    .from("place_lists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", listId);

  return { error: null };
}

/** 이 장소가 담긴 목록 id 들 */
export async function fetchListsForPlace(
  placeId: string,
): Promise<{ data: string[]; error: string | null }> {
  const { data, error } = await supabase
    .from("place_list_items")
    .select("list_id")
    .eq("place_id", placeId);

  if (error) {
    return { data: [], error: mapDbError(error, "목록 정보를 불러오지 못했어요.") };
  }

  return {
    data: (data ?? [])
      .map((row) => String((row as { list_id?: string }).list_id ?? ""))
      .filter(Boolean),
    error: null,
  };
}

export type PlaceListColorMap = Record<string, string | null>;

/**
 * 장소별 대표 목록 색 — place_list_items.created_at 최신 목록의 color.
 * RPC 1회(장소당 1행). RPC 없으면 조인 페이지네이션 폴백(N+1 아님).
 */
export async function fetchPlaceRepresentativeListColors(
  userId: string,
): Promise<{ data: PlaceListColorMap; error: string | null; elapsedMs: number; source: "rpc" | "join" }> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const rpc = await supabase.rpc("place_representative_list_colors", {
    p_user_id: userId,
  });

  if (!rpc.error && Array.isArray(rpc.data)) {
    const data: PlaceListColorMap = {};
    for (const row of rpc.data as Array<{ place_id?: string; color?: string | null }>) {
      const placeId = typeof row.place_id === "string" ? row.place_id : "";
      if (!placeId) continue;
      data[placeId] = normalizeListColor(row.color ?? null);
    }
    const elapsedMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    return { data, error: null, elapsedMs, source: "rpc" };
  }

  // Fallback: single join, paginated (PostgREST 1000-row pages) — still one logical query family, not N+1
  const pageSize = 1000;
  let from = 0;
  const rows: Array<{ place_id: string; created_at: string; color: string | null }> = [];

  for (;;) {
    const { data, error } = await supabase
      .from("place_list_items")
      .select("place_id, created_at, place_lists!inner(user_id, color)")
      .eq("place_lists.user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      const elapsedMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      return {
        data: {},
        error: mapDbError(error, "목록 색을 불러오지 못았어요."),
        elapsedMs,
        source: "join",
      };
    }

    for (const raw of data ?? []) {
      const r = raw as {
        place_id?: string;
        created_at?: string;
        place_lists?:
          | { user_id?: string; color?: string | null }
          | Array<{ user_id?: string; color?: string | null }>
          | null;
      };
      const placeId = typeof r.place_id === "string" ? r.place_id : "";
      if (!placeId) continue;
      const nested = Array.isArray(r.place_lists) ? r.place_lists[0] : r.place_lists;
      rows.push({
        place_id: placeId,
        created_at: typeof r.created_at === "string" ? r.created_at : "",
        color: nested && typeof nested === "object" ? (nested.color ?? null) : null,
      });
    }

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  // created_at DESC globally → first sighting per place_id is representative
  const data: PlaceListColorMap = {};
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(data, row.place_id)) continue;
    data[row.place_id] = normalizeListColor(row.color);
  }

  const elapsedMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return { data, error: null, elapsedMs, source: "join" };
}

export function mergePlacesWithListColors<T extends { id: string; listColor?: string | null }>(
  places: T[],
  colorByPlaceId: PlaceListColorMap,
): T[] {
  let changed = false;
  const next = places.map((p) => {
    const listColor = Object.prototype.hasOwnProperty.call(colorByPlaceId, p.id)
      ? colorByPlaceId[p.id] ?? null
      : null;
    if ((p.listColor ?? null) === listColor) return p;
    changed = true;
    return { ...p, listColor };
  });
  return changed ? next : places;
}
