import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Insta Map",
  description: "Instagram URL to Kakao Map pins",
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
