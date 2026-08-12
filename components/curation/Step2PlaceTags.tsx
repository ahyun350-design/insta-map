"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { PhotoPlaceTag } from "@/lib/feedPost";
import {
  getPhotoPlaceTag,
  mapKakaoCategoryToPindMap,
  photoTapToNormalized,
  removePhotoPlaceTag,
  upsertPhotoPlaceTag,
} from "@/lib/photoPlaceTag";
import { PlaceSearchModal, type KakaoPlaceSearchResult, type ManualPlaceResult } from "@/components/curation/PlaceSearchModal";
import { PhotoTagMarker } from "@/components/curation/PhotoTagMarker";
import type { PostImageItem } from "@/components/curation/types";
import {
  curationAspectRatioCss,
  DEFAULT_CURATION_ASPECT_RATIO,
  resolveCurationAspectRatioFromSrc,
  type CurationAspectRatio,
} from "@/lib/curationAspectRatio";

type PendingPin = {
  photoIndex: number;
  x: number;
  y: number;
};

type Props = {
  images: PostImageItem[];
  photoPlaceTags: PhotoPlaceTag[];
  onPhotoPlaceTagsChange: (tags: PhotoPlaceTag[]) => void;
  keyboardHeight?: number;
};

function kakaoYXToLatLng(y?: unknown, x?: unknown): { lat: number; lng: number } | null {
  const lat = typeof y === "string" ? parseFloat(y) : typeof y === "number" ? y : NaN;
  const lng = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** "○○ 성수점" → "○○" (추출 stripKakaoBranchSuffix와 동일) */
function stripKakaoBranchSuffix(name: string): string {
  return name.replace(/\s+[^\s]+점$/u, "").trim();
}

function buildPlaceSearchQueries(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const noSpace = trimmed.replace(/\s+/g, "");
  const withoutBranch = stripKakaoBranchSuffix(trimmed);
  const withoutBranchNoSpace = withoutBranch.replace(/\s+/g, "");
  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const t = q.trim();
    if (!t || queries.includes(t)) return;
    queries.push(t);
  };
  pushUnique(trimmed);
  pushUnique(noSpace);
  pushUnique(withoutBranch);
  pushUnique(withoutBranchNoSpace);
  return queries;
}

function keywordSearchOnce(query: string): Promise<KakaoPlaceSearchResult[]> {
  return new Promise((resolve) => {
    new window.kakao.maps.services.Places().keywordSearch(
      query,
      (data: KakaoPlaceSearchResult[], st: string) => {
        if (st === window.kakao.maps.services.Status.OK && Array.isArray(data) && data.length > 0) {
          resolve(data.slice(0, 15));
        } else {
          resolve([]);
        }
      },
    );
  });
}

