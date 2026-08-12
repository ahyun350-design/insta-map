"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FEED_POST_CATEGORIES, type FeedPostCategory } from "@/lib/feedPost";

export type KakaoPlaceSearchResult = {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  y?: string | number;
  x?: string | number;
};

/** 직접 입력으로 확정된 장소 (카카오 검색 결과와 동일 슬롯으로 태그) */
export type ManualPlaceResult = {
  id: string;
  place_name: string;
  address: string;
  category: FeedPostCategory;
  lat: number;
  lng: number;
  isManual: true;
};

type GeocodeHit = {
  lat: number;
  lng: number;
  displayAddress: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  results: KakaoPlaceSearchResult[];
  onSelect: (place: KakaoPlaceSearchResult) => void;
  onManualSelect: (place: ManualPlaceResult) => void;
  keyboardHeight?: number;
  searching?: boolean;
  hasSearched?: boolean;
  lastSearchedQuery?: string;
  searchNotice?: string | null;
};

function addressSearchOnce(query: string): Promise<GeocodeHit | null> {
  return new Promise((resolve) => {
    if (!window.kakao?.maps?.services?.Geocoder) {
      resolve(null);
      return;
    }
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(query.trim(), (data: any[], st: string) => {
      if (st !== window.kakao.maps.services.Status.OK || !Array.isArray(data) || data.length === 0) {
        resolve(null);
        return;
      }
      const first = data[0];
      const lat = parseFloat(String(first.y));
      const lng = parseFloat(String(first.x));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        resolve(null);
        return;
      }
      const road = first.road_address?.address_name as string | undefined;
      const jibun = first.address?.address_name as string | undefined;
      const displayAddress =
        (typeof road === "string" && road.trim()) ||
        (typeof jibun === "string" && jibun.trim()) ||
        (typeof first.address_name === "string" && first.address_name.trim()) ||
        query.trim();
      resolve({ lat, lng, displayAddress });
    });
  });
}

