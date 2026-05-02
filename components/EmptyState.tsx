"use client";

type EmptyStateProps = {
  icon?: string;
  title: string;
  description?: string;
  /** feed: 상단 정렬 (홈 피드 빈 상태 등) */
  variant?: "default" | "feed";
  action?: {
    label: string;
    onClick: () => void;
  };
};

export default function EmptyState({ icon = "✨", title, description, action, variant = "default" }: EmptyStateProps) {
  const isFeed = variant === "feed";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: isFeed ? "flex-start" : "center",
      padding: isFeed ? "24px 16px 40px" : "60px 20px",
      textAlign: "center",
      width: "100%",
      boxSizing: "border-box",
    }}>
      <div style={{
        fontSize: "56px",
        marginBottom: "16px",
        opacity: 0.7,
      }}>
        {icon}
      </div>
      <h3 style={{
        margin: "0 0 8px",
        fontFamily: "'Playfair Display', serif",
        fontSize: "16px",
        color: "#1a1a1a",
        fontWeight: 500,
      }}>
        {title}
      </h3>
      {description && (
        <p style={{
          margin: 0,
          fontSize: "12px",
          color: "#999",
          lineHeight: 1.6,
          maxWidth: "260px",
        }}>
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: "20px",
            border: "1px solid #1a1a1a",
            background: "#1a1a1a",
            color: "#fff",
            padding: "10px 24px",
            borderRadius: "8px",
            fontSize: "12px",
            fontFamily: "'Playfair Display', serif",
            letterSpacing: "1px",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}