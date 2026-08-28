"use client";

// Data layer for the self-hosted SiteTrack PHP API.
// The exported function names keep their historical "Supabase" names so the
// rest of the app needs minimal edits; everything now talks to /api/*.

import * as api from "@/lib/api";
import type { Asset, Building, Room, Site, StoreData } from "@/lib/types";

const activeWorkspaceKey = "sitetrack-active-workspace-id";
let storeCache: { key: string; result: SupabaseStoreResult; loadedAt: number } | null = null;
let workspaceGateCache: { key: string; result: WorkspaceGate } | null = null;

export type WorkspaceSummary = {
  id: string;
  name: string;
  role?: string;
  join_code?: string;
  editableSiteIds?: string[];
  manageableSiteIds?: string[];
};

export type SupabaseStoreResult = {
  data: StoreData;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
};

export type WorkspaceGate = {
  hasWorkspace: boolean;
  canAddAssets: boolean;
};

const emptyStore: StoreData = {
  sites: [],
  buildings: [],
  rooms: [],
  assets: [],
  asset_photos: [],
  asset_logs: []
};

export function getActiveWorkspaceId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(activeWorkspaceKey) ?? "";
}

export function setActiveWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(activeWorkspaceKey) === workspaceId) return;
  window.localStorage.setItem(activeWorkspaceKey, workspaceId);
  clearSupabaseStoreCache();
}

export function clearActiveWorkspaceId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(activeWorkspaceKey);
  clearSupabaseStoreCache();
}

export function clearSupabaseStoreCache() {
  storeCache = null;
  workspaceGateCache = null;
}

export async function loadSupabaseStore(): Promise<SupabaseStoreResult> {
  const cacheKey = getActiveWorkspaceId();
  if (storeCache && storeCache.key === cacheKey) {
    return storeCache.result;
  }

  const response = await api.getStore(cacheKey || undefined);
  const workspaces = (response.workspaces ?? []) as WorkspaceSummary[];
  const workspace = (response.workspace ?? null) as WorkspaceSummary | null;

  if (!workspace) {
    clearActiveWorkspaceId();
    return { data: emptyStore, workspace: null, workspaces };
  }
  setActiveWorkspaceId(workspace.id);

  const result: SupabaseStoreResult = {
    data: {
      sites: response.data?.sites ?? [],
      buildings: response.data?.buildings ?? [],
      rooms: response.data?.rooms ?? [],
      assets: response.data?.assets ?? [],
      asset_photos: response.data?.asset_photos ?? [],
      asset_logs: response.data?.asset_logs ?? []
    },
    workspace,
    workspaces
  };
  storeCache = { key: getActiveWorkspaceId(), result, loadedAt: Date.now() };
  return result;
}

export async function loadWorkspaceGate(): Promise<WorkspaceGate> {
  const cacheKey = getActiveWorkspaceId();
  if (workspaceGateCache?.key === cacheKey) {
    return workspaceGateCache.result;
  }

  const result = await api.getGate();
  workspaceGateCache = { key: cacheKey, result: { hasWorkspace: result.hasWorkspace, canAddAssets: result.canAddAssets } };
  return workspaceGateCache.result;
}

export async function upsertSiteInSupabase(site: Site, workspaceId = getActiveWorkspaceId()) {
  if (!workspaceId) throw new Error("No active workspace found. Create or select a workspace before saving sites.");
  await api.upsertSite(site, workspaceId);
  clearSupabaseStoreCache();
}

export async function deleteSiteFromSupabase(siteId: string) {
  if (!siteId) throw new Error("No site selected to delete.");
  await api.deleteSite(siteId);
  clearSupabaseStoreCache();
}

export async function upsertBuildingInSupabase(building: Building) {
  await api.upsertBuilding(building);
  clearSupabaseStoreCache();
}

export async function deleteBuildingFromSupabase(buildingId: string) {
  if (!buildingId) throw new Error("No building selected to delete.");
  await api.deleteBuilding(buildingId);
  clearSupabaseStoreCache();
}

export async function upsertRoomInSupabase(room: Room) {
  await api.upsertRoom(room);
  clearSupabaseStoreCache();
}

export async function deleteRoomFromSupabase(roomId: string) {
  if (!roomId) throw new Error("No room selected to delete.");
  await api.deleteRoom(roomId);
  clearSupabaseStoreCache();
}

export async function saveAssetToSupabase(asset: Omit<Asset, "created_at" | "updated_at">, photoUrl?: string) {
  if (!asset.asset_number || !asset.item_name || !asset.site_id || !asset.building_id || !asset.room_id) {
    throw new Error("Asset number, item name, site, building, and room are required.");
  }

  const assetRow: Record<string, unknown> = {
    asset_number: String(asset.asset_number ?? "").trim(),
    serial_number: asset.serial_number ?? "",
    item_name: String(asset.item_name ?? "").trim(),
    item_type: asset.item_type ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    mac_address: asset.mac_address ?? "",
    ip_address: asset.ip_address ?? "",
    switch_port: asset.switch_port ?? "",
    network_patch_number: asset.network_patch_number ?? "",
    site_id: asset.site_id,
    building_id: asset.building_id,
    room_id: asset.room_id,
    location_in_room: asset.location_in_room ?? "",
    patching_details: asset.patching_details ?? "",
    status: asset.status,
    notes: asset.notes ?? ""
  };
  if (asset.id) assetRow.id = asset.id;

  const result = await api.saveAsset(assetRow, photoUrl);
  clearSupabaseStoreCache();
  return result.id;
}

export async function deleteAssetFromSupabase(assetId: string) {
  if (!assetId) throw new Error("No asset selected to delete.");
  await api.deleteAsset(assetId);
  clearSupabaseStoreCache();
}

export async function archiveAssetInSupabase(assetId: string) {
  if (!assetId) throw new Error("No asset selected to archive.");
  await api.archiveAsset(assetId);
  clearSupabaseStoreCache();
}

export async function restoreAssetInSupabase(assetId: string) {
  if (!assetId) throw new Error("No asset selected to restore.");
  await api.restoreAsset(assetId);
  clearSupabaseStoreCache();
}
