<?php
/**
 * PhotoController: GET /api/photo?id=<uuid>
 *
 * Streams a single asset_photos.photo_url on demand so the /api/store payload
 * doesn't have to carry every base64 data URL for the workspace. Access-gated
 * the same way as viewing the asset itself (effectiveSiteRole must be non-null).
 *
 * The stored photo_url is typically a "data:image/...;base64,..." URI (migrated
 * from Supabase). We support two shapes:
 *   - data:<mime>;base64,<b64>  -> decoded + streamed as image/<mime>
 *   - anything else (http URL, /path)  -> 302 redirect
 */
final class PhotoController
{
    public static function serve(): void
    {
        $user = Auth::requireUser();
        $id = trim((string)($_GET['id'] ?? ''));
        if ($id === '') {
            throw new ApiError('Not found.', 404);
        }
        $row = Db::one(
            'SELECT p.photo_url, a.site_id
             FROM asset_photos p
             JOIN assets a ON a.id = p.asset_id
             WHERE p.id = ?',
            [$id]
        );
        if (!$row) {
            throw new ApiError('Not found.', 404);
        }
        if (Access::effectiveSiteRole($user['id'], $row['site_id']) === null) {
            throw new ApiError('Not found.', 404);
        }

        $photoUrl = (string)$row['photo_url'];

        if (stripos($photoUrl, 'data:') === 0) {
            // data:<mime>;base64,<b64>
            $comma = strpos($photoUrl, ',');
            if ($comma === false) {
                throw new ApiError('Not found.', 404);
            }
            $header = substr($photoUrl, 5, $comma - 5); // strip "data:"
            $payload = substr($photoUrl, $comma + 1);
            $isBase64 = stripos($header, ';base64') !== false;
            $mime = strtok($header, ';') ?: 'image/jpeg';
            $bytes = $isBase64 ? base64_decode($payload, true) : rawurldecode($payload);
            if ($bytes === false) {
                throw new ApiError('Not found.', 404);
            }
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . (string)strlen($bytes));
            header('Cache-Control: private, max-age=300');
            echo $bytes;
            exit;
        }

        // Non-data URL — bounce the browser to fetch it directly.
        header('Location: ' . $photoUrl, true, 302);
        header('Cache-Control: private, max-age=60');
        exit;
    }
}
