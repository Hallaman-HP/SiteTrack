"use client";

import { supabase } from "@/lib/supabase";
import { canEditAssets, canManageJobSiteAccess } from "@/lib/roles";
import { displayName, loadCurrentUserProfile } from "@/lib/profiles";
import type { Asset, AssetLog, AssetPhoto, AssetStatus, Building, Room, Site, StoreData } from "@/lib/types";

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
  if (!supabase) return { data: emptyStore, workspace: null, workspaces: [] };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) return { data: emptyStore, workspace: null, workspaces: [] };
  const cacheKey = `${userId}:${getActiveWorkspaceId()}`;
  if (storeCache && storeCache.key === cacheKey) {
    return storeCache.result;
  }

  const { data: memberships, error: memberError } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (memberError) throw memberError;

  const workspaces = (memberships ?? [])
    .map((membership: any) => {
      const workspace = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces;
      return workspace ? { id: workspace.id, name: workspace.name, role: membership.role } : null;
    })
    .filter(Boolean) as WorkspaceSummary[];

  const storedWorkspaceId = getActiveWorkspaceId();
  const workspace = workspaces.find((item) => item.id === storedWorkspaceId) ?? workspaces[0] ?? null;
  if (!workspace) {
    clearActiveWorkspaceId();
    return { data: emptyStore, workspace: null, workspaces };
  }
  setActiveWorkspaceId(workspace.id);

  const isAdmin = workspace.role === "admin";
  const { data: userSiteMemberships, error: userSiteMembershipError } = await supabase
    .from("site_members")
    .select("site_id, role")
    .eq("user_id", userId);
  if (userSiteMembershipError) throw userSiteMembershipError;

  const assignedSiteIds = Array.from(new Set((userSiteMemberships ?? []).map((membership: any) => membership.site_id).filter(Boolean)));
  const editableSiteIds = isAdmin
    ? []
    : Array.from(new Set((userSiteMemberships ?? []).filter((membership: any) => canEditAssets(membership.role)).map((membership: any) => membership.site_id).filter(Boolean)));
  const manageableSiteIds = isAdmin
    ? []
    : Array.from(new Set((userSiteMemberships ?? []).filter((membership: any) => canManageJobSiteAccess(membership.role)).map((membership: any) => membership.site_id).filter(Boolean)));
  const activeWorkspace = { ...workspace, editableSiteIds, manageableSiteIds };

  const sitesQuery = supabase.from("sites").select("*").order("created_at", { ascending: false });
  const scopedSitesQuery = isAdmin
    ? sitesQuery.eq("workspace_id", workspace.id)
    : assignedSiteIds.length
      ? sitesQuery.in("id", assignedSiteIds)
      : null;

  const [sitesResult, buildingsResult, roomsResult, assetsResult] = await Promise.all([
    scopedSitesQuery ?? Promise.resolve({ data: [], error: null }),
    supabase.from("buildings").select("*").order("created_at", { ascending: false }),
    supabase.from("rooms").select("*").order("created_at", { ascending: false }),
    isAdmin
      ? supabase.from("assets").select("*").eq("workspace_id", workspace.id).order("updated_at", { ascending: false })
      : assignedSiteIds.length
        ? supabase.from("assets").select("*").in("site_id", assignedSiteIds).is("archived_at", null).order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  const error = sitesResult.error || buildingsResult.error || roomsResult.error || assetsResult.error;
  if (error) throw error;

  const sites = (sitesResult.data ?? []).map(mapSite);
  const siteIds = new Set(sites.map((site) => site.id));
  const buildings = (buildingsResult.data ?? []).map(mapBuilding).filter((building) => siteIds.has(building.site_id));
  const buildingIds = new Set(buildings.map((building) => building.id));
  const rooms = (roomsResult.data ?? []).map(mapRoom).filter((room) => buildingIds.has(room.building_id));
  const assets = (assetsResult.data ?? []).map(mapAsset);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const assetIdList = Array.from(assetIds);

  const [photosResult, logsResult] = await Promise.all([
    isAdmin
      ? supabase.from("asset_photos").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false })
      : assetIds.size
        ? supabase.from("asset_photos").select("*").in("asset_id", assetIdList).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    isAdmin
      ? supabase.from("asset_logs").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false })
      : assetIds.size
        ? supabase.from("asset_logs").select("*").in("asset_id", assetIdList).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })
  ]);

  const relatedError = photosResult.error || logsResult.error;
  if (relatedError) throw relatedError;

  const result = {
    data: {
      sites,
      buildings,
      rooms,
      assets,
      asset_photos: (photosResult.data ?? []).map(mapPhoto).filter((photo) => assetIds.has(photo.asset_id)),
      asset_logs: (logsResult.data ?? []).map(mapLog).filter((log) => assetIds.has(log.asset_id))
    },
    workspace: activeWorkspace,
    workspaces
  };
  storeCache = { key: cacheKey, result, loadedAt: Date.now() };
  return result;
}

