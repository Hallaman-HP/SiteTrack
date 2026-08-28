<?php
/**
 * Auth: sessions, cookies, 2FA challenges, trusted devices, rate limiting.
 *
 * Cookies:
 *  - st_session: random 64-hex; SHA-256 hash in sessions table; rolling expiry.
 *  - st_trust:   random 64-hex; SHA-256 hash in trusted_devices; skips 2FA.
 * Both httpOnly, SameSite=Lax, Secure when APP_URL is https.
 */
final class Auth
{
    public const SESSION_COOKIE = 'st_session';
    public const TRUST_COOKIE = 'st_trust';

    private static ?array $currentUser = null;
    private static bool $currentUserLoaded = false;

    private static function secureCookies(): bool
    {
        return str_starts_with(strtolower(Env::get('APP_URL', '')), 'https://');
    }

    private static function setCookie(string $name, string $value, int $expiresAt): void
    {
        setcookie($name, $value, [
            'expires' => $expiresAt,
            'path' => '/',
            'secure' => self::secureCookies(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    /* ------------------------------ Sessions ------------------------------ */

    public static function createSession(string $userId): void
    {
        $token = Util::randomToken();
        $days = max(1, Env::int('SESSION_DAYS', 30));
        Db::run(
            'INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                Util::uuid4(), $userId, Util::hashToken($token),
                Util::nowUtc(), Util::nowUtc(), Util::nowUtc($days * 86400),
                Util::clientIp(), substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
            ]
        );
        self::setCookie(self::SESSION_COOKIE, $token, time() + $days * 86400);
        self::$currentUserLoaded = false;
    }

    /** Returns the users row for the current session, or null. Rolling expiry. */
    public static function currentUser(): ?array
    {
        if (self::$currentUserLoaded) {
            return self::$currentUser;
        }
        self::$currentUserLoaded = true;
        self::$currentUser = null;

        $token = (string)($_COOKIE[self::SESSION_COOKIE] ?? '');
        if ($token === '') {
            return null;
        }
        $hash = Util::hashToken($token);
        $row = Db::one(
            'SELECT s.id AS session_id, s.expires_at, u.*
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ?',
            [$hash, Util::nowUtc()]
        );
        if (!$row) {
            return null;
        }
        // Rolling 30-day expiry: refresh on activity.
        $days = max(1, Env::int('SESSION_DAYS', 30));
        Db::run(
            'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?',
            [Util::nowUtc(), Util::nowUtc($days * 86400), $row['session_id']]
        );
        $sessionId = $row['session_id'];
        unset($row['session_id'], $row['expires_at']);
        $row['_session_id'] = $sessionId;
        self::$currentUser = $row;
        return $row;
    }

    public static function requireUser(): array
    {
        $user = self::currentUser();
        if (!$user) {
            throw new ApiError('Not signed in.', 401);
        }
        return $user;
    }

    public static function logout(): void
    {
        $token = (string)($_COOKIE[self::SESSION_COOKIE] ?? '');
        if ($token !== '') {
            Db::run('DELETE FROM sessions WHERE token_hash = ?', [Util::hashToken($token)]);
        }
        self::setCookie(self::SESSION_COOKIE, '', time() - 3600);
        self::$currentUser = null;
        self::$currentUserLoaded = true;
    }

    /** Delete every session for the user except the current one. */
    public static function deleteOtherSessions(string $userId): void
    {
        $user = self::currentUser();
        $keep = $user['_session_id'] ?? '';
        if ($keep !== '') {
            Db::run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$userId, $keep]);
        } else {
            Db::run('DELETE FROM sessions WHERE user_id = ?', [$userId]);
        }
    }

    /* --------------------------- Trusted devices --------------------------- */

    public static function hasTrustedDevice(string $userId): bool
    {
        $token = (string)($_COOKIE[self::TRUST_COOKIE] ?? '');
        if ($token === '') {
            return false;
        }
        $row = Db::one(
            'SELECT id FROM trusted_devices WHERE user_id = ? AND token_hash = ? AND expires_at > ?',
            [$userId, Util::hashToken($token), Util::nowUtc()]
        );
        return $row !== null;
    }

    public static function trustDevice(string $userId): void
    {
        $token = Util::randomToken();
        $days = max(1, Env::int('TRUST_DAYS', 7));
        Db::run(
            'INSERT INTO trusted_devices (id, user_id, token_hash, created_at, expires_at, user_agent)
             VALUES (?, ?, ?, ?, ?, ?)',
            [
                Util::uuid4(), $userId, Util::hashToken($token),
                Util::nowUtc(), Util::nowUtc($days * 86400),
                substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
            ]
        );
        self::setCookie(self::TRUST_COOKIE, $token, time() + $days * 86400);
    }

    /* ------------------------------ Tokens -------------------------------- */

    /**
     * Create a one-time auth token. Returns the RAW token (64 hex).
     * For kind=2fa, $code is the 6-digit code (its SHA-256 goes in code_hash).
     */
    public static function createToken(string $userId, string $kind, int $ttlSeconds, ?string $code = null): string
    {
        $raw = Util::randomToken();
        Db::run(
            'INSERT INTO auth_tokens (id, user_id, kind, token_hash, code_hash, attempts, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
            [
                Util::uuid4(), $userId, $kind, Util::hashToken($raw),
                $code === null ? null : Util::hashToken($code),
                Util::nowUtc(), Util::nowUtc($ttlSeconds),
            ]
        );
        return $raw;
    }

    /** Find an unconsumed, unexpired token row of the given kind. */
    public static function findToken(string $raw, string $kind): ?array
    {
        if ($raw === '') {
            return null;
        }
        return Db::one(
            'SELECT * FROM auth_tokens WHERE token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?',
            [Util::hashToken($raw), $kind, Util::nowUtc()]
        );
    }

    public static function consumeToken(string $id): void
    {
        Db::run('UPDATE auth_tokens SET consumed_at = ? WHERE id = ?', [Util::nowUtc(), $id]);
    }

    /* ---------------------------- Rate limiting ---------------------------- */

    /** Sliding-window-ish limiter backed by the rate_limits table. Throws 429. */
    public static function rateLimit(string $action, string $key, int $max = 10, int $windowSec = 60): void
    {
        $bucket = substr($action . ':' . Util::clientIp() . ':' . strtolower($key), 0, 190);
        $now = Util::nowUtc();
        $cutoff = Util::nowUtc(-$windowSec);
        Db::run(
            'INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?, 1, ?)
             ON DUPLICATE KEY UPDATE
               hits = IF(window_start < ?, 1, hits + 1),
               window_start = IF(window_start < ?, ?, window_start)',
            [$bucket, $now, $cutoff, $cutoff, $now]
        );
        $row = Db::one('SELECT hits FROM rate_limits WHERE bucket = ?', [$bucket]);
        if ($row && (int)$row['hits'] > $max) {
            throw new ApiError('Too many attempts. Please wait a minute and try again.', 429);
        }
    }

    /* ------------------------------ Helpers -------------------------------- */

    /** Public user payload per the API contract. */
    public static function userPayload(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'first_name' => Util::s($user['first_name'] ?? null),
            'last_name' => Util::s($user['last_name'] ?? null),
            'display_name' => Util::s($user['display_name'] ?? null),
            'avatar_url' => !empty($user['avatar_path']) ? '/api/avatar?user_id=' . $user['id'] : null,
        ];
    }

    /**
     * Display-name logic identical to lib/profiles.ts displayName():
     * "first last" || display_name || fallback (email, then "Site user").
     */
    public static function displayNameFor(array $user): string
    {
        $full = trim(trim((string)($user['first_name'] ?? '')) . ' ' . trim((string)($user['last_name'] ?? '')));
        if ($full !== '') {
            return $full;
        }
        $display = trim((string)($user['display_name'] ?? ''));
        if ($display !== '') {
            return $display;
        }
        $email = trim((string)($user['email'] ?? ''));
        return $email !== '' ? $email : 'Site user';
    }
}
