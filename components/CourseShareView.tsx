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

type Props = {
  course: SavedCourse;
  isIOS: boolean;
};

export function CourseShareView({ course, isIOS }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [monkeyFailed, setMonkeyFailed] = useState(false);
  const [runAwayOffset, setRunAwayOffset] = useState({ x: 0, y: 0 });
  const runAwayCountRef = useRef(0);

  const placeCount = course.place_count ?? course.items.length;
  const appStoreUrl = getAppStoreUrl();
  const showAppStoreCta = isIOS && !!appStoreUrl;

  const handleRunAway = useCallback(() => {
    runAwayCountRef.current += 1;
    const n = runAwayCountRef.current;
    const angle = n * 2.1 + Math.random() * 0.8;
    const dist = 36 + Math.random() * 72;
    setRunAwayOffset({
      x: Math.cos(angle) * dist + (Math.random() - 0.5) * 48,
      y: Math.sin(angle) * dist + (Math.random() - 0.5) * 32,
    });
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
            <button
              type="button"
              className="courseShareBtnNah"
              style={{ transform: `translate(${runAwayOffset.x}px, ${runAwayOffset.y}px)` }}
              onClick={handleRunAway}
              onMouseEnter={handleRunAway}
              aria-label="음…"
            >
              음…
            </button>
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

        <footer className="courseShareRevealFooter">
          {showAppStoreCta ? (
            <a className="courseShareMapCta" href={appStoreUrl} rel="noopener noreferrer">
              📍 코스 전체 보기
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
