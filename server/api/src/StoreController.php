<?php
/**
 * StoreController: GET /api/store and GET /api/gate.
 * Scoping replicates lib/supabaseStore.ts loadSupabaseStore()/loadWorkspaceGate() exactly:
 *  - admin: all sites + assets in the workspace, INCLUDING archived assets
 *  - non-admin: only sites from site_members (any workspace, as in the original
 *    query), archived assets excluded
 *  - photos/logs filtered to the visible asset set
 *  - editableSiteIds/manageableSiteIds empty arrays for admin (admin implies all)
 *  - join_code exposed only to admins
 */
final class StoreController
{
    public static function store(): void
    {
        $user = Auth::requireUser();
        $requestedId = trim((string)($_GET['workspace_id'] ?? ''));

        $memberships = Db::all(
            'SELECT wm.role, w.id, w.name, w.join_code
             FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
             WHERE wm.user_id = ? ORDER BY wm.created_at ASC',
            [$user['id']]
        );

        $workspaces = [];
        foreach ($memberships as $m) {
            $summary = ['id' => $m['id'], 'name' => $m['name'], 'role' => $m['role']];
            if ($m['role'] === 'admin') {
                $summary['join_code'] = $m['join_code'];
            }
            $workspaces[] = $summary;
        }

        $emptyData = [
            'sites' => [], 'buildings' => [], 'rooms' => [],
            'assets' => [], 'asset_photos' => [], 'asset_logs' => [],
        ];
        if (!$workspaces) {
            Util::ok(['data' => $emptyData, 'workspace' => null, 'workspaces' => []]);
        }

        $workspace = $workspaces[0];
        if ($requestedId !== '') {
            foreach ($workspaces as $w) {
                if ($w['id'] === $requestedId) {
                    $workspace = $w;
                    break;
                }
            }
        }
        $isAdmin = ($workspace['role'] ?? '') === 'admin';

        // Site memberships across ALL workspaces (mirrors the original query).
        $siteMemberships = Db::all('SELECT site_id, role FROM site_members WHERE user_id = ?', [$user['id']]);
        $assignedSiteIds = [];
        $editableSiteIds = [];
        $manageableSiteIds = [];
        foreach ($siteMemberships as $sm) {
            if ($sm['site_id'] === null || $sm['site_id'] === '') {
                continue;
            }
            $assignedSiteIds[$sm['site_id']] = true;
            if (Access::canEditAssets($sm['role'])) {
                $editableSiteIds[$sm['site_id']] = true;
            }
            if (Access::canManageJobSiteAccess($sm['role'])) {
                $manageableSiteIds[$sm['site_id']] = true;
            }
        }
        $assignedSiteIds = array_keys($assignedSiteIds);

        $activeWorkspace = $workspace;
        $activeWorkspace['editableSiteIds'] = $isAdmin ? [] : array_keys($editableSiteIds);
        $activeWorkspace['manageableSiteIds'] = $isAdmin ? [] : array_keys($manageableSiteIds);

        // Sites
        if ($isAdmin) {
            $siteRows = Db::all('SELECT * FROM sites WHERE workspace_id = ? ORDER BY created_at DESC', [$workspace['id']]);
        } elseif ($assignedSiteIds) {
            $siteRows = Db::all(
                'SELECT * FROM sites WHERE id IN (' . Util::inClause($assignedSiteIds) . ') ORDER BY created_at DESC',
                $assignedSiteIds
            );
        } else {
            $siteRows = [];
        }
        $sites = array_map([self::class, 'mapSite'], $siteRows);
        $siteIds = array_column($sites, 'id');

        // Buildings
        $buildingRows = $siteIds
            ? Db::all('SELECT * FROM buildings WHERE site_id IN (' . Util::inClause($siteIds) . ') ORDER BY created_at DESC', $siteIds)
            : [];
        $buildings = array_map([self::class, 'mapBuilding'], $buildingRows);
        $buildingIds = array_column($buildings, 'id');

        // Rooms
        $roomRows = $buildingIds
            ? Db::all('SELECT * FROM rooms WHERE building_id IN (' . Util::inClause($buildingIds) . ') ORDER BY created_at DESC', $buildingIds)
            : [];
        $rooms = array_map([self::class, 'mapRoom'], $roomRows);

        // Assets: admin sees archived too; non-admin never sees archived.
        if ($isAdmin) {
            $assetRows = Db::all('SELECT * FROM assets WHERE workspace_id = ? ORDER BY updated_at DESC', [$workspace['id']]);
        } elseif ($assignedSiteIds) {
            $assetRows = Db::all(
                'SELECT * FROM assets WHERE site_id IN (' . Util::inClause($assignedSiteIds) . ') AND archived_at IS NULL ORDER BY updated_at DESC',
                $assignedSiteIds
            );
        } else {
            $assetRows = [];
        }
        $assets = array_map([self::class, 'mapAsset'], $assetRows);
        $assetIdSet = [];
        foreach ($assets as $a) {
            $assetIdSet[$a['id']] = true;
        }
        $assetIds = array_keys($assetIdSet);

        // Photos + logs, filtered to visible assets.
        if ($isAdmin) {
            $photoRows = Db::all(
                'SELECT p.* FROM asset_photos p JOIN assets a ON a.id = p.asset_id WHERE a.workspace_id = ? ORDER BY p.created_at DESC',
                [$workspace['id']]
            );
            $logRows = Db::all(
                'SELECT l.* FROM asset_logs l JOIN assets a ON a.id = l.asset_id WHERE a.workspace_id = ? ORDER BY l.created_at DESC',
                [$workspace['id']]
            );
        } elseif ($assetIds) {
            $photoRows = Db::all('SELECT * FROM asset_photos WHERE asset_id IN (' . Util::inClause($assetIds) . ') ORDER BY created_at DESC', $assetIds);
            $logRows = Db::all('SELECT * FROM asset_logs WHERE asset_id IN (' . Util::inClause($assetIds) . ') ORDER BY created_at DESC', $assetIds);
        } else {
            $photoRows = [];
            $logRows = [];
        }
        $photos = [];
        foreach ($photoRows as $row) {
            if (isset($assetIdSet[$row['asset_id']])) {
                $photos[] = self::mapPhoto($row);
            }
        }
        $logs = [];
        foreach ($logRows as $row) {
            if (isset($assetIdSet[$row['asset_id']])) {
                $logs[] = self::mapLog($row);
            }
        }

        Util::ok([
            'data' => [
                'sites' => $sites,
                'buildings' => $buildings,
                'rooms' => $rooms,
                'assets' => $assets,
                'asset_photos' => $photos,
                'asset_logs' => $logs,
            ],
            'workspace' => $activeWorkspace,
            'workspaces' => $workspaces,
        ]);
    }

