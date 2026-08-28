<?php
/**
 * Mailer: queues emails into the notifications table (OHS pattern).
 * Actual sending happens in server/cron/dispatch.php.
 */
final class Mailer
{
    public static function queue(string $toEmail, string $subject, string $bodyHtml): void
    {
        Db::run(
            'INSERT INTO notifications (id, to_email, subject, body_html, status, attempts, created_at)
             VALUES (?, ?, ?, ?, "pending", 0, ?)',
            [Util::uuid4(), $toEmail, $subject, $bodyHtml, Util::nowUtc()]
        );
    }

    private static function wrap(string $title, string $inner): string
    {
        $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        return '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;'
            . 'font-family:Arial,Helvetica,sans-serif;color:#1f2933;">'
            . '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;'
            . 'padding:32px;border:1px solid #e4e7eb;">'
            . '<h2 style="margin:0 0 16px;font-size:20px;">' . $safeTitle . '</h2>'
            . $inner
            . '<p style="margin:24px 0 0;font-size:12px;color:#7b8794;">SiteTrack &mdash; asset tracking for site teams.'
            . ' If you did not expect this email you can safely ignore it.</p>'
            . '</div></body></html>';
    }

    private static function button(string $url, string $label): string
    {
        $safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        return '<p style="margin:24px 0;"><a href="' . $safeUrl . '" style="background:#2563eb;color:#ffffff;'
            . 'text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold;">'
            . htmlspecialchars($label, ENT_QUOTES, 'UTF-8') . '</a></p>'
            . '<p style="font-size:12px;color:#7b8794;word-break:break-all;">Or copy this link: ' . $safeUrl . '</p>';
    }

    /* ------------------------------ Renderers ------------------------------ */

    public static function send2faCode(string $toEmail, string $code): void
    {
        $inner = '<p>Use this code to finish signing in. It expires in 10 minutes.</p>'
            . '<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:24px 0;">'
            . htmlspecialchars($code, ENT_QUOTES, 'UTF-8') . '</p>';
        self::queue($toEmail, 'Your SiteTrack sign-in code', self::wrap('Your sign-in code', $inner));
    }

    public static function sendMagicLink(string $toEmail, string $token): void
    {
        $url = rtrim(Env::get('APP_URL'), '/') . '/auth/callback/?token=' . rawurlencode($token);
        $inner = '<p>Click the button below to sign in to SiteTrack. The link expires in 15 minutes and can only be used once.</p>'
            . self::button($url, 'Sign in to SiteTrack');
        self::queue($toEmail, 'Your SiteTrack sign-in link', self::wrap('Sign in to SiteTrack', $inner));
    }

    public static function sendVerification(string $toEmail, string $token): void
    {
        $url = rtrim(Env::get('APP_URL'), '/') . '/auth/callback/?type=verify&token=' . rawurlencode($token);
        $inner = '<p>Welcome to SiteTrack! Confirm your email address to activate your account.</p>'
            . self::button($url, 'Verify my email');
        self::queue($toEmail, 'Verify your SiteTrack email', self::wrap('Verify your email', $inner));
    }

    public static function sendPasswordReset(string $toEmail, string $token): void
    {
        $url = rtrim(Env::get('APP_URL'), '/') . '/auth/callback/?type=recovery&token=' . rawurlencode($token);
        $inner = '<p>We received a request to reset your SiteTrack password. The link expires in 60 minutes.</p>'
            . self::button($url, 'Reset my password');
        self::queue($toEmail, 'Reset your SiteTrack password', self::wrap('Reset your password', $inner));
    }

    public static function sendInvite(string $toEmail, string $token, string $workspaceName, ?string $siteName, string $role): void
    {
        $url = rtrim(Env::get('APP_URL'), '/') . '/join/?invite=' . rawurlencode($token);
        $safeWs = htmlspecialchars($workspaceName, ENT_QUOTES, 'UTF-8');
        $detail = $siteName !== null && $siteName !== ''
            ? '<p>You have been invited to join the <strong>' . $safeWs . '</strong> workspace as <strong>'
              . htmlspecialchars($role, ENT_QUOTES, 'UTF-8') . '</strong> on site <strong>'
              . htmlspecialchars($siteName, ENT_QUOTES, 'UTF-8') . '</strong>.</p>'
            : '<p>You have been invited to join the <strong>' . $safeWs . '</strong> workspace as <strong>'
              . htmlspecialchars($role, ENT_QUOTES, 'UTF-8') . '</strong>.</p>';
        $inner = $detail . self::button($url, 'Accept invitation');
        self::queue($toEmail, 'You have been invited to ' . $workspaceName . ' on SiteTrack', self::wrap('Workspace invitation', $inner));
    }
}
