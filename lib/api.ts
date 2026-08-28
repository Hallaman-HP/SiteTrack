"use client";

import type { Asset, AssetLog, AssetPhoto, Building, Room, Site, StoreData } from "@/lib/types";

const baseUrl = (process.env.NEXT_PUBLIC_API_BASE ?? "/api").replace(/\/$/, "");

export type ApiUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar_url: string | null;
};

export type ApiProfile = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar_url: string | null;
};

export type ApiWorkspace = {
  id: string;
  name: string;
  role?: string;
  join_code?: string;
  editableSiteIds?: string[];
  manageableSiteIds?: string[];
};

export type ApiWorkspaceMember = {
  id: string;
  user_id: string;
  role: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

export type ApiSiteMember = {
  id: string;
  site_id: string;
  user_id: string;
  role: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

export type ApiInvite = {
  id: string;
  workspace_id: string;
  site_id: string | null;
  email: string;
  token: string;
  role: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
};

export type LoginResult =
  | { requires_2fa: true; challenge: string; user?: undefined }
  | { requires_2fa?: false; user: ApiUser };

export type SignupResult = { verify_email_sent?: boolean; user?: ApiUser };

export type StoreResult = {
  data: StoreData;
  workspace: ApiWorkspace | null;
  workspaces: ApiWorkspace[];
};

export type GateResult = { hasWorkspace: boolean; canAddAssets: boolean };

async function request<T>(path: string, options: { method?: string; body?: unknown; formData?: FormData } = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.formData ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Requested-With"] = "SiteTrack";
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
    credentials: "include"
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

// ---------- Auth ----------
export function signup(input: { email: string; password: string; first_name?: string; last_name?: string }) {
  return request<SignupResult>("/auth/signup", { body: input });
}

export function verifyEmail(token: string) {
  return request<{ user: ApiUser }>("/auth/verify-email", { body: { token } });
}

export function login(email: string, password: string) {
  return request<LoginResult>("/auth/login", { body: { email, password } });
}

export function verify2fa(challenge: string, code: string, trustDevice: boolean) {
  return request<{ user: ApiUser }>("/auth/2fa/verify", { body: { challenge, code, trust_device: trustDevice } });
}

export function requestMagicLink(email: string) {
  return request<{ ok: true }>("/auth/magic-link", { body: { email } });
}

export function magicVerify(token: string) {
  return request<{ user: ApiUser }>("/auth/magic-verify", { body: { token } });
}

export function logout() {
  return request<{ ok: true }>("/auth/logout", { method: "POST", body: {} });
}

export function getSession() {
  return request<{ user: ApiUser | null }>("/auth/session");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: true }>("/auth/change-password", { body: { current_password: currentPassword, new_password: newPassword } });
}

export function resetRequest(email: string) {
  return request<{ ok: true }>("/auth/reset-request", { body: { email } });
}

export function resetConfirm(token: string, newPassword: string) {
  return request<{ user: ApiUser }>("/auth/reset-confirm", { body: { token, new_password: newPassword } });
}

// ---------- Profiles ----------
export function updateProfile(input: { first_name?: string; last_name?: string; display_name?: string }) {
  return request<{ user: ApiUser }>("/profile/update", { body: input });
}

export function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ avatar_url: string }>("/profile/avatar", { formData });
}

export function getProfiles(ids: string[]) {
  return request<{ profiles: ApiProfile[] }>(`/profiles?ids=${encodeURIComponent(ids.join(","))}`);
}

// ---------- Store ----------
export function getStore(workspaceId?: string) {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return request<StoreResult>(`/store${query}`);
}

export function getGate() {
  return request<GateResult>("/gate");
}

// ---------- Workspaces & membership ----------
export function createWorkspace(name: string) {
  return request<{ workspace: ApiWorkspace }>("/workspaces", { body: { name } });
}

export function regenerateJoinCode(workspaceId: string) {
  return request<{ join_code: string }>("/workspaces/regenerate-code", { body: { workspace_id: workspaceId } });
}

