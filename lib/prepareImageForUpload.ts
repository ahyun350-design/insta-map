import { thumbFileNameFromOriginal } from "@/lib/postImageThumb";

const HEIC_EXT = /\.(heic|heif)$/i;

function isHeicLike(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || HEIC_EXT.test(file.name);
}

export type PreparedUploadImages = {
  /** maxWidthOrHeight 1080, maxSizeMB 0.5 */
  full: File;
  /** maxWidthOrHeight 600, target ~40–60KB */
  thumb: File;
};

async function heicToJpeg(original: File): Promise<File> {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: original,
    toType: "image/jpeg",
    quality: 0.85,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const base =
    original.name.replace(HEIC_EXT, "").replace(/\.[^/.]+$/, "") || "image";
  const source = new File([blob], `${base}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
  console.log("[prepareImageForUpload] HEIC→JPEG", {
    beforeBytes: original.size,
    afterBytes: source.size,
  });
  return source;
}

/**
 * HEIC → JPEG 변환(가능 시) 후 원본(1080/0.5MB) + 썸네일(600/~50KB) 생성.
 * 아바타·코스 초대장은 `.full`만 업로드하면 된다.
 */
export async function prepareImageForUpload(original: File): Promise<PreparedUploadImages> {
  let source: File = original;
  if (isHeicLike(original)) {
    source = await heicToJpeg(original);
  }

  const { default: imageCompression } = await import("browser-image-compression");

  const [fullCompressed, thumbCompressed] = await Promise.all([
    imageCompression(source, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1080,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.78,
    }),
    imageCompression(source, {
      maxSizeMB: 0.06,
      maxWidthOrHeight: 600,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.7,
    }),
  ]);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const fullName = `${stamp}.jpg`;
  const full = new File([fullCompressed], fullName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
  const thumb = new File([thumbCompressed], thumbFileNameFromOriginal(fullName), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  console.log("[prepareImageForUpload] compressed", {
    name: original.name,
    beforeBytes: original.size,
    fullBytes: full.size,
    thumbBytes: thumb.size,
  });

  return { full, thumb };
}
