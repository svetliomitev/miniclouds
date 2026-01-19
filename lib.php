<?php
declare(strict_types=1);

/* =========================================================
   MiniCloudS lib.php
   - Shared helpers for index.php, link.php, download.php, error.php
   - IMPORTANT: This file must NOT start a session on include.
   ========================================================= */

/* =========================
   IDE STUBS (Intelephense)
   - Safe: never executed at runtime
   ========================= */
if (false) {
    function apcu_fetch(string $key, &$success = null) {}
    function apcu_store(string $key, $var, int $ttl = 0) {}
    function apcu_delete($key) {}
}

/* =========================
   BASE / URL HELPERS
   ========================= */

function mc_base_uri(): string {
    $p = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? ''));
    $p = rtrim($p, '/');
    return ($p === '/' ? '' : $p);
}

function mc_home_url(): string {
    $b = mc_base_uri();
    return ($b === '' ? '/index.php' : ($b . '/index.php'));
}

function mc_redirect_home(): never {
    $base = mc_base_uri();
    header('Location: ' . ($base === '' ? '' : $base) . '/index.php', true, 302);
    exit;
}

function mc_redirect_error(int $code): never {
    $base = mc_base_uri();
    header('Location: ' . ($base === '' ? '' : $base) . '/error.php?e=' . (int)$code, true, 302);
    exit;
}

function mc_csp_nonce(): string {
    static $n = '';
    if ($n !== '') return $n;
    $n = rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
    return $n;
}

/* =========================
   SECURITY HEADERS
   ========================= */

function mc_security_headers(): void
{
    header('X-Robots-Tag: noindex, nofollow, noarchive', true);
    header('X-Frame-Options: DENY', true);
    header('X-Content-Type-Options: nosniff', true);
    header('Referrer-Policy: same-origin', true);

    $nonce = mc_csp_nonce();

    header(
        "Content-Security-Policy: "
        . "default-src 'self'; "
        . "base-uri 'self'; "
        . "form-action 'self'; "
        . "object-src 'none'; "
        . "frame-ancestors 'none'; "
        . "script-src 'self' 'nonce-{$nonce}' https://cdn.jsdelivr.net; "
        . "style-src 'self' 'nonce-{$nonce}' https://cdn.jsdelivr.net; "
        . "font-src 'self' https://cdn.jsdelivr.net data:; "
        . "img-src 'self' data:; "
        . "connect-src 'self' https://cdn.jsdelivr.net; "
        . "upgrade-insecure-requests",
        true
    );
}

/* =========================
   SESSION HARDENING
   - Must be applied BEFORE session_start()
   ========================= */

function mc_cookie_path(): string {
    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    $dir = rtrim($dir, '/');
    if ($dir === '' || $dir === '.') return '/';
    return $dir . '/';
}

function mc_is_https_request(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function mc_session_harden_params(): void {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');

    $https = mc_is_https_request();
    if ($https) ini_set('session.cookie_secure', '1');

    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => mc_cookie_path(),
            'secure' => $https,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}

function mc_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    mc_session_harden_params();
    session_start();
}

/* Used by download.php: start session only when needed */
function mc_session_start_if_needed(): void {
    mc_session_start();
}

/* =========================
   HTML / TEXT HELPERS
   ========================= */

function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function format_bytes(int $bytes): string {
    $units = ['B','KB','MB','GB','TB'];
    $i = 0;
    $v = (float)$bytes;
    while ($v >= 1024 && $i < count($units) - 1) { $v /= 1024; $i++; }
    return ($i === 0 ? (string)(int)$v : number_format($v, 2)) . ' ' . $units[$i];
}

if (!function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool {
        if ($needle === '') return true;
        return substr($haystack, -strlen($needle)) === $needle;
    }
}

/* =========================
   AJAX / JSON FAIL HELPERS
   ========================= */

function mc_is_ajax(): bool {
    $xrw = strtolower((string)($_SERVER['HTTP_X_REQUESTED_WITH'] ?? ''));
    return ($xrw === 'xmlhttprequest');
}

