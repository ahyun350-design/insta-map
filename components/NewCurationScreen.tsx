"use client";

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CompanionTag } from "@/lib/companionTag";
import type { PhotoPlaceTag } from "@/lib/feedPost";
import { Step1Photos } from "@/components/curation/Step1Photos";
import { Step2PlaceTags } from "@/components/curation/Step2PlaceTags";
import { Step3Form } from "@/components/curation/Step3Form";
import { extractCategoriesFromPhotoTags } from "@/lib/categoryUtil";
import { useNativeKeyboard } from "@/lib/useNativeKeyboard";
import type { CurationCategory, CurationStep, PostImageItem } from "@/components/curation/types";

export type { PostImageItem } from "@/components/curation/types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 슬라이드다운 종료 후 호출 (폼 리셋 등) */
  onExited?: () => void;
  onSubmit: () => void;
  canPost: boolean;
  validationHint: string | null;
  title: string;
  onTitleChange: (value: string) => void;
  categories: CurationCategory[];
  onCategoriesChange: (categories: CurationCategory[]) => void;
  onCategoryToggle: (category: CurationCategory) => void;
  categoryMainOrder: CurationCategory[];
  categoryPin: Record<CurationCategory, { color: string; emoji: string }>;
  categoryColors: Record<CurationCategory, string>;
  images: PostImageItem[];
  onImagesChange: (updater: (prev: PostImageItem[]) => PostImageItem[]) => void;
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRetryImage: (item: PostImageItem) => void;
  photoPlaceTags: PhotoPlaceTag[];
  onPhotoPlaceTagsChange: (tags: PhotoPlaceTag[]) => void;
  companionTag: CompanionTag | null;
  onCompanionTagChange: (tag: CompanionTag) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  saveCourseChecked: boolean;
  onSaveCourseCheckedChange: (checked: boolean) => void;
  courseTitle: string;
  onCourseTitleChange: (value: string) => void;
};

const SLIDE_MS = 280;

const STEP_TITLES: Record<CurationStep, string> = {
  1: "새 큐레이션",
  2: "장소 태그",
  3: "세부 정보",
};

