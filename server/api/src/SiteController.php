<?php
/**
 * SiteController: sites, buildings, rooms (admin, or manager within their sites).
 */
final class SiteController
{
    private static function requireSiteManage(string $userId, string $siteId): array
    {
        $site = Access::site($siteId);
        if (!$site) {
            throw new ApiError('Site not found.', 404);
        }
        if (!Access::canManageJobSiteAccess(Access::effectiveSiteRole($userId, $siteId))) {
            throw new ApiError('Only admins or site managers can do this.', 403);
        }
        return $site;
    }

    /* -------------------------------- Sites -------------------------------- */

    public static function siteUpsert(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $site = is_array($body['site'] ?? null) ? $body['site'] : [];
        $workspaceId = trim((string)($body['workspace_id'] ?? ''));
        $name = trim((string)($site['name'] ?? ''));
        if ($name === '') {
            throw new ApiError('Site name is required.', 400);
        }

        $id = trim((string)($site['id'] ?? ''));
        $existing = $id !== '' ? Access::site($id) : null;

        if ($existing) {
            // Edit: admin of the site's workspace, or manager of the site.
            if (!Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $existing['id']))) {
                throw new ApiError('Only admins or site managers can edit this site.', 403);
            }
            Db::run(
                'UPDATE sites SET name = ?, address = ?, client_name = ?, job_number = ? WHERE id = ?',
                [
                    $name,
                    Util::blankToNull($site['address'] ?? null),
                    Util::blankToNull($site['client_name'] ?? null),
                    Util::blankToNull($site['job_number'] ?? null),
                    $existing['id'],
                ]
            );
            $row = Access::site($existing['id']);
        } else {
            // Create: workspace admin only (managers only manage existing sites).
            if ($workspaceId === '') {
                throw new ApiError('No active workspace found. Create or select a workspace before saving sites.', 400);
            }
            Access::requireWorkspaceAdmin($user['id'], $workspaceId);
            $newId = $id !== '' ? $id : Util::uuid4();
            Db::run(
                'INSERT INTO sites (id, workspace_id, name, address, client_name, job_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    $newId, $workspaceId, $name,
                    Util::blankToNull($site['address'] ?? null),
                    Util::blankToNull($site['client_name'] ?? null),
                    Util::blankToNull($site['job_number'] ?? null),
                    Util::nowUtc(),
                ]
            );
            $row = Access::site($newId);
        }
        Util::ok(['site' => StoreController::mapSite($row)]);
    }

    public static function siteDelete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No site selected to delete.', 400);
        }
        $site = Access::site($id);
        if (!$site || !Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $id))) {
            throw new ApiError('You do not have permission to delete this site, or it no longer exists.', 403);
        }
        // FK cascades remove buildings, rooms, assets, photos, logs.
        $stmt = Db::run('DELETE FROM sites WHERE id = ?', [$id]);
        if ($stmt->rowCount() !== 1) {
            throw new ApiError('You do not have permission to delete this site, or it no longer exists.', 403);
        }
        Util::ok();
    }

    /* ------------------------------ Buildings ------------------------------ */

    public static function buildingUpsert(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $building = is_array($body['building'] ?? null) ? $body['building'] : [];
        $siteId = trim((string)($building['site_id'] ?? ''));
        $name = trim((string)($building['name'] ?? ''));
        if ($name === '') {
            throw new ApiError('Building name is required.', 400);
        }
        self::requireSiteManage($user['id'], $siteId);

        $id = trim((string)($building['id'] ?? ''));
        $existing = $id !== '' ? Db::one('SELECT * FROM buildings WHERE id = ?', [$id]) : null;
        if ($existing) {
            // Permission on the building's current site too (if it differs).
            if ($existing['site_id'] !== $siteId) {
                self::requireSiteManage($user['id'], $existing['site_id']);
            }
            Db::run('UPDATE buildings SET site_id = ?, name = ? WHERE id = ?', [$siteId, $name, $id]);
            $row = Db::one('SELECT * FROM buildings WHERE id = ?', [$id]);
        } else {
            $newId = $id !== '' ? $id : Util::uuid4();
            Db::run('INSERT INTO buildings (id, site_id, name, created_at) VALUES (?, ?, ?, ?)', [$newId, $siteId, $name, Util::nowUtc()]);
            $row = Db::one('SELECT * FROM buildings WHERE id = ?', [$newId]);
        }
        Util::ok(['building' => StoreController::mapBuilding($row)]);
    }

    public static function buildingDelete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No building selected to delete.', 400);
        }
        $building = Db::one('SELECT * FROM buildings WHERE id = ?', [$id]);
        if (!$building || !Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $building['site_id']))) {
            throw new ApiError('You do not have permission to delete this building, or it no longer exists.', 403);
        }
        $stmt = Db::run('DELETE FROM buildings WHERE id = ?', [$id]);
        if ($stmt->rowCount() !== 1) {
            throw new ApiError('You do not have permission to delete this building, or it no longer exists.', 403);
        }
        Util::ok();
    }

    /* -------------------------------- Rooms -------------------------------- */

    private static function buildingSite(string $buildingId): array
    {
        $building = $buildingId !== '' ? Db::one('SELECT * FROM buildings WHERE id = ?', [$buildingId]) : null;
        if (!$building) {
            throw new ApiError('Building not found.', 404);
        }
        return $building;
    }

    public static function roomUpsert(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $room = is_array($body['room'] ?? null) ? $body['room'] : [];
        $buildingId = trim((string)($room['building_id'] ?? ''));
        $roomNumber = trim((string)($room['room_number'] ?? ''));
        if ($roomNumber === '') {
            throw new ApiError('Room number is required.', 400);
        }
        $building = self::buildingSite($buildingId);
        self::requireSiteManage($user['id'], $building['site_id']);

        $id = trim((string)($room['id'] ?? ''));
        $existing = $id !== '' ? Db::one('SELECT * FROM rooms WHERE id = ?', [$id]) : null;
        if ($existing) {
            if ($existing['building_id'] !== $buildingId) {
                $prevBuilding = self::buildingSite($existing['building_id']);
                self::requireSiteManage($user['id'], $prevBuilding['site_id']);
            }
            Db::run(
                'UPDATE rooms SET building_id = ?, room_number = ?, room_name = ?, floor = ? WHERE id = ?',
                [$buildingId, $roomNumber, Util::blankToNull($room['room_name'] ?? null), Util::blankToNull($room['floor'] ?? null), $id]
            );
            $row = Db::one('SELECT * FROM rooms WHERE id = ?', [$id]);
        } else {
            $newId = $id !== '' ? $id : Util::uuid4();
            Db::run(
                'INSERT INTO rooms (id, building_id, room_number, room_name, floor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$newId, $buildingId, $roomNumber, Util::blankToNull($room['room_name'] ?? null), Util::blankToNull($room['floor'] ?? null), Util::nowUtc()]
            );
            $row = Db::one('SELECT * FROM rooms WHERE id = ?', [$newId]);
        }
        Util::ok(['room' => StoreController::mapRoom($row)]);
    }

    public static function roomDelete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No room selected to delete.', 400);
        }
        $room = Db::one('SELECT * FROM rooms WHERE id = ?', [$id]);
        $allowed = false;
        if ($room) {
            $building = Db::one('SELECT * FROM buildings WHERE id = ?', [$room['building_id']]);
            $allowed = $building && Access::canManageJobSiteAccess(Access::effectiveSiteRole($user['id'], $building['site_id']));
        }
        if (!$allowed) {
            throw new ApiError('You do not have permission to delete this room, or it no longer exists.', 403);
        }
        $stmt = Db::run('DELETE FROM rooms WHERE id = ?', [$id]);
        if ($stmt->rowCount() !== 1) {
            throw new ApiError('You do not have permission to delete this room, or it no longer exists.', 403);
        }
        Util::ok();
    }
}