export function PlaceSearchModal({
  open,
  onClose,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  results,
  onSelect,
  onManualSelect,
  keyboardHeight = 0,
  searching = false,
  hasSearched = false,
  lastSearchedQuery = "",
  searchNotice = null,
}: Props) {
  const modalPaddingBottom =
    keyboardHeight > 0
      ? `calc(12px + ${keyboardHeight}px)`
      : "calc(12px + env(safe-area-inset-bottom, 0px))";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [manualCategory, setManualCategory] = useState<FeedPostCategory>("쇼핑");
  const [geocodeHit, setGeocodeHit] = useState<GeocodeHit | null>(null);
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("search");
      setManualName("");
      setManualAddress("");
      setManualCategory("쇼핑");
      setGeocodeHit(null);
      setAddressConfirmed(false);
      setGeocoding(false);
      setManualError(null);
      return;
    }
    if (mode === "search") {
      const id = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }
  }, [open, mode]);

  const openManual = () => {
    setMode("manual");
    setManualName(searchQuery.trim() || lastSearchedQuery.trim());
    setManualAddress("");
    setGeocodeHit(null);
    setAddressConfirmed(false);
    setManualError(null);
  };

  const resolveAddress = async () => {
    const addr = manualAddress.trim();
    if (!addr) {
      setManualError("주소를 입력해 주세요");
      setGeocodeHit(null);
      setAddressConfirmed(false);
      return;
    }
    if (!window.kakao?.maps?.services?.Geocoder) {
      setManualError("잠시 후 다시 시도해 주세요");
      return;
    }
    setGeocoding(true);
    setManualError(null);
    setAddressConfirmed(false);
    try {
      const hit = await addressSearchOnce(addr);
      if (!hit) {
        setGeocodeHit(null);
        setManualError("이 주소로는 위치를 찾을 수 없어요. 도로명·지번을 확인해 주세요");
        return;
      }
      setGeocodeHit(hit);
      setManualError(null);
    } finally {
      setGeocoding(false);
    }
  };

  const submitManual = () => {
    const name = manualName.trim();
    if (!name) {
      setManualError("가게 이름을 입력해 주세요");
      return;
    }
    if (!geocodeHit) {
      setManualError("주소를 확인한 뒤 위치를 맞춰 주세요");
      return;
    }
    if (!addressConfirmed) {
      setManualError("변환된 주소가 맞는지 확인해 주세요");
      return;
    }
    onManualSelect({
      id: `manual-${Date.now()}`,
      place_name: name,
      address: geocodeHit.displayAddress,
      category: manualCategory,
      lat: geocodeHit.lat,
      lng: geocodeHit.lng,
      isManual: true,
    });
  };

  const showManualEntryCta = !searching && !searchNotice;

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="배경 닫기"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100001,
          border: "none",
          background: "rgba(0,0,0,0.45)",
          cursor: "pointer",
          padding: 0,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "manual" ? "장소 직접 입력" : "장소 검색"}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100002,
          background: "#fff",
          borderRadius: "16px 16px 0 0",
          maxHeight: "min(78vh, 560px)",
          display: "flex",
          flexDirection: "column",
          paddingBottom: modalPaddingBottom,
          transition: "padding-bottom 0.25s ease",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.12)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 10px",
            borderBottom: "0.5px solid #efefef",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {mode === "manual" && (
              <button
                type="button"
                onClick={() => setMode("search")}
                aria-label="검색으로 돌아가기"
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: 18,
                  color: "#1a2a7a",
                  cursor: "pointer",
                  padding: "4px 2px",
                }}
              >
                ←
              </button>
            )}
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1a2a7a" }}>
              {mode === "manual" ? "직접 입력" : "장소 검색"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              color: "#666",
              cursor: "pointer",
              width: 36,
              height: 36,
            }}
          >
            ×
          </button>
        </div>

        {mode === "search" ? (
          <>
            <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexShrink: 0 }}>
              <input
                ref={inputRef}
                className="mapInput"
                placeholder="장소명 검색"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                style={{ flex: 1 }}
              />
              <button
                className="primaryButton"
                type="button"
                onClick={onSearch}
                style={{ padding: "0 14px", flexShrink: 0 }}
              >
                검색
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                padding: "0 8px 8px",
              }}
            >
              {searching ? (
                <p style={{ margin: "24px 0", textAlign: "center", fontSize: 13, color: "#999" }}>
                  검색 중…
                </p>
              ) : searchNotice ? (
                <p style={{ margin: "24px 0", textAlign: "center", fontSize: 13, color: "#999" }}>
                  {searchNotice}
                </p>
              ) : results.length === 0 ? (
                <>
                  <p style={{ margin: "24px 0 12px", textAlign: "center", fontSize: 13, color: "#999" }}>
                    {hasSearched
                      ? `'${lastSearchedQuery}' 검색 결과가 없어요. 다른 이름으로 시도해 보세요`
                      : "검색어를 입력하고 검색해주세요"}
                  </p>
                  {showManualEntryCta && (
                    <div style={{ padding: "4px 8px 16px", textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={openManual}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#1a2a7a",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          textDecoration: "underline",
                          fontFamily: "inherit",
                          padding: "8px",
                        }}
                      >
                        찾는 곳이 없나요? 직접 입력하기
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(r)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 12px",
                          background: "transparent",
                          border: "none",
                          borderBottom: "0.5px solid #f5f5f5",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <p style={{ margin: 0, fontSize: 14, color: "#1a1a2e", fontWeight: 500 }}>
                          {r.place_name}
                        </p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#999" }}>
                          {r.road_address_name || r.address_name || "주소 없음"}
                        </p>
                        {r.category_name && (
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#bbb" }}>
                            {r.category_name}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                  {showManualEntryCta && (
                    <li style={{ padding: "12px 8px 16px", textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={openManual}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#1a2a7a",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          textDecoration: "underline",
                          fontFamily: "inherit",
                          padding: "8px",
                        }}
                      >
                        찾는 곳이 없나요? 직접 입력하기
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding: "12px 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>가게 이름 *</span>
              <input
                className="mapInput"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="예: 무차코 잡화점"
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>주소 *</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="mapInput"
                  value={manualAddress}
                  onChange={(e) => {
                    setManualAddress(e.target.value);
                    setGeocodeHit(null);
                    setAddressConfirmed(false);
                    setManualError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void resolveAddress();
                    }
                  }}
                  placeholder="도로명 또는 지번 주소"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="primaryButton"
                  onClick={() => void resolveAddress()}
                  disabled={geocoding}
                  style={{ padding: "0 12px", flexShrink: 0, opacity: geocoding ? 0.7 : 1 }}
                >
                  {geocoding ? "확인 중" : "주소 확인"}
                </button>
              </div>
            </label>

            {geocodeHit && (
              <div
                style={{
                  padding: "12px",
                  borderRadius: 10,
                  background: "#f5f7fb",
                  border: "1px solid #e4e8f2",
                }}
              >
                <p style={{ margin: 0, fontSize: 12, color: "#666" }}>변환된 주소</p>
                <p style={{ margin: "6px 0 10px", fontSize: 14, color: "#1a1a2e", fontWeight: 600 }}>
                  {geocodeHit.displayAddress}
                </p>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    fontSize: 13,
                    color: "#333",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={addressConfirmed}
                    onChange={(e) => {
                      setAddressConfirmed(e.target.checked);
                      setManualError(null);
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <span>이 주소가 맞아요</span>
                </label>
              </div>
            )}

            <div>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#666", fontWeight: 600 }}>
                카테고리 *
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {FEED_POST_CATEGORIES.map((cat) => {
                  const active = manualCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setManualCategory(cat)}
                      style={{
                        border: active ? "1px solid #1a2a7a" : "1px solid #ddd",
                        background: active ? "#1a2a7a" : "#fff",
                        color: active ? "#fff" : "#555",
                        borderRadius: 16,
                        padding: "6px 12px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {manualError && (
              <p style={{ margin: 0, fontSize: 12, color: "#c62828" }}>{manualError}</p>
            )}

            <button
              type="button"
              className="primaryButton"
              onClick={submitManual}
              disabled={!geocodeHit || !addressConfirmed || !manualName.trim()}
              style={{
                width: "100%",
                padding: "12px",
                marginTop: 4,
                opacity: !geocodeHit || !addressConfirmed || !manualName.trim() ? 0.5 : 1,
              }}
            >
              이 장소로 태그하기
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