export function Step2PlaceTags({
  images,
  photoPlaceTags,
  onPhotoPlaceTagsChange,
  keyboardHeight = 0,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KakaoPlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [actionMenuIndex, setActionMenuIndex] = useState<number | null>(null);
  const [frameAspect, setFrameAspect] = useState<CurationAspectRatio>(DEFAULT_CURATION_ASPECT_RATIO);
  const searchGenRef = useRef(0);

  useEffect(() => {
    const first = images[0];
    if (!first) {
      setFrameAspect(DEFAULT_CURATION_ASPECT_RATIO);
      return;
    }
    const src = first.status === "uploaded" && first.publicUrl ? first.publicUrl : first.previewUrl;
    if (!src) {
      setFrameAspect(DEFAULT_CURATION_ASPECT_RATIO);
      return;
    }
    let cancelled = false;
    void resolveCurationAspectRatioFromSrc(src).then((ratio) => {
      if (!cancelled) setFrameAspect(ratio);
    });
    return () => {
      cancelled = true;
    };
  }, [images[0]?.id, images[0]?.previewUrl, images[0]?.publicUrl, images[0]?.status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
    setActionMenuIndex(null);
  }, []);

  const resetSearchUi = () => {
    searchGenRef.current += 1;
    setSearchQuery("");
    setSearchResults([]);
    setSearching(false);
    setHasSearched(false);
    setLastSearchedQuery("");
    setSearchNotice(null);
  };

  const openSearchModal = (pin: PendingPin) => {
    setPendingPin(pin);
    resetSearchUi();
    setModalOpen(true);
    setActionMenuIndex(null);
  };

  const closeSearchModal = () => {
    setModalOpen(false);
    setPendingPin(null);
    resetSearchUi();
  };

  const runSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    if (!window.kakao?.maps?.services) {
      setSearchResults([]);
      setHasSearched(false);
      setSearching(false);
      setSearchNotice("잠시 후 다시 시도해 주세요");
      return;
    }

    const gen = ++searchGenRef.current;
    setSearchNotice(null);
    setSearching(true);
    setHasSearched(false);
    setSearchResults([]);

    try {
      const queries = buildPlaceSearchQueries(trimmed);
      console.log("[crs][place-search] fallback queries", queries);
      let found: KakaoPlaceSearchResult[] = [];
      for (let i = 0; i < queries.length; i++) {
        if (gen !== searchGenRef.current) return;
        if (i > 0) await new Promise((r) => setTimeout(r, 150));
        if (gen !== searchGenRef.current) return;
        const q = queries[i]!;
        found = await keywordSearchOnce(q);
        console.log("[crs][place-search] try", {
          step: i + 1,
          of: queries.length,
          query: q,
          hits: found.length,
          top: found[0]?.place_name ?? null,
        });
        if (found.length > 0) break;
      }
      if (gen !== searchGenRef.current) return;
      setSearchResults(found);
      setHasSearched(true);
      setLastSearchedQuery(trimmed);
      console.log("[crs][place-search] done", {
        query: trimmed,
        finalHits: found.length,
        exhausted: found.length === 0,
      });
    } finally {
      if (gen === searchGenRef.current) setSearching(false);
    }
  };

  const handleSelectPlace = (place: KakaoPlaceSearchResult) => {
    if (!pendingPin) return;
    const coords = kakaoYXToLatLng(place.y, place.x);
    if (!coords) return;

    const tag: PhotoPlaceTag = {
      photoIndex: pendingPin.photoIndex,
      placeId: place.id || null,
      placeName: place.place_name,
      address: place.road_address_name || place.address_name || "",
      category: mapKakaoCategoryToPindMap(place.category_name),
      lat: coords.lat,
      lng: coords.lng,
      x: pendingPin.x,
      y: pendingPin.y,
    };

    onPhotoPlaceTagsChange(upsertPhotoPlaceTag(photoPlaceTags, tag));
    closeSearchModal();
  };

  const handleManualPlace = (place: ManualPlaceResult) => {
    if (!pendingPin) return;
    const tag: PhotoPlaceTag = {
      photoIndex: pendingPin.photoIndex,
      placeId: place.id,
      placeName: place.place_name,
      address: place.address,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      x: pendingPin.x,
      y: pendingPin.y,
      isManual: true,
    };
    onPhotoPlaceTagsChange(upsertPhotoPlaceTag(photoPlaceTags, tag));
    closeSearchModal();
  };

  const handlePhotoTap = (photoIndex: number, e: MouseEvent<HTMLDivElement>) => {
    if (getPhotoPlaceTag(photoPlaceTags, photoIndex)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = photoTapToNormalized(e.clientX, e.clientY, rect);
    openSearchModal({ photoIndex, x, y });
  };

  const handleMarkerAction = (photoIndex: number, action: "change" | "delete") => {
    setActionMenuIndex(null);
    if (action === "delete") {
      onPhotoPlaceTagsChange(removePhotoPlaceTag(photoPlaceTags, photoIndex));
      return;
    }
    const existing = getPhotoPlaceTag(photoPlaceTags, photoIndex);
    if (!existing) return;
    openSearchModal({ photoIndex, x: existing.x, y: existing.y });
  };

  const activeHasTag = !!getPhotoPlaceTag(photoPlaceTags, activeIndex);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "0 -4px" }}>
      <p style={{ margin: 0, fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.5 }}>
        {activeHasTag
          ? "📍 표시를 탭하면 장소를 변경하거나 삭제할 수 있어요"
          : "사진을 탭해서 장소를 추가하세요 (선택)"}
      </p>

      <div
        className="curationPhotoCarousel"
        style={{ ["--curation-draft-aspect" as string]: curationAspectRatioCss(frameAspect) }}
      >
        <div ref={scrollRef} className="curationPhotoCarouselTrack" onScroll={onScroll}>
          {images.map((img, index) => {
            const thumbSrc = img.status === "uploaded" && img.publicUrl ? img.publicUrl : img.previewUrl;
            const tag = getPhotoPlaceTag(photoPlaceTags, index);
            return (
              <div key={img.id} className="curationPhotoCarouselSlide">
                <div
                  className="curationPhotoTapArea"
                  onClick={(e) => handlePhotoTap(index, e)}
                  role={tag ? undefined : "button"}
                  aria-label={tag ? undefined : `사진 ${index + 1}에 장소 추가`}
                >
                  <img src={thumbSrc} alt={`사진 ${index + 1}`} className="curationPhotoTapImg" loading="lazy" decoding="async" />
                  {tag && <PhotoTagMarker tag={tag} onMarkerClick={(e) => { e.stopPropagation(); setActionMenuIndex(index); }} />}
                </div>
              </div>
            );
          })}
        </div>

        {images.length > 1 && (
          <div className="curationPhotoCarouselDots" aria-hidden>
            {images.map((_, i) => (
              <span
                key={i}
                className={i === activeIndex ? "curationPhotoCarouselDot curationPhotoCarouselDotActive" : "curationPhotoCarouselDot"}
              />
            ))}
          </div>
        )}
      </div>

      {actionMenuIndex !== null && (
        <div className="curationMarkerActionSheet" role="menu">
          <button type="button" onClick={() => handleMarkerAction(actionMenuIndex, "change")}>
            장소 변경
          </button>
          <button type="button" className="curationMarkerActionDelete" onClick={() => handleMarkerAction(actionMenuIndex, "delete")}>
            삭제
          </button>
          <button type="button" className="curationMarkerActionCancel" onClick={() => setActionMenuIndex(null)}>
            취소
          </button>
        </div>
      )}

      <PlaceSearchModal
        open={modalOpen}
        onClose={closeSearchModal}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearch={() => {
          void runSearch();
        }}
        results={searchResults}
        onSelect={handleSelectPlace}
        onManualSelect={handleManualPlace}
        keyboardHeight={keyboardHeight}
        searching={searching}
        hasSearched={hasSearched}
        lastSearchedQuery={lastSearchedQuery}
        searchNotice={searchNotice}
      />
    </div>
  );
}
