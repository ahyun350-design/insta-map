import { supabase } from "./supabase";
import { toUserMessage } from "./userErrorMessage";

export type PlaceListSummary = {
  id: string;
  user_id: string;
  title: string;
  place_count: number;
  created_at: string;
  updated_at: string;
};

export type PlaceListPlace = {
  id: string;
  name: string;
  address: string;
  category: string;
  lat?: number;
  lng?: number;
  created_at?: string;
  sort_order: number;
};

function mapDbError(error: { code?: string; message?: string }, fallback: string): string {
  return toUserMessage(error, fallback);
}

function validateListTitle(trimmed: string): string | null {
  if (!trimmed) return "이름을 입력해주세요";
  if (trimmed.length > 60) return "이름은 60자 이내로 입력해주세요";
  return null;
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
    place_count: placeCount,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

/** 내 목록 전체 + 각 목록의 장소 수 */
export async function fetchMyLists(
  userId: string,
): Promise<{ data: PlaceListSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from("place_lists")
    .select("id, user_id, title, created_at, updated_at, place_list_items(count)")
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

/** 목록 생성 */
export async function createList(
  userId: string,
  title: string,
): Promise<{ data: PlaceListSummary | null; error: string | null }> {
  const trimmed = title.trim();
  const validationError = validateListTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const { data, error } = await supabase
    .from("place_lists")
    .insert({ user_id: userId, title: trimmed })
    .select("id, user_id, title, created_at, updated_at")
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "목록을 만들지 못했어요.") };
  }

  return {
    data: mapListRow({ ...(data as Record<string, unknown>), place_count: 0 }),
    error: null,
  };
}

/** 이름 수정 (updated_at 갱신) */
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
    .select("id, user_id, title, created_at, updated_at, place_list_items(count)")
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "이름을 바꾸지 못했어요.") };
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
      "sort_order, places ( id, name, address, category, lat, lng, created_at )",
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
