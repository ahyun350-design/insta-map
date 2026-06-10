"use client";

type FeedSkeletonProps = {
  variant?: "list" | "grid";
  columns?: number;
};

export default function FeedSkeleton({ variant = "list", columns = 2 }: FeedSkeletonProps) {
  if (variant === "grid") {
    return (
      <div
        className="homeFeedGridSkeleton"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 10,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <article key={i} style={{ minWidth: 0 }}>
            <div className="skeleton" style={{ width: "100%", aspectRatio: "1", borderRadius: 10 }} />
            <div className="skeleton" style={{ width: "55%", height: 10, borderRadius: 4, marginTop: 8 }} />
            <div className="skeleton" style={{ width: "85%", height: 12, borderRadius: 4, marginTop: 6 }} />
            <div className="skeleton" style={{ width: "70%", height: 12, borderRadius: 4, marginTop: 4 }} />
          </article>
        ))}
      </div>
    );
  }

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
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px" }}>
            <div className="skeleton" style={{ width: "38px", height: "38px", borderRadius: "50%" }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: "80px", height: "12px", borderRadius: "4px", marginBottom: "6px" }} />
              <div className="skeleton" style={{ width: "50px", height: "10px", borderRadius: "4px" }} />
            </div>
          </div>
          <div className="skeleton" style={{ width: "70%", height: "18px", borderRadius: "4px", marginBottom: "8px" }} />
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <div className="skeleton" style={{ width: "100px", height: "14px", borderRadius: "10px" }} />
          </div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "6px" }} />
          </div>
          <div style={{ display: "flex", gap: "14px" }}>
            <div className="skeleton" style={{ width: "30px", height: "12px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "30px", height: "12px", borderRadius: "4px" }} />
          </div>
        </article>
      ))}
    </>
  );
}
