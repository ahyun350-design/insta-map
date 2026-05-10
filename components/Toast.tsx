"use client";

import { useCallback, useEffect, useState, createContext, useContext, ReactNode } from "react";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const colors = {
  success: { bg: "#1a1a1a", text: "#fff", icon: "✓" },
  error: { bg: "#e07070", text: "#fff", icon: "✕" },
  info: { bg: "#666", text: "#fff", icon: "ℹ" },
};

function ToastItem({
  id,
  message,
  type,
  onDismiss,
}: {
  id: number;
  message: string;
  type: ToastType;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const duration = type === "error" ? 5000 : 3000;
    const t = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(t);
  }, [id, type, onDismiss]);

  const c = colors[type];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onDismiss(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDismiss(id);
        }
      }}
      style={{
        background: c.bg,
        color: c.text,
        padding: "12px 20px",
        borderRadius: "10px",
        fontSize: "13px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        animation: "toastSlide 0.3s ease-out",
        maxWidth: "320px",
        pointerEvents: "auto",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "14px" }}>{c.icon}</span>
      <span>{message}</span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: "fixed",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
      }}>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            onDismiss={dismissToast}
          />
        ))}
      </div>
      <style jsx global>{`
        @keyframes toastSlide {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
