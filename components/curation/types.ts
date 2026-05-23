export type PostImageItem = {
  id: string;
  previewUrl: string;
  publicUrl?: string;
  status: "uploading" | "uploaded" | "failed";
  file?: File;
  error?: string;
};

export type CurationCategory = "맛집" | "카페" | "쇼핑" | "숙소" | "놀거리" | "여행지";

export type CurationStep = 1 | 2 | 3;

/** 큐레이션 업로드 최대 사진 수 (G-2) */
export const MAX_CURATION_PHOTOS = 15;
