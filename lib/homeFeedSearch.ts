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

const HOME_SEARCH_NORMALIZE_RE = /[\s\-_·,./()]/g;

function normalizeForHomeSearch(text: string): string {
  return text.toLowerCase().replace(HOME_SEARCH_NORMALIZE_RE, "");
}

function companionTagSearchLabel(tag: CompanionTag | null | undefined): string {
  if (!tag) return "";
  return COMPANION_TAG_OPTIONS.find((o) => o.value === tag)?.label ?? "";
}

export function feedPostMatchesHomeSearch(post: HomeFeedSearchablePost, query: string): boolean {
  const rawQ = query.trim();
  if (!rawQ) return true;

  const q = normalizeForHomeSearch(rawQ);
  if (!q) return false;

  const normalizedFields = [
    post.title,
    post.comment,
    post.placeName,
    post.address,
    post.user,
  ].map((field) => normalizeForHomeSearch(field ?? ""));

  if (normalizedFields.some((field) => field.includes(q))) {
    return true;
  }

  const simpleQ = rawQ.toLowerCase();
  const simpleFields = [post.category, companionTagSearchLabel(post.companionTag)].map(
    (field) => (field ?? "").toLowerCase(),
  );

  return simpleFields.some((field) => field.includes(simpleQ));
}
