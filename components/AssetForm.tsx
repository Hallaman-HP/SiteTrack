"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Camera, ChevronDown, MapPin, Network, PackagePlus, RotateCcw, ScanText, Save, Sparkles, Upload } from "lucide-react";
import { Field, inputClass } from "@/components/Field";
import { canDeleteAssets } from "@/lib/roles";
import { archiveAsset, assetToView, restoreAsset, saveAsset, saveStore } from "@/lib/store";
import { archiveAssetInSupabase, loadSupabaseStore, restoreAssetInSupabase, saveAssetToSupabase } from "@/lib/supabaseStore";
import type { Asset, AssetStatus, StoreData } from "@/lib/types";
import { useStoreData } from "@/lib/useStoreData";

type AssetDraft = Omit<Asset, "created_at" | "updated_at">;

const statuses: AssetStatus[] = ["awaiting_install", "installed", "removed", "replaced", "moved", "damaged"];

export function AssetForm({ assetId }: { assetId?: string }) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData, isSupabaseMode, workspace, isLoading, replaceData] = useStoreData();
  const existing = assetId ? data.assets.find((asset) => asset.id === assetId) : undefined;
  const editableSiteIds = workspace?.editableSiteIds;
  const canEditAllSites = !isSupabaseMode || workspace?.role === "admin";
  const editableSites = useMemo(
    () => canEditAllSites ? data.sites : data.sites.filter((site) => editableSiteIds?.includes(site.id)),
    [canEditAllSites, data.sites, editableSiteIds]
  );
  const firstSite = editableSites[0];
  const firstBuilding = data.buildings.find((building) => building.site_id === firstSite?.id) ?? data.buildings[0];
  const firstRoom = data.rooms.find((room) => room.building_id === firstBuilding?.id) ?? data.rooms[0];
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState("");
  const [photoMessage, setPhotoMessage] = useState("");
  const [isReadingLabel, setIsReadingLabel] = useState(false);
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [photoTextLines, setPhotoTextLines] = useState<string[]>([]);
  const [selectedPhotoText, setSelectedPhotoText] = useState("");
  const [draft, setDraft] = useState<AssetDraft>(() => ({
    id: existing?.id ?? "",
    asset_number: existing?.asset_number ?? "",
    serial_number: existing?.serial_number ?? "",
    item_name: existing?.item_name ?? "",
    item_type: existing?.item_type ?? "",
    brand: existing?.brand ?? "",
    model: existing?.model ?? "",
    mac_address: existing?.mac_address ?? "",
    ip_address: existing?.ip_address ?? "",
    switch_port: existing?.switch_port ?? "",
    network_patch_number: existing?.network_patch_number ?? "",
    site_id: existing?.site_id ?? firstSite?.id ?? "",
    building_id: existing?.building_id ?? firstBuilding?.id ?? "",
    room_id: existing?.room_id ?? firstRoom?.id ?? "",
    location_in_room: existing?.location_in_room ?? "",
    patching_details: existing?.patching_details ?? "",
    status: existing?.status ?? "installed",
    notes: existing?.notes ?? ""
  }));

  useEffect(() => {
    if (!assetId || !existing) return;
    setDraft({
      id: existing.id,
      asset_number: existing.asset_number,
      serial_number: existing.serial_number,
      item_name: existing.item_name,
      item_type: existing.item_type,
      brand: existing.brand,
      model: existing.model,
      mac_address: existing.mac_address ?? "",
      ip_address: existing.ip_address ?? "",
      switch_port: existing.switch_port ?? "",
      network_patch_number: existing.network_patch_number ?? "",
      site_id: existing.site_id,
      building_id: existing.building_id,
      room_id: existing.room_id,
      location_in_room: existing.location_in_room,
      patching_details: existing.patching_details,
      status: existing.status,
      notes: existing.notes
    });
  }, [assetId, existing]);

  useEffect(() => {
    if (assetId || !editableSites.length) return;

    setDraft((current) => {
      const site = editableSites.find((item) => item.id === current.site_id) ?? editableSites[0];
      const availableBuildings = data.buildings.filter((item) => item.site_id === site.id);
      const building = availableBuildings.find((item) => item.id === current.building_id) ?? availableBuildings[0];
      const availableRooms = building ? data.rooms.filter((item) => item.building_id === building.id) : [];
      const room = availableRooms.find((item) => item.id === current.room_id) ?? availableRooms[0];

      if (site.id === current.site_id && (building?.id ?? "") === current.building_id && (room?.id ?? "") === current.room_id) {
        return current;
      }

      return {
        ...current,
        site_id: site.id,
        building_id: building?.id ?? "",
        room_id: room?.id ?? ""
      };
    });
  }, [assetId, data.buildings, data.rooms, editableSites]);

  const buildings = useMemo(() => data.buildings.filter((building) => building.site_id === draft.site_id), [data.buildings, draft.site_id]);
  const rooms = useMemo(() => data.rooms.filter((room) => room.building_id === draft.building_id), [data.rooms, draft.building_id]);
  const preview = draft.id ? assetToView({ ...draft, created_at: existing?.created_at ?? "", updated_at: existing?.updated_at ?? "" }, data) : undefined;
  const canEditCurrentAsset = !isSupabaseMode || canEditAllSites || (!!draft.site_id && editableSiteIds?.includes(draft.site_id));
  const canArchiveCurrentAsset = Boolean(existing) && (!isSupabaseMode || canDeleteAssets(workspace?.role));

  function update<K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "site_id") {
        const building = data.buildings.find((item) => item.site_id === value);
        next.building_id = building?.id ?? "";
        next.room_id = data.rooms.find((room) => room.building_id === building?.id)?.id ?? "";
      }
      if (key === "building_id") {
        next.room_id = data.rooms.find((room) => room.building_id === value)?.id ?? "";
      }
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await saveDraft(false);
  }

  async function saveDraft(addAnother: boolean) {
    setError("");
    setSuccess("");
    const overlap = findAssetOverlap(data, draft);
    if (overlap) {
      setError(overlap);
      return;
    }
    if (!draft.asset_number || !draft.item_name || !draft.site_id || !draft.building_id || !draft.room_id) {
      setError("Asset number, item name, site, building, and room are required.");
      return;
    }
    if (isSupabaseMode && !canEditCurrentAsset) {
      setError("Your role can view this job site, but cannot add or edit assets here.");
      return;
    }
    setIsSaving(true);
    try {
      if (isSupabaseMode) {
        const savedId = await saveAssetToSupabase(draft, photoUrl);
        const fresh = await loadSupabaseStore();
        replaceData(fresh.data);
        finishAfterSave(addAnother, savedId, fresh.data);
        return;
      }

      const next = saveAsset(data, draft, photoUrl);
      saveStore(next);
      setData(next);
      const savedId = draft.id || next.assets.find((asset) => asset.asset_number === draft.asset_number)?.id;
      finishAfterSave(addAnother, savedId, next);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  function finishAfterSave(addAnother: boolean, savedId: string | undefined, nextData: StoreData) {
    if (assetId && savedId) {
      router.push(`/assets/${savedId}`);
      return;
    }

    setPhotoUrl("");
    setPhotoTextLines([]);
    setSelectedPhotoText("");
    setPhotoMessage("");
    setDraft((current) => addAnother ? makeRepeatedAssetDraft(current) : makeBlankAssetDraft(current, nextData, editableSites));
    setSuccess(addAnother ? "Asset saved. Ready for the next matching item." : "Asset saved. Ready for the next asset.");
    router.replace("/assets/new");
  }

  async function onArchiveAsset() {
    if (!existing) return;
    setError("");
    if (!window.confirm(`Archive ${existing.asset_number} (${existing.item_name})? It will be hidden from active searches but can be restored by an admin.`)) return;

    try {
      if (isSupabaseMode) {
        await archiveAssetInSupabase(existing.id);
        replaceData(archiveAsset(data, existing.id, workspace?.name ?? "Site user"));
      } else {
        const next = archiveAsset(data, existing.id);
        saveStore(next);
        setData(next);
      }
      router.push("/search");
    } catch (caught) {
      setError(getErrorMessage(caught) || "Could not archive asset.");
    }
  }

  async function onRestoreAsset() {
    if (!existing) return;
    setError("");
    if (!window.confirm(`Restore ${existing.asset_number} (${existing.item_name}) to the active register?`)) return;

    try {
      if (isSupabaseMode) {
        await restoreAssetInSupabase(existing.id);
        replaceData(restoreAsset(data, existing.id, workspace?.name ?? "Site user"));
      } else {
        const next = restoreAsset(data, existing.id);
        saveStore(next);
        setData(next);
      }
      router.push(`/assets/${existing.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught) || "Could not restore asset.");
    }
  }

  function handlePhotoFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoUrl(String(reader.result));
      setPhotoMessage("Photo attached. Save the asset to keep it in the record.");
    };
    reader.readAsDataURL(file);
  }

  async function readLabelFromPhoto() {
    if (!photoUrl.startsWith("data:image")) {
      setPhotoMessage("Take or paste a label photo first, then read the label.");
      return;
    }
    setIsReadingLabel(true);
    setPhotoMessage("Reading label photo...");
    try {
      const tesseract = await import("tesseract.js");
      const result = await (tesseract as any).recognize(photoUrl, "eng");
      const text = result?.data?.text ?? "";
      const extracted = extractNetworkLabel(text);
      setPhotoTextLines(cleanPhotoTextLines(text));
      setDraft((current) => ({
        ...current,
        mac_address: extracted.mac_address || current.mac_address,
        ip_address: extracted.ip_address || current.ip_address,
        switch_port: extracted.switch_port || current.switch_port,
        network_patch_number: extracted.network_patch_number || current.network_patch_number,
        serial_number: extracted.serial_number || current.serial_number
      }));
      setPhotoMessage(
        Object.values(extracted).some(Boolean)
          ? "Label read. I filled the network fields I could detect."
          : "Photo read. Select any detected text below and drop it into the right field."
      );
    } catch {
      setPhotoMessage("Could not read this photo in the browser. Try a closer, brighter label shot.");
    } finally {
      setIsReadingLabel(false);
    }
  }

  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-[1fr_340px]">
      {isLoading ? (
        <section className="rounded-[8px] border border-zinc-200 bg-white p-5 text-steel shadow-panel lg:col-span-2">
          Loading secure site and room options...
        </section>
      ) : null}
      {isSupabaseMode && workspace && (!data.sites.length || !editableSites.length) ? (
        <section className="rounded-[8px] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-panel lg:col-span-2">
          <h1 className="text-xl font-semibold tracking-tight">{data.sites.length ? "View-only access" : "No job-site access yet"}</h1>
          <p className="mt-2 text-sm leading-6">
            {data.sites.length
              ? `Your account can view ${workspace.name} job-site data, but this role cannot add or edit assets.`
              : `Your account is signed into ${workspace.name}, but no job sites have been granted to you yet. Ask an admin or manager to add you to a job site before adding assets.`}
          </p>
        </section>
      ) : null}
      <form id="asset-form" onSubmit={onSubmit} className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel animate-rise">
        <div className="bg-gradient-to-r from-ink via-signal to-mint p-5 text-white sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><Sparkles size={14} />Quick capture</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">{existing ? "Edit asset" : "Add asset"}</h1>
              <p className="mt-1 text-sm text-white/80">Core details first. Everything else can stay tucked away.</p>
          </div>
            <button disabled={isLoading || isSaving || (isSupabaseMode && !canEditCurrentAsset)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-semibold text-ink shadow-panel transition hover:-translate-y-0.5 disabled:opacity-50">
            <Save size={17} />
              {isSaving ? "Saving..." : "Save"}
          </button>
          </div>
        </div>
        <div className="grid gap-5 p-5 sm:p-6">
          {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          {success ? <p className="rounded-[8px] bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</p> : null}

          <section className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink"><PackagePlus size={17} className="text-coral" />What is it?</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Asset number"><input className={inputClass} value={draft.asset_number} onChange={(e) => update("asset_number", e.target.value)} required /></Field>
              <Field label="Item name"><input className={inputClass} value={draft.item_name} onChange={(e) => update("item_name", e.target.value)} required /></Field>
              <Field label="Serial number"><input className={inputClass} value={draft.serial_number} onChange={(e) => update("serial_number", e.target.value)} /></Field>
              <Field label="Type"><input className={inputClass} value={draft.item_type} onChange={(e) => update("item_type", e.target.value)} /></Field>
            </div>
          </section>

          <section className="grid gap-3 rounded-[8px] bg-zinc-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin size={17} className="text-signal" />Where is it?</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Site">
                <select className={inputClass} value={draft.site_id} onChange={(e) => update("site_id", e.target.value)}>
                  {editableSites.length ? editableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>) : <option value="">No editable sites available</option>}
                </select>
              </Field>
              <Field label="Building">
                <select className={inputClass} value={draft.building_id} onChange={(e) => update("building_id", e.target.value)} disabled={!buildings.length}>
                  {buildings.length ? buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>) : <option value="">No buildings for this site</option>}
                </select>
              </Field>
              <Field label="Room">
                <select className={inputClass} value={draft.room_id} onChange={(e) => update("room_id", e.target.value)} disabled={!rooms.length}>
                  {rooms.length ? rooms.map((room) => <option key={room.id} value={room.id}>{room.room_number} | {room.room_name}</option>) : <option value="">No rooms for this building</option>}
                </select>
              </Field>
            </div>
            <Field label="Exact spot"><input className={inputClass} value={draft.location_in_room} onChange={(e) => update("location_in_room", e.target.value)} placeholder="Rack B, ceiling grid C4, under bench..." /></Field>
          </section>

          <section className="grid gap-3 rounded-[8px] border border-zinc-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Camera size={17} className="text-mint" />Photo</div>
              {photoUrl.startsWith("data:image") ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Attached</span> : null}
            </div>
            <input
              ref={photoInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handlePhotoFile(e.target.files?.[0])}
            />
            <input
              ref={uploadInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={(e) => handlePhotoFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-gradient-to-r from-signal to-mint px-4 text-sm font-semibold text-white shadow-panel transition hover:-translate-y-0.5 active:translate-y-0"
            >
              <Camera size={17} />
              Take Photo
            </button>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => uploadInputRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5">
                <Upload size={17} />
                Upload Image
              </button>
              <button type="button" onClick={() => void readLabelFromPhoto()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:-translate-y-0.5">
                <ScanText size={17} />
                {isReadingLabel ? "Reading..." : "Copy Details From Photo"}
              </button>
            </div>
            {photoMessage ? <p className="rounded-[8px] bg-zinc-50 px-3 py-2 text-sm text-steel">{photoMessage}</p> : null}
            {photoTextLines.length ? (
              <div className="grid gap-3 rounded-[8px] bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Detected text</p>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
                  {photoTextLines.map((line) => (
                    <button
                      key={line}
                      type="button"
                      onClick={() => setSelectedPhotoText(line)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selectedPhotoText === line ? "bg-ink text-white" : "bg-white text-ink shadow-sm hover:-translate-y-0.5"}`}
                    >
                      {line}
                    </button>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <PhotoInsertButton label="Serial" disabled={!selectedPhotoText} onClick={() => insertPhotoText("serial_number")} />
                  <PhotoInsertButton label="MAC" disabled={!selectedPhotoText} onClick={() => insertPhotoText("mac_address")} />
                  <PhotoInsertButton label="IP" disabled={!selectedPhotoText} onClick={() => insertPhotoText("ip_address")} />
                  <PhotoInsertButton label="Switch Port" disabled={!selectedPhotoText} onClick={() => insertPhotoText("switch_port")} />
                  <PhotoInsertButton label="Network Patch" disabled={!selectedPhotoText} onClick={() => insertPhotoText("network_patch_number")} />
                  <PhotoInsertButton label="Notes" disabled={!selectedPhotoText} onClick={() => insertPhotoText("notes")} />
                </div>
              </div>
            ) : null}
          {photoUrl.startsWith("data:image") ? (
              <div className="overflow-hidden rounded-[8px] border border-zinc-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="Attached asset photo preview" className="max-h-72 w-full object-cover" />
            </div>
          ) : null}
          </section>

          <section className="grid gap-3 rounded-[8px] bg-blue-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Network size={17} className="text-signal" />Network details</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="MAC address"><input className={inputClass} value={draft.mac_address} onChange={(e) => update("mac_address", e.target.value)} placeholder="00:1A:2B:3C:4D:5E" /></Field>
              <Field label="IP number"><input className={inputClass} value={draft.ip_address} onChange={(e) => update("ip_address", e.target.value)} placeholder="10.12.40.33" /></Field>
              <Field label="Switch port"><input className={inputClass} value={draft.switch_port} onChange={(e) => update("switch_port", e.target.value)} placeholder="SW12-18 / Gi1/0/18" /></Field>
              <Field label="Network patch"><input className={inputClass} value={draft.network_patch_number} onChange={(e) => update("network_patch_number", e.target.value)} placeholder="PP-B-18 / AUD-12-04" /></Field>
            </div>
          </section>

          <details className="group rounded-[8px] border border-zinc-200">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
              More details
              <ChevronDown className="transition group-open:rotate-180" size={17} />
            </summary>
            <div className="grid gap-3 border-t border-zinc-100 p-4 sm:grid-cols-2">
              <Field label="Brand"><input className={inputClass} value={draft.brand} onChange={(e) => update("brand", e.target.value)} /></Field>
              <Field label="Model"><input className={inputClass} value={draft.model} onChange={(e) => update("model", e.target.value)} /></Field>
              <Field label="Status">
                <select className={inputClass} value={draft.status} onChange={(e) => update("status", e.target.value as AssetStatus)}>
                  {statuses.map((status) => <option key={status} value={status}>{statusOptionLabel(status)}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Patching details"><textarea className={`${inputClass} min-h-24`} value={draft.patching_details} onChange={(e) => update("patching_details", e.target.value)} /></Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes"><textarea className={`${inputClass} min-h-24`} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></Field>
              </div>
            </div>
          </details>
        </div>
      </form>
      <aside className="grid content-start gap-4">
        <div className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Camera size={17} /> Photo storage</div>
          <p className="mt-2 text-sm leading-6 text-steel">
            On mobile, the photo field opens the camera. You can also paste a received image, or copy text from a photo using your phone&apos;s photo text selection and paste it into patching or notes.
          </p>
        </div>
        {preview ? (
          <div className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Current location</p>
            <p className="mt-2 text-lg font-semibold">{preview.building?.name} / {preview.room?.room_number}</p>
            <p className="mt-1 text-sm text-steel">{preview.location_in_room}</p>
          </div>
        ) : null}
        {canArchiveCurrentAsset ? (
          <div className={`rounded-[8px] border p-5 shadow-panel ${existing?.archived_at ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <p className={`text-sm font-semibold ${existing?.archived_at ? "text-emerald-900" : "text-amber-900"}`}>
              {existing?.archived_at ? "Restore asset" : "Archive asset"}
            </p>
            <p className={`mt-2 text-sm leading-6 ${existing?.archived_at ? "text-emerald-800" : "text-amber-800"}`}>
              {existing?.archived_at
                ? "Return this asset to active search results and dashboard lists."
                : "Hide this asset from active searches while keeping photos and history for audit."}
            </p>
            <button
              type="button"
              onClick={() => existing?.archived_at ? void onRestoreAsset() : void onArchiveAsset()}
              className={`mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 ${existing?.archived_at ? "bg-emerald-600" : "bg-amber-600"}`}
            >
              {existing?.archived_at ? <RotateCcw size={17} /> : <Archive size={17} />}
              {existing?.archived_at ? "Restore Asset" : "Archive Asset"}
            </button>
          </div>
        ) : null}
      </aside>
      <div className="fixed inset-x-0 bottom-[73px] z-40 border-t border-zinc-200 bg-white/90 px-4 py-3 shadow-panel backdrop-blur-xl md:bottom-0">
        <div className="mx-auto grid max-w-7xl gap-2 sm:flex sm:justify-end">
          {!existing ? (
            <button
              type="button"
              disabled={isLoading || isSaving || (isSupabaseMode && !canEditCurrentAsset)}
              onClick={() => void saveDraft(true)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              <PackagePlus size={17} />
              Add Another
            </button>
          ) : null}
          <button
            type="submit"
            form="asset-form"
            disabled={isLoading || isSaving || (isSupabaseMode && !canEditCurrentAsset)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-5 text-sm font-semibold text-white shadow-panel transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            <Save size={17} />
            {isSaving ? "Saving..." : existing ? "Save Changes" : "Save Asset"}
          </button>
        </div>
      </div>
    </div>
  );

  function insertPhotoText(key: keyof Pick<AssetDraft, "serial_number" | "mac_address" | "ip_address" | "switch_port" | "network_patch_number" | "notes">) {
    if (!selectedPhotoText) return;
    setDraft((current) => ({
      ...current,
      [key]: key === "notes" && current.notes ? `${current.notes}\n${selectedPhotoText}` : selectedPhotoText
    }));
    setPhotoMessage(`Copied "${selectedPhotoText}" into ${fieldLabel(key)}.`);
  }
}

function PhotoInsertButton({ disabled, label, onClick }: { disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-10 rounded-[8px] bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40"
    >
      Put in {label}
    </button>
  );
}

function makeRepeatedAssetDraft(current: AssetDraft): AssetDraft {
  return {
    ...current,
    id: "",
    asset_number: "",
    serial_number: "",
    mac_address: "",
    ip_address: "",
    switch_port: "",
    network_patch_number: "",
    patching_details: "",
    notes: "",
    archived_at: undefined,
    archived_by: undefined,
    archived_reason: undefined
  };
}

function makeBlankAssetDraft(current: AssetDraft, data: StoreData, editableSites: StoreData["sites"]): AssetDraft {
  const site = editableSites.find((item) => item.id === current.site_id) ?? editableSites[0];
  const building = data.buildings.find((item) => item.site_id === site?.id);
  const room = data.rooms.find((item) => item.building_id === building?.id);
  return {
    ...current,
    id: "",
    asset_number: "",
    serial_number: "",
    item_name: "",
    item_type: "",
    brand: "",
    model: "",
    mac_address: "",
    ip_address: "",
    switch_port: "",
    network_patch_number: "",
    site_id: site?.id ?? "",
    building_id: building?.id ?? "",
    room_id: room?.id ?? "",
    location_in_room: "",
    patching_details: "",
    status: "installed",
    notes: "",
    archived_at: undefined,
    archived_by: undefined,
    archived_reason: undefined
  };
}

function cleanPhotoTextLines(text: string) {
  const usefulPatterns = [
    /(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}/i,
    /(?:\d{1,3}\.){3}\d{1,3}/,
    /\b(?:SN|S\/N|SERIAL|MAC|IP|PORT|PATCH|PP|SW)\b/i,
    /\b[A-Z]{1,5}[- ]?\d+[A-Z0-9./-]*\b/i
  ];

  return Array.from(new Set(
    text
      .split(/\r?\n| {2,}/)
      .map((line) => line.replace(/[^\w\s:./-]/g, " ").replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 3 && line.length <= 48)
      .filter((line) => usefulPatterns.some((pattern) => pattern.test(line)))
      .slice(0, 18)
  ));
}

function statusOptionLabel(status: AssetStatus) {
  if (status === "awaiting_install") return "Awaiting Install";
  if (status === "damaged") return "Faulty/Damaged";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function fieldLabel(key: keyof Pick<AssetDraft, "serial_number" | "mac_address" | "ip_address" | "switch_port" | "network_patch_number" | "notes">) {
  const labels: Record<typeof key, string> = {
    serial_number: "serial number",
    mac_address: "MAC address",
    ip_address: "IP number",
    switch_port: "switch port",
    network_patch_number: "network patch",
    notes: "notes"
  };
  return labels[key];
}

function findAssetOverlap(data: StoreData, draft: AssetDraft) {
  const checks: Array<[string, keyof AssetDraft]> = [
    ["Asset number", "asset_number"],
    ["Serial number", "serial_number"],
    ["MAC address", "mac_address"],
    ["IP number", "ip_address"],
    ["Switch port", "switch_port"],
    ["Network patch", "network_patch_number"]
  ];
  const existing = data.assets.find((asset) => {
    if (asset.id === draft.id) return false;
    return checks.some(([, key]) => {
      const current = normalizeOverlapValue(String(asset[key] ?? ""));
      const next = normalizeOverlapValue(String(draft[key] ?? ""));
      return !!current && !!next && current === next;
    });
  });
  if (!existing) return "";

  const duplicateField = checks.find(([, key]) => {
    const current = normalizeOverlapValue(String(existing[key] ?? ""));
    const next = normalizeOverlapValue(String(draft[key] ?? ""));
    return !!current && !!next && current === next;
  });
  const label = duplicateField?.[0] ?? "Value";
  return `${label} already exists on ${existing.asset_number} (${existing.item_name}). Open that asset or change this value before saving.`;
}

function normalizeOverlapValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/[:-]/g, "");
}

function extractNetworkLabel(text: string) {
  const mac = text.match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i)?.[0] ?? "";
  const ip = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] ?? "";
  const serial = text.match(/\b(?:SN|S\/N|SERIAL)[:\s#-]*([A-Z0-9-]{5,})\b/i)?.[1] ?? "";
  const switchPort =
    text.match(/\b(?:SWITCH\s*PORT|SW\s*PORT|PORT)[:\s#-]*([A-Z]{0,3}\d+(?:\/\d+){0,2}|SW\d+[-/]\d+|GI\d+\/\d+\/\d+)\b/i)?.[1] ?? "";
  const patch =
    text.match(/\b(?:PATCH|NETWORK\s*PATCH|PP)[:\s#-]*([A-Z]{1,5}[- ]?\d+[A-Z0-9./-]*)\b/i)?.[1] ?? "";

  return {
    mac_address: mac.toUpperCase(),
    ip_address: ip,
    switch_port: switchPort,
    network_patch_number: patch,
    serial_number: serial
  };
}

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  if (caught && typeof caught === "object") {
    const error = caught as { message?: string; details?: string; hint?: string; code?: string };
    return [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ");
  }
  return "Could not save asset.";
}
