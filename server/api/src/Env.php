<?php
/**
 * Env: loads KEY=VALUE pairs from a .env file (OHS convention).
 * - Skips blank lines and lines starting with #
 * - Trims whitespace and optional surrounding quotes on values
 * - Exposes values via putenv/getenv and Env::get()
 */
final class Env
{
    private static bool $loaded = false;

    public static function load(?string $path = null): void
    {
        if (self::$loaded) {
            return;
        }
        $path = $path ?: dirname(__DIR__, 2) . '/.env';
        if (is_file($path) && is_readable($path)) {
            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') {
                    continue;
                }
                $pos = strpos($line, '=');
                if ($pos === false) {
                    continue;
                }
                $key = trim(substr($line, 0, $pos));
                $value = trim(substr($line, $pos + 1));
                if ($key === '') {
                    continue;
                }
                if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && substr($value, -1) === $value[0]) {
                    $value = substr($value, 1, -1);
                }
                putenv($key . '=' . $value);
                $_ENV[$key] = $value;
            }
        }
        self::$loaded = true;
    }

    public static function get(string $key, string $default = ''): string
    {
        self::load();
        $value = getenv($key);
        return ($value === false || $value === '') ? $default : $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key, $default ? '1' : '0');
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        $value = self::get($key, (string)$default);
        return is_numeric($value) ? (int)$value : $default;
    }
}