    public static function gate(): void
    {
        $user = Auth::currentUser();
        if (!$user) {
            Util::ok(['hasWorkspace' => false, 'canAddAssets' => false]);
        }
        $membership = Db::one('SELECT role FROM workspace_members WHERE user_id = ? LIMIT 1', [$user['id']]);
        if (!$membership) {
            Util::ok(['hasWorkspace' => false, 'canAddAssets' => false]);
        }
        if ($membership['role'] === 'admin') {
            Util::ok(['hasWorkspace' => true, 'canAddAssets' => true]);
        }
        $siteMemberships = Db::all('SELECT role FROM site_members WHERE user_id = ?', [$user['id']]);
        $canAdd = false;
        foreach ($siteMemberships as $sm) {
            if (Access::canEditAssets($sm['role'])) {
                $canAdd = true;
                break;
            }
        }
        Util::ok(['hasWorkspace' => true, 'canAddAssets' => $canAdd]);
    }

    /* ---- Row mappers identical to supabaseStore.ts (nulls -> '') ---- */

    public static function mapSite(array $row): array
    {
        return [
            'id' => $row['id'],
            'name' => Util::s($row['name']),
            'address' => Util::s($row['address']),
            'client_name' => Util::s($row['client_name']),
            'job_number' => Util::s($row['job_number']),
            'created_at' => Util::isoTime($row['created_at']),
        ];
    }

    public static function mapBuilding(array $row): array
    {
        return [
            'id' => $row['id'],
            'site_id' => $row['site_id'],
            'name' => Util::s($row['name']),
            'created_at' => Util::isoTime($row['created_at']),
        ];
    }

    public static function mapRoom(array $row): array
    {
        return [
            'id' => $row['id'],
            'building_id' => $row['building_id'],
            'room_number' => Util::s($row['room_number']),
            'room_name' => Util::s($row['room_name']),
            'floor' => Util::s($row['floor']),
            'created_at' => Util::isoTime($row['created_at']),
        ];
    }

    public static function mapAsset(array $row): array
    {
        return [
            'id' => $row['id'],
            'asset_number' => Util::s($row['asset_number']),
            'serial_number' => Util::s($row['serial_number']),
            'item_name' => Util::s($row['item_name']),
            'item_type' => Util::s($row['item_type']),
            'brand' => Util::s($row['brand']),
            'model' => Util::s($row['model']),
            'mac_address' => Util::s($row['mac_address']),
            'ip_address' => Util::s($row['ip_address']),
            'switch_port' => Util::s($row['switch_port']),
            'network_patch_number' => Util::s($row['network_patch_number']),
            'site_id' => Util::s($row['site_id']),
            'building_id' => Util::s($row['building_id']),
            'room_id' => Util::s($row['room_id']),
            'location_in_room' => Util::s($row['location_in_room']),
            'patching_details' => Util::s($row['patching_details']),
            'status' => $row['status'] !== null && $row['status'] !== '' ? $row['status'] : 'installed',
            'notes' => Util::s($row['notes']),
            'created_at' => Util::isoTime($row['created_at']),
            'updated_at' => Util::isoTime($row['updated_at']),
            'archived_at' => Util::isoTime($row['archived_at']),
            'archived_by' => Util::s($row['archived_by']),
            'archived_reason' => Util::s($row['archived_reason']),
        ];
    }

    public static function mapPhoto(array $row): array
    {
        return [
            'id' => $row['id'],
            'asset_id' => $row['asset_id'],
            'photo_url' => Util::s($row['photo_url']),
            'caption' => Util::s($row['caption']),
            'created_at' => Util::isoTime($row['created_at']),
        ];
    }

    public static function mapLog(array $row): array
    {
        return [
            'id' => $row['id'],
            'asset_id' => $row['asset_id'],
            'action_type' => $row['action_type'],
            'previous_location' => Util::s($row['previous_location']),
            'new_location' => Util::s($row['new_location']),
            'notes' => Util::s($row['notes']),
            'user_name' => Util::s($row['user_name']),
            'created_at' => Util::isoTime($row['created_at']),
        ];
    }
}
