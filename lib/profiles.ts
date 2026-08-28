"use client";

import * as api from "@/lib/api";
import type { ApiUser } from "@/lib/api";

export type UserProfile = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar_url?: string;
  updated_at?: string;
};

export type ProfileMap = Record<string, UserProfile>;

export function profileFallback(user?: Pick<ApiUser, "id" | "email" | "first_name" | "last_name" | "display_name" | "avatar_url"> | null): UserProfile | null {
  if (!user?.id) return null;
  const first = String(user.first_name ?? "").trim();
  const last = String(user.last_name ?? "").trim();
  const display = [first, last].filter(Boolean).join(" ") || String(user.display_name ?? "").trim() || user.email?.split("@")[0] || "Site user";
  return {
    id: user.id,
    first_name: first,
    last_name: last,
    display_name: display,
    avatar_url: user.avatar_url ?? ""
  };
}

export function displayName(profile?: UserProfile | null, fallback = "Site user") {
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return full || profile?.display_name || fallback;
}

export function initialsForProfile(profile?: UserProfile | null, fallback = "ST") {
  const name = displayName(profile, fallback);
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2);
  return initials.toUpperCase();
}

export async function loadCurrentUserProfile(user: ApiUser): Promise<UserProfile | null> {
  // The session endpoint already returns the joined profile fields, so a
  // refresh just re-reads the session.
  const { user: fresh } = await api.getSession();
  return profileFallback(fresh ?? user);
}

export async function saveCurrentUserProfile(user: ApiUser, firstName: string, lastName: string) {
  const first_name = firstName.trim();
  const last_name = lastName.trim();
  const display_name = [first_name, last_name].filter(Boolean).join(" ");
  if (!first_name || !last_name) throw new Error("First name and last name are required.");

  const result = await api.updateProfile({ first_name, last_name, display_name });
  return profileFallback(result.user ?? user);
}

export async function loadProfilesForUsers(userIds: string[]): Promise<ProfileMap> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return {};

  const result = await api.getProfiles(ids);
  return Object.fromEntries(
    (result.profiles ?? []).map((profile) => [
      profile.id,
      {
        id: profile.id,
        first_name: profile.first_name ?? "",
        last_name: profile.last_name ?? "",
        display_name: profile.display_name ?? "",
        avatar_url: profile.avatar_url ?? ""
      }
    ])
  );
}

export async function uploadCurrentUserAvatar(user: ApiUser, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for your profile picture.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile picture must be under 5 MB.");

  const result = await api.uploadAvatar(file);
  const current = profileFallback(user);
  return current ? { ...current, avatar_url: result.avatar_url } : null;
}
