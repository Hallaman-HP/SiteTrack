<?php
/**
 * SiteTrack: Supabase → MySQL import (step 2 of the migration).
 *
 * Usage (CLI only):
 *   php import_from_supabase.php /path/to/export
 *
 * Reads the CSV files produced by docs/supabase_export_queries.sql from the
 * export directory and imports them into the MySQL database configured in
 * server/.env (same file the API uses). Idempotent: every insert is
 * INSERT ... ON DUPLICATE KEY UPDATE, so the script can be re-run safely.
 *
 * Expected files (users.csv is required, everything else optional):
 *   users.csv, profiles.csv, workspaces.csv, workspace_members.csv,
 *   sites.csv, site_members.csv, invites.csv, buildings.csv, rooms.csv,
 *   assets.csv, asset_photos.csv, asset_logs.csv
 *   avatars/  (files named as profiles.avatar_path; copied to UPLOADS_DIR/avatars/)
 *
 * Notes:
 * - Supabase bcrypt hashes ($2a$...) are stored as-is into users.password_hash;
 *   PHP password_verify() accepts them, so passwords carry over.
 * - Timestamps are converted from Supabase RFC-3339 (e.g. "2026-05-01
 *   03:22:11.123456+00") to MySQL DATETIME in UTC.
 * - Rows whose parent is missing (FK violation) are counted as "skipped"
 *   instead of aborting the run.
 * - invites: Supabase does not export token_hash/expires_at, so a fresh random
 *   token hash is generated (the raw token is discarded) and expiry is set to
 *   now + 14 days. Old invite links from Supabase emails will NOT work —
 *   re-send pending invites after migration.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

date_default_timezone_set('UTC');

require __DIR__ . '/../api/src/Env.php';
Env::load(__DIR__ . '/../.env');

const PHOTO_BATCH = 200;
const MAX_ERR_SAMPLES = 5;

/* ------------------------------ Arguments ------------------------------ */

$exportDir = isset($argv[1]) ? rtrim($argv[1], '/') : '';
if ($exportDir === '' || !is_dir($exportDir)) {
    fwrite(STDERR, "Usage: php import_from_supabase.php /path/to/export\n");
    fwrite(STDERR, "The path must be the directory containing users.csv etc.\n");
    exit(1);
}
if (!is_file($exportDir . '/users.csv')) {
    fwrite(STDERR, "ERROR: {$exportDir}/users.csv not found. users.csv is required (see docs/supabase_export_queries.sql).\n");
    exit(1);
}

/* ------------------------------ Database ------------------------------- */

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', Env::get('DB_HOST', 'localhost'), Env::get('DB_NAME')),
        Env::get('DB_USER'),
        Env::get('DB_PASS'),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    $pdo->exec("SET time_zone = '+00:00'");
} catch (PDOException $e) {
    fwrite(STDERR, 'ERROR: cannot connect to the database (check server/.env): ' . $e->getMessage() . "\n");
    exit(1);
}

/* ------------------------------ Helpers -------------------------------- */

/**
 * Supabase timestamp ("2026-05-01 03:22:11.123456+00", RFC-3339, or ISO-8601)
 * -> MySQL DATETIME string in UTC ('Y-m-d H:i:s'). Empty string -> NULL.
 */
function toDbDatetime(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    try {
        return (new DateTimeImmutable($value))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s');
    } catch (Exception $e) {
        throw new RuntimeException("Unparseable timestamp '{$value}'");
    }
}

/**
 * Empty/whitespace-only string -> NULL, otherwise the value.
 * Also treats the literal strings 'null', 'NULL', and 'undefined' as NULL —
 * Supabase CSV exports serialise missing values as the four-character token
 * "null", and JS-side exports sometimes serialise them as "undefined".
 * Without this normalisation those strings land in MySQL as varchars and
 * appear literally in the UI (e.g. dashboard cards showing "null").
 */
function emptyToNull(?string $value): ?string
{
    if ($value === null) {
        return null;
    }
    $trimmed = trim($value);
    if ($trimmed === '' || $trimmed === 'null' || $trimmed === 'NULL' || $trimmed === 'undefined') {
        return null;
    }
    return $value;
}

/**
 * Stream a CSV file with a header row. Yields associative rows keyed by
 * header name. Never loads the whole file (safe for huge asset_photos.csv).
 *
 * @return Generator<int, array<string, string>>
 */
