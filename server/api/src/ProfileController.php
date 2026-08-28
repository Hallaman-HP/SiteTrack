<?php
/**
 * ProfileController: profile updates, avatar upload/serving, profile lookups.
 */
final class ProfileController
{
    public static function update(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $fields = [];
        $params = [];
        foreach (['first_name', 'last_name', 'display_name'] as $key) {
            if (array_key_exists($key, $body)) {
                $value = trim((string)$body[$key]);
                $fields[] = "$key = ?";
                $params[] = $value === '' ? null : $value;
            }
        }
        if ($fields) {
            $fields[] = 'updated_at = ?';
            $params[] = Util::nowUtc();
            $params[] = $user['id'];
            Db::run('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
        }
        $fresh = Db::one('SELECT * FROM users WHERE id = ?', [$user['id']]);
        Util::ok(['user' => Auth::userPayload($fresh)]);
    }

    public static function avatarUpload(): void
    {
        $user = Auth::requireUser();
        if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
            throw new ApiError('No file uploaded.', 400);
        }
        $file = $_FILES['file'];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new ApiError('Upload failed. Please try again.', 400);
        }
        if (($file['size'] ?? 0) > 5 * 1024 * 1024) {
            throw new ApiError('Image must be 5 MB or smaller.', 400);
        }
        $tmp = $file['tmp_name'];

        // Validate content, never the filename: finfo + getimagesize.
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new ApiError('Only JPEG, PNG or WebP images are allowed.', 400);
        }
        $info = @getimagesize($tmp);
        if ($info === false || $info[0] < 1 || $info[1] < 1) {
            throw new ApiError('The file is not a valid image.', 400);
        }

        $src = match ($mime) {
            'image/jpeg' => @imagecreatefromjpeg($tmp),
            'image/png' => @imagecreatefrompng($tmp),
            'image/webp' => @imagecreatefromwebp($tmp),
        };
        if (!$src) {
            throw new ApiError('The file is not a valid image.', 400);
        }

        // Re-encode via GD, capped at 512px on the longest edge.
        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min(1.0, 512 / max($w, $h));
        $nw = max(1, (int)round($w * $scale));
        $nh = max(1, (int)round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        $white = imagecolorallocate($dst, 255, 255, 255);
        imagefill($dst, 0, 0, $white); // flatten transparency onto white
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($src);

        $dir = rtrim(Env::get('UPLOADS_DIR'), '/') . '/avatars';
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
            throw new ApiError('Server error', 500);
        }
        $path = $dir . '/' . $user['id'] . '.jpg';
        if (!imagejpeg($dst, $path, 85)) {
            imagedestroy($dst);
            throw new ApiError('Server error', 500);
        }
        imagedestroy($dst);

        Db::run('UPDATE users SET avatar_path = ?, updated_at = ? WHERE id = ?', ['avatars/' . $user['id'] . '.jpg', Util::nowUtc(), $user['id']]);
        Util::ok(['avatar_url' => '/api/avatar?user_id=' . $user['id']]);
    }

    public static function avatarServe(): void
    {
        $viewer = Auth::requireUser();
        $targetId = (string)($_GET['user_id'] ?? '');
        if ($targetId === '' || !Access::sharesWorkspace($viewer['id'], $targetId)) {
            throw new ApiError('Not found.', 404);
        }
        $target = Db::one('SELECT avatar_path FROM users WHERE id = ?', [$targetId]);
        if (!$target || empty($target['avatar_path'])) {
            throw new ApiError('Not found.', 404);
        }
        // avatar_path is server-generated ("avatars/<uuid>.jpg") — never user input.
        $path = rtrim(Env::get('UPLOADS_DIR'), '/') . '/' . $target['avatar_path'];
        $real = realpath($path);
        $baseDir = realpath(rtrim(Env::get('UPLOADS_DIR'), '/'));
        if ($real === false || $baseDir === false || !str_starts_with($real, $baseDir)) {
            throw new ApiError('Not found.', 404);
        }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . (string)filesize($real));
        header('Cache-Control: private, max-age=300');
        readfile($real);
        exit;
    }

    public static function profiles(): void
    {
        $viewer = Auth::requireUser();
        $idsParam = trim((string)($_GET['ids'] ?? ''));
        $ids = array_values(array_filter(array_map('trim', explode(',', $idsParam))));
        $profiles = [];
        if ($ids) {
            $ids = array_slice(array_unique($ids), 0, 200);
            $rows = Db::all(
                'SELECT id, email, first_name, last_name, display_name, avatar_path FROM users WHERE id IN (' . Util::inClause($ids) . ')',
                $ids
            );
            foreach ($rows as $row) {
                if (!Access::sharesWorkspace($viewer['id'], $row['id'])) {
                    continue;
                }
                $profiles[] = [
                    'id' => $row['id'],
                    'first_name' => Util::s($row['first_name']),
                    'last_name' => Util::s($row['last_name']),
                    'display_name' => Util::s($row['display_name']),
                    'avatar_url' => !empty($row['avatar_path']) ? '/api/avatar?user_id=' . $row['id'] : null,
                ];
            }
        }
        Util::ok(['profiles' => $profiles]);
    }
}
