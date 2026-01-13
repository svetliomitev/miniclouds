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

/* =========================
   SECURITY HEADERS
   ========================= */

function mc_security_headers(): void {
    header('X-Robots-Tag: noindex, nofollow, noarchive', true);
    header('X-Frame-Options: DENY', true);
    header('X-Content-Type-Options: nosniff', true);
    header('Referrer-Policy: same-origin', true);
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
    return is_array($j) ? $j : [];
}

/* installed iff install_state.json says installed=true (do NOT depend on .htaccess) */
function mc_is_installed(): bool {
    $j = mc_read_state();
    return (($j['installed'] ?? false) === true);
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

function format_bytes(int $bytes): string {
    $units = ['B','KB','MB','GB','TB'];
    $i = 0;
    $v = (float)$bytes;
    while ($v >= 1024 && $i < count($units)-1) { $v /= 1024; $i++; }
    return ($i === 0 ? (string)(int)$v : number_format($v, 2)) . ' ' . $units[$i];
}

/* =========================
   ADMIN SESSION (set by index.php after BasicAuth succeeds)
   ========================= */

function mc_mark_admin_session_from_basic_auth(): void {
    // Only index.php should call this, after mc_session_start().
    // It marks the session as "admin-ok" when Apache BasicAuth succeeded.
    if (!empty($_SERVER['REMOTE_USER'])) {
        $_SESSION['mc_admin_ok'] = true;
    }
}

function mc_is_admin_session(): bool {
    return (session_status() === PHP_SESSION_ACTIVE)
        && !empty($_SESSION['mc_admin_ok'])
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
        echo '<div class="alert alert-secondary mb-3" role="alert" style="white-space:pre-wrap">';
        echo $safeDetail;
        echo '</div>';
    }

    echo '<div class="d-grid gap-2 d-md-flex">';
    echo '<a class="btn btn-primary" href="' . $safeHome . '">Go to Home</a>';
    echo '<button type="button" class="btn btn-outline-secondary" onclick="(function(){ if (history.length>1) history.back(); else location.href=\'' . $safeHome . '\'; })()">Back</button>';
    echo '</div>';

    echo '</div></div></div>';
    echo '</body></html>';
    exit;
}