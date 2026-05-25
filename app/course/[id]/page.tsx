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
  const ogImage = `${siteOrigin}/icon.svg`;

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
      images: [
        {
          url: ogImage,
          width: 512,
          height: 512,
          alt: "PindMap",
        },
      ],
    },
    twitter: {
      card: "summary",
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
