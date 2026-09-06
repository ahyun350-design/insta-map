"use client";

import { useEffect, useRef, useState } from "react";
import { PLACE_MEMO_MAX_LEN, savePlaceMemo } from "@/lib/placeMemo";

type Props = {
  open: boolean;
  placeId: string;
  placeName?: string;
  initialMemo?: string | null;
  keyboardHeight?: number;
  onClose: () => void;
  /** 낙관적 반영 — 시트는 호출 전에 닫아도 됨. 실패 시 prevMemo로 롤백용 */
  onOptimisticSave: (placeId: string, nextMemo: string | null) => void;
  onRollback: (placeId: string, prevMemo: string | null) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function PlaceMemoSheet({
  open,
  placeId,
  placeName,
  initialMemo = null,
  keyboardHeight = 0,
  onClose,
  onOptimisticSave,
  onRollback,
  showToast,
}: Props) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft((initialMemo ?? "").slice(0, PLACE_MEMO_MAX_LEN));
    setSaving(false);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, placeId, initialMemo]);

  useEffect(() => {
    if (!open || keyboardHeight <= 0) return;
    const id = window.setTimeout(() => {
      inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [open, keyboardHeight]);

  if (!open) return null;

  const sheetBottom = keyboardHeight > 0 ? keyboardHeight : 0;

  const handleSave = async () => {
    if (saving) return;
    const prevMemo =
      typeof initialMemo === "string" && initialMemo.trim() ? initialMemo.trim() : null;
    const trimmed = draft.trim();
    const nextMemo = trimmed ? trimmed.slice(0, PLACE_MEMO_MAX_LEN) : null;

    setSaving(true);
    onOptimisticSave(placeId, nextMemo);
    onClose();

    const { error } = await savePlaceMemo(placeId, draft);
    if (error) {
      onRollback(placeId, prevMemo);
      showToast(error, "error");
    } else {
      showToast(nextMemo ? "메모를 저장했어요" : "메모를 삭제했어요", "success");
    }
  };

  return (
    <div className="placeListSheetOverlay" role="presentation" onClick={onClose}>
      <div
        className="placeListSheet"
        role="dialog"
        aria-label="장소 메모"
        style={{
          bottom: sheetBottom,
          transition: "bottom 0.25s ease, padding-bottom 0.25s ease",
          paddingBottom:
            keyboardHeight > 0
              ? 16
              : "calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="placeListSheetHandle" aria-hidden />
        <header className="placeListSheetHeader">
          <div>
            <p className="placeListSheetTitle">메모</p>
            {placeName ? <p className="placeListSheetSubtitle">{placeName}</p> : null}
          </div>
          <button type="button" className="placeListSheetClose" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <div className="placeListSheetBody" ref={bodyRef}>
          <textarea
            ref={inputRef}
            data-testid="saved-memo-input"
            className="placeMemoSheetInput"
            value={draft}
            maxLength={PLACE_MEMO_MAX_LEN}
            rows={2}
            placeholder="나만 보는 메모 (예: 삼겹살 맛있던 곳)"
            disabled={saving}
            onChange={(e) => setDraft(e.target.value.slice(0, PLACE_MEMO_MAX_LEN))}
          />
          <p className="placeMemoSheetCounter">
            {draft.length}/{PLACE_MEMO_MAX_LEN}
          </p>
          <div className="placeMemoSheetActions">
            <button
              type="button"
              data-testid="saved-memo-cancel"
              className="placeMemoSheetCancel"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="button"
              data-testid="saved-memo-save"
              className="placeMemoSheetSave"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