export async function loadWorkspaceGate(): Promise<WorkspaceGate> {
  if (!supabase) return { hasWorkspace: false, canAddAssets: true };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) return { hasWorkspace: false, canAddAssets: false };
  const cacheKey = `${userId}:${getActiveWorkspaceId()}`;
  if (workspaceGateCache?.key === cacheKey) {
    return workspaceGateCache.result;
  }

  const { data: memberships, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .limit(1);
  if (memberError) throw memberError;

  const role = memberships?.[0]?.role;
  if (!role) {
    const result = { hasWorkspace: false, canAddAssets: false };
    workspaceGateCache = { key: cacheKey, result };
    return result;
  }
  if (role === "admin") {
    const result = { hasWorkspace: true, canAddAssets: true };
    workspaceGateCache = { key: cacheKey, result };
    return result;
  }

  const { data: siteMemberships, error: siteError } = await supabase
    .from("site_members")
    .select("role")
    .eq("user_id", userId);
  if (siteError) throw siteError;

  const result = {
    hasWorkspace: true,
    canAddAssets: (siteMemberships ?? []).some((membership: any) => canEditAssets(membership.role))
  };
  workspaceGateCache = { key: cacheKey, result };
  return result;
}

export async function saveSupabaseStore(data: StoreData, workspaceId = getActiveWorkspaceId()) {
  const existing = await loadSupabaseStore();
  const targetWorkspaceId = workspaceId || existing.workspace?.id;
  if (!supabase) return;
  if (!targetWorkspaceId) throw new Error("No active workspace found. Create or select a workspace before saving.");

  const existingData = existing.data;

  await deleteMissing("asset_logs", existingData.asset_logs.map((item) => item.id), data.asset_logs.map((item) => item.id));
  await deleteMissing("asset_photos", existingData.asset_photos.map((item) => item.id), data.asset_photos.map((item) => item.id));
  await deleteMissing("assets", existingData.assets.map((item) => item.id), data.assets.map((item) => item.id));
  await deleteMissing("rooms", existingData.rooms.map((item) => item.id), data.rooms.map((item) => item.id));
  await deleteMissing("buildings", existingData.buildings.map((item) => item.id), data.buildings.map((item) => item.id));
  await deleteMissing("sites", existingData.sites.map((item) => item.id), data.sites.map((item) => item.id));

  if (data.sites.length) await throwOnError(supabase.from("sites").upsert(data.sites.map((site) => toSiteRow(site, targetWorkspaceId))));
  if (data.buildings.length) await throwOnError(supabase.from("buildings").upsert(data.buildings.map(toBuildingRow)));
  if (data.rooms.length) await throwOnError(supabase.from("rooms").upsert(data.rooms.map(toRoomRow)));
  if (data.assets.length) await throwOnError(supabase.from("assets").upsert(data.assets.map((asset) => toAssetRow(asset, targetWorkspaceId))));
  if (data.asset_photos.length) await throwOnError(supabase.from("asset_photos").upsert(data.asset_photos.map(toPhotoRow)));
  if (data.asset_logs.length) await throwOnError(supabase.from("asset_logs").upsert(data.asset_logs.map(toLogRow)));
  clearSupabaseStoreCache();
}

