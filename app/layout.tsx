import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "PindMap — 인스타에서 본 그곳, 지도 위에서 다시 만나다",
  description:
    "Instagram에서 발견한 맛집·카페·여행지를 지도에 핀으로 저장하고 친구들과 공유하세요.",
  applicationName: "PindMap",manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#1a2a7a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}