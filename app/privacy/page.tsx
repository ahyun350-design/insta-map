import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "PindMap 개인정보처리방침",
};

export default function PrivacyPage() {
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
          <h1>개인정보처리방침</h1>

          <div className="not-prose my-6 rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-center text-sm font-medium text-zinc-800 sm:text-[15px]">
            본 서비스는 만 14세 이상부터 이용 가능합니다
          </div>

          <p>
            PindMap(이하 &quot;회사&quot;)은 「개인정보 보호법」에 따라 이용자의
            개인정보를 보호하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수
            있도록 다음과 같은 처리방침을 두고 있습니다.
          </p>

          <h2>1. 수집하는 개인정보 항목</h2>
          <p>
            회사는 회원가입 및 서비스 이용을 위해 다음의 개인정보를 수집합니다.
          </p>
          <ul>
            <li>필수: 이메일 주소, 비밀번호, 닉네임</li>
            <li>선택: 프로필 사진, 자기소개</li>
            <li>
              자동 수집: 기기 정보, IP 주소, 서비스 이용 기록, FCM(푸시 알림)
              토큰
            </li>
            <li>Instagram 게시물 URL (이용자가 직접 공유한 것)</li>
          </ul>

          <h2>2. 개인정보 수집 및 이용 목적</h2>
          <ul>
            <li>회원 가입 및 본인 확인</li>
            <li>서비스 제공 및 운영</li>
            <li>친구 팔로우 및 콘텐츠 공유 기능 제공</li>
            <li>푸시 알림 발송 (메시지, 좋아요, 댓글, 팔로우)</li>
            <li>
              이용자가 공유한 Instagram 공개 게시물의 위치 정보 추출 및 지도
              표시
            </li>
            <li>고객 문의 응답</li>
            <li>서비스 개선을 위한 통계 분석</li>
          </ul>

          <h2>3. 개인정보 보유 및 이용 기간</h2>
          <p>
            회원 탈퇴 시 즉시 파기합니다. 단, 관계 법령에 따라 보존이 필요한
            경우 해당 기간 동안 보관합니다.
          </p>

          <h2>4. 개인정보 제3자 제공</h2>
          <p>
            회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다.
          </p>

          <h2>4-1. Instagram 데이터 처리 안내</h2>
          <p>
            본 서비스는 이용자가 직접 입력한 Instagram 게시물 URL의 공개
            메타데이터(위치 정보, 본문 텍스트)만 추출하여 지도 표시 용도로
            사용합니다.
          </p>
          <p>이미지나 동영상 콘텐츠는 다운로드하거나 저장하지 않습니다.</p>
          <p>Instagram 비공개 계정의 데이터에는 접근하지 않습니다.</p>
          <p>
            본 서비스는 Meta Platforms, Inc. 및 Instagram과 어떠한 제휴, 협력,
            후원 관계가 없는 독립 서비스입니다.
          </p>

          <h2>5. 개인정보 처리 위탁</h2>
          <p>
            원활한 서비스 제공을 위해 다음 업체에 일부 업무를 위탁하고 있습니다.
          </p>
          <ul>
            <li>Supabase Inc. (데이터베이스 및 인증)</li>
            <li>Railway Corp. (서버 호스팅)</li>
            <li>Apify (인스타그램 게시물 분석)</li>
            <li>Kakao (지도 서비스)</li>
            <li>Google Firebase (푸시 알림 발송)</li>
          </ul>

          <h2>6. 이용자의 권리</h2>
          <p>
            이용자는 언제든지 본인의 개인정보를 조회·수정·삭제·처리정지를 요청할
            수 있습니다. 앱 내 설정에서 직접 처리하거나 아래 연락처로 문의해
            주세요.
          </p>
          <p>
            회원 탈퇴 시 모든 데이터가 즉시 영구 삭제됩니다. 탈퇴는 앱 내
            [마이페이지] &gt; [설정] &gt; [계정 영구 삭제]에서 진행할 수
            있습니다.
          </p>

          <h2>7. 개인정보 보호 책임자</h2>
          <ul>
            <li>이름: 조아현</li>
            <li>이메일: dontouchmm@gmail.com</li>
          </ul>

          <h2>8. 개인정보처리방침 변경</h2>
          <p>본 방침이 변경될 경우 앱 공지사항을 통해 사전 고지합니다.</p>

          <h2>9. 만 14세 미만 아동의 개인정보 보호</h2>
          <p>
            본 서비스는 만 14세 미만 아동의 회원가입을 제한하고 있으며,
            개인정보를 수집하지 않습니다.
          </p>
          <p>회원가입 시 본인이 만 14세 이상임을 확인하는 절차를 거칩니다.</p>
        </article>

        <footer className="mt-12 border-t border-zinc-200 pt-8 text-center text-sm text-zinc-500">
          최종 수정일: 2026년 5월 13일
        </footer>
      </div>
    </div>
  );
}
