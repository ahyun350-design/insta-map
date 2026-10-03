"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type PublicPlaceListDetail,
  type PublicPlaceListPlace,
} from "@/lib/placeLists";
import { formatCategoryWithSubcategory } from "@/lib/kakaoSubcategory";
import { LIST_COLOR_PRESETS } from "@/lib/listColors";
import { getAppStoreUrl, getTrackDomain } from "@/lib/pindmapLinks";
import { parsePindmapMapThemeId } from "@/lib/pindmapMapStyle";
import { trackPublicListEvent } from "@/lib/track";
import PindmapGlMap from "@/components/PindmapGlMap";

type Props = {
  list: PublicPlaceListDetail;
  places: PublicPlaceListPlace[];
  isIOS: boolean;
};

function loadKakaoMapsSdk(): Promise<NonNullable<(typeof window)["kakao"]>> {
  return new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim();
    if (!key) {
      reject(new Error("missing_kakao_key"));
      return;
    }

    const w = window as Window & {
      kakao?: {
        maps: {
          load: (cb: () => void) => void;
        };
      };
    };

    const finish = () => {
      if (!w.kakao?.maps) {
        reject(new Error("kakao_maps_missing"));
        return;
      }
      w.kakao.maps.load(() => resolve(w.kakao!));
    };

    if (w.kakao?.maps) {
      finish();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-pindmap-kakao-maps]",
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("kakao_script_error")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.dataset.pindmapKakaoMaps = "1";
    script.onload = finish;
    script.onerror = () => reject(new Error("kakao_script_error"));
    document.head.appendChild(script);
  });
}

function readMapEngine(): "gl" | "kakao" {
  if (typeof window === "undefined") return "gl";
  const map = new URLSearchParams(window.location.search).get("map");
  return map === "kakao" ? "kakao" : "gl";
}

function readTheme() {
  if (typeof window === "undefined") return "paper" as const;
  return parsePindmapMapThemeId(
    new URLSearchParams(window.location.search).get("theme"),
  );
}

