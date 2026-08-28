"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AssetDetailClient } from "@/components/AssetDetailClient";

function AssetViewInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  return <AssetDetailClient id={id} />;
}

export default function AssetViewPage() {
  return (
    <Suspense>
      <AssetViewInner />
    </Suspense>
  );
}
