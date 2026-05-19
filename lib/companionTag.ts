export const COMPANION_TAGS = ["lover", "friend", "pet", "alone", "family", "parent", "kid"] as const;
export type CompanionTag = (typeof COMPANION_TAGS)[number];

export const COMPANION_TAG_OPTIONS: { value: CompanionTag; emoji: string; label: string }[] = [
  { value: "lover", emoji: "💑", label: "연인이랑" },
  { value: "friend", emoji: "👫", label: "친구랑" },
  { value: "pet", emoji: "🐾", label: "반려동물이랑" },
  { value: "alone", emoji: "🧍", label: "혼자" },
  { value: "family", emoji: "👨‍👩‍👧", label: "가족이랑" },
  { value: "parent", emoji: "👵", label: "부모님이랑" },
  { value: "kid", emoji: "👶", label: "아이랑" },
];

export function isCompanionTag(value: unknown): value is CompanionTag {
  return typeof value === "string" && (COMPANION_TAGS as readonly string[]).includes(value);
}