function csvRows(string $path): Generator
{
    $fh = fopen($path, 'r');
    if ($fh === false) {
        throw new RuntimeException("Cannot open {$path}");
    }
    try {
        $header = fgetcsv($fh, 0, ',', '"', '');
        if ($header === false) {
            return; // empty file
        }
        // Strip a UTF-8 BOM from the first header cell if present.
        if (isset($header[0])) {
            $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string)$header[0]);
        }
        $header = array_map(static fn($h) => trim((string)$h), $header);
        $lineNo = 1;
        while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            $lineNo++;
            if ($row === [null] || $row === ['']) {
                continue; // blank line
            }
            if (count($row) !== count($header)) {
                throw new RuntimeException("{$path} line {$lineNo}: expected " . count($header) . ' columns, got ' . count($row));
            }
            yield array_combine($header, array_map(static fn($v) => (string)$v, $row));
        }
    } finally {
        fclose($fh);
    }
}

/** Random 64-hex SHA-256 style hash for invite tokens (raw token discarded). */
function randomTokenHash(): string
{
    return hash('sha256', bin2hex(random_bytes(32)));
}

final class TableStats
{
    public int $imported = 0;
    public int $updated = 0;
    public int $skipped = 0;
    /** @var string[] */
    public array $errors = [];

    public function recordError(string $msg): void
    {
        $this->skipped++;
        if (count($this->errors) < MAX_ERR_SAMPLES) {
            $this->errors[] = $msg;
        }
    }
}

/** True when the PDOException is a missing-parent (FK) violation. */
function isFkViolation(PDOException $e): bool
{
    return isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1452;
}

/**
 * Execute one prepared upsert and classify the result.
 * rowCount(): 1 = inserted, 2 = updated, 0 = identical row already present.
 */
function upsert(PDOStatement $stmt, array $params, TableStats $stats, string $rowLabel): void
{
    try {
        $stmt->execute($params);
        $count = $stmt->rowCount();
        if ($count === 2) {
            $stats->updated++;
        } else {
            $stats->imported++; // 1 (insert) or 0 (unchanged re-run) both count as present
        }
    } catch (PDOException $e) {
        $kind = isFkViolation($e) ? 'missing parent row (orphan)' : $e->getMessage();
        $stats->recordError("{$rowLabel}: {$kind}");
    }
}

/**
 * Generic table importer: streams a CSV, maps each row to SQL params inside
 * one transaction. $mapper returns [paramArray, rowLabel] or null to skip.
 */
