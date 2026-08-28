<?php
/**
 * AssetController: asset save/delete/archive/restore + photo delete.
 * Save behaviour replicates lib/supabaseStore.ts saveAssetToSupabase() exactly.
 */
final class AssetController
{
    private static function assetById(string $id): ?array
    {
        return $id !== '' ? Db::one('SELECT * FROM assets WHERE id = ?', [$id]) : null;
    }

    public static function save(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $asset = is_array($body['asset'] ?? null) ? $body['asset'] : [];
        $photoUrl = trim((string)($body['photo_url'] ?? ''));

        // Required-field validation identical to saveAssetToSupabase.
        $assetNumber = trim((string)($asset['asset_number'] ?? ''));
        $itemName = trim((string)($asset['item_name'] ?? ''));
        $siteId = trim((string)($asset['site_id'] ?? ''));
        $buildingId = trim((string)($asset['building_id'] ?? ''));
        $roomId = trim((string)($asset['room_id'] ?? ''));
        if ($assetNumber === '' || $itemName === '' || $siteId === '' || $buildingId === '' || $roomId === '') {
            throw new ApiError('Asset number, item name, site, building, and room are required.', 400);
        }

        $status = (string)($asset['status'] ?? 'installed');
        $action = Util::statusToAction($status);
        if ($action === null) {
            throw new ApiError('Invalid asset status.', 400);
        }

        $site = Access::site($siteId);
        if (!$site) {
            throw new ApiError('Site not found.', 404);
        }
        // Editor must have edit rights on the asset's site.
        if (!Access::canEditAssets(Access::effectiveSiteRole($user['id'], $siteId))) {
            throw new ApiError('You do not have permission to add or edit assets on this site.', 403);
        }

        $id = trim((string)($asset['id'] ?? ''));
        $existing = self::assetById($id);
        if ($existing) {
            // Must also be allowed to edit the asset where it currently lives.
            if ($existing['site_id'] !== $siteId
                && !Access::canEditAssets(Access::effectiveSiteRole($user['id'], $existing['site_id']))) {
                throw new ApiError('You do not have permission to edit this asset.', 403);
            }
            if ($existing['workspace_id'] !== $site['workspace_id']) {
                throw new ApiError('Assets cannot be moved between workspaces.', 400);
            }
        }
        $workspaceId = $site['workspace_id'];

        // Sanity: building belongs to site, room belongs to building.
        $building = Db::one('SELECT id, site_id FROM buildings WHERE id = ?', [$buildingId]);
        if (!$building || $building['site_id'] !== $siteId) {
            throw new ApiError('Building not found on this site.', 400);
        }
        $room = Db::one('SELECT id, building_id FROM rooms WHERE id = ?', [$roomId]);
        if (!$room || $room['building_id'] !== $buildingId) {
            throw new ApiError('Room not found in this building.', 400);
        }

        $assetId = $existing ? $existing['id'] : ($id !== '' ? $id : Util::uuid4());

        // Unique asset_number per workspace (friendly error before the DB constraint).
        $dupe = Db::one(
            'SELECT id FROM assets WHERE workspace_id = ? AND asset_number = ? AND id <> ?',
            [$workspaceId, $assetNumber, $assetId]
        );
        if ($dupe) {
            throw new ApiError('An asset with this asset number already exists in this workspace.', 409);
        }

        $row = Util::normalizeAssetRow([
            'asset_number' => $assetNumber,
            'serial_number' => $asset['serial_number'] ?? null,
            'item_name' => $itemName,
            'item_type' => $asset['item_type'] ?? null,
            'brand' => $asset['brand'] ?? null,
            'model' => $asset['model'] ?? null,
            'mac_address' => $asset['mac_address'] ?? null,
            'ip_address' => $asset['ip_address'] ?? null,
            'switch_port' => $asset['switch_port'] ?? null,
            'network_patch_number' => $asset['network_patch_number'] ?? null,
            'location_in_room' => $asset['location_in_room'] ?? null,
            'patching_details' => $asset['patching_details'] ?? null,
            'notes' => $asset['notes'] ?? null,
            'archived_at' => $asset['archived_at'] ?? null,
            'archived_by' => $asset['archived_by'] ?? null,
            'archived_reason' => $asset['archived_reason'] ?? null,
        ]);
        $archivedAt = Util::toDbDatetime($row['archived_at']);
        $now = Util::nowUtc();

        $db = Db::get();
        $db->beginTransaction();
        try {
            if ($existing) {
                Db::run(
                    'UPDATE assets SET asset_number = ?, serial_number = ?, item_name = ?, item_type = ?, brand = ?, model = ?,
                        mac_address = ?, ip_address = ?, switch_port = ?, network_patch_number = ?, site_id = ?, building_id = ?,
                        room_id = ?, location_in_room = ?, patching_details = ?, status = ?, notes = ?, archived_at = ?,
                        archived_by = ?, archived_reason = ?, updated_at = ?
                     WHERE id = ?',
                    [
                        $row['asset_number'], $row['serial_number'], $row['item_name'], $row['item_type'], $row['brand'], $row['model'],
                        $row['mac_address'], $row['ip_address'], $row['switch_port'], $row['network_patch_number'], $siteId, $buildingId,
                        $roomId, $row['location_in_room'], $row['patching_details'], $status, $row['notes'], $archivedAt,
                        $row['archived_by'], $row['archived_reason'], $now,
                        $assetId,
                    ]
                );
            } else {
                Db::run(
                    'INSERT INTO assets (id, workspace_id, asset_number, serial_number, item_name, item_type, brand, model,
                        mac_address, ip_address, switch_port, network_patch_number, site_id, building_id, room_id,
                        location_in_room, patching_details, status, notes, archived_at, archived_by, archived_reason,
                        created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $assetId, $workspaceId, $row['asset_number'], $row['serial_number'], $row['item_name'], $row['item_type'],
                        $row['brand'], $row['model'], $row['mac_address'], $row['ip_address'], $row['switch_port'],
                        $row['network_patch_number'], $siteId, $buildingId, $roomId, $row['location_in_room'],
                        $row['patching_details'], $status, $row['notes'], $archivedAt, $row['archived_by'], $row['archived_reason'],
                        $now, $now,
                    ]
                );
            }

            // Log row: identical wording/logic to saveAssetToSupabase.
            $previousLocation = ($existing && !empty($existing['location_in_room'])) ? $existing['location_in_room'] : 'New asset';
            $newLocation = (string)($asset['location_in_room'] ?? '');
            Db::run(
                'INSERT INTO asset_logs (id, asset_id, action_type, previous_location, new_location, notes, user_name, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    Util::uuid4(), $assetId, $action, $previousLocation, $newLocation,
                    $existing ? 'Asset record updated.' : 'Asset created from add asset form.',
                    Auth::displayNameFor($user), $now,
                ]
            );

