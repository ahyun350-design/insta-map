import { supabase } from "./supabase";
import { prepareImageForUpload } from "./prepareImageForUpload";

function avatarObjectPath(userId: string): string {
  return `${userId}/avatar.jpg`;
}

/**
 * 프로필 아바타 업로드 — avatars 버킷, 경로 `{userId}/avatar.jpg` (upsert).
 * HEIC·대용량은 prepareImageForUpload으로 압축 후 업로드.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!userId) {
    throw new Error("userId가 필요해요");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있어요");
  }

  const prepared = await prepareImageForUpload(file);
  const path = avatarObjectPath(userId);

  const { error } = await supabase.storage.from("avatars").upload(path, prepared, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });

  if (error) {
    console.error("[uploadAvatar]", error);
    const err = new Error("avatar_upload_failed");
    const code = (error as { statusCode?: string | number; error?: string; name?: string }).statusCode
      ?? (error as { error?: string }).error
      ?? "avatar_upload_failed";
    (err as Error & { code?: string }).code = String(code);
    throw err;
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const base = data?.publicUrl?.trim();
  if (!base) {
    throw new Error("public URL을 가져올 수 없어요");
  }

  return `${base}?t=${Date.now()}`;
}