export async function upsertSiteInSupabase(site: Site, workspaceId = getActiveWorkspaceId()) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!workspaceId) throw new Error("No active workspace found. Create or select a workspace before saving sites.");
  await throwOnError(supabase.from("sites").upsert(toSiteRow(site, workspaceId)));
  clearSupabaseStoreCache();
}

export async function deleteSiteFromSupabase(siteId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!siteId) throw new Error("No site selected to delete.");
  const result = await supabase.from("sites").delete({ count: "exact" }).eq("id", siteId);
  if (result.error) throw result.error;
  if (result.count !== 1) throw new Error("You do not have permission to delete this site, or it no longer exists.");
  clearSupabaseStoreCache();
}

export async function upsertBuildingInSupabase(building: Building) {
  if (!supabase) throw new Error("Supabase is not configured.");
  await throwOnError(supabase.from("buildings").upsert(toBuildingRow(building)));
  clearSupabaseStoreCache();
}

export async function deleteBuildingFromSupabase(buildingId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!buildingId) throw new Error("No building selected to delete.");
  const result = await supabase.from("buildings").delete({ count: "exact" }).eq("id", buildingId);
  if (result.error) throw result.error;
  if (result.count !== 1) throw new Error("You do not have permission to delete this building, or it no longer exists.");
  clearSupabaseStoreCache();
}

export async function upsertRoomInSupabase(room: Room) {
  if (!supabase) throw new Error("Supabase is not configured.");
  await throwOnError(supabase.from("rooms").upsert(toRoomRow(room)));
  clearSupabaseStoreCache();
}

export async function deleteRoomFromSupabase(roomId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!roomId) throw new Error("No room selected to delete.");
  const result = await supabase.from("rooms").delete({ count: "exact" }).eq("id", roomId);
  if (result.error) throw result.error;
  if (result.count !== 1) throw new Error("You do not have permission to delete this room, or it no longer exists.");
  clearSupabaseStoreCache();
}

export async function saveAssetToSupabase(asset: Omit<Asset, "created_at" | "updated_at">, photoUrl?: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!asset.asset_number || !asset.item_name || !asset.site_id || !asset.building_id || !asset.room_id) {
    throw new Error("Asset number, item name, site, building, and room are required.");
  }

  const existing = asset.id
    ? await supabase.from("assets").select("id, location_in_room, status").eq("id", asset.id).maybeSingle()
    : { data: null, error: null };
  if (existing.error) throw existing.error;

  const workspaceId = await getWritableWorkspaceId();
  if (!workspaceId) throw new Error("No active workspace found. Join or create a workspace before saving assets.");
  const userName = await getCurrentUserDisplayName().catch(() => "Site user");

  const assetId = asset.id || crypto.randomUUID();
  const assetRow = normalizeAssetRow({
    id: assetId,
    asset_number: asset.asset_number,
    serial_number: asset.serial_number,
    item_name: asset.item_name,
    item_type: asset.item_type,
    brand: asset.brand,
    model: asset.model,
    mac_address: asset.mac_address,
    ip_address: asset.ip_address,
    switch_port: asset.switch_port,
    network_patch_number: asset.network_patch_number,
    site_id: asset.site_id,
    building_id: asset.building_id,
    room_id: asset.room_id,
    location_in_room: asset.location_in_room,
    patching_details: asset.patching_details,
    status: asset.status,
    notes: asset.notes,
    workspace_id: workspaceId,
    archived_at: asset.archived_at || null,
    archived_by: asset.archived_by || null,
    archived_reason: asset.archived_reason || null
  });
  const { error: assetError } = await supabase.from("assets").upsert(assetRow).select("id").single();
  if (assetError) throw assetError;

  const previousLocation = existing.data?.location_in_room ? existing.data.location_in_room : "New asset";
  const { error: logError } = await supabase.from("asset_logs").insert({
    asset_id: assetId,
    action_type: statusToAction(asset.status),
    previous_location: previousLocation,
    new_location: asset.location_in_room || "",
    notes: existing.data ? "Asset record updated." : "Asset created from add asset form.",
    user_name: userName
  });
  if (logError) throw logError;

  if (photoUrl) {
    const { error: photoError } = await supabase.from("asset_photos").insert({
      asset_id: assetId,
      photo_url: photoUrl,
      caption: "Uploaded photo"
    });
    if (photoError) throw photoError;
  }

  clearSupabaseStoreCache();
  return assetId;
}

