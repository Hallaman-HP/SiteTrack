<?php
/**
 * MemberController: workspace + site membership management.
 * Includes last-admin protection on workspace member update/remove.
 */
final class MemberController
{
    private const SITE_ROLES = ['manager', 'technician', 'viewer'];

    private static function memberPayload(array $row, array $extra = []): array
    {
        $display = Auth::displayNameFor($row);
        return array_merge([
            'id' => $row['id'],
            'user_id' => $row['user_id'],
            'role' => $row['role'],
            'email' => $row['email'],
            'display_name' => $display,
            'avatar_url' => !empty($row['avatar_path']) ? '/api/avatar?user_id=' . $row['user_id'] : null,
        ], $extra);
    }

    public static function list(): void
    {
        $user = Auth::requireUser();
        $workspaceId = trim((string)($_GET['workspace_id'] ?? ''));
        $role = Access::requireWorkspaceMember($user['id'], $workspaceId);

        $workspaceMembers = [];
        $siteMembers = [];

        if ($role === 'admin') {
            $wmRows = Db::all(
                'SELECT wm.id, wm.user_id, wm.role, u.email, u.first_name, u.last_name, u.display_name, u.avatar_path
                 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
                 WHERE wm.workspace_id = ? ORDER BY wm.created_at ASC',
                [$workspaceId]
            );
            foreach ($wmRows as $row) {
                $workspaceMembers[] = self::memberPayload($row);
            }
            $smRows = Db::all(
                'SELECT sm.id, sm.site_id, sm.user_id, sm.role, u.email, u.first_name, u.last_name, u.display_name, u.avatar_path
                 FROM site_members sm
                 JOIN sites s ON s.id = sm.site_id
                 JOIN users u ON u.id = sm.user_id
                 WHERE s.workspace_id = ? ORDER BY sm.created_at ASC',
                [$workspaceId]
            );
            foreach ($smRows as $row) {
                $siteMembers[] = self::memberPayload($row, ['site_id' => $row['site_id']]);
            }
        } else {
            // Managers see site_members for the sites they manage.
            $managed = Db::all(
                'SELECT sm.site_id FROM site_members sm JOIN sites s ON s.id = sm.site_id
                 WHERE sm.user_id = ? AND sm.role = "manager" AND s.workspace_id = ?',
                [$user['id'], $workspaceId]
            );
            $siteIds = array_column($managed, 'site_id');
            if ($siteIds) {
                $smRows = Db::all(
                    'SELECT sm.id, sm.site_id, sm.user_id, sm.role, u.email, u.first_name, u.last_name, u.display_name, u.avatar_path
                     FROM site_members sm JOIN users u ON u.id = sm.user_id
                     WHERE sm.site_id IN (' . Util::inClause($siteIds) . ') ORDER BY sm.created_at ASC',
                    $siteIds
                );
                foreach ($smRows as $row) {
                    $siteMembers[] = self::memberPayload($row, ['site_id' => $row['site_id']]);
                }
            }
        }
        Util::ok(['workspace_members' => $workspaceMembers, 'site_members' => $siteMembers]);
    }

    private static function adminCount(string $workspaceId): int
    {
        $row = Db::one('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = "admin"', [$workspaceId]);
        return (int)($row['n'] ?? 0);
    }

    public static function workspaceUpdate(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $role = trim((string)($body['role'] ?? ''));
        if (!in_array($role, ['admin', 'member'], true)) {
            throw new ApiError('Invalid workspace role.', 400);
        }
        $member = $id !== '' ? Db::one('SELECT * FROM workspace_members WHERE id = ?', [$id]) : null;
        if (!$member) {
            throw new ApiError('Member not found.', 404);
        }
        Access::requireWorkspaceAdmin($user['id'], $member['workspace_id']);
        if ($member['role'] === 'admin' && $role !== 'admin' && self::adminCount($member['workspace_id']) <= 1) {
            throw new ApiError('You cannot demote the last admin of a workspace.', 400);
        }
        Db::run('UPDATE workspace_members SET role = ? WHERE id = ?', [$role, $id]);
        Util::ok();
    }

    public static function workspaceRemove(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $member = $id !== '' ? Db::one('SELECT * FROM workspace_members WHERE id = ?', [$id]) : null;
        if (!$member) {
            throw new ApiError('Member not found.', 404);
        }
        $isSelf = $member['user_id'] === $user['id'];
        if (!$isSelf) {
            Access::requireWorkspaceAdmin($user['id'], $member['workspace_id']);
        }
        if ($member['role'] === 'admin' && self::adminCount($member['workspace_id']) <= 1) {
            throw new ApiError('You cannot remove the last admin of a workspace.', 400);
        }
        Db::run('DELETE FROM workspace_members WHERE id = ?', [$id]);
        Util::ok();
    }

    public static function siteUpsert(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $siteId = trim((string)($body['site_id'] ?? ''));
        $targetUserId = trim((string)($body['user_id'] ?? ''));
        $role = trim((string)($body['role'] ?? ''));
        if (!in_array($role, self::SITE_ROLES, true)) {
            throw new ApiError('Invalid site role.', 400);
        }
        $site = Access::site($siteId);
        if (!$site) {
            throw new ApiError('Site not found.', 404);
        }
        if (!Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $siteId))) {
            throw new ApiError('Only admins or site managers can manage site access.', 403);
        }
        if (!Access::workspaceRole($targetUserId, $site['workspace_id'])) {
            throw new ApiError('That user is not a member of this workspace.', 400);
        }
        $existing = Db::one('SELECT id FROM site_members WHERE site_id = ? AND user_id = ?', [$siteId, $targetUserId]);
        if ($existing) {
            Db::run('UPDATE site_members SET role = ? WHERE id = ?', [$role, $existing['id']]);
        } else {
            Db::run(
                'INSERT INTO site_members (id, site_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
                [Util::uuid4(), $siteId, $targetUserId, $role, Util::nowUtc()]
            );
        }
        Util::ok();
    }

    public static function siteUpdate(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $role = trim((string)($body['role'] ?? ''));
        if (!in_array($role, self::SITE_ROLES, true)) {
            throw new ApiError('Invalid site role.', 400);
        }
        $member = $id !== '' ? Db::one('SELECT * FROM site_members WHERE id = ?', [$id]) : null;
        if (!$member) {
            throw new ApiError('Site member not found.', 404);
        }
        if (!Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $member['site_id']))) {
            throw new ApiError('Only admins or site managers can manage site access.', 403);
        }
        Db::run('UPDATE site_members SET role = ? WHERE id = ?', [$role, $id]);
        Util::ok();
    }

    public static function siteRemove(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $member = $id !== '' ? Db::one('SELECT * FROM site_members WHERE id = ?', [$id]) : null;
        if (!$member) {
            throw new ApiError('Site member not found.', 404);
        }
        $isSelf = $member['user_id'] === $user['id'];
        if (!$isSelf && !Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $member['site_id']))) {
            throw new ApiError('Only admins or site managers can manage site access.', 403);
        }
        Db::run('DELETE FROM site_members WHERE id = ?', [$id]);
        Util::ok();
    }
}
