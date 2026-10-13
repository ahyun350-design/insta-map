import type { Metadata, Viewport } from "next";
import MapPreviewAccessGate from "@/components/MapPreviewAccessGate";
import { isMapPreviewE2eTokenValid } from "@/lib/mapPreviewAccess";
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

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MapPreviewPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const raw = sp.e2e;
  const e2eParam = Array.isArray(raw) ? raw[0] : raw;
  const e2eGranted = isMapPreviewE2eTokenValid(e2eParam);

  return (
    <MapPreviewAccessGate e2eGranted={e2eGranted}>
      <MapPreviewClient />
    </MapPreviewAccessGate>
  );
}