export function joinWorkspace(code: string) {
  return request<{ workspace_id: string }>("/workspaces/join", { body: { code } });
}

export function acceptInvite(token: string) {
  return request<{ workspace_id: string }>("/invites/accept", { body: { token } });
}

export function createInvite(input: { workspace_id: string; email: string; role: string; site_id?: string }) {
  return request<{ invite: ApiInvite }>("/invites", { body: input });
}

export function getInvites(workspaceId: string) {
  return request<{ invites: ApiInvite[] }>(`/invites?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function deleteInvite(id: string) {
  return request<{ ok: true }>("/invites/delete", { body: { id } });
}

export function getMembers(workspaceId: string) {
  return request<{ workspace_members: ApiWorkspaceMember[]; site_members: ApiSiteMember[] }>(
    `/members?workspace_id=${encodeURIComponent(workspaceId)}`
  );
}

export function updateWorkspaceMember(id: string, role: string) {
  return request<{ ok: true }>("/members/workspace/update", { body: { id, role } });
}

export function removeWorkspaceMember(id: string) {
  return request<{ ok: true }>("/members/workspace/remove", { body: { id } });
}

export function upsertSiteMember(siteId: string, userId: string, role: string) {
  return request<{ ok: true }>("/members/site/upsert", { body: { site_id: siteId, user_id: userId, role } });
}

export function updateSiteMember(id: string, role: string) {
  return request<{ ok: true }>("/members/site/update", { body: { id, role } });
}

export function removeSiteMember(id: string) {
  return request<{ ok: true }>("/members/site/remove", { body: { id } });
}

// ---------- Sites / buildings / rooms ----------
export function upsertSite(site: Partial<Site> & Pick<Site, "name" | "address" | "client_name" | "job_number">, workspaceId: string) {
  const payload: Record<string, string> = {
    name: site.name,
    address: site.address,
    client_name: site.client_name,
    job_number: site.job_number
  };
  if (site.id) payload.id = site.id;
  return request<{ site: Site }>("/sites/upsert", { body: { site: payload, workspace_id: workspaceId } });
}

export function deleteSite(id: string) {
  return request<{ ok: true }>("/sites/delete", { body: { id } });
}

export function upsertBuilding(building: Partial<Building> & Pick<Building, "site_id" | "name">) {
  const payload: Record<string, string> = { site_id: building.site_id, name: building.name };
  if (building.id) payload.id = building.id;
  return request<{ building: Building }>("/buildings/upsert", { body: { building: payload } });
}

export function deleteBuilding(id: string) {
  return request<{ ok: true }>("/buildings/delete", { body: { id } });
}

export function upsertRoom(room: Partial<Room> & Pick<Room, "building_id" | "room_number" | "room_name" | "floor">) {
  const payload: Record<string, string> = {
    building_id: room.building_id,
    room_number: room.room_number,
    room_name: room.room_name,
    floor: room.floor
  };
  if (room.id) payload.id = room.id;
  return request<{ room: Room }>("/rooms/upsert", { body: { room: payload } });
}

export function deleteRoom(id: string) {
  return request<{ ok: true }>("/rooms/delete", { body: { id } });
}

// ---------- Assets ----------
export function saveAsset(asset: Record<string, unknown>, photoUrl?: string) {
  const body: Record<string, unknown> = { asset };
  if (photoUrl) body.photo_url = photoUrl;
  return request<{ id: string }>("/assets/save", { body });
}

export function deleteAsset(id: string) {
  return request<{ ok: true }>("/assets/delete", { body: { id } });
}

export function archiveAsset(id: string) {
  return request<{ ok: true }>("/assets/archive", { body: { id } });
}

export function restoreAsset(id: string) {
  return request<{ ok: true }>("/assets/restore", { body: { id } });
}

export function deletePhoto(id: string) {
  return request<{ ok: true }>("/photos/delete", { body: { id } });
}

// ---------- Health ----------
export function getHealth() {
  return request<{ db: boolean; time: string }>("/health");
}

export type { Asset, AssetLog, AssetPhoto, Building, Room, Site, StoreData };
