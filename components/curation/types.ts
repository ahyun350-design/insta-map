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
