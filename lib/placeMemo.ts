import { supabase } from "@/lib/supabase";

const MEMO_MAX_LEN = 200;

/** places.memo 저장. 빈 문자열 → null(삭제). 200자 초과 시 truncate. */
export async function savePlaceMemo(
  placeId: string,
  memo: string,
): Promise<{ error: string | null; memo: string | null }> {
  const id = placeId.trim();
  if (!id) return { error: "장소 id가 없어요", memo: null };

  let next: string | null = memo.trim();
  if (!next) next = null;
  else if (next.length > MEMO_MAX_LEN) next = next.slice(0, MEMO_MAX_LEN);

  const { error } = await supabase.from("places").update({ memo: next }).eq("id", id);
  if (error) {
    console.error("[PindMap:places] savePlaceMemo failed", error);
    return { error: error.message || "메모를 저장하지 못했어요", memo: next };
  }
  return { error: null, memo: next };
}

export const PLACE_MEMO_MAX_LEN = MEMO_MAX_LEN;
