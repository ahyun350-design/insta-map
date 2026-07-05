"use client";

import { useCallback, useRef, useState } from "react";
import type { SavedCourse } from "@/lib/courses";
import { getAppStoreUrl } from "@/lib/pindmapLinks";

const PLACE_CATEGORY_EMOJI: Record<string, string> = {
  맛집: "🍽️",
  카페: "☕",
  쇼핑: "🛍️",
  숙소: "🏠",
  놀거리: "🎮",
  여행지: "🗺️",
};

const NAH_PROXIMITY_PX = 80;
const NAH_PLAYFIELD_MIN_H = 156;
const NAH_BTN_MAX_W = 260;
const NAH_BTN_H = 48;
const NAH_PAD = 10;
const NAH_RUN_COOLDOWN_MS = 70;

type Props = {
  course: SavedCourse;
  isIOS: boolean;
};

export function CourseShareView({ course, isIOS }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [monkeyFailed, setMonkeyFailed] = useState(false);
  const [nahPos, setNahPos] = useState({ x: 0, y: 12 });
  const nahPosRef = useRef({ x: 0, y: 12 });
  const nahPlayfieldRef = useRef<HTMLDivElement>(null);
  const nahBtnRef = useRef<HTMLButtonElement>(null);
  const lastNahRunRef = useRef(0);

  const placeCount = course.place_count ?? course.items.length;
  const appStoreUrl = getAppStoreUrl();
  const showAppStoreCta = isIOS && !!appStoreUrl;

  const clampNahPos = useCallback((x: number, y: number, playW: number, playH: number) => {
    const btnW = Math.min(NAH_BTN_MAX_W, playW - NAH_PAD * 2);
    const maxX = Math.max(0, (playW - btnW) / 2 - NAH_PAD);
    const maxY = Math.max(NAH_PAD, playH - NAH_BTN_H - NAH_PAD);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(NAH_PAD, Math.min(maxY, y)),
    };
  }, []);

  const moveNahAway = useCallback(
    (pointerX?: number, pointerY?: number) => {
      const now = Date.now();
      if (now - lastNahRunRef.current < NAH_RUN_COOLDOWN_MS) return;
      lastNahRunRef.current = now;

      const field = nahPlayfieldRef.current;
      const nah = nahBtnRef.current;
      if (!field || !nah) return;

      const fieldRect = field.getBoundingClientRect();
      const playW = fieldRect.width;
      const playH = field.clientHeight || NAH_PLAYFIELD_MIN_H;

      const nahRect = nah.getBoundingClientRect();
      const nahCx = nahRect.left + nahRect.width / 2;
      const nahCy = nahRect.top + nahRect.height / 2;

      let nextX = nahPosRef.current.x;
      let nextY = nahPosRef.current.y;

      if (pointerX != null && pointerY != null) {
        const dx = nahCx - pointerX;
        const dy = nahCy - pointerY;
        const len = Math.hypot(dx, dy) || 1;
        const push = 52 + Math.random() * 36;
        nextX += (dx / len) * push + (Math.random() - 0.5) * 24;
        nextY += (dy / len) * push + (Math.random() - 0.5) * 20;
      } else {
        nextX += (Math.random() - 0.5) * 110;
        nextY += (Math.random() - 0.5) * 72;
      }

      const clamped = clampNahPos(nextX, nextY, playW, playH);
      nahPosRef.current = clamped;
      setNahPos(clamped);
    },
    [clampNahPos],
  );

  const handleNahZonePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const nah = nahBtnRef.current;
      if (!nah) return;
      const rect = nah.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < NAH_PROXIMITY_PX) {
        moveNahAway(e.clientX, e.clientY);
      }
    },
    [moveNahAway],
  );

  const handleNahPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      moveNahAway(e.clientX, e.clientY);
    },
    [moveNahAway],
  );

  const blockNahClick = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (step === 1) {
    return (
      <div className="courseSharePage courseSharePageInvite">
        <div className="courseShareInviteInner">
          {monkeyFailed ? (
            <div className="courseShareMonkeyFallback" aria-hidden>
              🐵
            </div>
          ) : (
            <img
              src="/date-monkey.png"
              alt=""
              className="courseShareMonkeyImg"
              width={120}
              height={180}
              decoding="async"
              onError={() => setMonkeyFailed(true)}
            />
          )}
          <p className="courseShareInviteLine">나랑 데이트 할래…??</p>
          <div className="courseShareInviteActions">
            <button type="button" className="courseShareBtnYes" onClick={() => setStep(2)}>
              좋아 ㅎㅎ
            </button>
            <div
              ref={nahPlayfieldRef}
              className="courseShareNahPlayfield"
              onPointerMove={handleNahZonePointerMove}
            >
              <button
                ref={nahBtnRef}
                type="button"
                className="courseShareBtnNah"
                style={{ transform: `translate(calc(-50% + ${nahPos.x}px), ${nahPos.y}px)` }}
                onPointerDown={handleNahPointerDown}
                onClick={blockNahClick}
                onMouseEnter={(e) => moveNahAway(e.clientX, e.clientY)}
                aria-label="음…"
              >
                음…
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="courseSharePage courseSharePageReveal">
      <main className="courseShareRevealMain">
        <p className="courseShareRevealLead">그래서 내가 코스 준비해 왔어!</p>
        <p className="courseShareRevealTitle">
          {course.title} · {placeCount}곳
        </p>

        <ol className="courseShareList courseShareListStagger">
          {course.items.map((place, idx) => {
            const emoji = PLACE_CATEGORY_EMOJI[place.category] ?? "📍";
            return (
              <li
                key={`${place.id}-${idx}`}
                className="courseShareListItem courseShareListItemReveal"
                style={{ animationDelay: `${idx * 0.15}s` }}
              >
                <div className="courseShareListIndex">{idx + 1}</div>
                <div className="courseShareListBody">
                  <p className="courseShareListName">{place.name}</p>
                  <p className="courseShareListMeta">
                    {emoji} {place.category}
                    {place.address ? ` · ${place.address}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {showAppStoreCta && (
          <div className="courseShareAppBanner">
            <p className="courseShareAppBannerLine1">🔒 지도·경로·길찾기는 앱에서</p>
            <p className="courseShareAppBannerLine2">앱에서 열면 이 코스 그대로 저장돼</p>
          </div>
        )}

        <footer className="courseShareRevealFooter">
          {showAppStoreCta ? (
            <a className="courseShareAppCta" href={appStoreUrl} rel="noopener noreferrer">
              <span className="courseShareAppCtaMain">PindMap 앱에서 코스 열기 →</span>
              <span className="courseShareAppCtaSub">무료 · 3초면 설치 끝</span>
            </a>
          ) : isIOS ? (
            <p className="courseShareFooterNote">
              PindMap은 iOS 앱 스토어에서 이용할 수 있어요.
              {appStoreUrl ? null : " (앱 스토어 링크 준비 중)"}
            </p>
          ) : (
            <p className="courseShareFooterNote">PindMap은 현재 iOS에서 이용할 수 있어요.</p>
          )}
        </footer>
      </main>
    </div>
  );
}
