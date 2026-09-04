"use client";

import { useEffect, useState } from "react";

const PROGRESS_MESSAGES = [
  "맛집 냄새 맡는 중 🐕",
  "지도에 핀 꽂을 자리 찾는 중 📍",
  "릴스 속 장소 훔쳐보는 중 👀",
  "좋은 곳만 쏙쏙 고르는 중 ✨",
  "주소 확인하는 중 🔍",
];

const TIPS = [
  {
    emoji: "⚡",
    title: "여러 개 한꺼번에 저장 OK",
    desc: "릴스 하나 넣고 기다릴 필요 없이, 계속 링크를 추가하면 동시에 저장돼요",
  },
  {
    emoji: "🗺️",
    title: "저장한 곳들로 코스가 자동 완성",
    desc: "동선까지 계산해서 순서대로 짜줘요. 데이트·나들이 계획 끝",
  },
  {
    emoji: "🚶",
    title: "앱 안에서 바로 도보 길찾기",
    desc: "저장한 장소를 탭하면 지금 위치에서 걸어가는 길 안내. 다른 지도앱 안 켜도 돼요",
  },
  {
    emoji: "🔍",
    title: "지도 움직이고 '이 지역 재검색'",
    desc: "보고 있는 동네에서 맛집·카페를 다시 찾을 수 있어요",
  },
  {
    emoji: "👥",
    title: "친구랑 큐레이션·코스 공유",
    desc: "내가 모은 맛집 리스트를 통째로 보내고 받을 수 있어요",
  },
  {
    emoji: "📍",
    title: "카테고리별 이모지 핀",
    desc: "카페 ☕, 맛집 🍽️, 쇼핑 🛍️... 지도에서 한눈에 구분돼요",
  },
  {
    emoji: "✨",
    title: "링크만 붙여넣으면 끝",
    desc: "릴스·게시물 캡션 속 장소를 자동으로 찾아 지도에 저장해요",
  },
];

const TIP_ROTATE_MS = 6500;

/** 캡션에 장소/캡션 없음 — 재시도 무의미 */
export function isExtractNoPlaceError(raw: string | null | undefined): boolean {
  const msg = (raw ?? "").trim();
  if (!msg) return false;
  return (
    msg === "no_places_in_caption" ||
    msg.startsWith("no_places_in_caption|") ||
    msg.includes("캡션을 찾을 수 없습니다")
  );
}

type Props = {
  open: boolean;
  complete?: boolean;
  errorMessage?: string | null;
  /** extract_jobs.error_message 원문 — 사유 분기용 */
  errorRaw?: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
};

export function ExtractLoadingOverlay({
  open,
  complete = false,
  errorMessage = null,
  errorRaw = null,
  onDismiss,
  onRetry,
}: Props) {
  const [progressIndex, setProgressIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const tip = TIPS[tipIndex];
  const showError = !!errorMessage;
  const showComplete = complete && !showError;
  const noPlaceError = showError && isExtractNoPlaceError(errorRaw);

  useEffect(() => {
    if (!open || showComplete || showError) return;
    const id = window.setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [open, showComplete, showError]);

  useEffect(() => {
    if (!open || showComplete || showError) return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [open, showComplete, showError]);

  useEffect(() => {
    if (!open) {
      setProgressIndex(0);
      setTipIndex(0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="extractLoadingOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={showError ? "추출 실패" : showComplete ? "추출 완료" : "장소 추출 중"}
      onClick={onDismiss}
    >
      <div
        className="extractLoadingCard"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="extractLoadingCloseBtn"
          onClick={onDismiss}
          aria-label="닫기"
        >
          ✕
        </button>

        {showError ? (
          noPlaceError ? (
            <div className="extractLoadingComplete">
              <p className="extractLoadingCompleteEmoji" aria-hidden>
                👀
              </p>
              <p className="extractLoadingCompleteTitle">이 릴스엔 가게 이름이 없어요</p>
              <p className="extractLoadingCompleteSub">
                글에 가게 이름이 안 적혀 있어요.
                <br />
                영상에는 있는데 캡션에 안 쓴 경우예요.
              </p>
              <button type="button" className="extractLoadingDismissBtn" onClick={onDismiss}>
                확인
              </button>
            </div>
          ) : (
            <div className="extractLoadingComplete">
              <p className="extractLoadingCompleteEmoji" aria-hidden>
                😢
              </p>
              <p className="extractLoadingCompleteTitle">추출에 실패했어요</p>
              <p className="extractLoadingCompleteSub">{errorMessage}</p>
              {onRetry && (
                <button type="button" className="extractLoadingDismissBtn" onClick={onRetry}>
                  다시 시도
                </button>
              )}
            </div>
          )
        ) : showComplete ? (
          <div className="extractLoadingComplete">
            <p className="extractLoadingCompleteEmoji" aria-hidden>
              ✨
            </p>
            <p className="extractLoadingCompleteTitle">추출 완료!</p>
            <p className="extractLoadingCompleteSub">곧 지도에 핀이 추가돼요</p>
          </div>
        ) : (
          <>
            <div className="extractLoadingTipHero" key={tipIndex}>
              <span className="extractLoadingTipEmoji" aria-hidden>
                {tip.emoji}
              </span>
              <p className="extractLoadingTipTitle">{tip.title}</p>
              <p className="extractLoadingTipDesc">{tip.desc}</p>
            </div>

            <p className="extractLoadingProgressText" key={progressIndex}>
              {PROGRESS_MESSAGES[progressIndex]}
            </p>

            <div className="extractLoadingProgressTrack" aria-hidden>
              <div className="extractLoadingProgressFill" />
            </div>
          </>
        )}

        <p className="extractLoadingFooterNote">앱을 닫아도 계속 저장돼요 · 여러 개 OK</p>

        {!showComplete && !showError && (
          <button type="button" className="extractLoadingDismissBtn" onClick={onDismiss}>
            백그라운드에서 계속하기
          </button>
        )}
      </div>
    </div>
  );
}
