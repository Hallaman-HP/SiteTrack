<?php
/**
 * SiteTrack API integration tests (CLI).
 * Usage: php server/tests/api_test.php   (expects php -S 127.0.0.1:8080 dev-router.php running)
 * Prints PASS/FAIL per case and exits non-zero on any failure.
 */

declare(strict_types=1);

const BASE = 'http://127.0.0.1:8080/api';
const ENV_FILE = __DIR__ . '/../.env';
const UPLOADS = __DIR__ . '/../uploads-dev';

$GLOBALS['pass'] = 0;
$GLOBALS['fail'] = 0;

function check(string $name, bool $cond, string $detail = ''): void
{
    if ($cond) {
        $GLOBALS['pass']++;
        echo "PASS  $name\n";
    } else {
        $GLOBALS['fail']++;
        echo "FAIL  $name" . ($detail !== '' ? "  [$detail]" : '') . "\n";
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('mysql:host=127.0.0.1;dbname=sitetrack;charset=utf8mb4', 'sitetrack', 'sitetrack_dev', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function setEnvFile(int $requireVerify): void
{
    $env = <<<ENV
DB_HOST=127.0.0.1
DB_NAME=sitetrack
DB_USER=sitetrack
DB_PASS=sitetrack_dev
APP_URL=http://localhost:8080
UPLOADS_DIR=%UP%
MAIL_FROM_ADDRESS=no-reply@sitetrack.local
MAIL_FROM_NAME=SiteTrack
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SESSION_DAYS=30
TRUST_DAYS=7
REQUIRE_EMAIL_VERIFY=$requireVerify
REQUIRE_2FA=1

ENV;
    file_put_contents(ENV_FILE, str_replace('%UP%', realpath(dirname(ENV_FILE)) . '/uploads-dev', $env));
}

final class Client
{
    private array $cookies = [];

    public function hasCookie(string $name): bool
    {
        return isset($this->cookies[$name]);
    }

    public function clearCookie(string $name): void
    {
        unset($this->cookies[$name]);
    }

    public function request(string $method, string $path, $body = null, array $opts = []): array
    {
        $ch = curl_init(BASE . $path);
        $headers = [];
        if (!($opts['noCsrf'] ?? false)) {
            $headers[] = 'X-Requested-With: SiteTrack';
        }
        if ($this->cookies) {
            $pairs = [];
            foreach ($this->cookies as $k => $v) {
                $pairs[] = "$k=$v";
            }
            $headers[] = 'Cookie: ' . implode('; ', $pairs);
        }
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if (($opts['multipart'] ?? null) !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['multipart']);
        } elseif ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $respHeaders = [];
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$respHeaders) {
            $respHeaders[] = $line;
            return strlen($line);
        });
        $raw = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        foreach ($respHeaders as $line) {
            if (stripos($line, 'Set-Cookie:') !== 0) {
                continue;
            }
            $cookie = trim(substr($line, 11));
            $parts = explode(';', $cookie);
            [$name, $value] = array_pad(explode('=', trim($parts[0]), 2), 2, '');
            $expired = false;
            foreach ($parts as $attr) {
                $attr = trim($attr);
                if (stripos($attr, 'expires=') === 0 && strtotime(substr($attr, 8)) < time()) {
                    $expired = true;
                }
            }
            if ($expired || $value === '' || $value === 'deleted') {
                unset($this->cookies[$name]);
            } else {
                $this->cookies[$name] = $value;
            }
        }
        $json = json_decode((string)$raw, true);
        return ['status' => $status, 'json' => is_array($json) ? $json : null, 'raw' => (string)$raw, 'content_type' => $contentType];
    }

    public function get(string $path): array
    {
        return $this->request('GET', $path);
    }

    public function post(string $path, array $body = [], array $opts = []): array
    {
        return $this->request('POST', $path, $body, $opts);
    }
}

