"use client";

import { useEffect, useState } from "react";
import type { SavedCourse } from "@/lib/courses";

type Props = {
  courseId: string;
  currentUserId: string;
  ensureCourseLoaded: (courseId: string) => Promise<SavedCourse | null>;
  onOpenCourse: (course: SavedCourse, readOnly: boolean) => void;
  onCourseUnavailable?: () => void;
};

export function FeedPostLinkedCourse({
  courseId,
  currentUserId,
  ensureCourseLoaded,
  onOpenCourse,
  onCourseUnavailable,
}: Props) {
  const [placeCount, setPlaceCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ensureCourseLoaded(courseId).then((data) => {
      if (cancelled) return;
      if (!data) {
        setPlaceCount(null);
      } else {
        setPlaceCount(data.place_count ?? data.items?.length ?? 0);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, ensureCourseLoaded]);

  const label = loading
    ? "코스 불러오는 중..."
    : placeCount != null && placeCount > 0
      ? `📍 코스 ${placeCount}개 장소 보기`
      : placeCount === null
        ? "코스를 불러올 수 없어요"
        : "이 장소들로 만든 코스 보기";

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    void (async () => {
      const course = await ensureCourseLoaded(courseId);
      if (!course) {
        onCourseUnavailable?.();
        return;
      }
      onOpenCourse(course, course.user_id !== currentUserId);
    })();
  };

  return (
    <button
      type="button"
      className="feedPostLinkedCourse"
      onClick={handleOpen}
      disabled={loading && placeCount === null}
      aria-label="연결된 코스 보기"
    >
      {label}
    </button>
  );
}
