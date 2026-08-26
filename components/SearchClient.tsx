"use client";

import { useMemo, useState } from "react";
import { AssetCard } from "@/components/AssetCard";
import { inputClass } from "@/components/Field";
import { SearchBox } from "@/components/SearchBox";
import { canDeleteAssets } from "@/lib/roles";
import { archiveAsset, restoreAsset, searchArchivedAssets, searchAssets } from "@/lib/store";
import { archiveAssetInSupabase, restoreAssetInSupabase } from "@/lib/supabaseStore";
import type { AssetView } from "@/lib/types";
import { useStoreData } from "@/lib/useStoreData";

export function SearchClient() {
  const [data, commit, isSupabaseMode, workspace, isLoading, replaceData] = useStoreData();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const canArchive = !isSupabaseMode || canDeleteAssets(workspace?.role);
  const sites = useMemo(() => [...data.sites].sort((a, b) => a.name.localeCompare(b.name)), [data.sites]);
  const buildings = useMemo(
    () => data.buildings
      .filter((building) => !siteId || building.site_id === siteId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data.buildings, siteId]
  );
  const rooms = useMemo(() => {
    const allowedBuildingIds = new Set(buildings.map((building) => building.id));
    return data.rooms
      .filter((room) => (!buildingId || room.building_id === buildingId) && (!siteId || allowedBuildingIds.has(room.building_id)))
      .sort((a, b) => `${a.floor} ${a.room_number} ${a.room_name}`.localeCompare(`${b.floor} ${b.room_number} ${b.room_name}`));
  }, [buildings, buildingId, data.rooms, siteId]);
  const results = useMemo(() => {
    const source = showArchived ? searchArchivedAssets(data, query) : searchAssets(data, query);
    return source.filter((asset) => {
      if (siteId && asset.site_id !== siteId) return false;
      if (buildingId && asset.building_id !== buildingId) return false;
      if (roomId && asset.room_id !== roomId) return false;
      return true;
    });
  }, [buildingId, data, query, roomId, showArchived, siteId]);
  const archivedCount = useMemo(() => data.assets.filter((asset) => asset.archived_at).length, [data.assets]);
  const hasFilters = Boolean(query.trim() || siteId || buildingId || roomId);

  async function handleArchive(asset: AssetView) {
    if (!window.confirm(`Archive ${asset.asset_number} (${asset.item_name})? It will be hidden from active searches but can be restored by an admin.`)) return;
    setError("");
    try {
      if (isSupabaseMode) {
        await archiveAssetInSupabase(asset.id);
        replaceData(archiveAsset(data, asset.id, workspace?.name ?? "Site user"));
      } else {
        commit(archiveAsset(data, asset.id));
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
        commit(restoreAsset(data, asset.id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore this asset.");
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Search assets</h1>
        <p className="mt-2 text-steel">Asset number, serial number, item name, job site, building, room, or patching ID.</p>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Try HX-AUD-1201, SHM8A92103, L12-1242, SW12-18..." />
      <div className="grid gap-3 rounded-[8px] border border-zinc-200 bg-white p-3 shadow-panel sm:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Job site</span>
          <select
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
              setBuildingId("");
              setRoomId("");
            }}
            className={inputClass}
          >
            <option value="">All job sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Building</span>
          <select
            value={buildingId}
            onChange={(event) => {
              setBuildingId(event.target.value);
              setRoomId("");
            }}
            className={inputClass}
          >
            <option value="">All buildings</option>
            {buildings.map((building) => (
              <option key={building.id} value={building.id}>{building.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Room</span>
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)} className={inputClass}>
            <option value="">All rooms</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.room_number}{room.room_name ? ` - ${room.room_name}` : ""}{room.floor ? `, ${room.floor}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-steel">
          {isLoading ? "Loading secure asset data..." : `${results.length} ${results.length === 1 ? "asset" : "assets"} found`}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSiteId("");
              setBuildingId("");
              setRoomId("");
            }}
            className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5"
          >
            Clear search
          </button>
        ) : null}
      </div>
      {canArchive && archivedCount ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowArchived((current) => !current)}
            className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${showArchived ? "bg-ink text-white" : "border border-zinc-200 bg-white text-ink shadow-sm"}`}
          >
            {showArchived ? "Show active assets" : `Show archived (${archivedCount})`}
          </button>
        </div>
      ) : null}
      {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
      <div className="grid gap-3">
        {isLoading ? (
          <div className="rounded-[8px] border border-zinc-200 bg-white p-8 text-center text-steel shadow-panel">
            Loading secure asset data...
          </div>
        ) : null}
        {!isLoading ? results.map((asset) => (
          <AssetCard key={asset.id} asset={asset} canArchive={canArchive} onArchive={handleArchive} onRestore={handleRestore} />
        )) : null}
        {!isLoading && results.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white p-8 text-center text-steel">
            No matching assets found.
          </div>
        ) : null}
      </div>
    </div>
  );
}
