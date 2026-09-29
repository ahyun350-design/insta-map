import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "찾을 수 없는 목록 | PindMap",
  description: "삭제되었거나 비공개·잘못된 링크예요.",
};

export default function PublicListNotFoundPage() {
  return (
    <div className="publicListSharePage publicListShareNotFound">
      <main className="publicListShareNotFoundMain">
        <h1 className="publicListShareTitle" data-testid="public-list-not-found">
          찾을 수 없는 목록
        </h1>
        <p className="publicListShareSub">
          삭제되었거나 비공개·주소가 잘못된 링크일 수 있어요.
        </p>
        <Link href="/" className="courseShareFooterCta courseShareFooterCtaInline">
          PindMap 홈으로
        </Link>
      </main>
    </div>
  );
}
