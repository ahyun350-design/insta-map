"use client";

import dynamic from "next/dynamic";

const DebugBox = dynamic(() => import("@/components/DebugBox"), { ssr: false });

export default function DebugBoxLoader() {
  return <DebugBox />;
}
