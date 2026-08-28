<?php
/**
 * SiteTrack email dispatcher — run from cPanel cron every 5 minutes:
 *   /usr/local/bin/php /home/<user>/sitetrack/server/cron/dispatch.php
 *
 * - CLI only
 * - Overlap lock via cron_locks (stale locks older than 10 min are cleared)
 * - Sends pending notifications (attempts < 5) via SMTP (15 s timeout) when
 *   SMTP_HOST is configured, else PHP mail()
 * - Logs each run to cron_runs
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

date_default_timezone_set('UTC');

require dirname(__DIR__) . '/api/src/Env.php';
require dirname(__DIR__) . '/api/src/Db.php';
require dirname(__DIR__) . '/api/src/Util.php';

Env::load(dirname(__DIR__) . '/.env');

const LOCK_NAME = 'dispatch';
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const SMTP_TIMEOUT = 15;

/* ------------------------------ Locking ------------------------------ */

// Clear stale locks (> 10 minutes old — a previous run died).
Db::run('DELETE FROM cron_locks WHERE locked_at < ?', [Util::nowUtc(-600)]);

try {
    Db::run('INSERT INTO cron_locks (name, locked_at) VALUES (?, ?)', [LOCK_NAME, Util::nowUtc()]);
} catch (PDOException $e) {
    echo "Another dispatch run is in progress; exiting.\n";
    exit(0);
}

Db::run('INSERT INTO cron_runs (task, status, started_at) VALUES (?, "running", ?)', [LOCK_NAME, Util::nowUtc()]);
$runId = (int)Db::get()->lastInsertId();

$sent = 0;
$failed = 0;
$runStatus = 'ok';
$runDetail = '';

try {
    $pending = Db::all(
        'SELECT * FROM notifications WHERE status = "pending" AND attempts < ? ORDER BY created_at ASC LIMIT ' . BATCH_SIZE,
        [MAX_ATTEMPTS]
    );
    foreach ($pending as $note) {
        try {
            sendEmail($note['to_email'], $note['subject'], $note['body_html']);
            Db::run('UPDATE notifications SET status = "sent", sent_at = ?, last_error = NULL WHERE id = ?', [Util::nowUtc(), $note['id']]);
            $sent++;
        } catch (Throwable $e) {
            $attempts = (int)$note['attempts'] + 1;
            $status = $attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
            Db::run(
                'UPDATE notifications SET attempts = ?, status = ?, last_error = ? WHERE id = ?',
                [$attempts, $status, substr($e->getMessage(), 0, 5000), $note['id']]
            );
            $failed++;
        }
    }
    $runDetail = sprintf('sent=%d failed=%d pending_batch=%d', $sent, $failed, count($pending));
} catch (Throwable $e) {
    $runStatus = 'error';
    $runDetail = $e->getMessage();
} finally {
    Db::run('UPDATE cron_runs SET status = ?, detail = ?, finished_at = ? WHERE id = ?', [$runStatus, $runDetail, Util::nowUtc(), $runId]);
    Db::run('DELETE FROM cron_locks WHERE name = ?', [LOCK_NAME]);
}

echo $runDetail . "\n";
exit($runStatus === 'ok' ? 0 : 1);

/* ------------------------------ Sending ------------------------------ */

function sendEmail(string $to, string $subject, string $bodyHtml): void
{
    $fromAddress = Env::get('MAIL_FROM_ADDRESS', 'no-reply@localhost');
    $fromName = Env::get('MAIL_FROM_NAME', 'SiteTrack');

    if (Env::get('SMTP_HOST') !== '') {
        smtpSend($to, $subject, $bodyHtml, $fromAddress, $fromName);
        return;
    }

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . encodeHeaderName($fromName) . ' <' . $fromAddress . '>',
    ];
    if (!mail($to, encodeHeaderName($subject), $bodyHtml, implode("\r\n", $headers))) {
        throw new RuntimeException('PHP mail() returned false');
    }
}

function encodeHeaderName(string $value): string
{
    // RFC 2047 encode only when needed.
    return preg_match('/[^\x20-\x7e]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;
}

/** Minimal SMTP client: implicit TLS on 465, STARTTLS on 587, AUTH LOGIN. */
function smtpSend(string $to, string $subject, string $bodyHtml, string $fromAddress, string $fromName): void
{
    $host = Env::get('SMTP_HOST');
    $port = Env::int('SMTP_PORT', 587);
    $user = Env::get('SMTP_USER');
    $pass = Env::get('SMTP_PASS');

    $remote = ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $context = stream_context_create(['ssl' => ['SNI_enabled' => true]]);
    $fp = @stream_socket_client($remote, $errno, $errstr, SMTP_TIMEOUT, STREAM_CLIENT_CONNECT, $context);
    if (!$fp) {
        throw new RuntimeException("SMTP connect failed: $errstr ($errno)");
    }
    stream_set_timeout($fp, SMTP_TIMEOUT);

    $expect = static function (array $codes) use ($fp): string {
        $line = '';
        do {
            $chunk = fgets($fp, 2048);
            if ($chunk === false) {
                $meta = stream_get_meta_data($fp);
                throw new RuntimeException($meta['timed_out'] ? 'SMTP timeout' : 'SMTP connection closed');
            }
            $line = $chunk;
        } while (isset($line[3]) && $line[3] === '-'); // skip multiline replies
        $code = (int)substr($line, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException('SMTP unexpected reply: ' . trim($line));
        }
        return $line;
    };
    $send = static function (string $cmd) use ($fp): void {
        if (fwrite($fp, $cmd . "\r\n") === false) {
            throw new RuntimeException('SMTP write failed');
        }
    };

    try {
        $expect([220]);
        $hello = 'EHLO ' . (parse_url(Env::get('APP_URL', 'http://localhost'), PHP_URL_HOST) ?: 'localhost');
        $send($hello);
        $expect([250]);

        if ($port !== 465) {
            $send('STARTTLS');
            $expect([220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('SMTP STARTTLS negotiation failed');
            }
            $send($hello);
            $expect([250]);
        }

        if ($user !== '') {
            $send('AUTH LOGIN');
            $expect([334]);
            $send(base64_encode($user));
            $expect([334]);
            $send(base64_encode($pass));
            $expect([235]);
        }

        $send('MAIL FROM:<' . $fromAddress . '>');
        $expect([250]);
        $send('RCPT TO:<' . $to . '>');
        $expect([250, 251]);
        $send('DATA');
        $expect([354]);

        $headers = 'From: ' . encodeHeaderName($fromName) . ' <' . $fromAddress . ">\r\n"
            . 'To: <' . $to . ">\r\n"
            . 'Subject: ' . encodeHeaderName($subject) . "\r\n"
            . 'Date: ' . gmdate('D, d M Y H:i:s') . " +0000\r\n"
            . "MIME-Version: 1.0\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n";
        $body = chunk_split(base64_encode($bodyHtml), 76, "\r\n");
        $send($headers . "\r\n" . $body . "\r\n.");
        $expect([250]);
        $send('QUIT');
    } finally {
        fclose($fp);
    }
}
