"use client";

import { useCallback, useRef, useState } from "react";
import { resolveCourseInviteImage, type SavedCourse } from "@/lib/courses";
import { getAppStoreUrl } from "@/lib/pindmapLinks";

const PLACE_CATEGORY_EMOJI: Record<string, string> = {
  맛집: "🍽️",
  카페: "☕",
  쇼핑: "🛍️",
  숙소: "🏠",
  놀거리: "🎮",
  여행지: "🗺️",
};

const NAH_PROXIMITY_PX = 130;
const NAH_PLAYFIELD_MIN_H = 168;
const NAH_BTN_MAX_W = 260;
const NAH_BTN_H = 48;
const NAH_PAD = 10;
const NAH_RUN_COOLDOWN_MS = 45;

type Props = {
  course: SavedCourse;
  isIOS: boolean;
};

export function CourseShareView({ course, isIOS }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [nahPos, setNahPos] = useState({ x: 0, y: 12 });
  const nahPosRef = useRef({ x: 0, y: 12 });
  const nahPlayfieldRef = useRef<HTMLDivElement>(null);
  const nahBtnRef = useRef<HTMLButtonElement>(null);
  const lastNahRunRef = useRef(0);

  const placeCount = course.place_count ?? course.items.length;
  const appStoreUrl = getAppStoreUrl();
  const showAppStoreCta = isIOS && !!appStoreUrl;
  const inviteImageSrc = resolveCourseInviteImage(course);

  const getNahBounds = useCallback((playW: number, playH: number) => {
    const btnW = Math.min(NAH_BTN_MAX_W, playW - NAH_PAD * 2);
    const maxX = Math.max(0, (playW - btnW) / 2 - NAH_PAD);
    const minY = NAH_PAD;
    const maxY = Math.max(minY, playH - NAH_BTN_H - NAH_PAD);
    return { maxX, minY, maxY };
  }, []);

  const clampNahPos = useCallback(
    (x: number, y: number, playW: number, playH: number) => {
      const { maxX, minY, maxY } = getNahBounds(playW, playH);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },
    [getNahBounds],
  );

  const pickFarNahPos = useCallback(
    (
      playW: number,
      playH: number,
      pointerX?: number,
      pointerY?: number,
      fieldRect?: DOMRect,
    ) => {
      const { maxX, minY, maxY } = getNahBounds(playW, playH);
      const curX = nahPosRef.current.x;
      const curY = nahPosRef.current.y;
      const minJump = Math.max(maxX * 0.55, playW * 0.42, 56);
      const minJumpY = Math.max((maxY - minY) * 0.45, 36);

      let best: { x: number; y: number } | null = null;
      let bestScore = -1;

      const scoreCandidate = (x: number, y: number) => {
        const jumpDist = Math.hypot(x - curX, y - curY);
        if (jumpDist < minJump && Math.abs(y - curY) < minJumpY) return -1;

        let score = jumpDist;
        if (pointerX != null && pointerY != null && fieldRect) {
          const btnCx = fieldRect.left + playW / 2 + x;
          const btnCy = fieldRect.top + y + NAH_BTN_H / 2;
          score += Math.hypot(btnCx - pointerX, btnCy - pointerY) * 0.35;
        }
        return score;
      };

      const cornerSeeds = [
        { x: -maxX, y: minY },
        { x: maxX, y: minY },
        { x: -maxX, y: maxY },
        { x: maxX, y: maxY },
        { x: 0, y: maxY },
        { x: 0, y: minY },
        { x: -maxX * 0.85, y: (minY + maxY) / 2 },
        { x: maxX * 0.85, y: (minY + maxY) / 2 },
      ];

      for (const seed of cornerSeeds) {
        const s = scoreCandidate(seed.x, seed.y);
        if (s > bestScore) {
          bestScore = s;
          best = seed;
        }
      }

      for (let i = 0; i < 16; i += 1) {
        const x = (Math.random() * 2 - 1) * maxX;
        const y = minY + Math.random() * (maxY - minY);
        const s = scoreCandidate(x, y);
        if (s > bestScore) {
          bestScore = s;
          best = { x, y };
        }
      }

      if (!best) {
        best = {
          x: curX >= 0 ? -maxX * (0.75 + Math.random() * 0.25) : maxX * (0.75 + Math.random() * 0.25),
          y: curY >= (minY + maxY) / 2 ? minY + 6 : maxY - 6,
        };
      }

      return clampNahPos(best.x, best.y, playW, playH);
    },
    [clampNahPos, getNahBounds],
  );

  const moveNahAway = useCallback(
    (pointerX?: number, pointerY?: number) => {
      const now = Date.now();
      if (now - lastNahRunRef.current < NAH_RUN_COOLDOWN_MS) return;
      lastNahRunRef.current = now;

      const field = nahPlayfieldRef.current;
      if (!field) return;

      const fieldRect = field.getBoundingClientRect();
      const playW = fieldRect.width;
      const playH = field.clientHeight || NAH_PLAYFIELD_MIN_H;

      const next = pickFarNahPos(playW, playH, pointerX, pointerY, fieldRect);
      nahPosRef.current = next;
      setNahPos(next);
    },
    [pickFarNahPos],
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
          {inviteFailed ? (
            <div className="courseShareMonkeyFallback" aria-hidden>
              🐵
            </div>
          ) : (
            <img
              key={inviteImageSrc}
              src={inviteImageSrc}
              alt=""
              className="courseShareMonkeyImg"
              width={300}
              height={450}
              decoding="async"
              onError={() => setInviteFailed(true)}
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
