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

function mapDbError(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "23505" || error.code === "42501") {
    return `${fallback} 다시 시도해주세요`;
  }
  return error.message || fallback;
}

function mapInsertError(error: { code?: string; message?: string }): string {
  return mapDbError(error, "코스를 저장하지 못했어요.");
}

/** created_at → "5월 16일" (올해만) / "2025년 12월 31일" */
export function formatCourseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(d);
  }
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(d);
}

export async function fetchMyCourses(
  userId: string,
): Promise<{ data: SavedCourse[]; error: string | null }> {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error: mapDbError(error, "코스 목록을 불러오지 못했어요.") };
  }

  return { data: (data ?? []) as SavedCourse[], error: null };
}

function validateCourseTitle(trimmed: string): string | null {
  if (!trimmed) return "제목을 입력해주세요";
  if (trimmed.length > 60) return "제목은 60자 이내로 입력해주세요";
  return null;
}

export async function updateCourseItems(
  courseId: string,
  title: string,
  items: SavedCourseItem[],
): Promise<{ data: SavedCourse | null; error: string | null }> {
  const trimmed = title.trim();
  const validationError = validateCourseTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError };
  }
  if (items.length === 0) {
    return { data: null, error: "장소가 비어있어요" };
  }

  const { data, error } = await supabase
    .from("courses")
    .update({ title: trimmed, items, place_count: items.length })
    .eq("id", courseId)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "코스를 수정하지 못했어요.") };
  }

  return { data: data as SavedCourse, error: null };
}

export async function updateCourseTitle(
  courseId: string,
  newTitle: string,
): Promise<{ data: SavedCourse | null; error: string | null }> {
  const trimmed = newTitle.trim();
  const validationError = validateCourseTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const { data, error } = await supabase
    .from("courses")
    .update({ title: trimmed })
    .eq("id", courseId)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: mapDbError(error, "제목을 변경하지 못했어요.") };
  }

  return { data: data as SavedCourse, error: null };
}

export async function deleteCourse(courseId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("courses").delete().eq("id", courseId);

  if (error) {
    return { error: mapDbError(error, "코스를 삭제하지 못했어요.") };
  }

  return { error: null };
}

export async function saveCourse(
  userId: string,
  title: string,
  items: SavedCourseItem[],
): Promise<{ data: SavedCourse | null; error: string | null }> {
  const trimmed = title.trim();
  const validationError = validateCourseTitle(trimmed);
  if (validationError) {
    return { data: null, error: validationError === "제목을 입력해주세요" ? "이름을 입력해주세요" : validationError };
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

/** 채팅 공유용 스냅샷 텍스트 + [course:id] 마커 */
export function buildCourseShareText(course: SavedCourse): string {
  const count = course.place_count ?? course.items.length;
  return `📍 코스: ${course.title} · ${count}곳\n\n[course:${course.id}]`;
}

export function parseCourseMarker(text: string): { courseId: string; cleanText: string } | null {
  const match = text.match(/\[course:([^\]]+)\]/);
  if (!match) return null;
  return {
    courseId: match[1]!,
    cleanText: text.replace(/\[course:[^\]]+\]/, "").trim(),
  };
}

export async function fetchCourseById(
  courseId: string,
): Promise<{ data: SavedCourse | null; error: string | null }> {
  const { data, error } = await supabase.from("courses").select("*").eq("id", courseId).maybeSingle();

  if (error) {
    return { data: null, error: mapDbError(error, "코스를 불러오지 못했어요.") };
  }
  if (!data) {
    return { data: null, error: "삭제된 코스이거나 접근할 수 없는 코스예요" };
  }

  return { data: data as SavedCourse, error: null };
}