export async function deleteAssetFromSupabase(assetId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!assetId) throw new Error("No asset selected to delete.");

  await throwOnError(supabase.from("asset_logs").delete().eq("asset_id", assetId));
  await throwOnError(supabase.from("asset_photos").delete().eq("asset_id", assetId));
  const result = await supabase.from("assets").delete({ count: "exact" }).eq("id", assetId);
  if (result.error) throw result.error;
  if (result.count !== 1) throw new Error("You do not have permission to delete this asset, or it no longer exists.");
  clearSupabaseStoreCache();
}

export async function archiveAssetInSupabase(assetId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!assetId) throw new Error("No asset selected to archive.");

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  const userName = user ? displayName(await loadCurrentUserProfile(user), user.email ?? "Site user") : "Site user";
  const existing = await supabase.from("assets").select("id, location_in_room").eq("id", assetId).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error("Asset no longer exists.");

  const archivedAt = new Date().toISOString();
  const result = await supabase
    .from("assets")
    .update({
      archived_at: archivedAt,
      archived_by: user?.id ?? null,
      archived_reason: "Archived by admin.",
      updated_at: archivedAt
    })
    .eq("id", assetId)
    .select("id")
    .single();
  if (result.error) throw result.error;

  const { error: logError } = await supabase.from("asset_logs").insert({
    asset_id: assetId,
    action_type: "Archived",
    previous_location: existing.data.location_in_room || "",
    new_location: "Archived",
    notes: "Asset archived. It is hidden from active searches but can be restored by an admin.",
    user_name: userName
  });
  if (logError) throw logError;
  clearSupabaseStoreCache();
}

export async function restoreAssetInSupabase(assetId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!assetId) throw new Error("No asset selected to restore.");

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  const userName = user ? displayName(await loadCurrentUserProfile(user), user.email ?? "Site user") : "Site user";
  const existing = await supabase.from("assets").select("id, location_in_room").eq("id", assetId).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error("Asset no longer exists.");

  const restoredAt = new Date().toISOString();
  const result = await supabase
    .from("assets")
    .update({
      archived_at: null,
      archived_by: null,
      archived_reason: null,
      updated_at: restoredAt
    })
    .eq("id", assetId)
    .select("id")
    .single();
  if (result.error) throw result.error;

  const { error: logError } = await supabase.from("asset_logs").insert({
    asset_id: assetId,
    action_type: "Restored",
    previous_location: "Archived",
    new_location: existing.data.location_in_room || "",
    notes: "Asset restored to the active register.",
    user_name: userName
  });
  if (logError) throw logError;
  clearSupabaseStoreCache();
}

async function deleteMissing(table: string, previousIds: string[], nextIds: string[]) {
  if (!supabase) return;
  const next = new Set(nextIds);
  const removed = previousIds.filter((id) => !next.has(id));
  if (!removed.length) return;
  await throwOnError(supabase.from(table).delete().in("id", removed));
}

async function throwOnError(resultPromise: PromiseLike<{ error: any }>) {
  const result = await resultPromise;
  if (result.error) throw result.error;
}

function mapSite(row: any): Site {
  return {
    id: row.id,
    name: row.name ?? "",
    address: row.address ?? "",
    client_name: row.client_name ?? "",
    job_number: row.job_number ?? "",
    created_at: row.created_at ?? ""
  };
}

function mapBuilding(row: any): Building {
  return {
    id: row.id,
    site_id: row.site_id,
    name: row.name ?? "",
    created_at: row.created_at ?? ""
  };
}

function mapRoom(row: any): Room {
  return {
    id: row.id,
    building_id: row.building_id,
    room_number: row.room_number ?? "",
    room_name: row.room_name ?? "",
    floor: row.floor ?? "",
    created_at: row.created_at ?? ""
  };
}

