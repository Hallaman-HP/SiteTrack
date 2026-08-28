<?php
/**
 * Dev router for `php -S 127.0.0.1:8080 dev-router.php` (run from server/).
 * Maps /api/* to the front controller, mirroring the production .htaccess.
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if ($path === '/api' || str_starts_with($path, '/api/')) {
    require __DIR__ . '/api/index.php';
    return true;
}
http_response_code(404);
header('Content-Type: text/plain');
echo "Not found (dev server only proxies /api)";
return true;
