"use client";

import { ProfileAvatar } from "@/components/ProfileAvatar";
import type { PlaceSheetData, PlaceSheetFeedPost } from "@/lib/placeSheet";

type DirectionsMode = "car" | "walk";

type Props = {
  place: PlaceSheetData;
  isSaved: boolean;
  layout: "overlay" | "embedded";
  showDirections?: boolean;
  directionsMode?: DirectionsMode;
  directionsLoading?: boolean;
  directionsInfo?: { duration: number; distance: number } | null;
  onClose: () => void;
  onToggleSave: () => void;
  onCurationClick: (postId: string) => void;
  onImageLightbox: (url: string) => void;
  timeAgoLabel: (createdAt: string) => string;
  onOpenAppleMaps?: () => void;
  onDirectionsModeChange?: (mode: DirectionsMode) => void;
  onOpenTransit?: () => void;
  onClearRoute?: () => void;
};

export function PlaceDetailSheet({
  place,
  isSaved,
  layout,
  showDirections = false,
  directionsMode = "car",
  directionsLoading = false,
  directionsInfo = null,
  onClose,
  onToggleSave,
  onCurationClick,
  onImageLightbox,
  timeAgoLabel,
  onOpenAppleMaps,
  onDirectionsModeChange,
  onOpenTransit,
  onClearRoute,
}: Props) {
  const relatedPosts: PlaceSheetFeedPost[] = place._feedPosts ?? [];
  const heartFill = isSaved ? "#e53935" : "none";
  const heartStroke = isSaved ? "#e53935" : "#1a2a7a";

  return (
    <div
      className={layout === "overlay" ? "placeDetailSheet placeDetailSheetOverlay" : "placeDetailSheet placeDetailSheetEmbedded"}
      role="dialog"
      aria-label="장소 정보"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="placeDetailSheetHeader">
        <div className="placeDetailSheetHeaderText">
          <p className="placeDetailSheetName">{place.place_name}</p>
          {place.category_name && <p className="placeDetailSheetCategory">{place.category_name}</p>}
        </div>
        <div className="placeDetailSheetHeaderActions">
          <button type="button" className="placeDetailSheetHeartBtn" onClick={onToggleSave} aria-label={isSaved ? "저장 취소" : "장소 저장"}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={heartFill} aria-hidden>
              <path
                d="M12 21C12 21 3 13.5 3 8C3 5.239 5.239 3 8 3C9.657 3 11.122 3.832 12 5.083C12.878 3.832 14.343 3 16 3C18.761 3 21 5.239 21 8C21 13.5 12 21 12 21Z"
                stroke={heartStroke}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="placeDetailSheetCloseBtn" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
      </div>

      <div className="placeDetailSheetBody">
        {place.road_address_name && (
          <div className="placeDetailSheetRow">
            <span className="placeDetailSheetLabel">주소</span>
            <span className="placeDetailSheetValue">{place.road_address_name}</span>
          </div>
        )}
        {place.phone && (
          <div className="placeDetailSheetRow placeDetailSheetRowCenter">
            <span className="placeDetailSheetLabel">전화</span>
            <a className="placeDetailSheetLink" href={`tel:${place.phone}`}>
              {place.phone}
            </a>
          </div>
        )}
        {place.place_url && (
          <a className="placeDetailSheetKakaoBtn" href={place.place_url} target="_blank" rel="noreferrer">
            카카오맵에서 영업시간 보기
          </a>
        )}
        {onOpenAppleMaps && (
          <button type="button" className="placeDetailSheetAppleBtn" onClick={onOpenAppleMaps}>
            🗺 Apple 지도에서 열기
          </button>
        )}

        {showDirections && place.y && place.x && (
          <div className="placeDetailSheetDirections">
            <div className="placeDetailSheetDirectionsModes">
              {(
                [
                  { id: "car" as const, label: "🚗 자동차" },
                  { id: "walk" as const, label: "🚶 도보" },
                  { id: "transit" as const, label: "🚌 대중교통" },
                ] as const
              ).map((m) => {
                const isActive = m.id !== "transit" && directionsMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={directionsLoading}
                    className={isActive ? "placeDetailSheetModeBtn placeDetailSheetModeBtnActive" : "placeDetailSheetModeBtn"}
                    onClick={() => {
                      if (m.id === "transit") {
                        onOpenTransit?.();
                      } else {
                        onDirectionsModeChange?.(m.id);
                      }
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            {directionsLoading && <p className="placeDetailSheetDirectionsHint">경로 계산 중...</p>}
            {directionsInfo && !directionsLoading && (
              <div className="placeDetailSheetDirectionsResult">
                <span>🕐 {directionsInfo.duration}분</span>
                <span>📍 {directionsInfo.distance}km</span>
                {onClearRoute && (
                  <button type="button" className="placeDetailSheetClearRoute" onClick={onClearRoute}>
                    경로 지우기
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {relatedPosts.length > 0 ? (
        <div className="placeDetailSheetCurations">
          <p className="placeDetailSheetCurationsTitle">큐레이션 {relatedPosts.length}</p>
          {relatedPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              className="placeDetailSheetCurationItem"
              onClick={() => onCurationClick(post.id)}
            >
              <div className="placeDetailSheetCurationTop">
                <ProfileAvatar avatarUrl={post.userAvatarUrl} username={post.user} size={26} fontSize={11} />
                <span className="placeDetailSheetCurationUser">{post.user}</span>
                <span className="placeDetailSheetCurationTime">{timeAgoLabel(post.createdAt)}</span>
              </div>
              <p className="placeDetailSheetCurationTitle">{post.title || post.placeName}</p>
              {post.images.length > 0 && (
                <div className="placeDetailSheetCurationImages" onClick={(e) => e.stopPropagation()}>
                  {post.images.map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt=""
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onImageLightbox(img);
                      }}
                    />
                  ))}
                </div>
              )}
              <p className="placeDetailSheetCurationComment">{post.comment}</p>
              <div className="placeDetailSheetCurationStats">
                <span style={{ color: post.liked_by_me ? "#e05555" : "#ccc" }}>♥ {post.likes_count}</span>
                <span>💬 {post.comments.length}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="placeDetailSheetCurationsEmpty">
          <p>아직 큐레이션이 없어요</p>
        </div>
      )}
    </div>
  );
}
