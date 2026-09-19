"use client";

import { LIST_COLOR_PRESETS, type ListColorPresetId } from "@/lib/listColors";

export const LIST_COLOR_PRESET_IDS = Object.keys(LIST_COLOR_PRESETS) as ListColorPresetId[];

export const DEFAULT_LIST_COLOR_PRESET: ListColorPresetId = "coral";

type Props = {
  value: ListColorPresetId | null;
  onChange: (id: ListColorPresetId) => void;
  disabled?: boolean;
  /** denser = sheet create row; roomy = header popover */
  size?: "sm" | "md";
  "aria-label"?: string;
};

export function ListColorSwatches({
  value,
  onChange,
  disabled = false,
  size = "md",
  "aria-label": ariaLabel = "목록 색",
}: Props) {
  const dim = size === "sm" ? 22 : 28;
  return (
    <div
      className="listColorSwatches"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: size === "sm" ? 8 : 10,
        alignItems: "center",
      }}
    >
      {LIST_COLOR_PRESET_IDS.map((id) => {
        const hex = LIST_COLOR_PRESETS[id];
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={id}
            disabled={disabled}
            className={`listColorSwatch${selected ? " listColorSwatchSelected" : ""}`}
            style={{
              width: dim,
              height: dim,
              borderRadius: "50%",
              background: hex,
              border: selected ? "2px solid #1a2a7a" : "2px solid transparent",
              boxShadow: selected ? "0 0 0 1px #fff inset" : "0 0 0 1px rgba(0,0,0,0.08) inset",
              padding: 0,
              cursor: disabled ? "default" : "pointer",
              flexShrink: 0,
              opacity: disabled ? 0.6 : 1,
            }}
            onClick={() => onChange(id)}
          />
        );
      })}
    </div>
  );
}

export function ListColorDot({
  color,
  size = 12,
  title,
}: {
  color: string | null | undefined;
  size?: number;
  title?: string;
}) {
  const hex =
    typeof color === "string" && LIST_COLOR_PRESETS[color]
      ? LIST_COLOR_PRESETS[color]
      : "#c8c8d0";
  return (
    <span
      className="listColorDot"
      title={title}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: hex,
        flexShrink: 0,
        display: "inline-block",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.08) inset",
      }}
    />
  );
}
