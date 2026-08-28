<?php
/**
 * WorkspaceController: workspace create/join/join-code + invites.
 */
final class WorkspaceController
{
    private static function newJoinCode(): string
    {
        return strtoupper(bin2hex(random_bytes(4))); // 8 hex chars, upper
    }

    public static function create(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') {
            throw new ApiError('Workspace name is required.', 400);
        }
        $id = Util::uuid4();
        $code = self::newJoinCode();
        $db = Db::get();
        $db->beginTransaction();
        try {
            Db::run('INSERT INTO workspaces (id, name, join_code, created_at) VALUES (?, ?, ?, ?)', [$id, $name, $code, Util::nowUtc()]);
            Db::run(
                'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, "admin", ?)',
                [Util::uuid4(), $id, $user['id'], Util::nowUtc()]
            );
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Util::ok(['workspace' => ['id' => $id, 'name' => $name, 'role' => 'admin', 'join_code' => $code]]);
    }

    public static function regenerateCode(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $workspaceId = trim((string)($body['workspace_id'] ?? ''));
        Access::requireWorkspaceAdmin($user['id'], $workspaceId);
        $code = self::newJoinCode();
        Db::run('UPDATE workspaces SET join_code = ? WHERE id = ?', [$code, $workspaceId]);
        Util::ok(['join_code' => $code]);
    }

    public static function join(): void
    {
        $user = Auth::requireUser();
        Auth::rateLimit('join', $user['id']);
        $body = Util::jsonBody();
        $code = strtoupper(trim((string)($body['code'] ?? '')));
        if ($code === '') {
            throw new ApiError('Join code is required.', 400);
        }
        $workspace = Db::one('SELECT id FROM workspaces WHERE join_code = ?', [$code]);
        if (!$workspace) {
            throw new ApiError('That join code is not valid.', 404);
        }
        if (!Access::workspaceRole($user['id'], $workspace['id'])) {
            Db::run(
                'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, "member", ?)',
                [Util::uuid4(), $workspace['id'], $user['id'], Util::nowUtc()]
            );
        }
        Util::ok(['workspace_id' => $workspace['id']]);
    }

    /* ------------------------------- Invites ------------------------------- */

    private const WORKSPACE_ROLES = ['admin', 'member'];
    private const SITE_ROLES = ['manager', 'technician', 'viewer'];

    public static function inviteCreate(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $workspaceId = trim((string)($body['workspace_id'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $role = trim((string)($body['role'] ?? 'viewer'));
        $siteId = Util::blankToNull($body['site_id'] ?? null);

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ApiError('Please enter a valid email address.', 400);
        }
        $workspace = Db::one('SELECT * FROM workspaces WHERE id = ?', [$workspaceId]);
        if (!$workspace) {
            throw new ApiError('Workspace not found.', 404);
        }

        $siteName = null;
        $isAdmin = Access::workspaceRole($user['id'], $workspaceId) === 'admin';
        if ($siteId !== null) {
            $site = Access::site($siteId);
            if (!$site || $site['workspace_id'] !== $workspaceId) {
                throw new ApiError('Site not found in this workspace.', 404);
            }
            $siteName = $site['name'];
            if (!in_array($role, self::SITE_ROLES, true)) {
                throw new ApiError('Invalid site role.', 400);
            }
            // Admin, or manager of that site.
            if (!$isAdmin && !Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $siteId))) {
                throw new ApiError('Only admins or site managers can send this invite.', 403);
            }
        } else {
            if (!in_array($role, self::WORKSPACE_ROLES, true)) {
                throw new ApiError('Invalid workspace role.', 400);
            }
            if (!$isAdmin) {
                throw new ApiError('Only workspace admins can send workspace invites.', 403);
            }
        }

        $token = Util::randomToken();
        $id = Util::uuid4();
        Db::run(
            'INSERT INTO invites (id, workspace_id, site_id, email, role, token_hash, invited_by, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $workspaceId, $siteId, $email, $role, Util::hashToken($token), $user['id'], Util::nowUtc(), Util::nowUtc(14 * 86400)]
        );
        Mailer::sendInvite($email, $token, $workspace['name'], $siteName, $role);

        Util::ok(['invite' => [
            'id' => $id,
            'workspace_id' => $workspaceId,
            'site_id' => $siteId,
            'email' => $email,
            'role' => $role,
            'created_at' => Util::isoTime(Util::nowUtc()),
            'expires_at' => Util::isoTime(Util::nowUtc(14 * 86400)),
        ]]);
    }

