<?php
/**
 * Full-stack dev router: serves the static export from ../out plus /api,
 * mirroring the production Apache layout (static files + /api front controller).
 * Run from server/:  php -S 127.0.0.1:8080 dev-router-full.php
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($path === '/api' || str_starts_with($path, '/api/')) {
    require __DIR__ . '/api/index.php';
    return true;
}

$root = realpath(__DIR__ . '/../out');
if ($root === false) {
    http_response_code(500);
    echo 'Static export not found. Run: npm run build';
    return true;
}

$mime = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript', 'css' => 'text/css',
    'json' => 'application/json', 'webmanifest' => 'application/manifest+json',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
    'ico' => 'image/x-icon', 'txt' => 'text/plain; charset=utf-8', 'woff2' => 'font/woff2',
    'woff' => 'font/woff', 'map' => 'application/json', 'wasm' => 'application/wasm',
];
$candidate = realpath($root . $path);
if ($candidate !== false && is_file($candidate) && str_starts_with($candidate, $root)) {
    $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($mime[$ext] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($candidate));
    readfile($candidate);
    return true;
}
$index = realpath($root . rtrim($path, '/') . '/index.html');
if ($index !== false && is_file($index) && str_starts_with($index, $root)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($index);
    return true;
}
$notFound = $root . '/404.html';
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
if (is_file($notFound)) readfile($notFound); else echo 'Not found';
return true;