export function PublicListShareView({ list, places, isIOS }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [engine, setEngine] = useState<"gl" | "kakao">("gl");
  const [theme, setTheme] = useState<"paper" | "white">("paper");
  const [queryReady, setQueryReady] = useState(false);
  const appStoreUrl = getAppStoreUrl();
  const showAppStoreCta = isIOS && !!appStoreUrl;

  const listColor =
    (list.color && LIST_COLOR_PRESETS[list.color as keyof typeof LIST_COLOR_PRESETS]) ||
    "#1a2a7a";

  const pins = useMemo(
    () =>
      places
        .filter(
          (p) => typeof p.lat === "number" && typeof p.lng === "number",
        )
        .map((p) => ({
          id: p.place_id,
          lng: p.lng as number,
          lat: p.lat as number,
          category: p.category,
          name: p.name,
        })),
    [places],
  );

  useEffect(() => {
    setEngine(readMapEngine());
    setTheme(readTheme());
    setQueryReady(true);
  }, []);

  useEffect(() => {
    trackPublicListEvent("public_list_view", {
      list_id: list.id,
      domain: getTrackDomain(),
    });
  }, [list.id]);

  // Kakao rollback path (?map=kakao) — keep previous implementation
  useEffect(() => {
    if (!queryReady || engine !== "kakao") return;

    if (places.length === 0) {
      setMapStatus("error");
      setMapError(true);
      return;
    }

    let cancelled = false;
    const markers: { setMap?: (v: null) => void }[] = [];

    const run = async () => {
      try {
        const kakao = (await loadKakaoMapsSdk()) as {
          maps: {
            LatLng: new (lat: number, lng: number) => unknown;
            Map: new (
              el: HTMLElement,
              opts: { center: unknown; level: number },
            ) => {
              setBounds?: (b: unknown) => void;
              relayout?: () => void;
            };
            Marker: new (opts: { position: unknown }) => {
              setMap: (m: unknown) => void;
            };
            LatLngBounds: new () => { extend: (ll: unknown) => void };
          };
        };
        if (cancelled) return;
        const el = mapRef.current;
        if (!el) {
          setMapStatus("error");
          setMapError(true);
          return;
        }

        const withCoords = places.filter(
          (p) => typeof p.lat === "number" && typeof p.lng === "number",
        );
        if (withCoords.length === 0) {
          setMapStatus("error");
          setMapError(true);
          return;
        }

        const center = new kakao.maps.LatLng(
          withCoords[0]!.lat!,
          withCoords[0]!.lng!,
        );
        const map = new kakao.maps.Map(el, { center, level: 5 });
        const bounds = new kakao.maps.LatLngBounds();
        for (const p of withCoords) {
          const pos = new kakao.maps.LatLng(p.lat!, p.lng!);
          bounds.extend(pos);
          const marker = new kakao.maps.Marker({ position: pos });
          marker.setMap(map);
          markers.push(marker);
        }
        if (withCoords.length > 1) {
          try {
            map.setBounds?.(bounds);
          } catch {
            /* ignore */
          }
        }
        window.setTimeout(() => {
          try {
            map.relayout?.();
          } catch {
            /* ignore */
          }
        }, 80);
        if (!cancelled) {
          setMapError(false);
          setMapStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setMapError(true);
          setMapStatus("error");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      for (const m of markers) {
        try {
          m.setMap?.(null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [places, engine, queryReady]);

  useEffect(() => {
    if (!queryReady || engine !== "gl") return;
    if (pins.length === 0) {
      setMapStatus("error");
      setMapError(true);
    }
  }, [engine, queryReady, pins.length]);

  const handleCtaClick = () => {
    trackPublicListEvent("public_list_cta_click", {
      list_id: list.id,
      domain: getTrackDomain(),
    });
  };

  const showGlMap = queryReady && engine === "gl" && pins.length > 0 && !mapError;
  const showKakaoMap = queryReady && engine === "kakao" && !mapError;

  return (
    <div
      className="publicListSharePage"
      data-testid="public-list-share-page"
      data-map-status={mapStatus}
      data-map-engine={engine}
    >
      <header className="publicListShareHeader">
        <p className="publicListShareBrand">PindMap</p>
        <h1 className="publicListShareTitle" data-testid="public-list-share-title">
          {list.title}
        </h1>
        <p className="publicListShareSub">
          {list.owner_username ? `@${list.owner_username} · ` : ""}
          {list.place_count || places.length}곳
        </p>
      </header>

      <div className="publicListShareMapWrap" aria-hidden={mapError}>
        {mapError ? (
          <p className="publicListShareMapFallback" data-testid="public-list-map-fallback">
            지도를 불러오지 못했어요
          </p>
        ) : null}
        {showGlMap ? (
          <div className="publicListShareMap" data-testid="public-list-share-map">
            <PindmapGlMap
              theme={theme}
              pins={pins}
              singleZoom={15}
              fitPadding={36}
              cluster
              onReady={() => {
                setMapError(false);
                setMapStatus("ready");
              }}
              onError={() => {
                setMapError(true);
                setMapStatus("error");
              }}
            />
          </div>
        ) : null}
        {showKakaoMap ? (
          <div
            ref={mapRef}
            className="publicListShareMap"
            data-testid="public-list-share-map"
          />
        ) : null}
      </div>

      <main className="publicListShareBody">
        {places.length === 0 ? (
          <p className="publicListShareHint">담긴 장소가 없어요</p>
        ) : (
          <ul className="publicListShareItems" data-testid="public-list-share-items">
            {places.map((p) => {
              const catLabel = formatCategoryWithSubcategory(
                p.category,
                p.subcategory,
              );
              return (
                <li key={p.place_id} className="publicListShareItem">
                  <span
                    className="publicListShareItemBar"
                    style={{ background: listColor }}
                    aria-hidden
                  />
                  <span className="publicListShareItemText">
                    <span
                      className="publicListShareItemName"
                      data-testid="public-list-share-place-name"
                    >
                      {p.name}
                    </span>
                    {catLabel ? (
                      <span className="publicListShareItemMeta">{catLabel}</span>
                    ) : null}
                    <span className="publicListShareItemAddr">{p.address}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="publicListShareFooter">
        {showAppStoreCta ? (
          <a
            className="courseShareAppCta"
            href={appStoreUrl}
            rel="noopener noreferrer"
            data-testid="public-list-app-cta"
            onClick={handleCtaClick}
          >
            <span className="courseShareAppCtaMain">PindMap 앱에서 목록 열기 →</span>
            <span className="courseShareAppCtaSub">무료 · 3초면 설치 끝</span>
          </a>
        ) : isIOS ? (
          <p className="publicListShareFooterNote">
            PindMap은 iOS 앱 스토어에서 이용할 수 있어요.
            {appStoreUrl ? null : " (앱 스토어 링크 준비 중)"}
          </p>
        ) : (
          <a
            className="courseShareAppCta"
            href="/"
            data-testid="public-list-app-cta"
            onClick={handleCtaClick}
          >
            <span className="courseShareAppCtaMain">PindMap에서 더 보기 →</span>
            <span className="courseShareAppCtaSub">저장·지도·공유까지 한곳에서</span>
          </a>
        )}
      </footer>
    </div>
  );
}