    public static function inviteList(): void
    {
        $user = Auth::requireUser();
        $workspaceId = trim((string)($_GET['workspace_id'] ?? ''));
        $role = Access::requireWorkspaceMember($user['id'], $workspaceId);

        if ($role === 'admin') {
            $rows = Db::all('SELECT * FROM invites WHERE workspace_id = ? ORDER BY created_at DESC', [$workspaceId]);
        } else {
            // Managers: invites for sites they manage.
            $managed = Db::all(
                'SELECT sm.site_id FROM site_members sm JOIN sites s ON s.id = sm.site_id
                 WHERE sm.user_id = ? AND sm.role = "manager" AND s.workspace_id = ?',
                [$user['id'], $workspaceId]
            );
            $siteIds = array_column($managed, 'site_id');
            if (!$siteIds) {
                throw new ApiError('Only admins or site managers can view invites.', 403);
            }
            $rows = Db::all(
                'SELECT * FROM invites WHERE workspace_id = ? AND site_id IN (' . Util::inClause($siteIds) . ') ORDER BY created_at DESC',
                array_merge([$workspaceId], $siteIds)
            );
        }
        $invites = [];
        foreach ($rows as $row) {
            $invites[] = [
                'id' => $row['id'],
                'workspace_id' => $row['workspace_id'],
                'site_id' => $row['site_id'],
                'email' => $row['email'],
                'role' => $row['role'],
                'accepted_at' => Util::isoTime($row['accepted_at']),
                'created_at' => Util::isoTime($row['created_at']),
                'expires_at' => Util::isoTime($row['expires_at']),
            ];
        }
        Util::ok(['invites' => $invites]);
    }

    public static function inviteDelete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $invite = $id !== '' ? Db::one('SELECT * FROM invites WHERE id = ?', [$id]) : null;
        $allowed = false;
        if ($invite) {
            if (Access::workspaceRole($user['id'], $invite['workspace_id']) === 'admin') {
                $allowed = true;
            } elseif ($invite['site_id'] !== null) {
                $allowed = Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $invite['site_id']));
            }
        }
        if (!$allowed) {
            throw new ApiError('You do not have permission to delete this invite, or it no longer exists.', 403);
        }
        $stmt = Db::run('DELETE FROM invites WHERE id = ?', [$id]);
        if ($stmt->rowCount() !== 1) {
            throw new ApiError('You do not have permission to delete this invite, or it no longer exists.', 403);
        }
        Util::ok();
    }

    public static function inviteAccept(): void
    {
        $user = Auth::requireUser();
        Auth::rateLimit('invite-accept', $user['id']);
        $body = Util::jsonBody();
        $token = (string)($body['token'] ?? '');
        $invite = $token !== ''
            ? Db::one('SELECT * FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?', [Util::hashToken($token), Util::nowUtc()])
            : null;
        if (!$invite) {
            throw new ApiError('This invite is invalid, expired, or has already been used.', 400);
        }

        $db = Db::get();
        $db->beginTransaction();
        try {
            // Workspace membership (invite role admin -> admin, else member).
            if (!Access::workspaceRole($user['id'], $invite['workspace_id'])) {
                $wsRole = $invite['role'] === 'admin' ? 'admin' : 'member';
                Db::run(
                    'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
                    [Util::uuid4(), $invite['workspace_id'], $user['id'], $wsRole, Util::nowUtc()]
                );
            }
            // Optional site membership.
            if ($invite['site_id'] !== null && in_array($invite['role'], self::SITE_ROLES, true)) {
                $existing = Db::one('SELECT id FROM site_members WHERE site_id = ? AND user_id = ?', [$invite['site_id'], $user['id']]);
                if ($existing) {
                    Db::run('UPDATE site_members SET role = ? WHERE id = ?', [$invite['role'], $existing['id']]);
                } else {
                    Db::run(
                        'INSERT INTO site_members (id, site_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
                        [Util::uuid4(), $invite['site_id'], $user['id'], $invite['role'], Util::nowUtc()]
                    );
                }
            }
            Db::run('UPDATE invites SET accepted_at = ? WHERE id = ?', [Util::nowUtc(), $invite['id']]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Util::ok(['workspace_id' => $invite['workspace_id']]);
    }
}