/** Latest queued email for an address. */
function lastEmail(string $to): ?array
{
    $stmt = db()->prepare('SELECT * FROM notifications WHERE to_email = ? ORDER BY created_at DESC LIMIT 1');
    $stmt->execute([$to]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function clearEmails(string $to): void
{
    $stmt = db()->prepare('DELETE FROM notifications WHERE to_email = ?');
    $stmt->execute([$to]);
}

function tokenFromEmail(string $to, string $param = 'token'): ?string
{
    $email = lastEmail($to);
    if (!$email || !preg_match('/' . $param . '=([a-f0-9]{64})/', $email['body_html'], $m)) {
        return null;
    }
    return $m[1];
}

function codeFromEmail(string $to): ?string
{
    $email = lastEmail($to);
    if (!$email || !preg_match('/>(\d{6})</', $email['body_html'], $m)) {
        return null;
    }
    return $m[1];
}

/* ======================= Reset database ======================= */

db()->exec('SET FOREIGN_KEY_CHECKS=0');
foreach (['users', 'sessions', 'trusted_devices', 'auth_tokens', 'rate_limits', 'workspaces', 'workspace_members',
          'site_members', 'invites', 'sites', 'buildings', 'rooms', 'assets', 'asset_photos', 'asset_logs',
          'notifications', 'cron_runs', 'cron_locks'] as $t) {
    db()->exec("TRUNCATE TABLE $t");
}
db()->exec('SET FOREIGN_KEY_CHECKS=1');
array_map('unlink', glob(UPLOADS . '/avatars/*') ?: []);

$alice = new Client();
$aliceEmail = 'alice@test.local';

/* ======================= Phase A: verify + 2FA on ======================= */
setEnvFile(1);

$r = $alice->get('/health');
check('health endpoint', ($r['json']['ok'] ?? false) === true && ($r['json']['db'] ?? false) === true, $r['raw']);

$r = $alice->post('/auth/signup', ['email' => $aliceEmail, 'password' => 'password123', 'first_name' => 'Alice', 'last_name' => 'Admin'], ['noCsrf' => true]);
check('CSRF header required on non-GET', $r['status'] === 403 && ($r['json']['ok'] ?? true) === false, $r['raw']);

$r = $alice->post('/auth/signup', ['email' => $aliceEmail, 'password' => 'password123', 'first_name' => 'Alice', 'last_name' => 'Admin']);
check('signup queues verification email', ($r['json']['verify_email_sent'] ?? false) === true, $r['raw']);
check('verification email in notifications', tokenFromEmail($aliceEmail) !== null);

$r = $alice->post('/auth/login', ['email' => $aliceEmail, 'password' => 'password123']);
check('login blocked before email verification', $r['status'] === 403 && str_contains($r['json']['error'] ?? '', 'verify'), $r['raw']);

$verifyToken = tokenFromEmail($aliceEmail);
$r = $alice->post('/auth/verify-email', ['token' => $verifyToken]);
check('verify-email logs user in', ($r['json']['user']['email'] ?? '') === $aliceEmail, $r['raw']);
$aliceId = $r['json']['user']['id'] ?? '';

$r = $alice->post('/auth/verify-email', ['token' => $verifyToken]);
check('verify token is single-use', $r['status'] === 400, $r['raw']);

$r = $alice->get('/auth/session');
check('session cookie works', ($r['json']['user']['id'] ?? '') === $aliceId, $r['raw']);

$r = $alice->post('/auth/logout');
$r = $alice->get('/auth/session');
check('logout clears session', array_key_exists('user', $r['json'] ?? []) && $r['json']['user'] === null, $r['raw']);

/* --- 2FA login flow --- */
clearEmails($aliceEmail);
$r = $alice->post('/auth/login', ['email' => $aliceEmail, 'password' => 'wrong-password']);
check('login rejects bad password', $r['status'] === 401, $r['raw']);

$r = $alice->post('/auth/login', ['email' => $aliceEmail, 'password' => 'password123']);
$challenge = $r['json']['challenge'] ?? '';
check('login requires 2FA without trust cookie', ($r['json']['requires_2fa'] ?? false) === true && strlen($challenge) === 64, $r['raw']);
$code = codeFromEmail($aliceEmail);
check('2FA code emailed (6 digits)', $code !== null && preg_match('/^\d{6}$/', (string)$code) === 1);

$wrong = $code === '000000' ? '111111' : '000000';
$r = $alice->post('/auth/2fa/verify', ['challenge' => $challenge, 'code' => $wrong, 'trust_device' => false]);
check('2FA rejects wrong code', $r['status'] === 400, $r['raw']);

$r = $alice->post('/auth/2fa/verify', ['challenge' => $challenge, 'code' => $code, 'trust_device' => true]);
check('2FA verify with correct code logs in', ($r['json']['user']['id'] ?? '') === $aliceId, $r['raw']);
check('trust cookie set when trust_device=true', $alice->hasCookie('st_trust'));

$r = $alice->post('/auth/2fa/verify', ['challenge' => $challenge, 'code' => $code, 'trust_device' => false]);
check('2FA challenge is single-use', $r['status'] === 400, $r['raw']);

/* --- trusted device skips 2FA --- */
$alice->post('/auth/logout');
$r = $alice->post('/auth/login', ['email' => $aliceEmail, 'password' => 'password123']);
check('trusted device skips 2FA on second login', ($r['json']['user']['id'] ?? '') === $aliceId && !isset($r['json']['requires_2fa']), $r['raw']);

/* --- magic link flow --- */
clearEmails($aliceEmail);
$magic = new Client();
$r = $magic->post('/auth/magic-link', ['email' => $aliceEmail]);
check('magic-link always returns ok', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $magic->post('/auth/magic-link', ['email' => 'nobody@test.local']);
check('magic-link ok for unknown email (no enumeration)', ($r['json']['ok'] ?? false) === true, $r['raw']);
$magicToken = tokenFromEmail($aliceEmail);
check('magic link email queued', $magicToken !== null);
$r = $magic->post('/auth/magic-verify', ['token' => $magicToken]);
check('magic-verify logs in (bypasses 2FA)', ($r['json']['user']['id'] ?? '') === $aliceId, $r['raw']);
$r = $magic->post('/auth/magic-verify', ['token' => $magicToken]);
check('magic token is single-use', $r['status'] === 400, $r['raw']);

/* --- change password (invalidates other sessions) --- */
$r = $alice->post('/auth/change-password', ['current_password' => 'nope', 'new_password' => 'password456']);
check('change-password requires correct current password', $r['status'] === 403, $r['raw']);
$r = $alice->post('/auth/change-password', ['current_password' => 'password123', 'new_password' => 'password456']);
check('change-password succeeds', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $magic->get('/auth/session');
check('change-password invalidates other sessions', array_key_exists('user', $r['json'] ?? []) && $r['json']['user'] === null, $r['raw']);
$r = $alice->get('/auth/session');
check('change-password keeps current session', ($r['json']['user']['id'] ?? '') === $aliceId, $r['raw']);

/* --- rate limiting --- */
$rl = new Client();
$last = null;
for ($i = 0; $i < 11; $i++) {
    $last = $rl->post('/auth/login', ['email' => 'ratelimit@test.local', 'password' => 'x']);
}
check('login rate limited after 10/min per IP+email', $last['status'] === 429, $last['raw']);

/* ======================= Phase B: verify off ======================= */
setEnvFile(0);

$bob = new Client();
$r = $bob->post('/auth/signup', ['email' => 'bob@test.local', 'password' => 'password123', 'first_name' => 'Bob', 'last_name' => 'Builder']);
check('signup logs straight in when verify disabled', ($r['json']['user']['email'] ?? '') === 'bob@test.local', $r['raw']);
$bobId = $r['json']['user']['id'] ?? '';

$carol = new Client();
$r = $carol->post('/auth/signup', ['email' => 'carol@test.local', 'password' => 'password123', 'first_name' => 'Carol', 'last_name' => 'Tech']);
$carolId = $r['json']['user']['id'] ?? '';

$r = $carol->post('/auth/signup', ['email' => 'carol@test.local', 'password' => 'password123']);
check('duplicate signup rejected', $r['status'] === 409, $r['raw']);

/* --- password reset flow --- */
$resetUser = new Client();
$resetUser->post('/auth/signup', ['email' => 'reset@test.local', 'password' => 'password123']);
$fresh = new Client();
$fresh->post('/auth/reset-request', ['email' => 'reset@test.local']);
$resetToken = tokenFromEmail('reset@test.local');
check('reset email queued', $resetToken !== null);
$r = $fresh->post('/auth/reset-confirm', ['token' => $resetToken, 'new_password' => 'newpassword789']);
check('reset-confirm logs in', ($r['json']['user']['email'] ?? '') === 'reset@test.local', $r['raw']);
$r = $resetUser->get('/auth/session');
check('reset kills pre-existing sessions', array_key_exists('user', $r['json'] ?? []) && $r['json']['user'] === null, $r['raw']);
$r = (new Client())->post('/auth/login', ['email' => 'reset@test.local', 'password' => 'newpassword789']);
check('login works with reset password', ($r['json']['requires_2fa'] ?? false) === true || isset($r['json']['user']), $r['raw']);

/* ======================= Workspaces ======================= */

$r = $alice->post('/workspaces', ['name' => 'Alpha Corp']);
$wsId = $r['json']['workspace']['id'] ?? '';
$joinCode = $r['json']['workspace']['join_code'] ?? '';
check('workspace created with 8-hex-upper join code', $wsId !== '' && preg_match('/^[0-9A-F]{8}$/', $joinCode) === 1, $r['raw']);

$r = $alice->get('/gate');
check('gate: admin can add assets', ($r['json']['hasWorkspace'] ?? false) === true && ($r['json']['canAddAssets'] ?? false) === true, $r['raw']);
$r = $bob->get('/gate');
check('gate: no workspace yet for bob', ($r['json']['hasWorkspace'] ?? true) === false && ($r['json']['canAddAssets'] ?? true) === false, $r['raw']);

$r = $bob->post('/workspaces/join', ['code' => 'ZZZZZZZZ']);
check('join with bad code rejected', $r['status'] === 404, $r['raw']);
$r = $bob->post('/workspaces/join', ['code' => strtolower($joinCode)]);
check('join by code (case-insensitive)', ($r['json']['workspace_id'] ?? '') === $wsId, $r['raw']);
$r = $bob->get('/gate');
check('gate: member without site role cannot add assets', ($r['json']['hasWorkspace'] ?? false) === true && ($r['json']['canAddAssets'] ?? true) === false, $r['raw']);

$r = $bob->post('/workspaces/regenerate-code', ['workspace_id' => $wsId]);
check('regenerate-code denied for member', $r['status'] === 403, $r['raw']);
$r = $alice->post('/workspaces/regenerate-code', ['workspace_id' => $wsId]);
$joinCode = $r['json']['join_code'] ?? $joinCode;
check('regenerate-code works for admin', preg_match('/^[0-9A-F]{8}$/', $r['json']['join_code'] ?? '') === 1, $r['raw']);

/* ======================= Sites / buildings / rooms ======================= */

$r = $bob->post('/sites/upsert', ['site' => ['name' => 'Bob Site'], 'workspace_id' => $wsId]);
check('site create denied for non-admin', $r['status'] === 403, $r['raw']);

$r = $alice->post('/sites/upsert', ['site' => ['name' => 'Site One', 'address' => '1 Main St', 'client_name' => 'ACME', 'job_number' => 'J-100'], 'workspace_id' => $wsId]);
$site1 = $r['json']['site']['id'] ?? '';
check('site upsert (create)', $site1 !== '' && ($r['json']['site']['address'] ?? '') === '1 Main St', $r['raw']);

$r = $alice->post('/sites/upsert', ['site' => ['id' => $site1, 'name' => 'Site One Renamed', 'address' => '1 Main St', 'client_name' => 'ACME', 'job_number' => 'J-100'], 'workspace_id' => $wsId]);
check('site upsert (edit)', ($r['json']['site']['name'] ?? '') === 'Site One Renamed', $r['raw']);

$r = $alice->post('/sites/upsert', ['site' => ['name' => 'Site Two'], 'workspace_id' => $wsId]);
$site2 = $r['json']['site']['id'] ?? '';

$r = $alice->post('/buildings/upsert', ['building' => ['site_id' => $site1, 'name' => 'Block A']]);
$building1 = $r['json']['building']['id'] ?? '';
check('building upsert', $building1 !== '', $r['raw']);
$r = $bob->post('/buildings/upsert', ['building' => ['site_id' => $site1, 'name' => 'Bob Block']]);
check('building upsert denied for non-member of site', $r['status'] === 403, $r['raw']);

$r = $alice->post('/rooms/upsert', ['room' => ['building_id' => $building1, 'room_number' => '101', 'room_name' => 'Comms', 'floor' => '1']]);
$room1 = $r['json']['room']['id'] ?? '';
check('room upsert', $room1 !== '' && ($r['json']['room']['room_name'] ?? '') === 'Comms', $r['raw']);

$r = $alice->post('/buildings/upsert', ['building' => ['site_id' => $site2, 'name' => 'Block B']]);
$building2 = $r['json']['building']['id'] ?? '';
$r = $alice->post('/rooms/upsert', ['room' => ['building_id' => $building2, 'room_number' => '201']]);
$room2 = $r['json']['room']['id'] ?? '';

// temp building+room delete round-trip
$r = $alice->post('/buildings/upsert', ['building' => ['site_id' => $site1, 'name' => 'Temp Block']]);
$tmpB = $r['json']['building']['id'] ?? '';
$r = $alice->post('/rooms/upsert', ['room' => ['building_id' => $tmpB, 'room_number' => 'T1']]);
$tmpR = $r['json']['room']['id'] ?? '';
$r = $alice->post('/rooms/delete', ['id' => $tmpR]);
check('room delete', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $alice->post('/rooms/delete', ['id' => $tmpR]);
check('room delete twice -> permission-style error', $r['status'] === 403 && str_contains($r['json']['error'] ?? '', 'You do not have permission'), $r['raw']);
$r = $alice->post('/buildings/delete', ['id' => $tmpB]);
check('building delete', ($r['json']['ok'] ?? false) === true, $r['raw']);

/* ======================= Assets ======================= */

$photoData = 'data:image/png;base64,' . base64_encode('fakepngbytes');
$r = $alice->post('/assets/save', ['asset' => ['asset_number' => '', 'item_name' => 'X', 'site_id' => $site1, 'building_id' => $building1, 'room_id' => $room1]]);
check('asset save validates required fields', $r['status'] === 400 && str_contains($r['json']['error'] ?? '', 'required'), $r['raw']);

$r = $alice->post('/assets/save', ['asset' => [
    'asset_number' => 'A-001', 'item_name' => 'Switch', 'item_type' => 'Network', 'brand' => 'Cisco', 'model' => '',
    'serial_number' => ' SN123 ', 'site_id' => $site1, 'building_id' => $building1, 'room_id' => $room1,
    'location_in_room' => 'Rack 1', 'status' => 'installed', 'notes' => '',
], 'photo_url' => $photoData]);
$asset1 = $r['json']['id'] ?? '';
check('asset save (create)', $asset1 !== '', $r['raw']);

$row = db()->query("SELECT * FROM assets WHERE id = " . db()->quote($asset1))->fetch();
check('asset normalisation: blank -> NULL, trim', $row && $row['model'] === null && $row['notes'] === null && $row['serial_number'] === 'SN123');

$log = db()->query("SELECT * FROM asset_logs WHERE asset_id = " . db()->quote($asset1) . " ORDER BY created_at ASC")->fetchAll();
check('create log row: Installed / New asset / create note / user name', count($log) === 1
    && $log[0]['action_type'] === 'Installed'
    && $log[0]['previous_location'] === 'New asset'
    && $log[0]['new_location'] === 'Rack 1'
    && $log[0]['notes'] === 'Asset created from add asset form.'
    && $log[0]['user_name'] === 'Alice Admin', json_encode($log));

$photos = db()->query("SELECT * FROM asset_photos WHERE asset_id = " . db()->quote($asset1))->fetchAll();
check('photo row inserted with caption', count($photos) === 1 && $photos[0]['photo_url'] === $photoData && $photos[0]['caption'] === 'Uploaded photo');

$r = $alice->post('/assets/save', ['asset' => [
    'id' => $asset1, 'asset_number' => 'A-001', 'item_name' => 'Switch', 'site_id' => $site1,
    'building_id' => $building1, 'room_id' => $room1, 'location_in_room' => 'Rack 2', 'status' => 'moved',
]]);
check('asset save (update)', ($r['json']['id'] ?? '') === $asset1, $r['raw']);
$log = db()->query("SELECT * FROM asset_logs WHERE asset_id = " . db()->quote($asset1) . " ORDER BY created_at ASC, notes ASC")->fetchAll();
$updateLog = null;
foreach ($log as $l) {
    if ($l['notes'] === 'Asset record updated.') {
        $updateLog = $l;
    }
}
check('update log row: Moved / previous location / update note', $updateLog !== null
    && $updateLog['action_type'] === 'Moved'
    && $updateLog['previous_location'] === 'Rack 1'
    && $updateLog['new_location'] === 'Rack 2', json_encode($log));

$r = $alice->post('/assets/save', ['asset' => [
    'asset_number' => 'A-001', 'item_name' => 'Dupe', 'site_id' => $site2, 'building_id' => $building2, 'room_id' => $room2,
]]);
check('duplicate asset_number rejected per workspace', $r['status'] === 409, $r['raw']);

$r = $alice->post('/assets/save', ['asset' => [
    'asset_number' => 'A-002', 'item_name' => 'Camera', 'site_id' => $site2, 'building_id' => $building2, 'room_id' => $room2,
    'location_in_room' => 'Ceiling', 'status' => 'awaiting_install',
]]);
$asset2 = $r['json']['id'] ?? '';
check('asset save on site2', $asset2 !== '', $r['raw']);

/* ======================= Store scoping ======================= */

$r = $alice->get('/store?workspace_id=' . $wsId);
$d = $r['json']['data'] ?? [];
$ws = $r['json']['workspace'] ?? [];
check('admin store: all sites + assets', count($d['sites'] ?? []) === 2 && count($d['assets'] ?? []) === 2, $r['raw']);
check('admin store: editable/manageable arrays empty', ($ws['editableSiteIds'] ?? null) === [] && ($ws['manageableSiteIds'] ?? null) === []);
check('admin store: join_code exposed to admin', ($ws['join_code'] ?? '') === $joinCode && (($r['json']['workspaces'][0]['join_code'] ?? '') === $joinCode));
check('admin store: photos + logs present', count($d['asset_photos'] ?? []) === 1 && count($d['asset_logs'] ?? []) >= 3);
$a1 = null;
foreach ($d['assets'] as $a) {
    if ($a['id'] === $asset1) {
        $a1 = $a;
    }
}
check('store row shape: nulls -> empty strings, ISO Z timestamps', $a1 !== null
    && $a1['model'] === '' && $a1['notes'] === '' && $a1['archived_at'] === ''
    && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $a1['created_at']) === 1, json_encode($a1));

$r = $bob->get('/store?workspace_id=' . $wsId);
$d = $r['json']['data'] ?? [];
$ws = $r['json']['workspace'] ?? [];
check('member store: no site_members -> empty data', ($d['sites'] ?? null) === [] && ($d['assets'] ?? null) === [], $r['raw']);
check('member store: join_code hidden', !isset($ws['join_code']) && !isset($r['json']['workspaces'][0]['join_code']));
check('member store: role=member', ($ws['role'] ?? '') === 'member');

/* --- give bob viewer on site1 --- */
$r = $alice->post('/members/site/upsert', ['site_id' => $site1, 'user_id' => $bobId, 'role' => 'viewer']);
check('site member upsert (viewer)', ($r['json']['ok'] ?? false) === true, $r['raw']);

$r = $bob->get('/store?workspace_id=' . $wsId);
$d = $r['json']['data'] ?? [];
$ws = $r['json']['workspace'] ?? [];
$bobAssetIds = array_column($d['assets'] ?? [], 'id');
check('viewer store: only site1 + its assets', count($d['sites'] ?? []) === 1 && ($d['sites'][0]['id'] ?? '') === $site1
    && $bobAssetIds === [$asset1], json_encode($d['sites']) . json_encode($bobAssetIds));
check('viewer store: cannot see other site assets', !in_array($asset2, $bobAssetIds, true));
check('viewer store: editableSiteIds empty, manageable empty', ($ws['editableSiteIds'] ?? null) === [] && ($ws['manageableSiteIds'] ?? null) === []);

$r = $bob->post('/assets/save', ['asset' => [
    'asset_number' => 'B-001', 'item_name' => 'Bob Device', 'site_id' => $site1, 'building_id' => $building1, 'room_id' => $room1,
]]);
check('viewer cannot save assets', $r['status'] === 403, $r['raw']);
$r = $bob->post('/assets/save', ['asset' => [
    'asset_number' => 'B-002', 'item_name' => 'Sneaky', 'site_id' => $site2, 'building_id' => $building2, 'room_id' => $room2,
]]);
check('non-member cannot save assets on other site', $r['status'] === 403, $r['raw']);
$r = $bob->post('/assets/delete', ['id' => $asset1]);
check('viewer cannot delete assets', $r['status'] === 403 && str_contains($r['json']['error'] ?? '', 'You do not have permission'), $r['raw']);
$r = $bob->post('/sites/delete', ['id' => $site1]);
check('viewer cannot delete site', $r['status'] === 403 && str_contains($r['json']['error'] ?? '', 'You do not have permission'), $r['raw']);

/* --- upgrade bob to technician --- */
$r = $alice->get('/members?workspace_id=' . $wsId);
$smId = '';
foreach (($r['json']['site_members'] ?? []) as $sm) {
    if ($sm['user_id'] === $bobId && $sm['site_id'] === $site1) {
        $smId = $sm['id'];
    }
}
check('members list includes site member row', $smId !== '', $r['raw']);
check('members list includes workspace members with display names', count($r['json']['workspace_members'] ?? []) === 2
    && in_array('Bob Builder', array_column($r['json']['workspace_members'], 'display_name'), true));

$r = $bob->get('/members?workspace_id=' . $wsId);
check('members list for plain member: no workspace members leaked', ($r['json']['workspace_members'] ?? null) === [] && ($r['json']['site_members'] ?? null) === [], $r['raw']);

$r = $bob->post('/members/site/update', ['id' => $smId, 'role' => 'manager']);
check('viewer cannot change site roles', $r['status'] === 403, $r['raw']);
$r = $alice->post('/members/site/update', ['id' => $smId, 'role' => 'technician']);
check('site member role update', ($r['json']['ok'] ?? false) === true, $r['raw']);

$r = $bob->get('/gate');
check('gate: technician can add assets', ($r['json']['canAddAssets'] ?? false) === true, $r['raw']);
$r = $bob->get('/store?workspace_id=' . $wsId);
check('technician store: editableSiteIds contains site1', ($r['json']['workspace']['editableSiteIds'] ?? []) === [$site1], $r['raw']);

$r = $bob->post('/assets/save', ['asset' => [
    'asset_number' => 'B-001', 'item_name' => 'Bob Device', 'site_id' => $site1, 'building_id' => $building1, 'room_id' => $room1,
    'location_in_room' => 'Desk', 'status' => 'installed',
]]);
$asset3 = $r['json']['id'] ?? '';
check('technician can save assets', $asset3 !== '', $r['raw']);
$r = $bob->post('/assets/delete', ['id' => $asset3]);
check('technician cannot delete assets', $r['status'] === 403, $r['raw']);
$r = $bob->post('/assets/archive', ['id' => $asset3]);
check('technician cannot archive assets', $r['status'] === 403, $r['raw']);

/* ======================= Archive / restore ======================= */

$r = $alice->post('/assets/archive', ['id' => $asset1]);
check('archive asset', ($r['json']['ok'] ?? false) === true, $r['raw']);
$log = db()->query("SELECT * FROM asset_logs WHERE asset_id = " . db()->quote($asset1) . " AND action_type = 'Archived'")->fetchAll();
check('archive log row', count($log) === 1 && $log[0]['previous_location'] === 'Rack 2' && $log[0]['new_location'] === 'Archived');

$r = $alice->get('/store?workspace_id=' . $wsId);
$archivedVisible = false;
foreach (($r['json']['data']['assets'] ?? []) as $a) {
    if ($a['id'] === $asset1 && $a['archived_at'] !== '') {
        $archivedVisible = true;
    }
}
check('admin store includes archived assets', $archivedVisible);

$r = $bob->get('/store?workspace_id=' . $wsId);
$bobAssetIds = array_column($r['json']['data']['assets'] ?? [], 'id');
check('non-admin store excludes archived assets', !in_array($asset1, $bobAssetIds, true) && in_array($asset3, $bobAssetIds, true), json_encode($bobAssetIds));

$r = $alice->post('/assets/restore', ['id' => $asset1]);
check('restore asset', ($r['json']['ok'] ?? false) === true, $r['raw']);
$log = db()->query("SELECT * FROM asset_logs WHERE asset_id = " . db()->quote($asset1) . " AND action_type = 'Restored'")->fetchAll();
check('restore log row', count($log) === 1 && $log[0]['previous_location'] === 'Archived' && $log[0]['new_location'] === 'Rack 2');
$r = $bob->get('/store?workspace_id=' . $wsId);
check('restored asset visible to non-admin again', in_array($asset1, array_column($r['json']['data']['assets'] ?? [], 'id'), true));

/* ======================= Invites ======================= */

$r = $bob->post('/invites', ['workspace_id' => $wsId, 'email' => 'carol@test.local', 'role' => 'technician', 'site_id' => $site1]);
check('technician cannot send site invites', $r['status'] === 403, $r['raw']);

clearEmails('carol@test.local');
$r = $alice->post('/invites', ['workspace_id' => $wsId, 'email' => 'carol@test.local', 'role' => 'technician', 'site_id' => $site1]);
$inviteId = $r['json']['invite']['id'] ?? '';
check('invite created', $inviteId !== '' && ($r['json']['invite']['role'] ?? '') === 'technician', $r['raw']);
$inviteToken = tokenFromEmail('carol@test.local', 'invite');
check('invite email queued with join link', $inviteToken !== null);

$r = $alice->get('/invites?workspace_id=' . $wsId);
check('invite list for admin', count($r['json']['invites'] ?? []) === 1, $r['raw']);
$r = $bob->get('/invites?workspace_id=' . $wsId);
check('invite list denied for non-manager', $r['status'] === 403, $r['raw']);

$r = $carol->post('/invites/accept', ['token' => $inviteToken]);
check('invite accept returns workspace', ($r['json']['workspace_id'] ?? '') === $wsId, $r['raw']);
$r = $carol->post('/invites/accept', ['token' => $inviteToken]);
check('invite is single-use', $r['status'] === 400, $r['raw']);
$r = $carol->get('/store?workspace_id=' . $wsId);
check('invited technician sees site1', in_array($site1, array_column($r['json']['data']['sites'] ?? [], 'id'), true)
    && ($r['json']['workspace']['role'] ?? '') === 'member', $r['raw']);
$r = $carol->get('/gate');
check('gate: invited technician can add assets', ($r['json']['canAddAssets'] ?? false) === true, $r['raw']);

$r = $alice->post('/invites', ['workspace_id' => $wsId, 'email' => 'dave@test.local', 'role' => 'member']);
$invite2 = $r['json']['invite']['id'] ?? '';
$r = $alice->post('/invites/delete', ['id' => $invite2]);
check('invite delete', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $alice->post('/invites/delete', ['id' => $invite2]);
check('invite delete twice -> permission-style error', $r['status'] === 403, $r['raw']);

/* ======================= Last-admin protection ======================= */

$r = $alice->get('/members?workspace_id=' . $wsId);
$aliceWm = '';
$bobWm = '';
foreach (($r['json']['workspace_members'] ?? []) as $wm) {
    if ($wm['user_id'] === $aliceId) {
        $aliceWm = $wm['id'];
    }
    if ($wm['user_id'] === $bobId) {
        $bobWm = $wm['id'];
    }
}
$r = $alice->post('/members/workspace/update', ['id' => $aliceWm, 'role' => 'member']);
check('cannot demote last admin', $r['status'] === 400 && str_contains($r['json']['error'] ?? '', 'last admin'), $r['raw']);
$r = $alice->post('/members/workspace/remove', ['id' => $aliceWm]);
check('cannot remove last admin', $r['status'] === 400 && str_contains($r['json']['error'] ?? '', 'last admin'), $r['raw']);
$r = $bob->post('/members/workspace/update', ['id' => $bobWm, 'role' => 'admin']);
check('member cannot self-promote', $r['status'] === 403, $r['raw']);
$r = $alice->post('/members/workspace/update', ['id' => $bobWm, 'role' => 'admin']);
check('admin can promote member', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $alice->post('/members/workspace/update', ['id' => $aliceWm, 'role' => 'member']);
check('demote allowed once another admin exists', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $alice->post('/members/workspace/update', ['id' => $aliceWm, 'role' => 'admin']);
check('former admin loses management rights after demotion', $r['status'] === 403, $r['raw']);
$r = $bob->post('/members/workspace/update', ['id' => $aliceWm, 'role' => 'admin']);
check('new admin can restore alice', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = $alice->post('/members/workspace/update', ['id' => $bobWm, 'role' => 'member']);
check('bob demoted back to member', ($r['json']['ok'] ?? false) === true, $r['raw']);

/* ======================= Profiles & avatars ======================= */

$r = $alice->post('/profile/update', ['display_name' => 'Ali A.']);
check('profile update', ($r['json']['user']['display_name'] ?? '') === 'Ali A.', $r['raw']);

$tmpPng = tempnam(sys_get_temp_dir(), 'avatar') . '.png';
$img = imagecreatetruecolor(800, 600);
imagefill($img, 0, 0, imagecolorallocate($img, 40, 90, 200));
imagepng($img, $tmpPng);
imagedestroy($img);
$r = $alice->request('POST', '/profile/avatar', null, ['multipart' => ['file' => new CURLFile($tmpPng, 'image/png', 'me.png')]]);
check('avatar upload', ($r['json']['avatar_url'] ?? '') === '/api/avatar?user_id=' . $aliceId, $r['raw']);
$avatarFile = UPLOADS . '/avatars/' . $aliceId . '.jpg';
$size = @getimagesize($avatarFile);
check('avatar re-encoded to jpeg <= 512px', $size !== false && $size['mime'] === 'image/jpeg' && max($size[0], $size[1]) === 512, json_encode($size));

$tmpTxt = tempnam(sys_get_temp_dir(), 'avatar') . '.png';
file_put_contents($tmpTxt, 'this is not an image');
$r = $alice->request('POST', '/profile/avatar', null, ['multipart' => ['file' => new CURLFile($tmpTxt, 'image/png', 'fake.png')]]);
check('avatar rejects non-image content (finfo)', $r['status'] === 400, $r['raw']);

$r = $bob->get('/avatar?user_id=' . $aliceId);
check('avatar served to workspace peer', $r['status'] === 200 && str_contains($r['content_type'], 'image/jpeg'), $r['raw']);

$dave = new Client();
$dave->post('/auth/signup', ['email' => 'dave@test.local', 'password' => 'password123', 'first_name' => 'Dave']);
$r = $dave->get('/avatar?user_id=' . $aliceId);
check('avatar hidden from strangers', $r['status'] === 404, $r['raw']);
$r = $dave->get('/profiles?ids=' . $aliceId);
check('profiles hidden from strangers', ($r['json']['profiles'] ?? null) === [], $r['raw']);
$r = $bob->get('/profiles?ids=' . $aliceId . ',' . $carolId);
check('profiles visible to workspace peers', count($r['json']['profiles'] ?? []) === 2, $r['raw']);

/* ======================= Photos + cascading deletes ======================= */

$photoId = db()->query("SELECT id FROM asset_photos WHERE asset_id = " . db()->quote($asset1))->fetchColumn();
$r = $bob->post('/photos/delete', ['id' => $photoId]);
check('technician cannot delete photos', $r['status'] === 403, $r['raw']);
$r = $alice->post('/photos/delete', ['id' => $photoId]);
check('admin deletes photo', ($r['json']['ok'] ?? false) === true, $r['raw']);

$r = $alice->post('/assets/delete', ['id' => $asset3]);
check('admin deletes asset (with logs)', ($r['json']['ok'] ?? false) === true, $r['raw']);
$n = db()->query("SELECT COUNT(*) FROM asset_logs WHERE asset_id = " . db()->quote($asset3))->fetchColumn();
check('asset delete removes logs', (int)$n === 0);

$r = $alice->post('/sites/delete', ['id' => $site2]);
check('site delete', ($r['json']['ok'] ?? false) === true, $r['raw']);
$n = db()->query("SELECT COUNT(*) FROM assets WHERE site_id = " . db()->quote($site2))->fetchColumn();
check('site delete cascades to assets', (int)$n === 0);

$r = $alice->get('/nope');
check('unknown route -> 404 JSON', $r['status'] === 404 && ($r['json']['ok'] ?? true) === false, $r['raw']);

/* ======================= Cron dispatcher ======================= */

$pendingBefore = (int)db()->query("SELECT COUNT(*) FROM notifications WHERE status = 'pending'")->fetchColumn();
exec('php ' . escapeshellarg(dirname(__DIR__) . '/cron/dispatch.php') . ' 2>/dev/null', $out, $code);
$run = db()->query("SELECT * FROM cron_runs ORDER BY id DESC LIMIT 1")->fetch();
$locks = (int)db()->query('SELECT COUNT(*) FROM cron_locks')->fetchColumn();
check('cron dispatch runs, logs to cron_runs, releases lock', $run && in_array($run['status'], ['ok', 'error'], true) && $run['finished_at'] !== null && $locks === 0, json_encode($run));
$touched = (int)db()->query("SELECT COUNT(*) FROM notifications WHERE status = 'sent' OR attempts > 0")->fetchColumn();
check('cron dispatch processed pending notifications', $pendingBefore === 0 || $touched > 0, "pending_before=$pendingBefore touched=$touched");

// Overlap lock: hold the lock, run again, expect immediate exit without processing.
db()->exec("INSERT INTO cron_locks (name, locked_at) VALUES ('dispatch', UTC_TIMESTAMP())");
exec('php ' . escapeshellarg(dirname(__DIR__) . '/cron/dispatch.php') . ' 2>/dev/null', $out2, $code2);
$runCount = (int)db()->query('SELECT COUNT(*) FROM cron_runs')->fetchColumn();
check('cron overlap lock prevents concurrent run', $code2 === 0 && $runCount === 1, "runs=$runCount");
db()->exec("DELETE FROM cron_locks WHERE name = 'dispatch'");

/* ======================= Summary ======================= */

echo "\n==============================\n";
echo 'PASS: ' . $GLOBALS['pass'] . '   FAIL: ' . $GLOBALS['fail'] . "\n";
exit($GLOBALS['fail'] > 0 ? 1 : 0);
