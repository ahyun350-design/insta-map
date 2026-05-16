import { supabase } from "./supabase";

export type SavedCourseItem = {
  id: string;
  name: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
};

export type SavedCourse = {
  id: string;
  user_id: string;
  title: string;
  items: SavedCourseItem[];
  place_count: number;
  created_at: string;
  updated_at: string;
};

function mapInsertError(error: { code?: string; message?: string }): string {
  if (error.code === "23505" || error.code === "42501") {
    return "코스를 저장하지 못했어요. 다시 시도해주세요";
  }
  return error.message || "코스를 저장하지 못했어요. 다시 시도해주세요";
}

export async function saveCourse(
  userId: string,
  title: string,
  items: SavedCourseItem[],
): Promise<{ data: SavedCourse | null; error: string | null }> {
  const trimmed = title.trim();
  if (!trimmed) {
    return { data: null, error: "이름을 입력해주세요" };
  }
  if (trimmed.length > 60) {
    return { data: null, error: "이름은 60자 이내로 입력해주세요" };
  }
  if (items.length === 0) {
    return { data: null, error: "장소가 비어있어요" };
  }

  const { data, error } = await supabase
    .from("courses")
    .insert({
      user_id: userId,
      title: trimmed,
      items,
      place_count: items.length,
    })
    .select("*")
    .single();

  if (error) {
    return { data: null, error: mapInsertError(error) };
  }

  return { data: data as SavedCourse, error: null };
}