            if ($photoUrl !== '') {
                Db::run(
                    'INSERT INTO asset_photos (id, asset_id, photo_url, caption, created_at) VALUES (?, ?, ?, ?, ?)',
                    [Util::uuid4(), $assetId, $photoUrl, 'Uploaded photo', $now]
                );
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Util::ok(['id' => $assetId]);
    }

    public static function delete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No asset selected to delete.', 400);
        }
        $asset = self::assetById($id);
        if (!$asset || !Access::canDeleteAssets(Access::effectiveSiteRole($user['id'], $asset['site_id']))) {
            throw new ApiError('You do not have permission to delete this asset, or it no longer exists.', 403);
        }
        $db = Db::get();
        $db->beginTransaction();
        try {
            Db::run('DELETE FROM asset_logs WHERE asset_id = ?', [$id]);
            Db::run('DELETE FROM asset_photos WHERE asset_id = ?', [$id]);
            $stmt = Db::run('DELETE FROM assets WHERE id = ?', [$id]);
            if ($stmt->rowCount() !== 1) {
                $db->rollBack();
                throw new ApiError('You do not have permission to delete this asset, or it no longer exists.', 403);
            }
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
        Util::ok();
    }

    public static function archive(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No asset selected to archive.', 400);
        }
        $asset = self::assetById($id);
        if (!$asset) {
            throw new ApiError('Asset no longer exists.', 404);
        }
        if (!Access::canDeleteAssets(Access::effectiveSiteRole($user['id'], $asset['site_id']))) {
            throw new ApiError('You do not have permission to archive this asset.', 403);
        }
        $now = Util::nowUtc();
        Db::run(
            'UPDATE assets SET archived_at = ?, archived_by = ?, archived_reason = ?, updated_at = ? WHERE id = ?',
            [$now, $user['id'], 'Archived by admin.', $now, $id]
        );
        Db::run(
            'INSERT INTO asset_logs (id, asset_id, action_type, previous_location, new_location, notes, user_name, created_at)
             VALUES (?, ?, "Archived", ?, "Archived", ?, ?, ?)',
            [
                Util::uuid4(), $id, Util::s($asset['location_in_room']),
                'Asset archived. It is hidden from active searches but can be restored by an admin.',
                Auth::displayNameFor($user), $now,
            ]
        );
        Util::ok();
    }

    public static function restore(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('No asset selected to restore.', 400);
        }
        $asset = self::assetById($id);
        if (!$asset) {
            throw new ApiError('Asset no longer exists.', 404);
        }
        if (!Access::canDeleteAssets(Access::effectiveSiteRole($user['id'], $asset['site_id']))) {
            throw new ApiError('You do not have permission to restore this asset.', 403);
        }
        $now = Util::nowUtc();
        Db::run(
            'UPDATE assets SET archived_at = NULL, archived_by = NULL, archived_reason = NULL, updated_at = ? WHERE id = ?',
            [$now, $id]
        );
        Db::run(
            'INSERT INTO asset_logs (id, asset_id, action_type, previous_location, new_location, notes, user_name, created_at)
             VALUES (?, ?, "Restored", "Archived", ?, ?, ?, ?)',
            [
                Util::uuid4(), $id, Util::s($asset['location_in_room']),
                'Asset restored to the active register.',
                Auth::displayNameFor($user), $now,
            ]
        );
        Util::ok();
    }

    public static function photoDelete(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $id = trim((string)($body['id'] ?? ''));
        $photo = $id !== '' ? Db::one('SELECT p.id, a.site_id FROM asset_photos p JOIN assets a ON a.id = p.asset_id WHERE p.id = ?', [$id]) : null;
        if (!$photo || !Access::canDeleteAssets(Access::effectiveSiteRole($user['id'], $photo['site_id']))) {
            throw new ApiError('You do not have permission to delete this photo, or it no longer exists.', 403);
        }
        $stmt = Db::run('DELETE FROM asset_photos WHERE id = ?', [$id]);
        if ($stmt->rowCount() !== 1) {
            throw new ApiError('You do not have permission to delete this photo, or it no longer exists.', 403);
        }
        Util::ok();
    }
}
