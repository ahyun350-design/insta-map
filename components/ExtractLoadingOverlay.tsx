"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCategoryWithSubcategory } from "@/lib/kakaoSubcategory";
import type { ExtractReviewPlace } from "@/lib/extractReviewPending";
import {
  batchReviewTitle,
  countBatchPlaces,
} from "@/lib/extractReviewBatch";

export type ExtractReviewJobSection = {
  jobId: string;
  places: ExtractReviewPlace[];
};

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

const NO_PLACE_VARIANTS = [
  { icon: "👀", title: "가게 이름이 안 보여요" },
  { icon: "🕵️", title: "탐정도 못 찾았어요" },
  { icon: "🙈", title: "이름을 꽁꽁 숨겼네요" },
  { icon: "🐕", title: "냄새는 맡았는데 이름이 없어요" },
  { icon: "🔍", title: "이름표가 없는 릴스예요" },
  { icon: "🤔", title: "가게 이름을 못 찾겠어요" },
] as const;

/** 서버 error_message — 캡션에 장소/캡션 없음 (재시도 무의미에 가깝지만 강제 재시도는 허용) */
export function isExtractNoPlaceError(raw: string | null | undefined): boolean {
  const msg = (raw ?? "").trim();
  if (!msg) return false;
  const code = msg.split("|")[0] || msg;
  return (
    code === "no_places_in_caption" ||
    code === "caption_empty" ||
    code === "caption_too_short" ||
    code === "only_account_handles" ||
    msg.includes("캡션을 찾을 수 없습니다")
  );
}

export function isExtractOverseasError(raw: string | null | undefined): boolean {
  const code = (raw ?? "").trim().split("|")[0] || "";
  return code === "overseas_unsupported";
}

/** 빈 result_places (캡션 가이드 흡수용) */
export const EXTRACT_EMPTY_RESULT_RAW = "empty_extract_result";

export function isExtractEmptyResult(raw: string | null | undefined): boolean {
  return (raw ?? "").trim() === EXTRACT_EMPTY_RESULT_RAW;
}

function pickNoPlaceVariant(): (typeof NO_PLACE_VARIANTS)[number] {
  const idx = Math.floor(Math.random() * NO_PLACE_VARIANTS.length);
  return NO_PLACE_VARIANTS[idx] ?? NO_PLACE_VARIANTS[0];
}

export type ExtractOverlayCompleteVariant = "success" | "all_saved";

/** 배타적 UI 모드 — 진행/백그라운드/완료/실패가 한 카드에 겹치지 않게 */
export type ExtractOverlayMode = "loading" | "background" | "complete" | "error";

export type { ExtractReviewPlace };

type Props = {
  open: boolean;
  complete?: boolean;
  /** success=신규 추가 / all_saved=이미 전부 저장됨 */
  completeVariant?: ExtractOverlayCompleteVariant;
  /** 폴링 soft-timeout — 실패가 아니라 백그라운드 계속 */
  backgroundWaiting?: boolean;
  errorMessage?: string | null;
  /** extract_jobs.error_message 원문 — 사유 분기용 */
  errorRaw?: string | null;
  /** Newly inserted places for complete UI (1 = add-to-list line, 2+ = checklist) */
  reviewPlaces?: ExtractReviewPlace[] | null;
  /**
   * Restore-path 모아 보기: 2+ jobs. When set (≥2), takes precedence over
   * single-job multi checklist. In-app extract still uses reviewPlaces only.
   */
  reviewJobs?: ExtractReviewJobSection[] | null;
  onDismiss: () => void;
  onRetry?: () => void;
  /** all_saved 시 「지도에서 보기」 */
  onViewMap?: () => void;
  /** 캡션 실패 시 「직접 찾아보기」→ 지도 검색 */
  onManualSearch?: () => void;
  /** 「목록에 담기」 — checked (or single) place ids */
  onAddToList?: (placeIds: string[]) => void;
  /** 2+ 「완료」— keepIds stay, removeIds deleted by parent */
  onConfirmReview?: (keepIds: string[], removeIds: string[]) => void | Promise<void>;
  reviewConfirming?: boolean;
};

