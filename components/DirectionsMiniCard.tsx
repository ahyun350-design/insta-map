"use client";

type Mode = "car" | "walk" | "transit";

type Props = {
  placeName: string;
  durationMin: number;
  distanceKm: number;
  approx?: boolean;
  mode: "car" | "walk";
  loading?: boolean;
  onExpand: () => void;
  onClose: () => void;
  onModeChange: (mode: Mode) => void;
};

export default function DirectionsMiniCard({
  placeName,
  durationMin,
  distanceKm,
  approx,
  mode,
  loading,
  onExpand,
  onClose,
  onModeChange,
}: Props) {
  const modeLabel = mode === "walk" ? "도보" : "자동차";
  const dur = approx ? `약 ${durationMin}` : String(durationMin);
  const dist = Number(distanceKm).toFixed(1);

  return (
    <>
      <div className="directionsMiniCardSeg" role="group" aria-label="이동수단">
        {(
          [
            { id: "car" as const, label: "자동차" },
            { id: "walk" as const, label: "도보" },
            { id: "transit" as const, label: "대중교통" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            className={
              m.id !== "transit" && mode === m.id
                ? "directionsMiniCardMode is-active"
                : "directionsMiniCardMode"
            }
            disabled={loading}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="directionsMiniCard" data-testid="directions-mini-card">
        <button
          type="button"
          className="directionsMiniCardBody"
          onClick={onExpand}
          aria-label="장소 상세 펼치기"
        >
          <div className="directionsMiniCardText">
            <p className="directionsMiniCardName">{placeName}</p>
            <p className="directionsMiniCardMeta">
              {modeLabel}{" "}
              <strong>
                {dur}분 · {dist}km
              </strong>
            </p>
          </div>
        </button>
        <button
          type="button"
          className="directionsMiniCardClose"
          aria-label="경로 지우기"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </>
  );
}
