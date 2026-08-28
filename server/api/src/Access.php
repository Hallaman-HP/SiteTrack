<?php
/**
 * Access: server-side role checks (replaces Supabase RLS — the frontend is untrusted).
 *
 * Workspace roles: admin | member (workspace_members.role)
 * Site roles: manager | technician | viewer (site_members.role)
 * Effective site role: 'admin' when the user is a workspace admin of the
 * site's workspace, else their site_members role, else null.
 */
final class Access
{
    /** workspace_members role for the user in the workspace, or null. */
    public static function workspaceRole(string $userId, string $workspaceId): ?string
    {
        $row = Db::one(
            'SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?',
            [$userId, $workspaceId]
        );
        return $row['role'] ?? null;
    }

    public static function requireWorkspaceMember(string $userId, string $workspaceId): string
    {
        $role = self::workspaceRole($userId, $workspaceId);
        if ($role === null) {
            throw new ApiError('You are not a member of this workspace.', 403);
        }
        return $role;
    }

    public static function requireWorkspaceAdmin(string $userId, string $workspaceId): void
    {
        if (self::workspaceRole($userId, $workspaceId) !== 'admin') {
            throw new ApiError('Only workspace admins can do this.', 403);
        }
    }

    /** Site row (id, workspace_id, ...) or null. */
    public static function site(string $siteId): ?array
    {
        if ($siteId === '') {
            return null;
        }
        return Db::one('SELECT * FROM sites WHERE id = ?', [$siteId]);
    }

    /** Effective role on a site: admin > site_members.role > null. */
    public static function effectiveSiteRole(string $userId, string $siteId): ?string
    {
        $site = self::site($siteId);
        if (!$site) {
            return null;
        }
        if (self::workspaceRole($userId, $site['workspace_id']) === 'admin') {
            return 'admin';
        }
        $row = Db::one('SELECT role FROM site_members WHERE user_id = ? AND site_id = ?', [$userId, $siteId]);
        return $row['role'] ?? null;
    }

    /* ---- Role predicates identical to lib/roles.ts ---- */

    public static function canEditAssets(?string $role): bool
    {
        return $role === 'admin' || $role === 'manager' || $role === 'technician';
    }

    public static function canManageJobSiteAccess(?string $role): bool
    {
        return $role === 'admin' || $role === 'manager';
    }

    public static function canManageWorkspace(?string $role): bool
    {
        return $role === 'admin';
    }

    public static function canDeleteAssets(?string $role): bool
    {
        return $role === 'admin' || $role === 'manager';
    }

    /** True if two users share at least one workspace (or are the same user). */
    public static function sharesWorkspace(string $userIdA, string $userIdB): bool
    {
        if ($userIdA === $userIdB) {
            return true;
        }
        $row = Db::one(
            'SELECT a.workspace_id FROM workspace_members a
             JOIN workspace_members b ON b.workspace_id = a.workspace_id
             WHERE a.user_id = ? AND b.user_id = ? LIMIT 1',
            [$userIdA, $userIdB]
        );
        return $row !== null;
    }
}