const rootStyle = (active: boolean): CSSProperties => ({
  position: "fixed",
  inset: 0,
  zIndex: 100000,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  boxSizing: "border-box",
  transform: active ? "translateY(0)" : "translateY(100%)",
  transition: `transform ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
  willChange: "transform",
});

function scrollFieldIntoView(el: HTMLElement | null) {
  if (!el) return;
  window.setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 120);
}

const headerBtnBase: CSSProperties = {
  width: 40,
  height: 40,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 22,
  color: "#666",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

function headerActionClass(isLastStep: boolean, enabled: boolean): string {
  if (isLastStep) {
    return enabled
      ? "curationHeaderAction curationHeaderActionRegister"
      : "curationHeaderAction curationHeaderActionRegisterDisabled";
  }
  return enabled
    ? "curationHeaderAction curationHeaderActionNext"
    : "curationHeaderAction curationHeaderActionNextDisabled";
}

export function NewCurationScreen({
  open,
  onClose,
  onExited,
  onSubmit,
  canPost,
  validationHint,
  title,
  onTitleChange,
  categories,
  onCategoriesChange,
  onCategoryToggle,
  categoryMainOrder,
  categoryPin,
  categoryColors,
  images,
  onImagesChange,
  onImageUpload,
  onRetryImage,
  photoPlaceTags,
  onPhotoPlaceTagsChange,
  companionTag,
  onCompanionTagChange,
  comment,
  onCommentChange,
  saveCourseChecked,
  onSaveCourseCheckedChange,
  courseTitle,
  onCourseTitleChange,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [slideActive, setSlideActive] = useState(false);
  const { height: keyboardHeight } = useNativeKeyboard();
  const [currentStep, setCurrentStep] = useState<CurationStep>(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) setCurrentStep(1);
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setMounted(true);
      setSlideActive(false);
      const enterId = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideActive(true));
      });
      return () => cancelAnimationFrame(enterId);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setSlideActive(false);
    const exitId = window.setTimeout(() => {
      setMounted(false);
      setCurrentStep(1);
      onExited?.();
    }, SLIDE_MS);
    return () => window.clearTimeout(exitId);
  }, [open, onExited]);

  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted]);

  const scrollBodyPaddingBottom =
    keyboardHeight > 0
      ? `calc(${currentStep === 3 ? 40 : 28}px + ${keyboardHeight}px)`
      : `calc(${currentStep === 3 ? 40 : 28}px + env(safe-area-inset-bottom, 0px))`;

  const canGoNextStep1 = images.length >= 1;
  const canGoNextStep2 = images.length >= 1;
  const canSaveAsCourse = photoPlaceTags.length > 0;

  useEffect(() => {
    if (!canSaveAsCourse && saveCourseChecked) {
      onSaveCourseCheckedChange(false);
    }
  }, [canSaveAsCourse, saveCourseChecked, onSaveCourseCheckedChange]);

  const isLastStep = currentStep === 3;

  const rightActionEnabled = isLastStep ? canPost : currentStep === 1 ? canGoNextStep1 : canGoNextStep2;
  const rightActionLabel = isLastStep ? "등록" : "다음";

  const handleLeftAction = () => {
    if (currentStep === 1) {
      onClose();
      return;
    }
    setCurrentStep((s) => (s > 1 ? ((s - 1) as CurationStep) : s));
  };

  const handleRightAction = () => {
    if (isLastStep) {
      if (canPost) onSubmit();
      return;
    }
    if (currentStep === 1 && !canGoNextStep1) return;
    if (currentStep === 2 && !canGoNextStep2) return;
    if (currentStep === 2) {
      onCategoriesChange(extractCategoriesFromPhotoTags(photoPlaceTags));
      setCurrentStep(3);
      return;
    }
    setCurrentStep((s) => (s < 3 ? ((s + 1) as CurationStep) : s));
  };

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <section style={rootStyle(slideActive)} aria-modal="true" role="dialog" aria-label="새 큐레이션">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "0.5px solid #efefef",
          background: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handleLeftAction}
          aria-label={currentStep === 1 ? "닫기" : "뒤로"}
          style={headerBtnBase}
        >
          {currentStep === 1 ? "×" : "←"}
        </button>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: "'Playfair Display', serif",
            fontSize: 17,
            color: "#1a2a7a",
            fontWeight: 500,
          }}
        >
          {STEP_TITLES[currentStep]}
        </span>
        <button
          type="button"
          onClick={handleRightAction}
          disabled={!rightActionEnabled}
          className={headerActionClass(isLastStep, rightActionEnabled)}
        >
          {rightActionLabel}
        </button>
      </header>

      <div
        ref={scrollRef}
        className={currentStep === 3 ? "curationScreenBody curationScreenBodyStep3" : "curationScreenBody"}
        style={{
          paddingBottom: scrollBodyPaddingBottom,
          transition: "padding-bottom 0.25s ease",
        }}
      >
        {currentStep === 1 && (
          <Step1Photos
            images={images}
            onImagesChange={onImagesChange}
            onImageUpload={onImageUpload}
            onRetryImage={onRetryImage}
          />
        )}
        {currentStep === 2 && (
          <Step2PlaceTags
            images={images}
            photoPlaceTags={photoPlaceTags}
            onPhotoPlaceTagsChange={onPhotoPlaceTagsChange}
            keyboardHeight={keyboardHeight}
          />
        )}
        {currentStep === 3 && (
          <Step3Form
            title={title}
            onTitleChange={onTitleChange}
            categories={categories}
            onCategoryToggle={onCategoryToggle}
            categoryMainOrder={categoryMainOrder}
            companionTag={companionTag}
            onCompanionTagChange={onCompanionTagChange}
            comment={comment}
            onCommentChange={onCommentChange}
            saveCourseChecked={saveCourseChecked}
            onSaveCourseCheckedChange={onSaveCourseCheckedChange}
            canSaveAsCourse={canSaveAsCourse}
            courseTitle={courseTitle}
            onCourseTitleChange={onCourseTitleChange}
            validationHint={validationHint}
            onFieldFocus={scrollFieldIntoView}
          />
        )}
      </div>
    </section>,
    document.body,
  );
}