function mapAsset(row: any): Asset {
  return {
    id: row.id,
    asset_number: row.asset_number ?? "",
    serial_number: row.serial_number ?? "",
    item_name: row.item_name ?? "",
    item_type: row.item_type ?? "",
    brand: row.brand ?? "",
    model: row.model ?? "",
    mac_address: row.mac_address ?? "",
    ip_address: row.ip_address ?? "",
    switch_port: row.switch_port ?? "",
    network_patch_number: row.network_patch_number ?? "",
    site_id: row.site_id ?? "",
    building_id: row.building_id ?? "",
    room_id: row.room_id ?? "",
    location_in_room: row.location_in_room ?? "",
    patching_details: row.patching_details ?? "",
    status: row.status ?? "installed",
    notes: row.notes ?? "",
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
    archived_at: row.archived_at ?? "",
    archived_by: row.archived_by ?? "",
    archived_reason: row.archived_reason ?? ""
  };
}

function mapPhoto(row: any): AssetPhoto {
  return {
    id: row.id,
    asset_id: row.asset_id,
    photo_url: row.photo_url ?? "",
    caption: row.caption ?? "",
    created_at: row.created_at ?? ""
  };
}

function mapLog(row: any): AssetLog {
  return {
    id: row.id,
    asset_id: row.asset_id,
    action_type: row.action_type,
    previous_location: row.previous_location ?? "",
    new_location: row.new_location ?? "",
    notes: row.notes ?? "",
    user_name: row.user_name ?? "",
    created_at: row.created_at ?? ""
  };
}

function toSiteRow(site: Site, workspaceId: string) {
  return { ...site, workspace_id: workspaceId };
}

function toBuildingRow(building: Building) {
  return building;
}

function toRoomRow(room: Room) {
  return room;
}

function toAssetRow(asset: Asset, workspaceId: string) {
  return normalizeAssetRow({ ...asset, workspace_id: workspaceId });
}

function toPhotoRow(photo: AssetPhoto) {
  return photo;
}

function toLogRow(log: AssetLog) {
  return log;
}

function statusToAction(status: AssetStatus): AssetLog["action_type"] {
  const actions: Record<AssetStatus, AssetLog["action_type"]> = {
    awaiting_install: "Awaiting Install",
    installed: "Installed",
    removed: "Removed",
    replaced: "Replaced",
    moved: "Moved",
    damaged: "Faulty/Damaged"
  };
  return actions[status];
}

function blankToNull(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeAssetRow<T extends Record<string, any>>(asset: T) {
  return {
    ...asset,
    asset_number: String(asset.asset_number ?? "").trim(),
    serial_number: blankToNull(asset.serial_number),
    item_name: String(asset.item_name ?? "").trim(),
    item_type: blankToNull(asset.item_type),
    brand: blankToNull(asset.brand),
    model: blankToNull(asset.model),
    mac_address: blankToNull(asset.mac_address),
    ip_address: blankToNull(asset.ip_address),
    switch_port: blankToNull(asset.switch_port),
    network_patch_number: blankToNull(asset.network_patch_number),
    location_in_room: blankToNull(asset.location_in_room),
    patching_details: blankToNull(asset.patching_details),
    notes: blankToNull(asset.notes),
    archived_at: blankToNull(asset.archived_at),
    archived_by: blankToNull(asset.archived_by),
    archived_reason: blankToNull(asset.archived_reason)
  };
}

async function getCurrentUserDisplayName() {
  if (!supabase) return "Site user";
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return "Site user";
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, display_name")
    .eq("id", data.user.id)
    .maybeSingle();
  return displayName(profile as any, data.user.email ?? "Site user");
}

async function getWritableWorkspaceId() {
  if (!supabase) return "";
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) return "";

  const activeId = getActiveWorkspaceId();
  if (activeId) {
    const { data: activeMembership, error: activeMembershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("workspace_id", activeId)
      .maybeSingle();
    if (activeMembershipError) throw activeMembershipError;
    if (activeMembership?.workspace_id) return activeMembership.workspace_id;
    clearActiveWorkspaceId();
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;

  const workspaceId = membership?.workspace_id ?? "";
  if (workspaceId) setActiveWorkspaceId(workspaceId);
  return workspaceId;
}