export function ExtractLoadingOverlay({
  open,
  complete = false,
  completeVariant = "success",
  backgroundWaiting = false,
  errorMessage = null,
  errorRaw = null,
  reviewPlaces = null,
  reviewJobs = null,
  onDismiss,
  onRetry,
  onViewMap,
  onManualSearch,
  onAddToList,
  onConfirmReview,
  reviewConfirming = false,
}: Props) {
  const [progressIndex, setProgressIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [noPlaceVariant, setNoPlaceVariant] = useState<(typeof NO_PLACE_VARIANTS)[number]>(
    NO_PLACE_VARIANTS[0],
  );
  const tip = TIPS[tipIndex];

  const jobSections = useMemo(() => {
    if (!Array.isArray(reviewJobs)) return [] as ExtractReviewJobSection[];
    return reviewJobs.filter(
      (j) => j && typeof j.jobId === "string" && Array.isArray(j.places) && j.places.length > 0,
    );
  }, [reviewJobs]);

  const batchReview =
    complete && completeVariant === "success" && jobSections.length >= 2;

  const places = useMemo(() => {
    if (batchReview) return jobSections.flatMap((j) => j.places);
    return Array.isArray(reviewPlaces) ? reviewPlaces : [];
  }, [batchReview, jobSections, reviewPlaces]);

  const multiReview =
    complete && completeVariant === "success" && !batchReview && places.length >= 2;
  const singleReview =
    complete && completeVariant === "success" && !batchReview && places.length === 1;

  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!multiReview && !batchReview) return;
    setCheckedIds(new Set(places.map((p) => p.id)));
  }, [multiReview, batchReview, places]);

  // Priority: error > complete > background > loading (never mix)
  const mode: ExtractOverlayMode = errorMessage
    ? "error"
    : complete
      ? "complete"
      : backgroundWaiting
        ? "background"
        : "loading";

  const showAllSaved = mode === "complete" && completeVariant === "all_saved";
  const noPlaceError = mode === "error" && isExtractNoPlaceError(errorRaw);
  const overseasError = mode === "error" && isExtractOverseasError(errorRaw);
  const emptyResultError = mode === "error" && isExtractEmptyResult(errorRaw);
  const captionTipError = noPlaceError || emptyResultError;

  useEffect(() => {
    if (!open || mode !== "loading") return;
    const id = window.setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "loading") return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [open, mode]);

  useEffect(() => {
    if (!open) {
      setProgressIndex(0);
      setTipIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (open && noPlaceError) {
      setNoPlaceVariant(pickNoPlaceVariant());
    }
  }, [open, noPlaceError, errorRaw]);

  if (!open) return null;

  const checkedCount = places.reduce((n, p) => n + (checkedIds.has(p.id) ? 1 : 0), 0);
  const uncheckedCount = places.length - checkedCount;
  const checklistActive = multiReview || batchReview;
  const allUnchecked = checklistActive && checkedCount === 0;
  const allChecked = checklistActive && checkedCount === places.length;

  const togglePlace = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(places.map((p) => p.id)));
  };

  const handleConfirm = () => {
    if (!onConfirmReview || reviewConfirming) return;
    const keepIds = places.filter((p) => checkedIds.has(p.id)).map((p) => p.id);
    const removeIds = places.filter((p) => !checkedIds.has(p.id)).map((p) => p.id);
    void onConfirmReview(keepIds, removeIds);
  };

  const ariaLabel =
    mode === "error"
      ? "추출 실패"
      : showAllSaved
        ? "이미 저장한 장소"
        : batchReview
          ? "추출 결과 모아 보기"
          : multiReview
            ? "추출 장소 선택"
            : mode === "complete"
              ? "추출 완료"
              : mode === "background"
                ? "백그라운드 저장 중"
                : "장소 추출 중";

  const footerNote =
    mode === "error" && captionTipError
      ? "캡션에 가게 이름이 있는 릴스는 잘 찾아요"
      : showAllSaved
        ? "저장된 장소는 지도 탭에서 볼 수 있어요"
        : mode === "background"
          ? "알림이 오면 지도에서 확인해 주세요"
          : mode === "loading"
            ? "앱을 닫아도 계속 저장돼요 · 여러 개 OK"
            : null;

  const renderPlaceRow = (p: ExtractReviewPlace) => {
    const checked = checkedIds.has(p.id);
    const catLabel = formatCategoryWithSubcategory(p.category, p.subcategory);
    return (
      <li key={p.id}>
        <label className="extractReviewRow">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => togglePlace(p.id)}
            data-testid="extract-review-check"
            data-place-id={p.id}
          />
          <span className="extractReviewRowText">
            <span className="extractReviewName">{p.name}</span>
            {catLabel ? <span className="extractReviewMeta">{catLabel}</span> : null}
            <span className="extractReviewAddr">{p.address}</span>
          </span>
        </label>
      </li>
    );
  };

  const reviewActions = (
    <>
      {uncheckedCount > 0 ? (
        <p className="extractReviewHint" data-testid="extract-review-hint">
          선택하지 않은 {uncheckedCount}곳은 저장되지 않아요
        </p>
      ) : (
        <p className="extractReviewHint extractReviewHintSpacer" aria-hidden>
          &nbsp;
        </p>
      )}
      <div className="extractReviewActions">
        <button
          type="button"
          className="extractLoadingSecondaryBtn"
          disabled={checkedCount === 0 || reviewConfirming}
          data-testid="extract-review-add-to-list"
          onClick={() => {
            if (!onAddToList || checkedCount === 0) return;
            onAddToList(places.filter((p) => checkedIds.has(p.id)).map((p) => p.id));
          }}
        >
          목록에 담기
        </button>
        <button
          type="button"
          className="extractLoadingDismissBtn"
          disabled={reviewConfirming}
          data-testid="extract-review-confirm"
          onClick={handleConfirm}
        >
          {reviewConfirming
            ? "처리 중…"
            : allUnchecked
              ? "모두 저장 안 함"
              : "완료"}
        </button>
      </div>
    </>
  );

  return (
    <div
      className="extractLoadingOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid="extract-loading-overlay"
      onClick={checklistActive || reviewConfirming ? undefined : onDismiss}
    >
      <div
        className={
          checklistActive ? "extractLoadingCard extractLoadingCardReview" : "extractLoadingCard"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="extractLoadingCloseBtn"
          onClick={onDismiss}
          aria-label="닫기"
          data-testid="extract-overlay-close"
          disabled={reviewConfirming}
        >
          ✕
        </button>

        {mode === "error" ? (
          noPlaceError ? (
            <div className="extractLoadingComplete">
              <p
                className="extractLoadingCompleteEmoji extractLoadingNoPlaceEmoji"
                aria-hidden
              >
                {noPlaceVariant.icon}
              </p>
              <p className="extractLoadingCompleteTitle">{noPlaceVariant.title}</p>
              <p className="extractLoadingCompleteSub">
                글에 가게 이름이 안 적혀 있어요.
                <br />
                영상에는 있는데 캡션에 안 쓴 경우예요.
                <br />
                <span className="extractLoadingManualHint">
                  영상에 보이는 가게 이름을 알고 있다면 직접 찾아보세요
                </span>
              </p>
              <div className="extractLoadingActions">
                {onManualSearch && (
                  <button type="button" className="extractLoadingDismissBtn" onClick={onManualSearch}>
                    직접 찾아보기
                  </button>
                )}
                {onRetry && (
                  <button
                    type="button"
                    className="extractLoadingSecondaryBtn"
                    onClick={onRetry}
                  >
                    다시 시도
                  </button>
                )}
                <button
                  type="button"
                  className={
                    onManualSearch || onRetry
                      ? "extractLoadingSecondaryBtn"
                      : "extractLoadingDismissBtn"
                  }
                  onClick={onDismiss}
                >
                  확인
                </button>
              </div>
            </div>
          ) : emptyResultError ? (
            <div className="extractLoadingComplete">
              <p
                className="extractLoadingCompleteEmoji extractLoadingNoPlaceEmoji"
                aria-hidden
              >
                👀
              </p>
              <p className="extractLoadingCompleteTitle">장소를 찾지 못했어요</p>
              <p className="extractLoadingCompleteSub">
                캡션에서 가게 이름을 찾지 못했어요.
                <br />
                장소 이름이 적힌 릴스는 잘 찾아요.
                <br />
                <span className="extractLoadingManualHint">
                  영상에 보이는 가게 이름을 알고 있다면 직접 찾아보세요
                </span>
              </p>
              <div className="extractLoadingActions">
                {onManualSearch && (
                  <button type="button" className="extractLoadingDismissBtn" onClick={onManualSearch}>
                    직접 찾아보기
                  </button>
                )}
                <button
                  type="button"
                  className={onManualSearch ? "extractLoadingSecondaryBtn" : "extractLoadingDismissBtn"}
                  onClick={onDismiss}
                >
                  확인
                </button>
              </div>
            </div>
          ) : overseasError ? (
            <div className="extractLoadingComplete">
              <p className="extractLoadingCompleteEmoji" aria-hidden>
                🌏
              </p>
              <p className="extractLoadingCompleteTitle">아직 해외 장소는 지원하지 않아요</p>
              <p className="extractLoadingCompleteSub">
                지금은 국내 장소만 지도에 담을 수 있어요.
                <br />
                국내 릴스로 다시 시도해 주세요
              </p>
              <div className="extractLoadingActions">
                {onRetry && (
                  <button type="button" className="extractLoadingSecondaryBtn" onClick={onRetry}>
                    다시 시도
                  </button>
                )}
                <button type="button" className="extractLoadingDismissBtn" onClick={onDismiss}>
                  확인
                </button>
              </div>
            </div>
          ) : (
            <div className="extractLoadingComplete">
              <p className="extractLoadingCompleteEmoji" aria-hidden>
                😢
              </p>
              <p className="extractLoadingCompleteTitle">추출에 실패했어요</p>
              <p className="extractLoadingCompleteSub">
                {errorMessage}
                {onRetry ? (
                  <>
                    <br />
                    <span className="extractLoadingManualHint">
                      이전에 시도했지만 찾지 못한 릴스예요. 다시 시도할 수 있어요
                    </span>
                  </>
                ) : null}
              </p>
              {onRetry && (
                <button type="button" className="extractLoadingDismissBtn" onClick={onRetry}>
                  다시 시도
                </button>
              )}
            </div>
          )
        ) : mode === "background" ? (
          <div className="extractLoadingComplete">
            <p className="extractLoadingCompleteEmoji" aria-hidden>
              ⏳
            </p>
            <p className="extractLoadingCompleteTitle">시간이 좀 걸리고 있어요</p>
            <p className="extractLoadingCompleteSub">
              다 되면 알려드릴게요.
              <br />
              앱을 닫아도 계속 진행돼요
            </p>
            <button type="button" className="extractLoadingDismissBtn" onClick={onDismiss}>
              확인
            </button>
          </div>
        ) : showAllSaved ? (
          <div className="extractLoadingComplete">
            <p className="extractLoadingCompleteEmoji" aria-hidden>
              📌
            </p>
            <p className="extractLoadingCompleteTitle">이미 저장한 곳이에요</p>
            <p className="extractLoadingCompleteSub">이 릴스의 장소는 전부 지도에 있어요.</p>
            <button
              type="button"
              className="extractLoadingDismissBtn"
              onClick={() => {
                if (onViewMap) onViewMap();
                else onDismiss();
              }}
            >
              {onViewMap ? "지도에서 보기" : "확인"}
            </button>
          </div>
        ) : batchReview ? (
          <div className="extractReview" data-testid="extract-review-batch">
            <p className="extractReviewTitle">
              {batchReviewTitle(jobSections.length, countBatchPlaces(jobSections))}
            </p>
            <div className="extractReviewHeaderRow">
              <button
                type="button"
                className="extractReviewSelectAll"
                onClick={toggleAll}
                data-testid="extract-review-select-all"
              >
                {allChecked ? "전체 해제" : "전체 선택"}
              </button>
              <span className="extractReviewCheckedCount">
                {checkedCount}/{places.length}
              </span>
            </div>
            <div className="extractReviewList extractReviewBatchList" data-testid="extract-review-list">
              {jobSections.map((section, idx) => (
                <section
                  key={section.jobId}
                  className="extractReviewReelSection"
                  data-testid="extract-review-reel-section"
                  data-job-id={section.jobId}
                >
                  <h3 className="extractReviewReelLabel">릴스 {idx + 1}</h3>
                  <ul className="extractReviewReelPlaces">
                    {section.places.map((p) => renderPlaceRow(p))}
                  </ul>
                </section>
              ))}
            </div>
            {reviewActions}
          </div>
        ) : multiReview ? (
          <div className="extractReview" data-testid="extract-review-multi">
            <p className="extractReviewTitle">{places.length}곳 찾았어요</p>
            <div className="extractReviewHeaderRow">
              <button
                type="button"
                className="extractReviewSelectAll"
                onClick={toggleAll}
                data-testid="extract-review-select-all"
              >
                {allChecked ? "전체 해제" : "전체 선택"}
              </button>
              <span className="extractReviewCheckedCount">{checkedCount}/{places.length}</span>
            </div>
            <ul className="extractReviewList" data-testid="extract-review-list">
              {places.map((p) => renderPlaceRow(p))}
            </ul>
            {reviewActions}
          </div>
        ) : singleReview ? (
          <div className="extractLoadingComplete" data-testid="extract-review-single">
            <p className="extractLoadingCompleteEmoji" aria-hidden>
              ✨
            </p>
            <p className="extractLoadingCompleteTitle">추출 완료!</p>
            <p className="extractLoadingCompleteSub">곧 지도에 핀이 추가돼요</p>
            {onAddToList ? (
              <button
                type="button"
                className="extractLoadingSecondaryBtn extractReviewSingleListBtn"
                data-testid="extract-review-add-to-list"
                onClick={() => onAddToList([places[0]!.id])}
              >
                목록에 담기
              </button>
            ) : null}
          </div>
        ) : mode === "complete" ? (
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

        {footerNote ? <p className="extractLoadingFooterNote">{footerNote}</p> : null}

        {mode === "loading" && (
          <button type="button" className="extractLoadingDismissBtn" onClick={onDismiss}>
            백그라운드에서 계속하기
          </button>
        )}
      </div>
    </div>
  );
}
