import { COMPANION_TAG_OPTIONS, type CompanionTag } from "@/lib/companionTag";

export type HomeFeedSearchablePost = {
  title: string;
  comment: string;
  placeName: string;
  address: string;
  user: string;
  category: string;
  companionTag?: CompanionTag | null;
};

function companionTagSearchLabel(tag: CompanionTag | null | undefined): string {
  if (!tag) return "";
  return COMPANION_TAG_OPTIONS.find((o) => o.value === tag)?.label ?? "";
}

export function feedPostMatchesHomeSearch(post: HomeFeedSearchablePost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const fields = [
    post.title,
    post.comment,
    post.placeName,
    post.address,
    post.user,
    post.category,
    companionTagSearchLabel(post.companionTag),
  ];

  return fields.some((field) => (field ?? "").toLowerCase().includes(q));
}
