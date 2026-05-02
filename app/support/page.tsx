import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "지원 센터",
  description: "PindMap 지원 및 자주 묻는 질문",
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 pb-16 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
          >
            ← 홈으로
          </Link>
        </nav>

        <article className="prose prose-zinc max-w-none prose-headings:scroll-mt-24 prose-p:leading-relaxed prose-li:leading-relaxed sm:prose-base">
          <h1>지원 센터</h1>

          <p>PindMap을 이용해 주셔서 감사합니다.</p>

          <h2>자주 묻는 질문</h2>

          <h3>Q. 인스타그램 링크가 지도로 변환되지 않아요</h3>
          <p>
            공개 게시물만 변환 가능합니다. 비공개 계정의 게시물은 변환되지
            않습니다. 또한 위치 태그가 없는 게시물은 자동 변환이 어려울 수
            있습니다.
          </p>

          <h3>Q. 회원 탈퇴는 어떻게 하나요?</h3>
          <p>
            앱 내 [설정] &gt; [계정] &gt; [회원 탈퇴]에서 진행할 수 있습니다.
            탈퇴 시 모든 데이터는 즉시 삭제됩니다.
          </p>

          <h3>Q. 비밀번호를 잊어버렸어요</h3>
          <p>
            로그인 화면의 [비밀번호 찾기]를 통해 가입한 이메일로 재설정 링크를
            받으실 수 있습니다.
          </p>

          <h3>Q. 친구 추가는 어떻게 하나요?</h3>
          <p>검색에서 친구의 닉네임을 찾아 팔로우하면 됩니다.</p>

          <h3>Q. 핀에 잘못된 위치가 표시돼요</h3>
          <p>
            핀을 길게 누르면 위치 수정 메뉴가 나타납니다. 직접 올바른 위치로
            이동시킬 수 있습니다.
          </p>

          <h2>문의하기</h2>
          <p>위 답변에서 해결되지 않은 문제는 아래로 연락주세요.</p>
          <ul>
            <li>이메일: dontouchmm@gmail.com</li>
            <li>인스타그램: @pindmap</li>
          </ul>
          <p>평일 기준 24시간 이내에 답변드립니다.</p>
        </article>

        <footer className="mt-12 border-t border-zinc-200 pt-8 text-center text-sm text-zinc-500">
          최종 수정일: 2026년 5월 2일
        </footer>
      </div>
    </div>
  );
}
