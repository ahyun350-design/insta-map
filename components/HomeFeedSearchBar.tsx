"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** 홈 상단 툴바 한 줄 배치 시 바깥 패딩 제거 */
  variant?: "default" | "inline";
  /** true면 입력 없이 탭 시 검색 화면만 연다 */
  triggerOnly?: boolean;
  onOpenSearch?: () => void;
};

function IconSearch() {
  return (
    <svg className="homeFeedSearchIcon" width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function HomeFeedSearchBar({
  value,
  onChange,
  variant = "default",
  triggerOnly = false,
  onOpenSearch,
}: Props) {
  const showClear = !triggerOnly && value.length > 0;

  const openSearch = () => {
    onOpenSearch?.();
  };

  return (
    <div className={variant === "inline" ? "homeFeedSearchWrap homeFeedSearchWrapInline" : "homeFeedSearchWrap"}>
      <label className="homeFeedSearchField">
        <IconSearch />
        <input
          type="search"
          className="homeFeedSearchInput"
          value={triggerOnly ? "" : value}
          readOnly={triggerOnly}
          onChange={(e) => {
            if (triggerOnly) return;
            onChange(e.target.value);
          }}
          onFocus={(e) => {
            if (!triggerOnly) return;
            e.preventDefault();
            e.currentTarget.blur();
            openSearch();
          }}
          onClick={() => {
            if (triggerOnly) openSearch();
          }}
          placeholder="장소·키워드 검색"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {showClear && (
          <button
            type="button"
            className="homeFeedSearchClear"
            onClick={() => onChange("")}
            aria-label="검색어 지우기"
          >
            ×
          </button>
        )}
      </label>
    </div>
  );
}
