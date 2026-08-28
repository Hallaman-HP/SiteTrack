export type Role = "admin" | "manager" | "technician" | "viewer";

export const roles: Role[] = ["admin", "manager", "technician", "viewer"];

export function canEditAssets(role?: string) {
  return role === "admin" || role === "manager" || role === "technician";
}

export function canManageJobSiteAccess(role?: string) {
  return role === "admin" || role === "manager";
}

export function canManageWorkspace(role?: string) {
  return role === "admin";
}

export function canDeleteAssets(role?: string) {
  return role === "admin" || role === "manager";
}
