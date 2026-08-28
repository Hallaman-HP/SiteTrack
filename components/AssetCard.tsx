"use client";

import Link from "next/link";
import { MapPin, Network, PackageSearch } from "lucide-react";
import { AssetActionsMenu } from "@/components/AssetActionsMenu";
import type { AssetView } from "@/lib/types";
import { statusClass, statusLabel } from "@/lib/store";

export function AssetCard({
  asset,
  canArchive = false,
  canEdit = false,
  canDelete = false,
  onArchive,
  onRestore,
  onDelete
}: {
  asset: AssetView;
  canArchive?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onArchive?: (asset: AssetView) => void;
  onRestore?: (asset: AssetView) => void;
  onDelete?: (asset: AssetView) => void;
}) {
  const photo = asset.photos[0]?.photo_url;
  return (
    <article className="group relative overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel transition hover:-translate-y-0.5 hover:border-zinc-300">
      <Link href={`/assets/${asset.id}`} className="grid sm:grid-cols-[168px_1fr]">
        <div className="relative aspect-[4/3] bg-zinc-100 sm:aspect-auto">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={asset.item_name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-steel">
              <PackageSearch size={32} />
            </div>
          )}
        </div>
        <div className="min-w-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-11 sm:pr-0">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-steel">{asset.asset_number}</p>
              <h3 className="mt-1 truncate text-lg font-semibold tracking-tight text-ink">{asset.item_name}</h3>
              <p className="mt-1 text-sm text-steel">{asset.brand} {asset.model} | SN {asset.serial_number}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${asset.archived_at ? "bg-zinc-100 text-zinc-600 ring-zinc-200" : statusClass(asset.status)}`}>
              {asset.archived_at ? "Archived" : statusLabel(asset.status)}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-steel">
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 shrink-0" size={16} />
              <span className="min-w-0">{asset.building?.name} / {asset.room?.room_number} / {asset.location_in_room}</span>
            </p>
            <p className="flex items-start gap-2">
              <Network className="mt-0.5 shrink-0" size={16} />
              <span className="line-clamp-2">{asset.network_patch_number || asset.switch_port || asset.patching_details}</span>
            </p>
          </div>
        </div>
      </Link>
      <div className="absolute right-3 top-3">
        <AssetActionsMenu
          asset={asset}
          canArchive={canArchive && Boolean(onArchive)}
          canEdit={canEdit}
          canDelete={canDelete && Boolean(onDelete)}
          onArchive={(item) => onArchive?.(item)}
          onRestore={(item) => onRestore?.(item)}
          onDelete={(item) => onDelete?.(item)}
        />
      </div>
    </article>
  );
}
