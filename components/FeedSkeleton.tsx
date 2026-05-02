"use client";

export default function FeedSkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <article
          key={i}
          style={{
            background: "#fff",
            border: "0.5px solid #e5e5e5",
            borderRadius: "16px",
            padding: "16px",
            flexShrink: 0,
          }}
        >
          {/* 프로필 영역 */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px" }}>
            <div className="skeleton" style={{ width: "38px", height: "38px", borderRadius: "50%" }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: "80px", height: "12px", borderRadius: "4px", marginBottom: "6px" }} />
              <div className="skeleton" style={{ width: "50px", height: "10px", borderRadius: "4px" }} />
            </div>
          </div>
          {/* 제목 */}
          <div className="skeleton" style={{ width: "70%", height: "18px", borderRadius: "4px", marginBottom: "8px" }} />
          {/* 카테고리 */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <div className="skeleton" style={{ width: "100px", height: "14px", borderRadius: "10px" }} />
          </div>
          {/* 사진 */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
          </div>
          {/* 좋아요 */}
          <div style={{ display: "flex", gap: "14px" }}>
            <div className="skeleton" style={{ width: "30px", height: "12px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "30px", height: "12px", borderRadius: "4px" }} />
          </div>
        </article>
      ))}
    </>
  );
}