function mc_json_fail(string $msg, int $status = 400): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode(['error' => $msg], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/* Used by index.php for CSRF/forbidden */
function mc_respond_forbidden(string $msg): never {
    if (mc_is_ajax()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        echo json_encode([
            'ok'  => [],
            'err' => [$msg],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    mc_redirect_error(403);
}

/* =========================
   INPUT VALIDATION
   ========================= */

function safe_basename(string $name): string {
    $name = trim($name);
    $name = str_replace(["\0", '/', '\\'], '', $name);
    if ($name === '' || $name === '.' || $name === '..') return '';
    return $name;
}

function mc_safe_code(string $c): string {
    $c = trim($c);
    if ($c === '') return '';
    if (!preg_match('~^[A-Za-z0-9_-]{6,32}$~', $c)) return '';
    return $c;
}

function clamp_filename(string $base, int $maxLen = 180): string {
    $base = trim($base);
    if ($base === '') return '';

    $ext  = pathinfo($base, PATHINFO_EXTENSION);
    $name = pathinfo($base, PATHINFO_FILENAME);
    $dotExt = ($ext !== '') ? ('.' . $ext) : '';

    $reserve = 12; // enough for "-999999" etc.
    $limit = max(1, $maxLen - strlen($dotExt) - $reserve);

    if (mb_strlen($name, 'UTF-8') > $limit) {
        $name = mb_substr($name, 0, $limit, 'UTF-8');
        $name = rtrim($name, " .-_");
        if ($name === '') $name = 'file';
    }

    $out = $name . $dotExt;

    if (strlen($out) > $maxLen) {
        $out = substr($out, 0, $maxLen);
    }

    return $out;
}

/* =========================
   INSTALL GATE HELPERS
   ========================= */

function mc_state_path(): string {
    return __DIR__ . '/install_state.json';
}

/* ultra-safe: never throws, never returns non-array */
function mc_read_state(): array {
    $p = mc_state_path();
    if (!is_file($p)) return [];

    $raw = @file_get_contents($p);
    if (!is_string($raw) || $raw === '') return [];

    $j = json_decode($raw, true);
    if (!is_array($j)) return [];

    /* ---------------------------------
       Normalize allow_ips (canonical: array)
       - supports old string format
       - cleans whitespace
       - de-duplicates
       --------------------------------- */
    if (array_key_exists('allow_ips', $j)) {
        if (is_string($j['allow_ips'])) {
            $s = trim($j['allow_ips']);
            if ($s === '') {
                $j['allow_ips'] = [];
            } else {
                $parts = preg_split('~[,\s]+~', $s, -1, PREG_SPLIT_NO_EMPTY);
                $out = [];
                foreach ($parts as $p) {
                    $p = trim((string)$p);
                    if ($p !== '') $out[] = $p;
                }
                $j['allow_ips'] = array_values(array_unique($out));
            }
        } elseif (is_array($j['allow_ips'])) {
            $out = [];
            foreach ($j['allow_ips'] as $p) {
                $p = trim((string)$p);
                if ($p !== '') $out[] = $p;
            }
            $j['allow_ips'] = array_values(array_unique($out));
        } else {
            // unexpected type → make safe
            $j['allow_ips'] = [];
        }
    } else {
        // always present for callers
        $j['allow_ips'] = [];
    }

    return $j;
}

/* installed iff install_state.json says installed=true (do NOT depend on .htaccess) */
function mc_is_installed(): bool {
    $j = mc_read_state();
    return (($j['installed'] ?? false) === true);
}

/* =========================
   INSTALLER HELPERS (install.php)
   ========================= */

function mc_rewrite_base(): string {
    $b = mc_base_uri();
    return ($b === '' ? '/' : ($b . '/')); // "/" or "/subdir/app/"
}

/**
 * Writes install_state.json (atomic best-effort) and preserves instance_id if already present.
 * Stores installer fields EXCEPT password.
 */
function mc_write_install_state(
    string $version = '',
    string $appName = '',
    int $pageSize = 0,
    string $adminUser = '',
    array $allowIps = []
): void {
    $existing = mc_read_state();
    $existingId = '';
    $eid = (string)($existing['instance_id'] ?? '');

    // accept 20..64 hex; keep whatever already exists if valid
    if ($eid !== '' && preg_match('~^[a-f0-9]{20,64}$~i', $eid)) {
        $existingId = strtolower($eid);
    }

    $appName = trim((string)$appName);
    $appName = preg_replace('~\s+~', ' ', $appName) ?: '';

    $payload = [
        'installed'    => true,
        'installed_at' => date('c'),
        'instance_id'  => ($existingId !== '' ? $existingId : bin2hex(random_bytes(10))), // 80-bit hex (20 chars)
    ];

    $adminUser = trim((string)$adminUser);
    if ($adminUser !== '') $payload['admin_user'] = $adminUser;

    // store normalized allowlist as array, always present
    $norm = [];
    foreach ($allowIps as $v) {
        if (!is_string($v)) continue;
        $v = trim($v);
        if ($v !== '') $norm[] = $v;
    }
    $payload['allow_ips'] = array_values($norm);

    if ($version !== '') $payload['version'] = $version;
    if ($appName !== '') $payload['app_name'] = $appName;

    if ($pageSize > 0) {
        if ($pageSize < 20) $pageSize = 20;
        if ($pageSize > 200) $pageSize = 200;
        $payload['page_size'] = (int)$pageSize;
    }

    if (!atomic_write_json(mc_state_path(), $payload)) {
        throw new RuntimeException('Cannot write install_state.json');
    }
    @chmod(mc_state_path(), 0644);
}

/**
 * Read existing bcrypt hash from .htpasswd (single-line "user:hash").
 * Returns '' if missing/invalid/unreadable.
 */
function mc_htpasswd_read_hash(string $htpasswdPath): string {
    if (!is_file($htpasswdPath) || !is_readable($htpasswdPath)) return '';

    $raw = @file_get_contents($htpasswdPath);
    if (!is_string($raw) || $raw === '') return '';

    $line = trim(strtok($raw, "\r\n"));
    if ($line === '' || strpos($line, ':') === false) return '';

    $parts = explode(':', $line, 2);
    $hash = trim((string)($parts[1] ?? ''));
    if ($hash === '') return '';

    // bcrypt ($2y$, $2a$, $2b$)
    if (!preg_match('~^\$2[aby]\$~', $hash)) return '';

    return $hash;
}

/**
 * Production-safe install gate:
 * - never throws
 * - never fatals
 * - redirects to install.php when not installed
 */
function mc_install_gate_or_redirect(): void {
    try {
        if (!mc_is_installed()) {
            $base = mc_base_uri();
            header('Location: ' . ($base === '' ? '' : $base) . '/install.php', true, 302);
            exit;
        }
    } catch (\Throwable $e) {
        // If anything goes wrong (corrupt JSON, unexpected env), fail-safe to installer.
        $base = mc_base_uri();
        header('Location: ' . ($base === '' ? '' : $base) . '/install.php', true, 302);
        exit;
    }
}

/* =========================
   CSRF + FLASH
   ========================= */

function csrf_init(): void {
    if (session_status() !== PHP_SESSION_ACTIVE) mc_session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function csrf_check(): void {
    if (session_status() !== PHP_SESSION_ACTIVE) mc_session_start();

    $ok = isset($_POST['csrf'], $_SESSION['csrf'])
       && is_string($_SESSION['csrf'])
       && hash_equals($_SESSION['csrf'], (string)$_POST['csrf']);

    if (!$ok) mc_respond_forbidden('CSRF validation failed. Refresh the page and try again.');
}

function csrf_ok_post(): bool {
    if (session_status() !== PHP_SESSION_ACTIVE) return false;
    if (!isset($_POST['csrf'], $_SESSION['csrf'])) return false;
    $a = $_SESSION['csrf'];
    $b = $_POST['csrf'];
    if (!is_string($a) || $a === '') return false;
    if (!is_string($b) || $b === '') return false;
    return hash_equals($a, $b);
}

function flash_add(string $type, string $msg): void {
    if (session_status() !== PHP_SESSION_ACTIVE) mc_session_start();

    if (!isset($_SESSION['flash']) || !is_array($_SESSION['flash'])) {
        $_SESSION['flash'] = ['ok' => [], 'err' => []];
    }
    if (!isset($_SESSION['flash'][$type]) || !is_array($_SESSION['flash'][$type])) {
        $_SESSION['flash'][$type] = [];
    }
    $_SESSION['flash'][$type][] = $msg;
}

function flash_pop(): array {
    if (session_status() !== PHP_SESSION_ACTIVE) mc_session_start();

    $f = ['ok' => [], 'err' => []];
    if (isset($_SESSION['flash']) && is_array($_SESSION['flash'])) {
        $f['ok']  = isset($_SESSION['flash']['ok'])  ? (array)($_SESSION['flash']['ok'])  : [];
        $f['err'] = isset($_SESSION['flash']['err']) ? (array)($_SESSION['flash']['err']) : [];
    }
    unset($_SESSION['flash']);
    return $f;
}

/* =========================
   APCu (best-effort)
   ========================= */

function apcu_enabled(): bool {
    if (!function_exists('apcu_fetch') || !function_exists('apcu_store')) return false;

    $en = (string)ini_get('apc.enabled');
    if ($en === '0') return false;

    if (PHP_SAPI === 'cli') {
        $cli = (string)ini_get('apc.enable_cli');
        if ($cli !== '1') return false;
    }

    return true;
}

function apcu_prefix(): string {
    static $p = null;
    if ($p !== null) return $p;
    $p = 'mc:' . sha1(__DIR__);
    return $p;
}

function apcu_key(string $name): string {
    return apcu_prefix() . ':' . $name;
}

function apcu_get(string $key, &$ok = null) {
    $ok = false;
    if (!apcu_enabled()) return null;
    return apcu_fetch($key, $ok);
}

function apcu_set(string $key, $val, int $ttl = 0): void {
    if (!apcu_enabled()) return;
    @apcu_store($key, $val, $ttl);
}

function apcu_del(string $key): void {
    if (!apcu_enabled()) return;
    @apcu_delete($key);
}

/* =========================
   ATOMIC WRITE JSON
   ========================= */

function atomic_write_json(string $path, array $data): bool {
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);

    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($json)) return false;

    $fh = @fopen($tmp, 'wb');
    if (!$fh) return false;

    @flock($fh, LOCK_EX);

    $ok = (@fwrite($fh, $json) !== false);
    @fflush($fh);

    if (function_exists('fsync')) {
        try { @fsync($fh); } catch (\Throwable $e) {}
    }

    @flock($fh, LOCK_UN);
    @fclose($fh);

    if (!$ok) { @unlink($tmp); return false; }

    @chmod($tmp, 0644);

    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }

    return true;
}

/* =========================
   FILE INDEX
   - Stored in cache/file_index.json
   - No self-heal here (rebuild only via explicit action)
   ========================= */

function file_index_path(string $cacheDir): string {
    return rtrim($cacheDir, '/\\') . '/file_index.json';
}

/** Sorting newest uploaded files come first in the list */
function mc_cmp_file_index_newest_first(array $a, array $b): int {
    $am = (int)($a['mtime'] ?? 0);
    $bm = (int)($b['mtime'] ?? 0);

    if ($am !== $bm) return ($bm <=> $am); // DESC (newest first)

    $an = (string)($a['name'] ?? '');
    $bn = (string)($b['name'] ?? '');
    return strcmp($an, $bn); // ASC tie-break
}

/**
 * Load file index. Returns [] if missing/invalid.
 * Format: [ ['name'=>string,'size'=>int,'mtime'=>int], ... ]
 */
function file_index_load(string $cacheDir): array {
    $p = file_index_path($cacheDir);
    $mt = @filemtime($p);
    $mt = ($mt === false) ? 0 : (int)$mt;

    $k = apcu_key('file_index');
    $ok = false;
    $cached = apcu_get($k, $ok);

    if ($ok && is_array($cached)
        && (($cached['mt'] ?? -1) === $mt)
        && isset($cached['list']) && is_array($cached['list'])
    ) {
        return $cached['list'];
    }

    if (!is_file($p)) {
        apcu_set($k, ['mt' => $mt, 'list' => []], 0);
        return [];
    }

    $raw = @file_get_contents($p);
    if (!is_string($raw) || $raw === '') {
        apcu_set($k, ['mt' => $mt, 'list' => []], 0);
        return [];
    }

    $j = json_decode($raw, true);
    if (!is_array($j)) {
        apcu_set($k, ['mt' => $mt, 'list' => []], 0);
        return [];
    }

    $out = [];
    foreach ($j as $it) {
        if (!is_array($it)) continue;
        $name = (string)($it['name'] ?? '');
        if ($name === '' || (isset($name[0]) && $name[0] === '.')) continue;

        $out[] = [
            'name'  => $name,
            'size'  => (int)($it['size'] ?? 0),
            'mtime' => (int)($it['mtime'] ?? 0),
        ];
    }

    usort($out, 'mc_cmp_file_index_newest_first');

    apcu_set($k, ['mt' => $mt, 'list' => $out], 0);
    return $out;
}

/**
 * Save file index to cache/file_index.json (atomic).
 */
function file_index_save(string $cacheDir, array $fileIndex): bool {
    $p = file_index_path($cacheDir);

    $out = [];
    foreach ($fileIndex as $it) {
        if (!is_array($it)) continue;
        $name = (string)($it['name'] ?? '');
        if ($name === '' || (isset($name[0]) && $name[0] === '.')) continue;

        $out[] = [
            'name'  => $name,
            'size'  => (int)($it['size'] ?? 0),
            'mtime' => (int)($it['mtime'] ?? 0),
        ];
    }

    usort($out, 'mc_cmp_file_index_newest_first');

    $ok = atomic_write_json($p, $out);
    if ($ok) {
        $mt = @filemtime($p);
        $mt = ($mt === false) ? 0 : (int)$mt;
        apcu_set(apcu_key('file_index'), ['mt' => $mt, 'list' => $out], 0);
    }
    return $ok;
}

/**
 * Rebuild file index from disk (uploads directory).
 * Uses DirectoryIterator.
 */
function file_index_rebuild_from_disk(string $uploadDir): array {
    if (!is_dir($uploadDir) || !is_readable($uploadDir)) return [];

    $out = [];
    try {
        $it = new DirectoryIterator($uploadDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;

            $name = (string)$fi->getFilename();
            if ($name === '' || (isset($name[0]) && $name[0] === '.')) continue;

            $size = (int)$fi->getSize();
            $mtime = (int)$fi->getMTime();
            if ($size < 0) $size = 0;
            if ($mtime < 0) $mtime = 0;

            $out[] = ['name' => $name, 'size' => $size, 'mtime' => $mtime];
        }
    } catch (\Throwable $e) {
        return [];
    }

    usort($out, 'mc_cmp_file_index_newest_first');

    return $out;
}

/**
 * Upsert (insert or replace) one record by name.
 * Returns new array (keeps it functional like your call site expects).
 */
function file_index_upsert(array $fileIndex, array $row): array {
    $name = (string)($row['name'] ?? '');
    if ($name === '' || (isset($name[0]) && $name[0] === '.')) return $fileIndex;

    $size = (int)($row['size'] ?? 0);
    $mtime = (int)($row['mtime'] ?? 0);

    $found = false;
    for ($i = 0; $i < count($fileIndex); $i++) {
        if (!is_array($fileIndex[$i])) continue;
        if ((string)($fileIndex[$i]['name'] ?? '') === $name) {
            $fileIndex[$i] = ['name'=>$name, 'size'=>$size, 'mtime'=>$mtime];
            $found = true;
            break;
        }
    }
    if (!$found) {
        $fileIndex[] = ['name'=>$name, 'size'=>$size, 'mtime'=>$mtime];
    }

    usort($fileIndex, 'mc_cmp_file_index_newest_first');

    return $fileIndex;
}

/**
 * Remove record by name.
 */
function file_index_remove_name(array $fileIndex, string $name): array {
    $name = (string)$name;
    if ($name === '') return $fileIndex;

    $out = [];
    foreach ($fileIndex as $it) {
        if (!is_array($it)) continue;
        if ((string)($it['name'] ?? '') === $name) continue;
        $out[] = $it;
    }
    return $out;
}

/* =========================
   SHARED HELPERS (byname + shared_index.json)
   ========================= */

function byname_path(string $byDir, string $filename): string {
    return $byDir . '/' . hash('sha256', $filename) . '.txt';
}

function is_shared_file(string $byDir, string $filename): bool {
    $p = byname_path($byDir, $filename);
    if (!is_file($p)) return false;
    $sz = filesize($p);
    return ($sz !== false && $sz > 0);
}

function shared_index_path(string $cacheDir): string {
    return $cacheDir . '/shared_index.json';
}

/* Canonical loader: returns ['v'=>2, 'set'=>array, 'complete'=>bool] */
function shared_index_load(string $cacheDir): array {
    $p = shared_index_path($cacheDir);
    $mt = @filemtime($p);
    $mt = ($mt === false) ? 0 : (int)$mt;

    $k = apcu_key('shared_index');
    $ok = false;
    $cached = apcu_get($k, $ok);

    if ($ok && is_array($cached)
        && (($cached['mt'] ?? -1) === $mt)
        && isset($cached['set']) && is_array($cached['set'])
        && array_key_exists('complete', $cached)
    ) {
        return [
            'v' => 2,
            'set' => $cached['set'],
            'complete' => (bool)$cached['complete'],
        ];
    }

    if (!is_file($p)) {
        apcu_set($k, ['mt' => $mt, 'set' => [], 'complete' => false]);
        return ['v' => 2, 'set' => [], 'complete' => false];
    }

    $raw = @file_get_contents($p);
    if (!is_string($raw) || $raw === '') {
        apcu_set($k, ['mt' => $mt, 'set' => [], 'complete' => false]);
        return ['v' => 2, 'set' => [], 'complete' => false];
    }

    $j = json_decode($raw, true);
    if (!is_array($j)) {
        apcu_set($k, ['mt' => $mt, 'set' => [], 'complete' => false]);
        return ['v' => 2, 'set' => [], 'complete' => false];
    }

    $set = $j['set'] ?? [];
    if (!is_array($set)) $set = [];

    $complete = (bool)($j['complete'] ?? false);

    apcu_set($k, ['mt' => $mt, 'set' => $set, 'complete' => $complete]);
    return ['v' => 2, 'set' => $set, 'complete' => $complete];
}

function shared_index_save(string $cacheDir, array $set, bool $complete = true): void {
    $p = shared_index_path($cacheDir);

    $ok = atomic_write_json($p, [
        'v'        => 2,
        'set'      => $set,
        'complete' => $complete,
    ]);

    if ($ok) {
        $mt = @filemtime($p);
        $mt = ($mt === false) ? 0 : (int)$mt;

        apcu_set(apcu_key('shared_index'), [
            'mt' => $mt,
            'set' => $set,
            'complete' => $complete,
        ], 0);
    }
}

function shared_index_has(array $set, string $filename): bool {
    $h = hash('sha256', $filename);
    return isset($set[$h]);
}

function shared_index_add(array &$set, string $filename): void {
    $h = hash('sha256', $filename);
    $set[$h] = 1;
}

function shared_index_remove(array &$set, string $filename): void {
    $h = hash('sha256', $filename);
    unset($set[$h]);
}

/* For link.php: add filename to shared index while preserving "complete" flag */
function shared_index_add_filename_preserve_complete(string $cacheDir, string $filename): void {
    $meta = shared_index_load($cacheDir);
    $set = is_array($meta['set'] ?? null) ? $meta['set'] : [];
    $complete = (bool)($meta['complete'] ?? false);

    $h = hash('sha256', $filename);
    if (isset($set[$h])) return;

    $set[$h] = 1;

    // Never force complete=true here; preserve existing flag.
    shared_index_save($cacheDir, $set, $complete);
}

/* =========================
   SHARED INDEX
   - Stored in cache/shared_index.json (set + complete flag)
   - byname dir stores per-filename mapping to link code
   ========================= */

function shared_index_count_txt(string $byDir): int {
    if (!is_dir($byDir) || !is_readable($byDir)) return 0;
    $n = 0;
    try {
        $it = new DirectoryIterator($byDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;
            $name = (string)$fi->getFilename();
            if ($name === '') continue;
            if (!str_ends_with($name, '.txt')) continue;
            $n++;
        }
    } catch (\Throwable $e) {
        return 0;
    }
    return $n;
}

/**
 * Rebuild shared set from disk using linkDir/*.json as source of truth.
 * Validates:
 * - json file name is code (or code inside json)
 * - json contains 'f' filename
 * - upload exists
 * Recreates byname/*.txt for valid records.
 *
 * Returns: shared set array (for shared_index_save).
 */
function shared_index_rebuild_from_disk(string $linkDir, string $byDir, string $uploadDir): array {
    if (!is_dir($linkDir)) @mkdir($linkDir, 0755, true);
    if (!is_dir($byDir)) @mkdir($byDir, 0755, true);

    // Clear byname dir (safe: it's rebuild)
    try {
        $it = new DirectoryIterator($byDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;
            $fn = (string)$fi->getFilename();
            if ($fn === '' || !str_ends_with($fn, '.txt')) continue;
            @unlink($byDir . '/' . $fn);
        }
    } catch (\Throwable $e) {
        // ignore
    }

    $set = [];
    try {
        $it = new DirectoryIterator($linkDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;

            $fname = (string)$fi->getFilename();
            if ($fname === '' || !str_ends_with($fname, '.json')) continue;

            $path = $linkDir . '/' . $fname;
            $raw = @file_get_contents($path);
            if (!is_string($raw) || $raw === '') { @unlink($path); continue; }

            $j = json_decode($raw, true);
            if (!is_array($j)) { @unlink($path); continue; }

            $code = (string)($j['c'] ?? '');
            if ($code === '') {
                // fallback: derive from filename "<code>.json"
                $code = substr($fname, 0, -5);
            }
            if (!preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) { @unlink($path); continue; }

            $file = (string)($j['f'] ?? '');
            $file = safe_basename($file);
            if ($file === '' || (isset($file[0]) && $file[0] === '.')) { @unlink($path); continue; }

            // upload must exist
            $up = rtrim($uploadDir, '/\\') . '/' . $file;
            if (!is_file($up)) {
                @unlink($path);
                continue;
            }

            // Write byname file (byname_path must exist in lib.php already)
            $by = byname_path($byDir, $file);
            @file_put_contents($by, $code . "\n");

            // Add to shared set (shared_index_add must exist; if not, we can inline it)
            if (function_exists('shared_index_add')) {
                shared_index_add($set, $file);
            } else {
                // minimal fallback: set as associative for fast lookup
                $set[$file] = 1;
            }
        }
    } catch (\Throwable $e) {
        // ignore
    }

    return $set;
}

/* =========================
   UPLOADS FINGERPRINT (DRIFT DETECTION ONLY)
   - Baseline saved in cache/uploads_fingerprint.json
   - Cheap signature computed on every GET (no sort, no big arrays)
   - Strong hash computed only on explicit rebuild
   ========================= */

function mc_uploads_fingerprint_path(string $cacheDir): string {
    return rtrim($cacheDir, '/\\') . '/uploads_fingerprint.json';
}

/**
 * Compute CHEAP signature of uploads directory contents.
 * One pass, no sort, low memory.
 *
 * Fields:
 * - count, total_bytes, max_mtime
 * - crc_xor: XOR aggregate of per-file CRC32
 * - crc_sum: SUM aggregate of per-file CRC32 (mod 2^32)
 */
function mc_uploads_signature_compute(string $uploadDir): array {
    if (!is_dir($uploadDir) || !is_readable($uploadDir)) return [];

    $count = 0;
    $total = 0;
    $maxM  = 0;

    // 32-bit aggregates (we store as unsigned-ish integers in JSON)
    $crcXor = 0;
    $crcSum = 0;

    try {
        $it = new DirectoryIterator($uploadDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;

            $name = (string)$fi->getFilename();
            if ($name === '' || (isset($name[0]) && $name[0] === '.')) continue;

            $size  = (int)$fi->getSize();
            $mtime = (int)$fi->getMTime();
            if ($size < 0) $size = 0;
            if ($mtime < 0) $mtime = 0;

            $count++;
            $total += $size;
            if ($mtime > $maxM) $maxM = $mtime;

            // Per-file signature string (small) -> CRC32
            $s = $name . "\0" . $size . "\0" . $mtime;

            // crc32() returns signed int sometimes; normalize to 0..2^32-1
            $c = crc32($s);
            if ($c < 0) $c = $c + 4294967296;

            // XOR and SUM (mod 2^32)
            $crcXor = $crcXor ^ $c;
            $crcSum = ($crcSum + $c) % 4294967296;
        }
    } catch (\Throwable $e) {
        return [];
    }

    // Normalize to ints (JSON)
    $crcXor = (int)$crcXor;
    $crcSum = (int)$crcSum;

    return [
        'v' => 2,
        'generated_at' => gmdate('c'),
        'count' => (int)$count,
        'total_bytes' => (int)$total,
        'max_mtime' => (int)$maxM,
        'crc_xor' => $crcXor,
        'crc_sum' => $crcSum,
        // strong_sha256 optional (added by rebuild)
    ];
}

/**
 * Compute STRONG fingerprint of uploads directory contents.
 * This is the expensive one: collects rows, sorts, sha256.
 * Use ONLY during explicit rebuild.
 *
 * Returns 64-hex sha256 or '' on failure.
 */
function mc_uploads_strong_sha256_compute(string $uploadDir): string {
    if (!is_dir($uploadDir) || !is_readable($uploadDir)) return '';

    $rows = [];

    try {
        $it = new DirectoryIterator($uploadDir);
        foreach ($it as $fi) {
            if ($fi->isDot()) continue;
            if (!$fi->isFile()) continue;

            $name = (string)$fi->getFilename();
            if ($name === '' || (isset($name[0]) && $name[0] === '.')) continue;

            $size  = (int)$fi->getSize();
            $mtime = (int)$fi->getMTime();
            if ($size < 0) $size = 0;
            if ($mtime < 0) $mtime = 0;

            $rows[] = $name . "\0" . $size . "\0" . $mtime;
        }
    } catch (\Throwable $e) {
        return '';
    }

    sort($rows, SORT_STRING);

    $ctx = hash_init('sha256');
    foreach ($rows as $r) {
        hash_update($ctx, $r);
        hash_update($ctx, "\n");
    }
    $sha = hash_final($ctx);

    if (!is_string($sha) || !preg_match('~^[a-f0-9]{64}$~i', $sha)) return '';
    return strtolower($sha);
}

/**
 * Load baseline fingerprint.
 * Accepts:
 * - v1 old format (your previous) -> treated as "known but weak"; will not drift unless fields exist
 * - v2 new format
 */
function mc_uploads_fingerprint_load(string $cacheDir): array {
    $p = mc_uploads_fingerprint_path($cacheDir);
    if (!is_file($p)) return [];

    $raw = @file_get_contents($p);
    if (!is_string($raw) || $raw === '') return [];

    $j = json_decode($raw, true);
    if (!is_array($j)) return [];

    $v = (int)($j['v'] ?? 0);

    if ($v === 2) {
        // required cheap fields
        if (!isset($j['count'], $j['total_bytes'], $j['max_mtime'], $j['crc_xor'], $j['crc_sum'])) return [];

        return [
            'v' => 2,
            'generated_at' => (string)($j['generated_at'] ?? ''),
            'count' => (int)$j['count'],
            'total_bytes' => (int)$j['total_bytes'],
            'max_mtime' => (int)$j['max_mtime'],
            'crc_xor' => (int)$j['crc_xor'],
            'crc_sum' => (int)$j['crc_sum'],
            'strong_sha256' => (string)($j['strong_sha256'] ?? ''),
        ];
    }

    // v1 legacy: keep compatibility if you already have old files lying around
    if ($v === 1) {
        $sha = (string)($j['sha256'] ?? '');
        if (!preg_match('~^[a-f0-9]{64}$~i', $sha)) return [];
        return [
            'v' => 1,
            'generated_at' => (string)($j['generated_at'] ?? ''),
            'count' => (int)($j['count'] ?? 0),
            'total_bytes' => (int)($j['total_bytes'] ?? 0),
            'max_mtime' => (int)($j['max_mtime'] ?? 0),
            'sha256' => strtolower($sha),
        ];
    }

    return [];
}

function mc_uploads_fingerprint_save(string $cacheDir, array $payload): bool {
    $p = mc_uploads_fingerprint_path($cacheDir);

    // We only save v2 going forward
    $v = (int)($payload['v'] ?? 0);
    if ($v !== 2) return false;

    $data = [
        'v' => 2,
        'generated_at' => (string)($payload['generated_at'] ?? gmdate('c')),
        'count' => (int)($payload['count'] ?? 0),
        'total_bytes' => (int)($payload['total_bytes'] ?? 0),
        'max_mtime' => (int)($payload['max_mtime'] ?? 0),
        'crc_xor' => (int)($payload['crc_xor'] ?? 0),
        'crc_sum' => (int)($payload['crc_sum'] ?? 0),
    ];

    $strong = (string)($payload['strong_sha256'] ?? '');
    if ($strong !== '' && preg_match('~^[a-f0-9]{64}$~i', $strong)) {
        $data['strong_sha256'] = strtolower($strong);
    }

    return atomic_write_json($p, $data);
}

/**
 * Drift detection against baseline fingerprint.
 * - Baseline missing/invalid => known=false, drift=false (no warning)
 * - Compute cheap signature every time (per your requirement).
 * - Drift is decided by comparing cheap fields (v2) or sha256 (v1).
 */
function mc_uploads_drift_detect(string $cacheDir, string $uploadDir): array {
    $base = mc_uploads_fingerprint_load($cacheDir);
    if (!$base) {
        return ['known' => false, 'drift' => false, 'baseline' => [], 'current' => []];
    }

    // Always compute current signature (no throttling)
    $cur = mc_uploads_signature_compute($uploadDir);
    if (!$cur) {
        // If we can't compute, stay quiet.
        return ['known' => true, 'drift' => false, 'baseline' => $base, 'current' => []];
    }

    $drift = false;

    if ((int)($base['v'] ?? 0) === 2) {
        // Compare cheap signature fields
        $drift = (
            (int)$base['count'] !== (int)$cur['count']
            || (int)$base['total_bytes'] !== (int)$cur['total_bytes']
            || (int)$base['max_mtime'] !== (int)$cur['max_mtime']
            || (int)$base['crc_xor'] !== (int)$cur['crc_xor']
            || (int)$base['crc_sum'] !== (int)$cur['crc_sum']
        );
    } else {
        // v1 baseline: compare old sha256 to a strong hash only if you want; but per your new rule,
        // we keep it cheap and simply don't assert drift based on v1 unless you rebuild once.
        // Best: after first rebuild you will write v2 and be done.
        $drift = false;
    }

    return ['known' => true, 'drift' => $drift, 'baseline' => $base, 'current' => $cur];
}

/* =========================
   PAGED LIST QUERY
   ========================= */

function norm_q(string $s): string {
    $s = trim($s);
    $s = preg_replace('~\s+~', ' ', $s);
    return (string)$s;
}

function parse_ymd(string $ymd, bool $endOfDay): ?int {
    $ymd = trim($ymd);
    if ($ymd === '') return null;
    if (!preg_match('~^\d{4}-\d{2}-\d{2}$~', $ymd)) return null;

    $ts = strtotime($ymd . ($endOfDay ? ' 23:59:59' : ' 00:00:00'));
    if ($ts === false) return null;
    return (int)$ts;
}

function query_files_paged(
    array $fileIndex,
    string $q,
    ?int $fromTs,
    ?int $toTs,
    string $flags,
    int $offset,
    int $limit,
    string $byDir,
    ?array $sharedSetOrNull = null
): array {
    $q = norm_q($q);

    $terms = [];
    if ($q !== '') {
        foreach (preg_split('~\s+~', $q) as $t) {
            $t = trim((string)$t);
            if ($t !== '') $terms[] = mb_strtolower($t, 'UTF-8');
        }
    }

    $wantShared = ($flags === 'shared');

    $page = [];
    $matched = 0;

    $needStart = max(0, $offset);
    $needEnd = $needStart + max(1, $limit);

    $hasTerms = !empty($terms);
    $useSharedSet = is_array($sharedSetOrNull);

    foreach ($fileIndex as $it) {
        $name = (string)($it['name'] ?? '');
        if ($name === '') continue;

        $mtime = (int)($it['mtime'] ?? 0);
        if ($fromTs !== null && $mtime < $fromTs) continue;
        if ($toTs !== null && $mtime > $toTs) continue;

        if ($hasTerms) {
            $n = mb_strtolower($name, 'UTF-8');
            $ok = true;
            foreach ($terms as $t) {
                if ($t === '') continue;
                if (mb_strpos($n, $t, 0, 'UTF-8') === false) { $ok = false; break; }
            }
            if (!$ok) continue;
        }

        $isShared = false;

        if ($wantShared) {
            $isShared = $useSharedSet ? shared_index_has($sharedSetOrNull, $name) : is_shared_file($byDir, $name);
            if (!$isShared) continue;
        }

        if ($matched >= $needStart && $matched < $needEnd) {
            if (!$wantShared) {
                $isShared = $useSharedSet ? shared_index_has($sharedSetOrNull, $name) : is_shared_file($byDir, $name);
            }

            $page[] = [
                'name' => $name,
                'size' => (int)($it['size'] ?? 0),
                'mtime' => $mtime,
                'shared' => $isShared,
                'url' => '',
            ];
        }

        $matched++;
    }

    return [$page, $matched];
}

/* =========================
   LINK CLEANUP
   ========================= */

function delete_all_links(string $linkDir, string $byDir): array {
    $txtDeleted = 0; $txtFailed = 0;
    $jsonDeleted = 0; $jsonFailed = 0;

    $dhb = @opendir($byDir);
    if ($dhb) {
        while (($f = readdir($dhb)) !== false) {
            if ($f === '.' || $f === '..') continue;
            if (!str_ends_with($f, '.txt')) continue;

            $p = $byDir . '/' . $f;
            if (!is_file($p)) continue;

            if (@unlink($p)) $txtDeleted++;
            else $txtFailed++;
        }
        closedir($dhb);
    }

    $dh = @opendir($linkDir);
    if ($dh) {
        while (($f = readdir($dh)) !== false) {
            if ($f === '.' || $f === '..') continue;
            if (!str_ends_with($f, '.json')) continue;

            $p = $linkDir . '/' . $f;
            if (!is_file($p)) continue;

            if (@unlink($p)) $jsonDeleted++;
            else $jsonFailed++;
        }
        closedir($dh);
    }

    return [$txtDeleted, $jsonDeleted, $txtFailed + $jsonFailed];
}

function delete_links_for_filename(string $linkDir, string $byDir, string $filename): array {
    $deleted = 0;
    $failed  = 0;

    $by = byname_path($byDir, $filename);
    $lockPath = $by . '.lock';

    if (!is_dir($linkDir)) @mkdir($linkDir, 0755, true);
    if (!is_dir($byDir))   @mkdir($byDir, 0755, true);

    $fh = @fopen($lockPath, 'c+');
    if ($fh) @flock($fh, LOCK_EX);

    try {
        $code = '';

        if (is_file($by)) {
            $raw = @file_get_contents($by);
            if (is_string($raw) && $raw !== '') {
                $code = trim(strtok($raw, "\r\n"));
            }

            if (@unlink($by)) $deleted++;
            else {
                if (is_file($by)) $failed++;
            }
        }

        if ($code !== '' && preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) {
            $json = $linkDir . '/' . $code . '.json';
            if (is_file($json)) {
                if (@unlink($json)) $deleted++;
                else {
                    if (is_file($json)) $failed++;
                }
            }
            return [$deleted, $failed];
        }

        $dh = @opendir($linkDir);
        if (!$dh) return [$deleted, $failed];

        $scanned  = 0;
        $MAX_SCAN = 2000;

        while (($f = readdir($dh)) !== false) {
            if ($f === '.' || $f === '..') continue;
            if (!str_ends_with($f, '.json')) continue;

            $path = $linkDir . '/' . $f;
            if (!is_file($path)) continue;

            $raw = @file_get_contents($path);
            if (!is_string($raw) || $raw === '') continue;

            $j = json_decode($raw, true);
            if (!is_array($j)) continue;

            if (($j['f'] ?? null) === $filename) {
                if (@unlink($path)) $deleted++;
                else {
                    if (is_file($path)) $failed++;
                }
            }

            $scanned++;
            if ($scanned >= $MAX_SCAN) {
                $failed++;
                break;
            }
        }
        closedir($dh);

        return [$deleted, $failed];

    } finally {
        if ($fh) {
            @flock($fh, LOCK_UN);
            @fclose($fh);
        }
        if (is_file($lockPath) && @filesize($lockPath) === 0) {
            @unlink($lockPath);
        }
    }
}

/* =========================
   PHP LIMIT HELPERS (index.php)
   ========================= */

function ini_bytes(string $val): int {
    $val = trim($val);
    if ($val === '' || $val === '-1') return PHP_INT_MAX;

    $last = strtolower($val[strlen($val) - 1]);
    $num  = (float)$val;

    switch ($last) {
        case 'g': return (int)($num * 1024 * 1024 * 1024);
        case 'm': return (int)($num * 1024 * 1024);
        case 'k': return (int)($num * 1024);
        default:  return (int)$num;
    }
}

function php_upload_file_limit_bytes(): int {
    return ini_bytes((string)ini_get('upload_max_filesize'));
}

function php_post_limit_bytes(): int {
    return ini_bytes((string)ini_get('post_max_size'));
}

function php_max_file_uploads(): int {
    $v = (string)ini_get('max_file_uploads');
    $n = (int)preg_replace('~[^0-9]~', '', $v);
    return ($n > 0) ? $n : 0;
}

/* =========================
   ADMIN SESSION (bridged from Apache BasicAuth)
   ========================= */

function mc_mark_admin_session_from_basic_auth(): void {
    // Call after mc_session_start().
    // Marks the session as "admin-ok" when Apache BasicAuth succeeded.
    if (session_status() !== PHP_SESSION_ACTIVE) return;

    $ru = (string)($_SERVER['REMOTE_USER'] ?? '');
    if ($ru !== '') {
        $_SESSION['mc_admin_ok'] = true;
    }
}

function mc_is_admin_session(): bool {
    return (session_status() === PHP_SESSION_ACTIVE)
        && isset($_SESSION['mc_admin_ok'])
        && $_SESSION['mc_admin_ok'] === true;
}

/* =========================
   AUTHZ HELPERS (pretty 403 / JSON 403)
   ========================= */

function mc_require_admin_session_or_pretty_403(
    string $lead = 'You are not allowed to access this resource.',
    string $detail = ''
): void {
    mc_session_start_if_needed();
    if (!mc_is_admin_session()) {
        mc_render_pretty_page('403 Forbidden', $lead, $detail, 403);
    }
    // release session lock so other actions proceed
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

function mc_require_admin_session_or_json_403(string $msg = 'Forbidden', bool $closeSession = true): void {
    mc_session_start_if_needed();

    if (empty($_SESSION['mc_admin_ok']) || $_SESSION['mc_admin_ok'] !== true) {
        mc_json_fail($msg, 403);
    }

    if ($closeSession && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

/* =========================
   ENDPOINT GUARDS
   ========================= */
  
function mc_require_ajax_post_or_pretty_403(
    string $lead = 'Direct access is not allowed.',
    string $detail = 'This endpoint is for AJAX POST requests only.'
): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !mc_is_ajax()) {
        mc_render_pretty_page('403 Forbidden', $lead, $detail, 403);
    }
}

/* =========================
   ERROR PAGE RENDERER
   ========================= */

function mc_pretty_403(string $lead = 'Forbidden', string $detail = ''): never {
    mc_render_pretty_page('403 Forbidden', $lead, $detail, 403);
}

function mc_render_pretty_page(string $title, string $lead, string $detail = '', int $code = 200): never {
    http_response_code($code);

    $home = mc_home_url();

    // Use shared h() helper for consistency
    $safeTitle  = h($title);
    $safeLead   = h($lead);
    $safeDetail = h($detail);
    $safeHome   = h($home);

    echo '<!doctype html><html lang="en" data-bs-theme="dark"><head>';
    echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . $safeTitle . '</title>';
    echo '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">';
    echo '</head><body class="bg-body">';

    echo '<nav class="navbar border-bottom">';
    echo '<div class="container"><span class="navbar-brand fw-semibold mb-0">MiniCloudS</span></div>';
    echo '</nav>';

    echo '<div class="container py-4">';
    echo '<div class="card shadow-sm">';
    echo '<div class="card-body">';
    echo '<h4 class="card-title mb-2">' . $safeTitle . '</h4>';
    echo '<p class="mb-3 text-body-secondary">' . $safeLead . '</p>';

    if ($detail !== '') {
        echo '<div class="alert alert-secondary mb-3" role="alert">';
        echo nl2br($safeDetail, false);
        echo '</div>';
    }

    echo '<div class="d-grid gap-2 d-md-flex">';
    echo '<a class="btn btn-primary" href="' . $safeHome . '">Go to Home</a>';
    $ref = (string)($_SERVER['HTTP_REFERER'] ?? '');
    $ref = ($ref !== '' ? $ref : $home);
    $safeRef = h($ref);

    echo '<a class="btn btn-outline-secondary" href="' . $safeRef . '">Back</a>';
    echo '</div>';
    echo '</div></div></div>';
    echo '</body></html>';
    exit;
}