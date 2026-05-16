"use client";

import { useEffect, useState } from "react";
import type { SavedCourse } from "@/lib/courses";

type ChatCourseCardProps = {
  courseId: string;
  cleanText: string;
  isMine: boolean;
  currentUserId: string;
  ensureCourseLoaded: (courseId: string) => Promise<SavedCourse | null>;
  onOpenCourse: (course: SavedCourse, readOnly: boolean) => void;
};

function formatPlacePreview(course: SavedCourse): string {
  const items = course.items ?? [];
  const total = course.place_count ?? items.length;
  const lines: string[] = [];
  for (let i = 0; i < Math.min(2, items.length); i++) {
    lines.push(`${i + 1}. ${items[i]!.name}`);
  }
  if (total > 3 && lines.length > 0) {
    lines.push(`...외 ${total - 2}곳`);
  }
  return lines.join("\n");
}

export function ChatCourseCard({
  courseId,
  cleanText,
  isMine,
  currentUserId,
  ensureCourseLoaded,
  onOpenCourse,
}: ChatCourseCardProps) {
  const [course, setCourse] = useState<SavedCourse | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ensureCourseLoaded(courseId).then((data) => {
      if (cancelled) return;
      setCourse(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, ensureCourseLoaded]);

  const previewColor = isMine ? "rgba(255,255,255,0.75)" : "#777";
  const btnBg = isMine ? "rgba(255,255,255,0.2)" : "#fff";
  const btnBorder = isMine ? "1px solid rgba(255,255,255,0.3)" : "1px solid #1a2a7a";
  const btnColor = isMine ? "#fff" : "#1a2a7a";

  const handleOpen = () => {
    void (async () => {
      const resolved = course ?? (await ensureCourseLoaded(courseId));
      if (!resolved) return;
      onOpenCourse(resolved, resolved.user_id !== currentUserId);
    })();
  };

  return (
    <>
      {cleanText ? (
        <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{cleanText}</span>
      ) : null}
      <div style={{ marginTop: cleanText ? 8 : 0 }}>
        {loading && (
          <p style={{ margin: 0, fontSize: 12, color: previewColor }}>코스 불러오는 중...</p>
        )}
        {!loading && course && (
          <p style={{ margin: 0, fontSize: 12, color: previewColor, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
            {formatPlacePreview(course)}
          </p>
        )}
        {!loading && !course && (
          <p style={{ margin: 0, fontSize: 12, color: previewColor }}>삭제된 코스예요</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading || !course}
        style={{
          display: "block",
          width: "100%",
          marginTop: 8,
          padding: "8px",
          background: btnBg,
          border: btnBorder,
          borderRadius: 8,
          color: btnColor,
          fontSize: 11,
          fontWeight: 500,
          cursor: loading || !course ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          opacity: loading || !course ? 0.6 : 1,
          boxSizing: "border-box",
        }}
      >
        코스 열기
      </button>
    </>
  );
}
