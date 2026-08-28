"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AssetForm } from "@/components/AssetForm";

function AssetEditInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  return <AssetForm assetId={id} />;
}

export default function EditAssetPage() {
  return (
    <Suspense>
      <AssetEditInner />
    </Suspense>
  );
}
