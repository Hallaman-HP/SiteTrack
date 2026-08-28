"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Camera, MapPinned, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { AssetActionsMenu } from "@/components/AssetActionsMenu";
import { ButtonLink } from "@/components/ButtonLink";
import { ExportRegisterButton } from "@/components/ExportRegisterButton";
import { SearchBox } from "@/components/SearchBox";
import { canEditAssets } from "@/lib/roles";
import { archiveAsset, deleteAsset, getActiveAssetViews, getAssetViews, loadStore, resetStore, restoreAsset, searchAssets, statusClass, statusLabel } from "@/lib/store";
import { archiveAssetInSupabase, deleteAssetFromSupabase, restoreAssetInSupabase } from "@/lib/supabaseStore";
import type { AssetStatus, AssetView } from "@/lib/types";
import { useStoreData } from "@/lib/useStoreData";

type AssetFilter = "installed" | "all" | "issues";

export function DashboardClient() {
  const [data, setData, isSupabaseMode, workspace, isLoading, replaceData] = useStoreData();
  const [query, setQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("installed");
  const [error, setError] = useState("");
  const activeAssets = getActiveAssetViews(data);
  const assets = activeAssets;
  const allAssets = getAssetViews(data);
  const results = useMemo(() => {
    const source = query.trim() ? searchAssets(data, query) : activeAssets;
    const filtered = query.trim()
      ? source
      : source.filter((asset) => {
          if (assetFilter === "installed") return asset.status === "installed";
          if (assetFilter === "issues") return asset.status === "damaged";
          return true;
        });
    return filtered.slice(0, 12);
  }, [activeAssets, assetFilter, data, query]);
  const recentLogs = [...data.asset_logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
  const installed = assets.filter((asset) => asset.status === "installed").length;
  const issues = assets.filter((asset) => asset.status === "damaged").length;
  const listTitle = query ? "Matches" : assetFilter === "all" ? "All assets" : assetFilter === "issues" ? "Issues" : "Installed assets";
  const canAddAssets = !isSupabaseMode || workspace?.role === "admin" || (workspace?.editableSiteIds?.length ?? 0) > 0;
  const canArchive = !isSupabaseMode || workspace?.role === "admin";

  function handleReset() {
    if (isSupabaseMode) {
      replaceData(loadStore());
      return;
    }
    resetStore();
    setData(loadStore());
  }

  async function handleArchive(asset: AssetView) {
    if (!window.confirm(`Archive ${asset.asset_number} (${asset.item_name})? It will be hidden from active searches but can be restored by an admin.`)) return;
    setError("");
    try {
      if (isSupabaseMode) {
        await archiveAssetInSupabase(asset.id);
        replaceData(archiveAsset(data, asset.id, workspace?.name ?? "Site user"));
      } else {
        setData(archiveAsset(data, asset.id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive this asset.");
    }
  }

  async function handleRestore(asset: AssetView) {
    if (!window.confirm(`Restore ${asset.asset_number} (${asset.item_name}) to the active register?`)) return;
    setError("");
    try {
      if (isSupabaseMode) {
        await restoreAssetInSupabase(asset.id);
        replaceData(restoreAsset(data, asset.id, workspace?.name ?? "Site user"));
      } else {
        setData(restoreAsset(data, asset.id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore this asset.");
    }
  }

  async function handleDelete(asset: AssetView) {
    if (!canDeleteAsset(asset)) return;
    if (!window.confirm(`Permanently delete ${asset.asset_number} (${asset.item_name})? This will remove photos and history logs.`)) return;
    setError("");
    try {
      if (isSupabaseMode) {
        await deleteAssetFromSupabase(asset.id);
        replaceData(deleteAsset(data, asset.id));
      } else {
        setData(deleteAsset(data, asset.id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this asset.");
    }
  }

  function canEditAsset(asset: AssetView) {
    return !isSupabaseMode || workspace?.role === "admin" || Boolean(workspace?.editableSiteIds?.includes(asset.site_id)) || canEditAssets(workspace?.role);
  }

  function canDeleteAsset(asset: AssetView) {
    return !isSupabaseMode || workspace?.role === "admin" || Boolean(workspace?.manageableSiteIds?.includes(asset.site_id));
  }

  return (
    <div className="grid gap-5">
      <section className="glass overflow-hidden rounded-[8px] p-5 shadow-panel sm:p-7 animate-rise">
        <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white bg-white/80 px-3 py-1 text-xs font-semibold text-steel shadow-sm">
              <Sparkles size={14} className="text-coral" />
              Ready for site work
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-5xl sm:leading-tight">
              Capture assets fast. Find them faster.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-steel">
              Add an item, drop it into a room, snap a photo, and keep moving.
            </p>
            <div className="mt-6 max-w-2xl">
              <SearchBox value={query} onChange={setQuery} placeholder="Search asset, serial, room, patching..." />
            </div>
          </div>
          <div className="grid gap-3">
            {canAddAssets ? (
              <div className="pulse-soft rounded-[8px]">
                <ButtonLink href="/assets/new" icon={Camera}>Quick Add Asset</ButtonLink>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <ButtonLink href="/sites" icon={MapPinned} variant="secondary">Sites</ButtonLink>
              <ButtonLink href="/search" icon={Search} variant="secondary">Find</ButtonLink>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-[8px] bg-white/80 p-2 shadow-sm">
              <MiniMetric label="Installed" value={installed} tone="text-emerald-700" active={!query && assetFilter === "installed"} onClick={() => setAssetFilter("installed")} />
              <MiniMetric label="Assets" value={assets.length} tone="text-signal" active={!query && assetFilter === "all"} onClick={() => setAssetFilter("all")} />
              <MiniMetric label="Issues" value={issues} tone="text-rose-700" active={!query && assetFilter === "issues"} onClick={() => setAssetFilter("issues")} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{listTitle}</h2>
            {canAddAssets ? <ButtonLink href="/assets/new" icon={Plus} variant="secondary">Add</ButtonLink> : null}
          </div>
          {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          <div className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel">
            {results.length ? (
              <div className="divide-y divide-zinc-100">
                {results.map((asset) => (
                  <AssetListRow
                    key={asset.id}
                    asset={asset}
                    canArchive={canArchive}
                    canEdit={canEditAsset(asset)}
                    canDelete={canDeleteAsset(asset)}
                    onArchive={handleArchive}
                    onRestore={handleRestore}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : isLoading ? (
              <div className="p-6 text-sm text-steel">Loading secure asset data...</div>
            ) : (
              <div className="p-6 text-sm text-steel">No assets found for this view.</div>
            )}
          </div>
        </section>
        <aside className="grid content-start gap-3 animate-rise-delay">
          <div className="rounded-[8px] border border-zinc-200 bg-white p-4 shadow-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold tracking-tight">Recent changes</h2>
              <button onClick={handleReset} className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-3 text-xs font-semibold text-ink transition hover:-translate-y-0.5">
              <RotateCcw size={15} />
              Seed
              </button>
            </div>
            <div className="mt-3 grid gap-2">
            {recentLogs.map((log) => {
              const asset = allAssets.find((item) => item.id === log.asset_id);
              return (
                <div key={log.id} className="rounded-[8px] bg-zinc-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Activity size={16} className="text-signal" />
                    {log.action_type}
                  </div>
                  <p className="mt-1 text-sm text-steel">{asset?.asset_number} | {asset?.item_name}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{log.notes}</p>
                </div>
              );
            })}
            </div>
          </div>
          <div className="rounded-[8px] border border-zinc-200 bg-white p-4 shadow-panel">
            <p className="text-sm font-semibold text-ink">Share registers</p>
            <p className="mt-1 text-xs leading-5 text-steel">Exports are best from each site or building card.</p>
            <a href="/sites" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-signal">
              Go to Sites <ArrowRight size={15} />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[8px] p-3 text-center transition hover:-translate-y-0.5 ${active ? "bg-ink text-white shadow-panel" : "bg-zinc-50 text-ink hover:bg-white"}`}
    >
      <p className={`text-2xl font-semibold tracking-tight ${active ? "text-white" : tone}`}>{value}</p>
      <p className={`text-xs font-medium ${active ? "text-white/75" : "text-steel"}`}>{label}</p>
    </button>
  );
}

function AssetListRow({
  asset,
  canArchive,
  canEdit,
  canDelete,
  onArchive,
  onRestore,
  onDelete
}: {
  asset: AssetView;
  canArchive: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onArchive: (asset: AssetView) => void;
  onRestore: (asset: AssetView) => void;
  onDelete: (asset: AssetView) => void;
}) {
  return (
    <div className="grid gap-3 p-4 transition hover:bg-zinc-50 sm:grid-cols-[1fr_160px_160px_44px] sm:items-center">
      <Link href={`/assets/${asset.id}`} className="min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold tracking-tight text-ink">{asset.asset_number}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${asset.archived_at ? "bg-zinc-100 text-zinc-600 ring-zinc-200" : statusClass(asset.status as AssetStatus)}`}>
              {asset.archived_at ? "Archived" : statusLabel(asset.status as AssetStatus)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-steel">{asset.item_name} {asset.serial_number ? `| SN ${asset.serial_number}` : ""}</p>
        </div>
      </Link>
      <Link href={`/assets/${asset.id}`} className="text-sm font-medium text-steel">{asset.building?.name || "No building"} / {asset.room?.room_number || "No room"}</Link>
      <Link href={`/assets/${asset.id}`} className="truncate text-sm text-steel">{asset.network_patch_number || asset.switch_port || asset.location_in_room || "No patching"}</Link>
      <div className="justify-self-end">
        <AssetActionsMenu asset={asset} canArchive={canArchive} canEdit={canEdit} canDelete={canDelete} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />
      </div>
    </div>
  );
}
