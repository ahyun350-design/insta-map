import type { Metadata, Viewport } from "next";
import MapPreviewClient from "./MapPreviewClient";

export const metadata: Metadata = {
  title: "핀맵 지도 미리보기",
  description: "PindMap 자체 디자인 지도 시험용 페이지",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1a2a7a",
};

export default function MapPreviewPage() {
  return <MapPreviewClient />;
}
