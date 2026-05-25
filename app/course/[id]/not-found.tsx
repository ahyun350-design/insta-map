import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "코스를 찾을 수 없어요 | PindMap",
  description: "삭제되었거나 잘못된 코스 링크예요.",
};

export default function CourseNotFoundPage() {
  return (
    <div className="courseSharePage">
      <main className="courseShareMain courseShareNotFound">
        <h1 className="courseShareTitle">코스를 찾을 수 없어요</h1>
        <p className="courseShareSubtitle">
          삭제되었거나 주소가 잘못된 링크일 수 있어요.
        </p>
        <Link href="/" className="courseShareFooterCta courseShareFooterCtaInline">
          PindMap 홈으로
        </Link>
      </main>
    </div>
  );
}
