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
  const placeCount = course.place_count ?? course.items.length;
  const appStoreUrl = getAppStoreUrl();
  const showAppStoreCta = isIOS && !!appStoreUrl;

  return (
    <div className="courseSharePage">
      <header className="courseShareHeader">
        <div className="courseShareBrand">
          <span className="courseShareBrandIcon" aria-hidden>
            📍
          </span>
          <span className="courseShareBrandName">PindMap</span>
        </div>
        {showAppStoreCta ? (
          <a className="courseShareHeaderCta" href={appStoreUrl} rel="noopener noreferrer">
            앱에서 보기
          </a>
        ) : (
          <span className="courseShareHeaderHint">iOS 앱</span>
        )}
      </header>

      <main className="courseShareMain">
        <h1 className="courseShareTitle">{course.title}</h1>
        <p className="courseShareSubtitle">📍 {placeCount}곳 코스</p>

        <div className="courseShareMapPlaceholder" aria-label="지도 미리보기">
          <p className="courseShareMapPlaceholderText">🗺️ 앱에서 지도와 경로 보기</p>
          <p className="courseShareMapPlaceholderSub">인터랙티브 지도는 PindMap 앱에서 이용할 수 있어요</p>
        </div>

        <ol className="courseShareList">
          {course.items.map((place, idx) => {
            const emoji = PLACE_CATEGORY_EMOJI[place.category] ?? "📍";
            return (
              <li key={`${place.id}-${idx}`} className="courseShareListItem">
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
      </main>

      <footer className="courseShareFooter">
        {showAppStoreCta ? (
          <a className="courseShareFooterCta" href={appStoreUrl} rel="noopener noreferrer">
            PindMap 앱에서 보기
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
    </div>
  );
}