function importTable(
    PDO $pdo,
    string $table,
    string $csvPath,
    string $sql,
    callable $mapper,
    array &$summary,
    bool $required = false
): void {
    $stats = new TableStats();
    if (!is_file($csvPath)) {
        if ($required) {
            throw new RuntimeException("Required file missing: {$csvPath}");
        }
        echo "  ! {$table}: " . basename($csvPath) . " not found — skipping this table\n";
        $summary[$table] = null;
        return;
    }
    echo "  - {$table}: importing from " . basename($csvPath) . "\n";
    $stmt = $pdo->prepare($sql);
    $pdo->beginTransaction();
    try {
        foreach (csvRows($csvPath) as $row) {
            try {
                $mapped = $mapper($row, $stats);
            } catch (RuntimeException $e) {
                $stats->recordError(($row['id'] ?? '?') . ': ' . $e->getMessage());
                continue;
            }
            if ($mapped === null) {
                continue;
            }
            [$params, $label] = $mapped;
            upsert($stmt, $params, $stats, $label);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw new RuntimeException("{$table}: " . $e->getMessage(), 0, $e);
    }
    $summary[$table] = $stats;
}

/* ------------------------------ Import --------------------------------- */

echo "SiteTrack Supabase import\n";
echo "  export dir : {$exportDir}\n";
echo '  database   : ' . Env::get('DB_NAME') . ' @ ' . Env::get('DB_HOST', 'localhost') . "\n\n";

/** @var array<string, TableStats|null> $summary */
$summary = [];
$exitCode = 0;

try {
    /* ---- users (users.csv merged with profiles.csv) ---- */

    // profiles.csv is small: load into memory keyed by user id.
    $profiles = [];
    $profilesPath = $exportDir . '/profiles.csv';
    if (is_file($profilesPath)) {
        foreach (csvRows($profilesPath) as $p) {
            $profiles[$p['id']] = $p;
        }
    } else {
        echo "  ! profiles.csv not found — users will be imported without profile fields\n";
    }

    $seenUserIds = [];
    importTable(
        $pdo,
        'users',
        $exportDir . '/users.csv',
        'INSERT INTO users
            (id, email, password_hash, email_verified_at,
             first_name, last_name, display_name, avatar_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            password_hash = VALUES(password_hash),
            email_verified_at = VALUES(email_verified_at),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            display_name = VALUES(display_name),
            avatar_path = VALUES(avatar_path)',
        function (array $row, TableStats $stats) use ($profiles, &$seenUserIds): ?array {
            $hash = trim($row['encrypted_password'] ?? '');
            if ($hash === '') {
                // e.g. OAuth-only auth.users rows — cannot log in with a password.
                $stats->recordError("user {$row['email']}: empty encrypted_password — skipped (no password to migrate)");
                return null;
            }
            $p = $profiles[$row['id']] ?? [];
            $seenUserIds[$row['id']] = true;
            return [[
                $row['id'],
                trim($row['email']),
                $hash, // Supabase bcrypt ($2a$) verifies with password_verify()
                toDbDatetime($row['email_confirmed_at'] ?? ''),
                emptyToNull($p['first_name'] ?? null),
                emptyToNull($p['last_name'] ?? null),
                emptyToNull($p['display_name'] ?? null),
                normalizeAvatarPath($p['avatar_path'] ?? null),
                toDbDatetime($row['created_at'] ?? '') ?? gmdate('Y-m-d H:i:s'),
            ], "user {$row['email']}"];
        },
        $summary,
        true
    );
    foreach (array_keys($profiles) as $pid) {
        if (!isset($seenUserIds[$pid])) {
            echo "  ! profiles.csv row {$pid} has no matching users.csv row — profile ignored\n";
        }
    }

    /* ---- workspaces ---- */

    importTable(
        $pdo,
        'workspaces',
        $exportDir . '/workspaces.csv',
        'INSERT INTO workspaces (id, name, join_code, created_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), join_code = VALUES(join_code)',
        fn(array $r): array => [[
            $r['id'], $r['name'], $r['join_code'],
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "workspace {$r['name']}"],
        $summary
    );

    /* ---- workspace_members ---- */

    importTable(
        $pdo,
        'workspace_members',
        $exportDir . '/workspace_members.csv',
        'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)',
        fn(array $r): array => [[
            $r['id'], $r['workspace_id'], $r['user_id'], $r['role'],
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "workspace_member {$r['id']}"],
        $summary
    );

    /* ---- sites ---- */

    importTable(
        $pdo,
        'sites',
        $exportDir . '/sites.csv',
        'INSERT INTO sites (id, workspace_id, name, address, client_name, job_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name), address = VALUES(address),
            client_name = VALUES(client_name), job_number = VALUES(job_number)',
        fn(array $r): array => [[
            $r['id'], $r['workspace_id'], $r['name'],
            emptyToNull($r['address']), emptyToNull($r['client_name']), emptyToNull($r['job_number']),
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "site {$r['name']}"],
        $summary
    );

    /* ---- site_members ---- */

    importTable(
        $pdo,
        'site_members',
        $exportDir . '/site_members.csv',
        'INSERT INTO site_members (id, site_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)',
        fn(array $r): array => [[
            $r['id'], $r['site_id'], $r['user_id'], $r['role'],
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "site_member {$r['id']}"],
        $summary
    );

    /* ---- invites (pending only; fresh token hash, 14-day expiry) ---- */

    importTable(
        $pdo,
        'invites',
        $exportDir . '/invites.csv',
        'INSERT INTO invites (id, workspace_id, site_id, email, role, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            email = VALUES(email), role = VALUES(role), site_id = VALUES(site_id)',
        fn(array $r): array => [[
            $r['id'], $r['workspace_id'], emptyToNull($r['site_id']),
            $r['email'], $r['role'],
            randomTokenHash(),                       // raw token discarded — old links are dead
            gmdate('Y-m-d H:i:s', time() + 14 * 86400),
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "invite {$r['email']}"],
        $summary
    );

    /* ---- buildings ---- */

    importTable(
        $pdo,
        'buildings',
        $exportDir . '/buildings.csv',
        'INSERT INTO buildings (id, site_id, name, created_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)',
        fn(array $r): array => [[
            $r['id'], $r['site_id'], $r['name'],
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "building {$r['name']}"],
        $summary
    );

    /* ---- rooms ---- */

    importTable(
        $pdo,
        'rooms',
        $exportDir . '/rooms.csv',
        'INSERT INTO rooms (id, building_id, room_number, room_name, floor, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            room_number = VALUES(room_number), room_name = VALUES(room_name), floor = VALUES(floor)',
        fn(array $r): array => [[
            $r['id'], $r['building_id'], $r['room_number'],
            emptyToNull($r['room_name']), emptyToNull($r['floor']),
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "room {$r['room_number']}"],
        $summary
    );

    /* ---- assets ---- */

    importTable(
        $pdo,
        'assets',
        $exportDir . '/assets.csv',
        'INSERT INTO assets
            (id, workspace_id, asset_number, serial_number, item_name, item_type,
             brand, model, mac_address, ip_address, switch_port, network_patch_number,
             site_id, building_id, room_id, location_in_room, patching_details,
             status, notes, archived_at, archived_by, archived_reason,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            workspace_id = VALUES(workspace_id), asset_number = VALUES(asset_number),
            serial_number = VALUES(serial_number), item_name = VALUES(item_name),
            item_type = VALUES(item_type), brand = VALUES(brand), model = VALUES(model),
            mac_address = VALUES(mac_address), ip_address = VALUES(ip_address),
            switch_port = VALUES(switch_port), network_patch_number = VALUES(network_patch_number),
            site_id = VALUES(site_id), building_id = VALUES(building_id), room_id = VALUES(room_id),
            location_in_room = VALUES(location_in_room), patching_details = VALUES(patching_details),
            status = VALUES(status), notes = VALUES(notes),
            archived_at = VALUES(archived_at), archived_by = VALUES(archived_by),
            archived_reason = VALUES(archived_reason), updated_at = VALUES(updated_at)',
        fn(array $r): array => [[
            $r['id'], $r['workspace_id'], $r['asset_number'],
            emptyToNull($r['serial_number']), $r['item_name'], emptyToNull($r['item_type']),
            emptyToNull($r['brand']), emptyToNull($r['model']),
            emptyToNull($r['mac_address']), emptyToNull($r['ip_address']),
            emptyToNull($r['switch_port']), emptyToNull($r['network_patch_number']),
            $r['site_id'], emptyToNull($r['building_id']), emptyToNull($r['room_id']),
            emptyToNull($r['location_in_room']), emptyToNull($r['patching_details']),
            $r['status'], emptyToNull($r['notes']),
            toDbDatetime($r['archived_at']), emptyToNull($r['archived_by']),
            emptyToNull($r['archived_reason']),
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
            toDbDatetime($r['updated_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "asset {$r['asset_number']}"],
        $summary
    );

    /* ---- asset_photos (large: streamed, committed every 200 rows) ---- */

    $photosPath = $exportDir . '/asset_photos.csv';
    if (!is_file($photosPath)) {
        echo "  ! asset_photos: asset_photos.csv not found — skipping this table\n";
        $summary['asset_photos'] = null;
    } else {
        echo "  - asset_photos: importing from asset_photos.csv (batches of " . PHOTO_BATCH . ")\n";
        $stats = new TableStats();
        $stmt = $pdo->prepare(
            'INSERT INTO asset_photos (id, asset_id, photo_url, caption, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE photo_url = VALUES(photo_url), caption = VALUES(caption)'
        );
        $inBatch = 0;
        $pdo->beginTransaction();
        try {
            foreach (csvRows($photosPath) as $r) {
                upsert($stmt, [
                    $r['id'], $r['asset_id'], $r['photo_url'],
                    emptyToNull($r['caption']),
                    toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
                ], $stats, "photo {$r['id']}");
                if (++$inBatch >= PHOTO_BATCH) {
                    $pdo->commit();
                    $pdo->beginTransaction();
                    $inBatch = 0;
                    echo "      … " . ($stats->imported + $stats->updated + $stats->skipped) . " photo rows processed\n";
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw new RuntimeException('asset_photos: ' . $e->getMessage(), 0, $e);
        }
        $summary['asset_photos'] = $stats;
    }

    /* ---- asset_logs ---- */

    importTable(
        $pdo,
        'asset_logs',
        $exportDir . '/asset_logs.csv',
        'INSERT INTO asset_logs
            (id, asset_id, action_type, previous_location, new_location, notes, user_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            action_type = VALUES(action_type), previous_location = VALUES(previous_location),
            new_location = VALUES(new_location), notes = VALUES(notes), user_name = VALUES(user_name)',
        fn(array $r): array => [[
            $r['id'], $r['asset_id'], $r['action_type'],
            emptyToNull($r['previous_location']), emptyToNull($r['new_location']),
            emptyToNull($r['notes']), emptyToNull($r['user_name']),
            toDbDatetime($r['created_at']) ?? gmdate('Y-m-d H:i:s'),
        ], "log {$r['id']}"],
        $summary
    );

    /* ---- avatar files ---- */

    importAvatars($pdo, $exportDir, $profiles);
} catch (Throwable $e) {
    fwrite(STDERR, "\nFATAL: " . $e->getMessage() . "\n");
    $exitCode = 1;
}

/* ------------------------------ Avatars -------------------------------- */

/**
 * Supabase avatar_path (e.g. "abc.jpg" or "avatars/abc.jpg") -> the value the
 * PHP API expects in users.avatar_path ("avatars/<name>", served from
 * UPLOADS_DIR/avatars/<name>). Empty -> NULL.
 */
function normalizeAvatarPath(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    $name = preg_replace('#^avatars/#', '', $value);
    return 'avatars/' . $name;
}

/** Copy avatar files from <exportdir>/avatars/ into UPLOADS_DIR/avatars/. */
function importAvatars(PDO $pdo, string $exportDir, array $profiles): void
{
    $withAvatars = array_filter($profiles, static fn($p) => trim((string)($p['avatar_path'] ?? '')) !== '');
    if (!$withAvatars) {
        echo "  - avatars: no avatar_path values in profiles.csv — nothing to copy\n";
        return;
    }
    $uploadsDir = rtrim(Env::get('UPLOADS_DIR'), '/');
    if ($uploadsDir === '') {
        echo "  ! avatars: UPLOADS_DIR not set in server/.env — avatar files NOT copied\n";
        return;
    }
    $destDir = $uploadsDir . '/avatars';
    if (!is_dir($destDir) && !@mkdir($destDir, 0755, true)) {
        echo "  ! avatars: cannot create {$destDir} — avatar files NOT copied\n";
        return;
    }
    $copied = 0;
    $missing = 0;
    foreach ($withAvatars as $p) {
        $name = preg_replace('#^avatars/#', '', trim((string)$p['avatar_path']));
        $src = $exportDir . '/avatars/' . $name;
        if (!is_file($src)) {
            echo "  ! avatars: missing file {$src} (user {$p['id']})\n";
            $missing++;
            continue;
        }
        $dest = $destDir . '/' . $name;
        $destParent = dirname($dest);
        if (!is_dir($destParent) && !@mkdir($destParent, 0755, true)) {
            echo "  ! avatars: cannot create {$destParent} — skipped {$name}\n";
            $missing++;
            continue;
        }
        if (@copy($src, $dest)) {
            $copied++;
        } else {
            echo "  ! avatars: failed to copy {$src} -> {$dest}\n";
            $missing++;
        }
    }
    echo "  - avatars: {$copied} copied, {$missing} missing/failed (dest {$destDir})\n";
}

/* ------------------------------ Summary -------------------------------- */

echo "\n==== Import summary ====\n";
printf("%-20s %10s %10s %10s\n", 'table', 'imported', 'updated', 'skipped');
foreach ($summary as $table => $stats) {
    if ($stats === null) {
        printf("%-20s %32s\n", $table, '(file missing — skipped)');
        continue;
    }
    printf("%-20s %10d %10d %10d\n", $table, $stats->imported, $stats->updated, $stats->skipped);
    foreach ($stats->errors as $err) {
        echo "    ! {$err}\n";
    }
    if ($stats->skipped > count($stats->errors)) {
        echo '    ! (' . ($stats->skipped - count($stats->errors)) . " more skipped rows not shown)\n";
    }
}
echo "\nSkipped rows are usually orphans (parent row missing in the export) or\n";
echo "invalid enum values — review the messages above.\n";
echo "Reminder: sessions, trusted devices and pending magic-link/reset tokens are\n";
echo "not migrated; migrated pending invites have new (unsent) tokens — re-send them.\n";

if ($exitCode !== 0) {
    fwrite(STDERR, "\nImport FAILED — fix the error above and re-run (the script is idempotent).\n");
}
exit($exitCode);
