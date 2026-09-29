import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicListShareView } from "@/components/PublicListShareView";
import {
  fetchPublicPlaceList,
  fetchPublicPlaceListPlaces,
} from "@/lib/placeLists";
import { getSiteOrigin } from "@/lib/pindmapLinks";

type PageProps = {
  params: Promise<{ listId: string }>;
};

async function loadList(listId: string) {
  const trimmed = listId.trim();
  if (!trimmed) return null;
  const { data, error } = await fetchPublicPlaceList(trimmed);
  if (error || !data) return null;
  return data;
}

function detectIOS(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { listId } = await params;
  const list = await loadList(listId);
  const siteOrigin = getSiteOrigin();

  if (!list) {
    return {
      title: "찾을 수 없는 목록 | PindMap",
      description: "삭제되었거나 비공개·잘못된 링크예요.",
    };
  }

  const placeCount = list.place_count;
  const description = list.owner_username
    ? `@${list.owner_username}의 목록 · ${placeCount}곳 — PindMap`
    : `PindMap에서 ${placeCount}곳 목록 보기`;
  const ogImage = `${siteOrigin}/pindmap-og-card.png`;

  return {
    title: `${list.title} | PindMap`,
    description,
    openGraph: {
      title: list.title,
      description,
      type: "website",
      url: `${siteOrigin}/list/${listId}`,
      siteName: "PindMap",
      locale: "ko_KR",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: "PindMap",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: list.title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicListPage({ params }: PageProps) {
  const { listId } = await params;
  const list = await loadList(listId);
  if (!list) {
    notFound();
  }

  const { data: places } = await fetchPublicPlaceListPlaces(list.id);
  const userAgent = (await headers()).get("user-agent") ?? "";
  const isIOS = detectIOS(userAgent);

  return (
    <PublicListShareView list={list} places={places} isIOS={isIOS} />
  );
}
