import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CourseShareView } from "@/components/CourseShareView";
import { fetchPublicCourseById } from "@/lib/courses";
import { getSiteOrigin } from "@/lib/pindmapLinks";

type PageProps = {
  params: Promise<{ id: string }>;
};

async function loadCourse(id: string) {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const { data, error } = await fetchPublicCourseById(trimmed);
  if (error || !data) return null;
  return data;
}

function detectIOS(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const course = await loadCourse(id);
  const siteOrigin = getSiteOrigin();

  if (!course) {
    return {
      title: "코스를 찾을 수 없어요 | PindMap",
      description: "삭제되었거나 잘못된 링크예요.",
    };
  }

  const placeCount = course.place_count ?? course.items.length;
  const description = `PindMap에서 ${placeCount}곳 코스 보기`;
  const ogImage = `${siteOrigin}/date-monkey.png`;

  let ogImageWidth: number | undefined;
  let ogImageHeight: number | undefined;
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const buffer = await fs.readFile(path.join(process.cwd(), "public", "date-monkey.png"));
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      if (w > 0 && h > 0) {
        ogImageWidth = w;
        ogImageHeight = h;
      }
    }
  } catch {
    /* width/height omitted when unreadable */
  }

  const ogImageEntry: { url: string; alt: string; width?: number; height?: number } = {
    url: ogImage,
    alt: "PindMap 데이트 코스 초대장",
  };
  if (ogImageWidth != null && ogImageHeight != null) {
    ogImageEntry.width = ogImageWidth;
    ogImageEntry.height = ogImageHeight;
  }

  return {
    title: `${course.title} | PindMap`,
    description,
    openGraph: {
      title: course.title,
      description,
      type: "website",
      url: `${siteOrigin}/course/${id}`,
      siteName: "PindMap",
      locale: "ko_KR",
      images: [ogImageEntry],
    },
    twitter: {
      card: "summary_large_image",
      title: course.title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicCoursePage({ params }: PageProps) {
  const { id } = await params;
  const course = await loadCourse(id);
  if (!course) {
    notFound();
  }

  const userAgent = (await headers()).get("user-agent") ?? "";
  const isIOS = detectIOS(userAgent);

  return <CourseShareView course={course} isIOS={isIOS} />;
}
