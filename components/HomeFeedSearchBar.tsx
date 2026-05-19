"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function IconSearch() {
  return (
    <svg className="homeFeedSearchIcon" width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function HomeFeedSearchBar({ value, onChange }: Props) {
  const showClear = value.length > 0;

  return (
    <div className="homeFeedSearchWrap">
      <label className="homeFeedSearchField">
        <IconSearch />
        <input
          type="search"
          className="homeFeedSearchInput"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
