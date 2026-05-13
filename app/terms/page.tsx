import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "이용약관",
  description: "PindMap 서비스 이용약관",
};

export default function TermsPage() {
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
          <h1>서비스 이용약관</h1>

          <h2>제1조 (목적)</h2>
          <p>
            본 약관은 PindMap(이하 &quot;회사&quot;)이 제공하는 서비스의 이용과
            관련하여 회사와 이용자의 권리, 의무 및 책임사항을 규정함을 목적으로
            합니다.
          </p>

          <h2>제2조 (정의)</h2>
          <ul>
            <li>
              &quot;서비스&quot;: PindMap이 제공하는 인스타그램 게시물 기반 지도
              정리 서비스
            </li>
            <li>
              &quot;이용자&quot;: 본 약관에 동의하고 서비스를 이용하는 회원
            </li>
          </ul>

          <h2>제3조 (약관의 효력 및 변경)</h2>
          <ul>
            <li>본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다.</li>
            <li>
              회사는 필요 시 약관을 변경할 수 있으며, 변경된 약관은 앱
              공지사항을 통해 사전 고지합니다.
            </li>
          </ul>

          <h2>제4조 (이용 계약의 성립)</h2>
          <ul>
            <li>만 14세 이상이어야 가입할 수 있습니다.</li>
            <li>
              회원가입 시 약관 동의 및 개인정보 처리방침 동의가 필수입니다.
            </li>
            <li>
              회사는 다음 경우 가입을 거부할 수 있습니다:
              <ul>
                <li>타인의 정보를 도용한 경우</li>
                <li>만 14세 미만인 경우</li>
                <li>부정한 목적으로 신청한 경우</li>
              </ul>
            </li>
          </ul>

          <h2>제5조 (회원의 의무)</h2>
          <ul>
            <li>이용자는 본인의 계정 정보를 안전하게 관리해야 합니다.</li>
            <li>
              다음 행위를 해서는 안 됩니다:
              <ul>
                <li>타인의 개인정보 도용</li>
                <li>음란물, 폭력적 콘텐츠, 차별·혐오 표현 게시</li>
                <li>저작권 등 타인의 권리 침해</li>
                <li>서비스의 정상적 운영을 방해하는 행위</li>
                <li>인스타그램 비공개 게시물 URL 입력</li>
                <li>자동화 도구를 이용한 비정상적 사용</li>
              </ul>
            </li>
          </ul>

          <h2>제6조 (회사의 의무)</h2>
          <ul>
            <li>회사는 안정적인 서비스 제공을 위해 노력합니다.</li>
            <li>
              이용자의 개인정보를 「개인정보처리방침」에 따라 보호합니다.
            </li>
            <li>이용자의 정당한 의견이나 불만에 신속히 대응합니다.</li>
          </ul>

          <h2>제7조 (서비스의 제공 및 변경)</h2>
          <ul>
            <li>서비스는 연중무휴 24시간 제공을 원칙으로 합니다.</li>
            <li>
              시스템 점검, 통신 장애, 천재지변 등의 사유로 일시 중단될 수
              있습니다.
            </li>
            <li>
              회사는 서비스의 내용을 변경할 수 있으며, 변경 시 앱 공지사항을
              통해 안내합니다.
            </li>
          </ul>

          <h2>제8조 (콘텐츠의 저작권)</h2>
          <ul>
            <li>이용자가 게시한 콘텐츠의 저작권은 이용자에게 있습니다.</li>
            <li>
              이용자는 서비스 운영을 위한 범위 내에서 회사에 이용권을
              부여합니다.
            </li>
            <li>
              본 서비스에서 추출하는 Instagram 메타데이터는 이용자가 직접 공개한
              게시물에 한합니다.
            </li>
          </ul>

          <h2>제9조 (인스타그램 데이터 사용에 관한 사항) ⭐️ 중요</h2>
          <ul>
            <li>
              본 서비스는 이용자가 직접 입력한 Instagram 공개 게시물의 위치
              정보와 본문 메타데이터만을 추출하여 사용합니다.
            </li>
            <li>
              이미지나 동영상 콘텐츠는 다운로드, 저장, 재배포하지 않습니다.
            </li>
            <li>
              본 서비스는 Meta Platforms, Inc. 및 Instagram과 어떠한 제휴,
              협력, 후원 관계가 없는 독립 서비스입니다.
            </li>
            <li>
              Instagram 약관 또는 정책 위반의 책임은 해당 콘텐츠를 입력한
              이용자에게 있습니다.
            </li>
          </ul>

          <h2>제10조 (회원 탈퇴 및 자격 상실)</h2>
          <ul>
            <li>
              이용자는 언제든지 [마이페이지] &gt; [설정] &gt; [계정 영구 삭제]에서
              탈퇴할 수 있습니다.
            </li>
            <li>
              회사는 다음 경우 이용자의 자격을 제한 또는 상실시킬 수 있습니다:
              <ul>
                <li>약관 위반</li>
                <li>다른 이용자에게 피해를 끼친 경우</li>
                <li>회원으로서의 자격을 상실한 경우</li>
              </ul>
            </li>
            <li>탈퇴 시 모든 데이터는 즉시 영구 삭제됩니다.</li>
          </ul>

          <h2>제11조 (면책 조항)</h2>
          <ul>
            <li>
              천재지변, 전쟁, 통신 장애 등 불가항력으로 인한 서비스 중단에 대해
              책임지지 않습니다.
            </li>
            <li>
              이용자의 귀책 사유로 인한 서비스 이용 장애에 대해 책임지지
              않습니다.
            </li>
            <li>
              이용자가 게시한 콘텐츠로 인한 분쟁에 대해 회사는 개입하지 않습니다.
            </li>
            <li>
              이용자가 입력한 Instagram URL의 정확성, 합법성에 대해 회사는
              책임지지 않습니다.
            </li>
          </ul>

          <h2>제12조 (분쟁 해결)</h2>
          <ul>
            <li>
              본 약관과 관련하여 발생한 분쟁은 대한민국 법률을 따릅니다.
            </li>
            <li>
              분쟁 발생 시 회사의 본점 소재지를 관할하는 법원을 합의관할로
              합니다.
            </li>
          </ul>

          <h2>제13조 (운영자 정보)</h2>
          <ul>
            <li>운영자: 조아현 (개인 운영)</li>
            <li>이메일: dontouchmm@gmail.com</li>
          </ul>
        </article>

        <footer className="mt-12 border-t border-zinc-200 pt-8 text-center text-sm text-zinc-500">
          최종 수정일: 2026년 5월 13일
        </footer>
      </div>
    </div>
  );
}
