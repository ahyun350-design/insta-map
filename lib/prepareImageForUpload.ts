import imageCompression from "browser-image-compression";

const HEIC_EXT = /\.(heic|heif)$/i;

function isHeicLike(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || HEIC_EXT.test(file.name);
}

/**
 * HEIC → JPEG 변환(가능 시) 후 1MB 이하·1920px 이내로 압축해 Storage 업로드용 File 생성
 */
export async function prepareImageForUpload(original: File): Promise<File> {
  let source: File = original;

  if (isHeicLike(original)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: original,
      toType: "image/jpeg",
      quality: 0.85,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const base =
      original.name.replace(HEIC_EXT, "").replace(/\.[^/.]+$/, "") || "image";
    source = new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    console.log("[prepareImageForUpload] HEIC→JPEG", {
      beforeBytes: original.size,
      afterBytes: source.size,
    });
  }

  const compressed = await imageCompression(source, {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.82,
  });

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const out = new File([compressed], `${stamp}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  console.log("[prepareImageForUpload] compressed", {
    name: original.name,
    beforeBytes: original.size,
    afterBytes: out.size,
  });

  return out;
}
