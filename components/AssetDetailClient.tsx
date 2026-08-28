"use client";

import Link from "next/link";
import { ArrowLeft, Clock3, Edit, MapPin, Network, PackageSearch } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { assetToView, statusClass, statusLabel } from "@/lib/store";
import { useStoreData } from "@/lib/useStoreData";

export function AssetDetailClient({ id }: { id: string }) {
  const [data, , , , isLoading] = useStoreData();
  const asset = data.assets.find((item) => item.id === id);

  if (isLoading) {
    return (
      <div className="rounded-[8px] border border-zinc-200 bg-white p-8 text-center shadow-panel">
        <PackageSearch className="mx-auto text-steel" size={36} />
        <h1 className="mt-4 text-2xl font-semibold">Loading asset...</h1>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="rounded-[8px] border border-zinc-200 bg-white p-8 text-center shadow-panel">
        <PackageSearch className="mx-auto text-steel" size={36} />
        <h1 className="mt-4 text-2xl font-semibold">Asset not found</h1>
        <Link href="/search" className="mt-4 inline-flex rounded-[8px] bg-ink px-4 py-2 text-sm font-semibold text-white">Back to search</Link>
      </div>
    );
  }

  const view = assetToView(asset, data);
  const photo = view.photos[0]?.photo_url;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/search" className="inline-flex items-center gap-2 text-sm font-semibold text-steel hover:text-ink">
          <ArrowLeft size={17} />
          Search
        </Link>
        <Link href={`/assets/edit/?id=${id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">
          <Edit size={17} />
          Edit Asset
        </Link>
      </div>
      {asset.archived_at ? (
        <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-panel">
          This asset is archived. It is hidden from active dashboard and search results until an admin restores it.
        </div>
      ) : null}
      <section className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
          <div className="min-h-[280px] bg-zinc-100">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={view.item_name} className="h-full max-h-[520px] w-full object-cover" />
            ) : (
              <div className="grid h-full min-h-[280px] place-items-center text-steel"><PackageSearch size={42} /></div>
            )}
          </div>
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-steel">{view.asset_number}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{view.item_name}</h1>
                <p className="mt-2 text-steel">{view.item_type} | {view.brand} {view.model}</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${view.archived_at ? "bg-zinc-100 text-zinc-600 ring-zinc-200" : statusClass(view.status)}`}>
                {view.archived_at ? "Archived" : statusLabel(view.status)}
              </span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Info label="Serial number" value={view.serial_number} />
              <Info label="MAC address" value={view.mac_address} />
              <Info label="IP number" value={view.ip_address} />
              <Info label="Switch port" value={view.switch_port} />
              <Info label="Network patch" value={view.network_patch_number} />
              <Info label="Site" value={view.site?.name} />
              <Info label="Building" value={view.building?.name} />
              <Info label="Room" value={`${view.room?.room_number} | ${view.room?.room_name}`} />
            </div>
            <div className="mt-6 grid gap-3">
              <Callout icon={MapPin} label="Current location" value={`${view.building?.name} / ${view.room?.room_number} / ${view.location_in_room}`} />
              <Callout icon={Network} label="Patching details" value={view.patching_details} />
            </div>
            {view.notes ? <p className="mt-5 rounded-[8px] bg-zinc-50 p-4 text-sm leading-6 text-steel">{view.notes}</p> : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
          <h2 className="text-xl font-semibold tracking-tight">Photos</h2>
          <div className="mt-4 grid gap-3">
            {view.photos.map((assetPhoto) => (
              <figure key={assetPhoto.id} className="overflow-hidden rounded-[8px] border border-zinc-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetPhoto.photo_url} alt={assetPhoto.caption} className="aspect-video w-full object-cover" />
                <figcaption className="p-3 text-sm text-steel">{assetPhoto.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
          <h2 className="text-xl font-semibold tracking-tight">Full history log</h2>
          <div className="mt-4 grid gap-3">
            {view.logs.map((log) => (
              <div key={log.id} className="rounded-[8px] border border-zinc-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{log.action_type}</p>
                  <p className="flex items-center gap-1 text-xs text-zinc-500"><Clock3 size={14} />{new Date(log.created_at).toLocaleString()}</p>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-steel">
                  <p><span className="font-semibold text-ink">From:</span> {log.previous_location}</p>
                  <p><span className="font-semibold text-ink">To:</span> {log.new_location}</p>
                  <p><span className="font-semibold text-ink">Notes:</span> {log.notes}</p>
                  <p><span className="font-semibold text-ink">User:</span> {log.user_name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">{label}</p>
      <p className="mt-1 font-semibold text-ink">{value || "Not set"}</p>
    </div>
  );
}

function Callout({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon size={17} />{label}</p>
      <p className="mt-2 text-sm leading-6 text-steel">{value}</p>
    </div>
  );
}
