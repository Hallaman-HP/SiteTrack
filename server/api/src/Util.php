<?php
/**
 * ApiError: throw to produce a clean {ok:false,error} response with a status code.
 */
final class ApiError extends Exception
{
    public int $status;

    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/**
 * Util: shared helpers (JSON I/O, UUIDs, tokens, timestamps, CSRF, normalisation).
 */
final class Util
{
    /** RFC 4122 UUIDv4. */
    public static function uuid4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12)
        );
    }

    /** Random 64-hex token (raw value sent to client; store only the hash). */
    public static function randomToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Current UTC time formatted for DATETIME columns. */
    public static function nowUtc(int $offsetSeconds = 0): string
    {
        return gmdate('Y-m-d H:i:s', time() + $offsetSeconds);
    }

    /** DATETIME (UTC) -> ISO-8601 with Z suffix. Empty string for null/empty. */
    public static function isoTime(?string $dbDatetime): string
    {
        if ($dbDatetime === null || $dbDatetime === '') {
            return '';
        }
        return str_replace(' ', 'T', $dbDatetime) . 'Z';
    }

    /** ISO-8601 (or anything strtotime groks) -> UTC DATETIME string, or null. */
    public static function toDbDatetime(?string $value): ?string
    {
        $value = trim((string)$value);
        if ($value === '') {
            return null;
        }
        $ts = strtotime($value);
        return $ts === false ? null : gmdate('Y-m-d H:i:s', $ts);
    }

    /** Parse the JSON request body into an array. */
    public static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new ApiError('Invalid JSON body.', 400);
        }
        return $data;
    }

    /** CSRF guard: every non-GET request must carry X-Requested-With: SiteTrack. */
    public static function checkCsrf(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if ($method === 'GET' || $method === 'HEAD' || $method === 'OPTIONS') {
            return;
        }
        $header = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
        if ($header !== 'SiteTrack') {
            throw new ApiError('Invalid request.', 403);
        }
    }

    /** Send a JSON response and terminate. */
    public static function respond(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function ok(array $payload = []): void
    {
        self::respond(array_merge(['ok' => true], $payload));
    }

    /** Identical to supabaseStore blankToNull: trim, blank -> null. */
    public static function blankToNull($value): ?string
    {
        $trimmed = trim((string)($value ?? ''));
        return $trimmed === '' ? null : $trimmed;
    }

    /** String coercion with '' default (mirrors `row.field ?? ""`). */
    public static function s($value): string
    {
        return $value === null ? '' : (string)$value;
    }

    /** Placeholder list for IN (...) clauses. */
    public static function inClause(array $values): string
    {
        return implode(',', array_fill(0, count($values), '?'));
    }

    /** Best-effort client IP. */
    public static function clientIp(): string
    {
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }

    /**
     * Normalisation identical to supabaseStore normalizeAssetRow():
     * asset_number/item_name trimmed strings; every optional text field blank->null.
     */
    public static function normalizeAssetRow(array $asset): array
    {
        $asset['asset_number'] = trim((string)($asset['asset_number'] ?? ''));
        $asset['item_name'] = trim((string)($asset['item_name'] ?? ''));
        foreach ([
            'serial_number', 'item_type', 'brand', 'model', 'mac_address', 'ip_address',
            'switch_port', 'network_patch_number', 'location_in_room', 'patching_details',
            'notes', 'archived_at', 'archived_by', 'archived_reason',
        ] as $field) {
            $asset[$field] = self::blankToNull($asset[$field] ?? null);
        }
        return $asset;
    }

    /** status -> asset_logs.action_type map (statusToAction in supabaseStore). */
    public static function statusToAction(string $status): ?string
    {
        $map = [
            'awaiting_install' => 'Awaiting Install',
            'installed' => 'Installed',
            'removed' => 'Removed',
            'replaced' => 'Replaced',
            'moved' => 'Moved',
            'damaged' => 'Faulty/Damaged',
        ];
        return $map[$status] ?? null;
    }
}
