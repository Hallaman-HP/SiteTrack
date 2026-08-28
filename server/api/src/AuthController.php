<?php
/**
 * AuthController: signup, login, 2FA, magic links, verification, password flows.
 */
final class AuthController
{
    private const MIN_PASSWORD = 8;

    private static function validEmail(string $email): string
    {
        $email = strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ApiError('Please enter a valid email address.', 400);
        }
        return $email;
    }

    private static function validPassword(string $password): string
    {
        if (strlen($password) < self::MIN_PASSWORD) {
            throw new ApiError('Password must be at least 8 characters.', 400);
        }
        return $password;
    }

    private static function userByEmail(string $email): ?array
    {
        return Db::one('SELECT * FROM users WHERE email = ?', [$email]);
    }

    public static function signup(): void
    {
        $body = Util::jsonBody();
        $email = self::validEmail((string)($body['email'] ?? ''));
        Auth::rateLimit('signup', $email);
        $password = self::validPassword((string)($body['password'] ?? ''));
        $first = trim((string)($body['first_name'] ?? ''));
        $last = trim((string)($body['last_name'] ?? ''));

        if (self::userByEmail($email)) {
            throw new ApiError('An account with this email already exists.', 409);
        }

        $userId = Util::uuid4();
        $display = trim($first . ' ' . $last);
        if ($display === '') {
            $display = explode('@', $email)[0];
        }
        Db::run(
            'INSERT INTO users (id, email, password_hash, first_name, last_name, display_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $userId, $email, password_hash($password, PASSWORD_DEFAULT),
                $first !== '' ? $first : null, $last !== '' ? $last : null, $display,
                Util::nowUtc(), Util::nowUtc(),
            ]
        );

        if (Env::bool('REQUIRE_EMAIL_VERIFY', true)) {
            $token = Auth::createToken($userId, 'verify', 24 * 3600);
            Mailer::sendVerification($email, $token);
            Util::ok(['verify_email_sent' => true]);
        }

        Db::run('UPDATE users SET email_verified_at = ? WHERE id = ?', [Util::nowUtc(), $userId]);
        Auth::createSession($userId);
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$userId]);
        Util::ok(['user' => Auth::userPayload($user)]);
    }

    public static function verifyEmail(): void
    {
        $body = Util::jsonBody();
        $token = (string)($body['token'] ?? '');
        Auth::rateLimit('verify-email', substr($token, 0, 16));
        $row = Auth::findToken($token, 'verify');
        if (!$row) {
            throw new ApiError('This verification link is invalid or has expired.', 400);
        }
        Auth::consumeToken($row['id']);
        Db::run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [Util::nowUtc(), $row['user_id']]);
        Auth::createSession($row['user_id']);
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$row['user_id']]);
        Util::ok(['user' => Auth::userPayload($user)]);
    }

    public static function login(): void
    {
        $body = Util::jsonBody();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        Auth::rateLimit('login', $email);
        $password = (string)($body['password'] ?? '');

        $user = $email !== '' ? self::userByEmail($email) : null;
        if (!$user || !password_verify($password, $user['password_hash'])) {
            throw new ApiError('Invalid email or password.', 401);
        }
        if (Env::bool('REQUIRE_EMAIL_VERIFY', true) && empty($user['email_verified_at'])) {
            throw new ApiError('Please verify your email address before logging in. Check your inbox for the verification link.', 403);
        }

        if (Env::bool('REQUIRE_2FA', true) && !Auth::hasTrustedDevice($user['id'])) {
            $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $challenge = Auth::createToken($user['id'], '2fa', 10 * 60, $code);
            Mailer::send2faCode($user['email'], $code);
            Util::ok(['requires_2fa' => true, 'challenge' => $challenge]);
        }

        Auth::createSession($user['id']);
        Util::ok(['user' => Auth::userPayload($user)]);
    }

    public static function verify2fa(): void
    {
        $body = Util::jsonBody();
        $challenge = (string)($body['challenge'] ?? '');
        $code = trim((string)($body['code'] ?? ''));
        $trustDevice = (bool)($body['trust_device'] ?? false);
        Auth::rateLimit('2fa', substr($challenge, 0, 16));

        $row = Auth::findToken($challenge, '2fa');
        if (!$row) {
            throw new ApiError('This sign-in code has expired. Please log in again.', 400);
        }
        if ((int)$row['attempts'] >= 5) {
            throw new ApiError('Too many incorrect codes. Please log in again.', 429);
        }
        if ($code === '' || $row['code_hash'] === null || !hash_equals($row['code_hash'], Util::hashToken($code))) {
            Db::run('UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ?', [$row['id']]);
            throw new ApiError('That code is not correct. Please try again.', 400);
        }

        Auth::consumeToken($row['id']);
        Auth::createSession($row['user_id']);
        if ($trustDevice) {
            Auth::trustDevice($row['user_id']);
        }
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$row['user_id']]);
        Util::ok(['user' => Auth::userPayload($user)]);
    }

    public static function magicLink(): void
    {
        $body = Util::jsonBody();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        Auth::rateLimit('magic', $email);
        $user = $email !== '' ? self::userByEmail($email) : null;
        if ($user) {
            $token = Auth::createToken($user['id'], 'magic', 15 * 60);
            Mailer::sendMagicLink($user['email'], $token);
        }
        // Always ok to avoid account enumeration.
        Util::ok();
    }

    public static function magicVerify(): void
    {
        $body = Util::jsonBody();
        $token = (string)($body['token'] ?? '');
        Auth::rateLimit('magic-verify', substr($token, 0, 16));
        $row = Auth::findToken($token, 'magic');
        if (!$row) {
            throw new ApiError('This sign-in link is invalid or has expired.', 400);
        }
        Auth::consumeToken($row['id']);
        // Possession of the email is proof of ownership: also verifies the address.
        Db::run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [Util::nowUtc(), $row['user_id']]);
        Auth::createSession($row['user_id']);
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$row['user_id']]);
        Util::ok(['user' => Auth::userPayload($user)]);
    }

    public static function logout(): void
    {
        Auth::logout();
        Util::ok();
    }

    public static function session(): void
    {
        $user = Auth::currentUser();
        Util::ok(['user' => $user ? Auth::userPayload($user) : null]);
    }

    public static function changePassword(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $current = (string)($body['current_password'] ?? '');
        $new = self::validPassword((string)($body['new_password'] ?? ''));
        if (!password_verify($current, $user['password_hash'])) {
            throw new ApiError('Your current password is not correct.', 403);
        }
        Db::run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), Util::nowUtc(), $user['id']]);
        Auth::deleteOtherSessions($user['id']);
        Util::ok();
    }

    public static function resetRequest(): void
    {
        $body = Util::jsonBody();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        Auth::rateLimit('reset', $email);
        $user = $email !== '' ? self::userByEmail($email) : null;
        if ($user) {
            $token = Auth::createToken($user['id'], 'reset', 60 * 60);
            Mailer::sendPasswordReset($user['email'], $token);
        }
        Util::ok();
    }

    public static function resetConfirm(): void
    {
        $body = Util::jsonBody();
        $token = (string)($body['token'] ?? '');
        Auth::rateLimit('reset-confirm', substr($token, 0, 16));
        $new = self::validPassword((string)($body['new_password'] ?? ''));
        $row = Auth::findToken($token, 'reset');
        if (!$row) {
            throw new ApiError('This reset link is invalid or has expired.', 400);
        }
        Auth::consumeToken($row['id']);
        Db::run('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', [
            password_hash($new, PASSWORD_DEFAULT), Util::nowUtc(), Util::nowUtc(), $row['user_id'],
        ]);
        // Kill every existing session, then start a fresh one.
        Db::run('DELETE FROM sessions WHERE user_id = ?', [$row['user_id']]);
        Auth::createSession($row['user_id']);
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$row['user_id']]);
        Util::ok(['user' => Auth::userPayload($user)]);
    }
}
