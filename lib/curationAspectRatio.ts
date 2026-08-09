/** 인스타식 게시물 허용 비율 */
export type CurationAspectRatio = "1:1" | "4:5" | "1.91:1";

export const DEFAULT_CURATION_ASPECT_RATIO: CurationAspectRatio = "1:1";

const CANDIDATES: ReadonlyArray<{ id: CurationAspectRatio; value: number }> = [
  { id: "1:1", value: 1 },
  { id: "4:5", value: 4 / 5 },
  { id: "1.91:1", value: 1.91 },
];

export function isCurationAspectRatio(value: unknown): value is CurationAspectRatio {
  return value === "1:1" || value === "4:5" || value === "1.91:1";
}

/** DB/알 수 없는 값 → 기본 1:1 */
export function parseCurationAspectRatio(value: unknown): CurationAspectRatio {
  return isCurationAspectRatio(value) ? value : DEFAULT_CURATION_ASPECT_RATIO;
}

/** CSS `aspect-ratio` 속성에 넣을 값 (width / height) */
export function curationAspectRatioCss(ratio: CurationAspectRatio): string {
  switch (ratio) {
    case "4:5":
      return "4 / 5";
    case "1.91:1":
      return "1.91 / 1";
    default:
      return "1 / 1";
  }
}

/** width/height 원본 비율에서 가장 가까운 허용 비율 */
export function pickNearestCurationAspectRatio(width: number, height: number): CurationAspectRatio {
  if (!(width > 0) || !(height > 0)) return DEFAULT_CURATION_ASPECT_RATIO;
  const r = width / height;
  let best: CurationAspectRatio = DEFAULT_CURATION_ASPECT_RATIO;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of CANDIDATES) {
    const d = Math.abs(r - c.value);
    if (d < bestDist) {
      bestDist = d;
      best = c.id;
    }
  }
  return best;
}

export function loadImageNaturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("empty src"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** 이미지 URL/blob 비율 → 허용 aspect (실패 시 1:1) */
export async function resolveCurationAspectRatioFromSrc(src: string): Promise<CurationAspectRatio> {
  try {
    const { width, height } = await loadImageNaturalSize(src);
    return pickNearestCurationAspectRatio(width, height);
  } catch {
    return DEFAULT_CURATION_ASPECT_RATIO;
  }
}
