<?php
/**
 * SiteTrack API front controller.
 * Parses the path after /api, routes to controllers, always answers JSON.
 * Errors are logged to the PHP error_log; clients never see stack traces.
 */

declare(strict_types=1);

date_default_timezone_set('UTC');
ini_set('display_errors', '0');

require __DIR__ . '/src/Env.php';
require __DIR__ . '/src/Db.php';
require __DIR__ . '/src/Util.php';
require __DIR__ . '/src/Auth.php';
require __DIR__ . '/src/Access.php';
require __DIR__ . '/src/Mailer.php';
require __DIR__ . '/src/AuthController.php';
require __DIR__ . '/src/ProfileController.php';
require __DIR__ . '/src/StoreController.php';
require __DIR__ . '/src/WorkspaceController.php';
require __DIR__ . '/src/MemberController.php';
require __DIR__ . '/src/SiteController.php';
require __DIR__ . '/src/AssetController.php';
require __DIR__ . '/src/PhotoController.php';

Env::load(dirname(__DIR__) . '/.env');

set_exception_handler(static function (Throwable $e): void {
    error_log('[sitetrack] Unhandled: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'error' => 'Server error']);
});

/** Path after /api, no trailing slash, e.g. "/auth/login". */
function apiPath(): string
{
    $uri = (string)($_SERVER['REQUEST_URI'] ?? '/');
    $path = parse_url($uri, PHP_URL_PATH) ?: '/';
    $pos = strpos($path, '/api');
    if ($pos !== false) {
        $path = substr($path, $pos + 4);
    }
    $path = '/' . trim($path, '/');
    return $path === '//' ? '/' : $path;
}

$routes = [
    // Health
    'GET /health' => static function (): void {
        Db::run('SELECT 1');
        Util::ok(['db' => true, 'time' => Util::isoTime(Util::nowUtc())]);
    },

    // Auth
    'POST /auth/signup' => ['AuthController', 'signup'],
    'POST /auth/verify-email' => ['AuthController', 'verifyEmail'],
    'POST /auth/login' => ['AuthController', 'login'],
    'POST /auth/2fa/verify' => ['AuthController', 'verify2fa'],
    'POST /auth/magic-link' => ['AuthController', 'magicLink'],
    'POST /auth/magic-verify' => ['AuthController', 'magicVerify'],
    'POST /auth/logout' => ['AuthController', 'logout'],
    'GET /auth/session' => ['AuthController', 'session'],
    'POST /auth/change-password' => ['AuthController', 'changePassword'],
    'POST /auth/reset-request' => ['AuthController', 'resetRequest'],
    'POST /auth/reset-confirm' => ['AuthController', 'resetConfirm'],

    // Photos (lazy fetch to keep /api/store lean)
    'GET /photo' => ['PhotoController', 'serve'],

    // Profiles
    'POST /profile/update' => ['ProfileController', 'update'],
    'POST /profile/avatar' => ['ProfileController', 'avatarUpload'],
    'GET /avatar' => ['ProfileController', 'avatarServe'],
    'GET /profiles' => ['ProfileController', 'profiles'],

    // Store / gate
    'GET /store' => ['StoreController', 'store'],
    'GET /gate' => ['StoreController', 'gate'],

    // Workspaces & invites
    'POST /workspaces' => ['WorkspaceController', 'create'],
    'POST /workspaces/regenerate-code' => ['WorkspaceController', 'regenerateCode'],
    'POST /workspaces/join' => ['WorkspaceController', 'join'],
    'POST /invites' => ['WorkspaceController', 'inviteCreate'],
    'GET /invites' => ['WorkspaceController', 'inviteList'],
    'POST /invites/delete' => ['WorkspaceController', 'inviteDelete'],
    'POST /invites/accept' => ['WorkspaceController', 'inviteAccept'],

    // Members
    'GET /members' => ['MemberController', 'list'],
    'POST /members/workspace/update' => ['MemberController', 'workspaceUpdate'],
    'POST /members/workspace/remove' => ['MemberController', 'workspaceRemove'],
    'POST /members/site/upsert' => ['MemberController', 'siteUpsert'],
    'POST /members/site/update' => ['MemberController', 'siteUpdate'],
    'POST /members/site/remove' => ['MemberController', 'siteRemove'],

    // Sites / buildings / rooms
    'POST /sites/upsert' => ['SiteController', 'siteUpsert'],
    'POST /sites/delete' => ['SiteController', 'siteDelete'],
    'POST /buildings/upsert' => ['SiteController', 'buildingUpsert'],
    'POST /buildings/delete' => ['SiteController', 'buildingDelete'],
    'POST /rooms/upsert' => ['SiteController', 'roomUpsert'],
    'POST /rooms/delete' => ['SiteController', 'roomDelete'],

    // Assets
    'POST /assets/save' => ['AssetController', 'save'],
    'POST /assets/delete' => ['AssetController', 'delete'],
    'POST /assets/archive' => ['AssetController', 'archive'],
    'POST /assets/restore' => ['AssetController', 'restore'],
    'POST /photos/delete' => ['AssetController', 'photoDelete'],
];

try {
    Util::checkCsrf();
    $key = ($_SERVER['REQUEST_METHOD'] ?? 'GET') . ' ' . apiPath();
    $handler = $routes[$key] ?? null;
    if ($handler === null) {
        throw new ApiError('Not found.', 404);
    }
    if (is_array($handler)) {
        [$class, $method] = $handler;
        $class::$method();
    } else {
        $handler();
    }
    // Handlers respond and exit; reaching here means nothing was sent.
    throw new ApiError('Server error', 500);
} catch (ApiError $e) {
    Util::respond(['ok' => false, 'error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[sitetrack] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Util::respond(['ok' => false, 'error' => 'Server error'], 500);
}
