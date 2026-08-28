"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, DoorOpen, MoreHorizontal, Navigation, Plus, Trash2, X } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ExportRegisterButton } from "@/components/ExportRegisterButton";
import { Field, inputClass } from "@/components/Field";
import { SiteWorldMap } from "@/components/SiteWorldMap";
import {
  createBuilding,
  createRoom,
  createSite,
  deleteBuilding,
  deleteRoom,
  deleteSite,
  saveStore,
  updateBuilding,
  updateRoom,
  updateSite
} from "@/lib/store";
import {
  deleteBuildingFromSupabase,
  deleteRoomFromSupabase,
  deleteSiteFromSupabase,
  upsertBuildingInSupabase,
  upsertRoomInSupabase,
  upsertSiteInSupabase
} from "@/lib/supabaseStore";
import type { Room, StoreData } from "@/lib/types";
import { useStoreData } from "@/lib/useStoreData";

type PersistOperation = () => Promise<void>;
type PersistChange = (next: StoreData, operation?: PersistOperation) => Promise<void>;

export function SitesClient() {
  const [data, commitData, isSupabaseMode, workspace, isLoading, replaceData] = useStoreData();
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(data.sites[0]?.id);
  const [siteName, setSiteName] = useState("");
  const [client, setClient] = useState("");
  const [job, setJob] = useState("");
  const [address, setAddress] = useState("");
  const [siteError, setSiteError] = useState("");
  const selectedSite = data.sites.find((site) => site.id === selectedSiteId) ?? data.sites[0];
  const canManageSites = !isSupabaseMode || workspace?.role === "admin";
  const canShareAllSites = !isSupabaseMode || workspace?.role === "admin";
  const shareableSiteIds = workspace?.manageableSiteIds ?? [];

  async function persist(next: StoreData, operation?: PersistOperation) {
    if (isSupabaseMode) {
      if (!operation) throw new Error("No save action was provided.");
      window.dispatchEvent(new CustomEvent("sitetrack-sync-status", { detail: "Saving..." }));
      try {
        await operation();
        replaceData(next);
        window.dispatchEvent(new CustomEvent("sitetrack-sync-status", { detail: "Saved." }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("sitetrack-sync-error", { detail: getErrorMessage(error) }));
        throw error;
      }
      return;
    }

    saveStore(next);
    commitData(next);
  }

  async function addSite(event: React.FormEvent) {
    event.preventDefault();
    setSiteError("");
    if (!siteName.trim()) return;
    const overlap = findSiteOverlap(data, { name: siteName, job_number: job, address });
    if (overlap) {
      setSiteError(overlap);
      return;
    }
    const next = createSite(data, {
      name: siteName.trim(),
      client_name: client.trim(),
      job_number: job.trim(),
      address: address.trim()
    });
    const createdSite = next.sites[0];
    try {
      await persist(next, () => upsertSiteInSupabase(createdSite, workspace?.id ?? ""));
      setSelectedSiteId(createdSite?.id);
      setSiteName("");
      setClient("");
      setJob("");
      setAddress("");
    } catch (error) {
      setSiteError(getErrorMessage(error));
    }
  }

  return (
    <div className="grid gap-5">
      <section className="glass overflow-hidden rounded-[8px] p-5 shadow-panel animate-rise">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-steel shadow-sm"><Navigation size={14} className="text-signal" />Site map</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Choose a job from the map.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-steel">
              Pan around the board, tap a pin, then manage that site&apos;s buildings, rooms, assets, and exports.
            </p>
          </div>
          {canManageSites ? (
            <details className="group w-full overflow-hidden rounded-[8px] border border-zinc-200 bg-white transition hover:border-zinc-300 sm:w-[340px]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><Plus size={17} />Add job site</span>
                <ChevronDown className="text-steel transition group-open:rotate-180" size={18} />
              </summary>
              <form onSubmit={addSite} className="grid gap-3 border-t border-zinc-100 p-4">
                <Field label="Job site"><input className={inputClass} value={siteName} onChange={(e) => setSiteName(e.target.value)} required /></Field>
                <Field label="Client"><input className={inputClass} value={client} onChange={(e) => setClient(e.target.value)} /></Field>
                <Field label="Job number"><input className={inputClass} value={job} onChange={(e) => setJob(e.target.value)} /></Field>
                <Field label="Address"><AddressAutocomplete value={address} onChange={setAddress} /></Field>
                {siteError ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{siteError}</p> : null}
                <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5">
                  <Plus size={17} />
                  Create Site
                </button>
              </form>
            </details>
          ) : (
            <div className="w-full rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 sm:w-[340px]">
              Site, building, and room management is admin-only. Ask an admin to grant you access to a job site.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        {isLoading ? (
          <div className="grid min-h-[420px] place-items-center rounded-[8px] border border-zinc-200 bg-white text-sm font-semibold text-steel shadow-panel">
            Loading secure site data...
          </div>
        ) : (
          <SiteWorldMap data={data} selectedSiteId={selectedSite?.id} onSelect={setSelectedSiteId} />
        )}

        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          {isLoading ? (
            <div className="rounded-[8px] border border-zinc-200 bg-white p-8 text-center text-steel shadow-panel">
              Loading job-site details...
            </div>
          ) : selectedSite ? (
            <SitePanel
              key={selectedSite.id}
              data={data}
              siteId={selectedSite.id}
              accent={data.sites.findIndex((site) => site.id === selectedSite.id) % 3}
              canManage={canManageSites}
              canShare={canShareAllSites || shareableSiteIds.includes(selectedSite.id)}
              onPersist={async (next, operation) => {
                await persist(next, operation);
                if (!next.sites.some((site) => site.id === selectedSite.id)) {
                  setSelectedSiteId(next.sites[0]?.id);
                }
              }}
            />
          ) : (
            <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white p-8 text-center text-steel shadow-panel">
              {canManageSites ? "Add your first job site to drop a pin." : "No job sites have been granted to this account yet."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SitePanel({ data, siteId, accent, canManage, canShare, onPersist }: { data: StoreData; siteId: string; accent: number; canManage: boolean; canShare: boolean; onPersist: PersistChange }) {
  const site = data.sites.find((item) => item.id === siteId)!;
  const buildings = data.buildings.filter((building) => building.site_id === site.id);
  const assetCount = data.assets.filter((asset) => asset.site_id === site.id && !asset.archived_at).length;
  const [isEditingSite, setIsEditingSite] = useState(false);
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const [siteDraft, setSiteDraft] = useState({
    name: site.name,
    client_name: site.client_name,
    job_number: site.job_number,
    address: site.address
  });
  const [buildingName, setBuildingName] = useState("");
  const [panelError, setPanelError] = useState("");

  const accentClass = ["from-safety/80 to-coral/80", "from-signal/80 to-mint/80", "from-coral/80 to-signal/80"][accent];

  async function addBuilding(event: React.FormEvent) {
    event.preventDefault();
    setPanelError("");
    if (!buildingName.trim()) return;
    if (buildings.some((building) => clean(building.name) === clean(buildingName))) {
      setPanelError(`Building "${buildingName.trim()}" already exists on ${site.name}.`);
      return;
    }
    const next = createBuilding(data, { site_id: site.id, name: buildingName.trim() });
    const createdBuilding = next.buildings[0];
    try {
      await onPersist(next, () => upsertBuildingInSupabase(createdBuilding));
      setBuildingName("");
    } catch (error) {
      setPanelError(getErrorMessage(error));
    }
  }

  async function saveSite(event: React.FormEvent) {
    event.preventDefault();
    setPanelError("");
    if (!siteDraft.name.trim()) return;
    const overlap = findSiteOverlap(data, siteDraft, site.id);
    if (overlap) {
      setPanelError(overlap);
      return;
    }
    const next = updateSite(data, site.id, {
      name: siteDraft.name.trim(),
      client_name: siteDraft.client_name.trim(),
      job_number: siteDraft.job_number.trim(),
      address: siteDraft.address.trim()
    });
    const updatedSite = next.sites.find((item) => item.id === site.id)!;
    try {
      await onPersist(next, () => upsertSiteInSupabase(updatedSite));
      setIsEditingSite(false);
    } catch (error) {
      setPanelError(getErrorMessage(error));
    }
  }

  async function confirmDeleteSite() {
    const ok = window.confirm(`Delete ${site.name}? This will also delete ${buildings.length} buildings, their rooms, assets, photos, and history logs.`);
    if (!ok) return;
    setPanelError("");
    try {
      await onPersist(deleteSite(data, site.id), () => deleteSiteFromSupabase(site.id));
    } catch (error) {
      setPanelError(getErrorMessage(error));
    }
  }

  function cancelSiteEdit() {
    setSiteDraft({
      name: site.name,
      client_name: site.client_name,
      job_number: site.job_number,
      address: site.address
    });
    setIsEditingSite(false);
  }

  return (
    <details className="group overflow-visible rounded-[8px] border border-zinc-200 bg-white shadow-panel transition duration-200 hover:-translate-y-0.5 hover:border-zinc-300" open>
      <summary className="relative flex cursor-pointer list-none items-start justify-between gap-3 p-5">
        <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${accentClass}`} />
        <span className="min-w-0">
          <span className="block truncate text-xl font-semibold tracking-tight">{site.name}</span>
          <span className="mt-1 block text-sm text-steel">{site.client_name || "No client"} | {site.job_number || "No job number"}</span>
          <span className="mt-1 block text-sm text-zinc-500">{site.address || "No address set"}</span>
          <span className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-steel">{buildings.length} buildings</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{assetCount} assets</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {canManage ? <ActionMenu
            label={`Site actions for ${site.name}`}
            isOpen={isSiteMenuOpen}
            onToggle={() => setIsSiteMenuOpen((current) => !current)}
            onClose={() => setIsSiteMenuOpen(false)}
            actions={[
              { label: "Edit site", onSelect: () => { setIsEditingSite(true); setIsSiteMenuOpen(false); } },
              { label: "Delete site", danger: true, onSelect: () => { setIsSiteMenuOpen(false); confirmDeleteSite(); } }
            ]}
          /> : null}
          <ChevronDown className="mt-2 text-steel transition group-open:rotate-180" size={18} />
        </span>
      </summary>

      <div className="grid gap-4 border-t border-zinc-100 p-5">
        {panelError ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{panelError}</p> : null}
        {canManage && isEditingSite ? (
          <form onSubmit={saveSite} className="grid gap-2 rounded-[8px] bg-zinc-50 p-3 sm:grid-cols-2">
            <input className={inputClass} value={siteDraft.name} onChange={(e) => setSiteDraft({ ...siteDraft, name: e.target.value })} placeholder="Site name" autoFocus />
            <input className={inputClass} value={siteDraft.client_name} onChange={(e) => setSiteDraft({ ...siteDraft, client_name: e.target.value })} placeholder="Client" />
            <input className={inputClass} value={siteDraft.job_number} onChange={(e) => setSiteDraft({ ...siteDraft, job_number: e.target.value })} placeholder="Job number" />
            <div className="sm:col-span-2">
              <AddressAutocomplete value={siteDraft.address} onChange={(value) => setSiteDraft({ ...siteDraft, address: value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white"><Check size={17} />Save</button>
              <button type="button" onClick={cancelSiteEdit} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-semibold text-ink shadow-sm"><X size={17} />Cancel</button>
            </div>
          </form>
        ) : null}

        {canShare ? <details className="group/share rounded-[8px] border border-zinc-200 bg-zinc-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
            Share {site.name}
            <ChevronDown className="transition group-open/share:rotate-180" size={17} />
          </summary>
          <div className="border-t border-zinc-200 p-3">
            <ExportRegisterButton data={data} compact siteId={site.id} filenamePrefix={`${site.name} asset register`} />
          </div>
        </details> : null}

        {canManage ? <details className="group/add rounded-[8px] border border-zinc-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
            Add building
            <ChevronDown className="transition group-open/add:rotate-180" size={17} />
          </summary>
          <form onSubmit={addBuilding} className="flex gap-2 border-t border-zinc-100 p-3">
            <input className={`${inputClass} flex-1`} value={buildingName} onChange={(e) => setBuildingName(e.target.value)} placeholder="Building name" />
            <button type="submit" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-ink text-white" aria-label="Add building"><Plus size={18} /></button>
          </form>
        </details> : null}

        <div className="grid gap-3">
          {buildings.map((building) => <BuildingPanel key={building.id} data={data} buildingId={building.id} canManage={canManage} canShare={canShare} onPersist={onPersist} />)}
        </div>
      </div>
    </details>
  );
}

function BuildingPanel({ data, buildingId, canManage, canShare, onPersist }: { data: StoreData; buildingId: string; canManage: boolean; canShare: boolean; onPersist: PersistChange }) {
  const building = data.buildings.find((item) => item.id === buildingId)!;
  const rooms = data.rooms.filter((room) => room.building_id === building.id);
  const assetCount = data.assets.filter((asset) => asset.building_id === building.id && !asset.archived_at).length;
  const [isEditingBuilding, setIsEditingBuilding] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [buildingDraft, setBuildingDraft] = useState(building.name);
  const [roomNumber, setRoomNumber] = useState("");
  const [roomName, setRoomName] = useState("");
  const [floor, setFloor] = useState("");
  const [buildingError, setBuildingError] = useState("");

  async function addRoom(event: React.FormEvent) {
    event.preventDefault();
    setBuildingError("");
    if (!roomNumber.trim()) return;
    if (rooms.some((room) => clean(room.room_number) === clean(roomNumber))) {
      setBuildingError(`Room ${roomNumber.trim()} already exists in ${building.name}.`);
      return;
    }
    const next = createRoom(data, { building_id: building.id, room_number: roomNumber.trim(), room_name: roomName.trim(), floor: floor.trim() });
    const createdRoom = next.rooms[0];
    try {
      await onPersist(next, () => upsertRoomInSupabase(createdRoom));
      setRoomNumber("");
      setRoomName("");
      setFloor("");
    } catch (error) {
      setBuildingError(getErrorMessage(error));
    }
  }

  async function saveBuilding(event: React.FormEvent) {
    event.preventDefault();
    setBuildingError("");
    if (!buildingDraft.trim()) return;
    const siteBuildings = data.buildings.filter((item) => item.site_id === building.site_id && item.id !== building.id);
    if (siteBuildings.some((item) => clean(item.name) === clean(buildingDraft))) {
      setBuildingError(`Building "${buildingDraft.trim()}" already exists on this site.`);
      return;
    }
    const next = updateBuilding(data, building.id, { name: buildingDraft.trim() });
    const updatedBuilding = next.buildings.find((item) => item.id === building.id)!;
    try {
      await onPersist(next, () => upsertBuildingInSupabase(updatedBuilding));
      setIsEditingBuilding(false);
    } catch (error) {
      setBuildingError(getErrorMessage(error));
    }
  }

  async function confirmDeleteBuilding() {
    const ok = window.confirm(`Delete ${building.name}? This will also delete ${rooms.length} rooms, their assets, photos, and history logs.`);
    if (!ok) return;
    setBuildingError("");
    try {
      await onPersist(deleteBuilding(data, building.id), () => deleteBuildingFromSupabase(building.id));
    } catch (error) {
      setBuildingError(getErrorMessage(error));
    }
  }

  return (
    <details className="group/building rounded-[8px] border border-zinc-200 bg-zinc-50 transition hover:bg-zinc-100/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="shrink-0 text-signal" size={18} />
          <span className="truncate font-semibold">{building.name}</span>
          <span className="hidden rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-steel sm:inline">{rooms.length} rooms</span>
          <span className="hidden rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-steel sm:inline">{assetCount} assets</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {canManage ? <ActionMenu
            label={`Building actions for ${building.name}`}
            isOpen={isMenuOpen}
            onToggle={() => setIsMenuOpen((current) => !current)}
            onClose={() => setIsMenuOpen(false)}
            actions={[
              { label: "Edit building", onSelect: () => { setIsEditingBuilding(true); setIsMenuOpen(false); } },
              { label: "Delete building", danger: true, onSelect: () => { setIsMenuOpen(false); confirmDeleteBuilding(); } }
            ]}
          /> : null}
          <ChevronDown className="text-steel transition group-open/building:rotate-180" size={17} />
        </span>
      </summary>

      <div className="grid gap-3 border-t border-zinc-200 p-3">
        {buildingError ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{buildingError}</p> : null}
        {canManage && isEditingBuilding ? (
          <form onSubmit={saveBuilding} className="flex gap-2">
            <input className={`${inputClass} flex-1 bg-white`} value={buildingDraft} onChange={(e) => setBuildingDraft(e.target.value)} autoFocus />
            <button type="submit" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-ink text-white" aria-label="Save building"><Check size={18} /></button>
            <button type="button" onClick={() => setIsEditingBuilding(false)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-white text-ink shadow-sm" aria-label="Cancel building edit"><X size={18} /></button>
          </form>
        ) : null}

        {canShare ? <details className="group/share rounded-[8px] border border-zinc-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
            Share {building.name}
            <ChevronDown className="transition group-open/share:rotate-180" size={17} />
          </summary>
          <div className="border-t border-zinc-100 p-3">
            <ExportRegisterButton data={data} compact buildingId={building.id} filenamePrefix={`${building.name} asset register`} />
          </div>
        </details> : null}

        {canManage ? <details className="group/add rounded-[8px] border border-zinc-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">
            Add room
            <ChevronDown className="transition group-open/add:rotate-180" size={17} />
          </summary>
          <form onSubmit={addRoom} className="grid gap-2 border-t border-zinc-100 p-3 sm:grid-cols-[1fr_1fr_90px_44px]">
            <input className={inputClass} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Room no." />
            <input className={inputClass} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name" />
            <input className={inputClass} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Floor" />
            <button type="submit" className="inline-flex h-11 items-center justify-center rounded-[8px] bg-ink text-white" aria-label="Add room"><Plus size={18} /></button>
          </form>
        </details> : null}

        <div className="flex flex-wrap gap-2">
          {rooms.map((room) => <EditableRoom key={room.id} data={data} room={room} canManage={canManage} onPersist={onPersist} />)}
        </div>
      </div>
    </details>
  );
}

function EditableRoom({ data, room, canManage, onPersist }: { data: StoreData; room: Room; canManage: boolean; onPersist: PersistChange }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draft, setDraft] = useState({
    room_number: room.room_number,
    room_name: room.room_name,
    floor: room.floor
  });
  const [roomError, setRoomError] = useState("");

  async function saveRoom(event: React.FormEvent) {
    event.preventDefault();
    setRoomError("");
    if (!draft.room_number.trim()) return;
    const siblingRooms = data.rooms.filter((item) => item.building_id === room.building_id && item.id !== room.id);
    if (siblingRooms.some((item) => clean(item.room_number) === clean(draft.room_number))) {
      setRoomError(`Room ${draft.room_number.trim()} already exists in this building.`);
      return;
    }
    const next = updateRoom(data, room.id, {
      room_number: draft.room_number.trim(),
      room_name: draft.room_name.trim(),
      floor: draft.floor.trim()
    });
    const updatedRoom = next.rooms.find((item) => item.id === room.id)!;
    try {
      await onPersist(next, () => upsertRoomInSupabase(updatedRoom));
      setIsEditing(false);
    } catch (error) {
      setRoomError(getErrorMessage(error));
    }
  }

  async function confirmDeleteRoom() {
    const assetCount = data.assets.filter((asset) => asset.room_id === room.id && !asset.archived_at).length;
    const ok = window.confirm(`Delete room ${room.room_number}? This will also delete ${assetCount} assets in this room, their photos, and history logs.`);
    if (!ok) return;
    setRoomError("");
    try {
      await onPersist(deleteRoom(data, room.id), () => deleteRoomFromSupabase(room.id));
    } catch (error) {
      setRoomError(getErrorMessage(error));
    }
  }

  if (isEditing) {
    return (
      <form onSubmit={saveRoom} className="grid w-full gap-2 rounded-[8px] border border-zinc-200 bg-white p-3 sm:grid-cols-[1fr_1fr_90px_44px_44px]">
        {roomError ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 sm:col-span-5">{roomError}</p> : null}
        <input className={inputClass} value={draft.room_number} onChange={(e) => setDraft({ ...draft, room_number: e.target.value })} placeholder="Room no." autoFocus />
        <input className={inputClass} value={draft.room_name} onChange={(e) => setDraft({ ...draft, room_name: e.target.value })} placeholder="Room name" />
        <input className={inputClass} value={draft.floor} onChange={(e) => setDraft({ ...draft, floor: e.target.value })} placeholder="Floor" />
        <button type="submit" className="inline-flex h-11 items-center justify-center rounded-[8px] bg-ink text-white" aria-label="Save room"><Check size={18} /></button>
        <button type="button" onClick={() => setIsEditing(false)} className="inline-flex h-11 items-center justify-center rounded-[8px] bg-zinc-100 text-ink" aria-label="Cancel room edit"><X size={18} /></button>
      </form>
    );
  }

  return (
    <span className="relative inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1.5 pl-3 pr-1 text-sm text-steel transition hover:-translate-y-0.5 hover:border-zinc-300">
      <DoorOpen size={15} className="text-mint" />
      <span>{room.room_number} {room.room_name ? `| ${room.room_name}` : ""}{room.floor ? ` | Floor ${room.floor}` : ""}</span>
      {canManage ? <ActionMenu
        label={`Room actions for ${room.room_number}`}
        isOpen={isMenuOpen}
        compact
        onToggle={() => setIsMenuOpen((current) => !current)}
        onClose={() => setIsMenuOpen(false)}
        actions={[
          { label: "Edit room", onSelect: () => { setIsEditing(true); setIsMenuOpen(false); } },
          { label: "Delete room", danger: true, onSelect: () => { setIsMenuOpen(false); confirmDeleteRoom(); } }
        ]}
      /> : null}
    </span>
  );
}

function ActionMenu({
  label,
  isOpen,
  compact = false,
  onToggle,
  onClose,
  actions
}: {
  label: string;
  isOpen: boolean;
  compact?: boolean;
  onToggle: () => void;
  onClose: () => void;
  actions: Array<{ label: string; danger?: boolean; onSelect: () => void }>;
}) {
  const menuRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [isOpen, onClose]);

  return (
    <span ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        className={`${compact ? "h-7 w-7 rounded-full" : "h-9 w-9 rounded-[8px]"} inline-flex items-center justify-center bg-white text-zinc-500 shadow-sm transition hover:-translate-y-0.5 hover:text-ink`}
        aria-label={label}
      >
        <MoreHorizontal size={compact ? 16 : 18} />
      </button>
      {isOpen ? (
        <span className="absolute right-0 top-full z-30 mt-1 min-w-36 overflow-hidden rounded-[8px] border border-zinc-200 bg-white p-1 shadow-panel">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                action.onSelect();
              }}
              className={`flex w-full items-center gap-2 rounded-[7px] px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-50 ${action.danger ? "text-rose-700" : "text-ink"}`}
            >
              {action.danger ? <Trash2 size={15} /> : null}
              {action.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function clean(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findSiteOverlap(data: StoreData, draft: { name: string; job_number: string; address: string }, currentSiteId?: string) {
  const match = data.sites.find((site) => {
    if (site.id === currentSiteId) return false;
    return (
      (!!draft.name.trim() && clean(site.name) === clean(draft.name)) ||
      (!!draft.job_number.trim() && clean(site.job_number) === clean(draft.job_number)) ||
      (!!draft.address.trim() && clean(site.address) === clean(draft.address))
    );
  });
  if (!match) return "";
  if (draft.job_number.trim() && clean(match.job_number) === clean(draft.job_number)) {
    return `Job number ${draft.job_number.trim()} is already used by ${match.name}.`;
  }
  if (draft.address.trim() && clean(match.address) === clean(draft.address)) {
    return `That address is already attached to ${match.name}.`;
  }
  return `Site "${draft.name.trim()}" already exists.`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: string; details?: string; hint?: string; code?: string };
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(" ");
  }
  return "Could not save this change.";
}
