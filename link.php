<?php
declare(strict_types=1);
ini_set('display_errors', '0');
ini_set('html_errors', '0');

require_once __DIR__ . '/lib.php';

mc_security_headers();
mc_session_start();

$UPLOAD_DIR = __DIR__ . '/uploads';
$LINK_DIR   = __DIR__ . '/links';
$BY_DIR     = $LINK_DIR . '/byname';
$CACHE_DIR  = __DIR__ . '/cache';

if (!is_dir($LINK_DIR))  @mkdir($LINK_DIR, 0755, true);
if (!is_dir($BY_DIR))    @mkdir($BY_DIR, 0755, true);
if (!is_dir($CACHE_DIR)) @mkdir($CACHE_DIR, 0755, true);

function redirect_home(): never {
    mc_redirect_home();
}

function base64url(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function link_path(string $dir, string $code): string {
    return $dir . '/' . $code . '.json';
}

/**
 * Read existing code from byname index and verify its json mapping.
 * If broken, cleans byname index file.
 */
function read_existing_code_by_index(string $linkDir, string $byDir, string $filename): string {
    $idx = byname_path($byDir, $filename); // from lib.php
    if (!is_file($idx)) return '';

    $raw = @file_get_contents($idx);
    if (!is_string($raw) || $raw === '') {
        @unlink($idx);
        return '';
    }

    $code = trim(strtok($raw, "\r\n"));
    if ($code === '' || !preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) {
        @unlink($idx);
        return '';
    }

    $p = link_path($linkDir, $code);
    if (!is_file($p)) {
        @unlink($idx);
        return '';
    }

    $raw = @file_get_contents($p);
    $j = json_decode(is_string($raw) ? $raw : '', true);
    if (!is_array($j) || (($j['f'] ?? null) !== $filename)) {
        @unlink($idx);
        return '';
    }

    return $code;
}

function write_index(string $byDir, string $filename, string $code): void {
    $idx = byname_path($byDir, $filename); // from lib.php
    $tmp = $idx . '.tmp.' . bin2hex(random_bytes(6));

    if (@file_put_contents($tmp, $code . "\n", LOCK_EX) === false) {
        return;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $idx)) {
        @unlink($tmp);
    }
}

/* =========================
   LINK CREATION
   ========================= */

function create_short_link(string $linkDir, string $byDir, string $filename): string {
    // Ensure dirs exist
    if (!is_dir($linkDir)) @mkdir($linkDir, 0755, true);
    if (!is_dir($byDir))   @mkdir($byDir, 0755, true);

    $idxPath  = byname_path($byDir, $filename); // from lib.php
    $lockPath = $idxPath . '.lock';

    $fh = @fopen($lockPath, 'c+'); // lock file, not the index file
    if ($fh) {
        @flock($fh, LOCK_EX);
    }

    try {
        $existing = read_existing_code_by_index($linkDir, $byDir, $filename);
        if ($existing !== '') return $existing;

        $data = json_encode(['f' => $filename], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($data) || $data === '') {
            return '';
        }

        for ($i = 0; $i < 20; $i++) {
            $code = base64url(random_bytes(9));
            if (!preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) continue;

            $path = link_path($linkDir, $code);
            if (file_exists($path)) continue;

            $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));

            if (@file_put_contents($tmp, $data, LOCK_EX) !== false && @rename($tmp, $path)) {
                @chmod($path, 0644);
                write_index($byDir, $filename, $code);
                return $code;
            }
            @unlink($tmp);
        }

        // Last attempt
        $code = base64url(random_bytes(12));
        if (strlen($code) > 32) $code = substr($code, 0, 32);
        if (!preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) return '';

        $path = link_path($linkDir, $code);
        if (file_exists($path)) return '';

        $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));

        if (@file_put_contents($tmp, $data, LOCK_EX) !== false && @rename($tmp, $path)) {
            @chmod($path, 0644);
            write_index($byDir, $filename, $code);
            return $code;
        }

        @unlink($tmp);
        return '';

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

/**
 * Only allow AJAX POST from index.php. Otherwise redirect to index.php.
 */
try {
    // Must be POST + AJAX
    mc_require_ajax_post_or_pretty_403();

    // Must be admin session, but DO NOT close session yet (CSRF needs it active)
    mc_require_admin_session_or_json_403('Forbidden', false);

    // CSRF must be checked while session is still ACTIVE
    if (!csrf_ok_post()) {
        mc_json_fail('CSRF failed', 403);
    }

    // NOW release session lock early (link.php is hit frequently)
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    $action = (string)($_POST['action'] ?? '');
    if ($action !== 'make_link' && $action !== 'get_direct') {
        mc_json_fail('Bad request', 400);
    }

    $name = safe_basename((string)($_POST['name'] ?? ''));
    if ($name === '' || (isset($name[0]) && $name[0] === '.')) {
        mc_json_fail('Bad filename', 400);
    }

    if (!is_dir($UPLOAD_DIR)) @mkdir($UPLOAD_DIR, 0755, true);

    $path = $UPLOAD_DIR . '/' . $name;
    if (!is_file($path)) {
        mc_json_fail('File not found', 404);
    }

    $base = mc_base_uri();

    if ($action === 'get_direct') {
        $url = ($base === '' ? '' : $base) . '/download.php?via=admin&name=' . rawurlencode($name);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        echo json_encode(['url' => $url], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    $code = create_short_link($LINK_DIR, $BY_DIR, $name);

    if ($code === '' || !preg_match('~^[A-Za-z0-9_-]{6,32}$~', $code)) {
        mc_json_fail('Link failed', 500);
    }

    // Hard check: ensure JSON exists
    $jp = link_path($LINK_DIR, $code);
    if (!is_file($jp) || filesize($jp) <= 0) {
        mc_json_fail('Link failed', 500);
    }

    // Update shared index, preserving "complete"
    shared_index_add_filename_preserve_complete($CACHE_DIR, $name);

    $url  = ($base === '' ? '' : $base) . '/d/' . $code;

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode(['url' => $url], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;

} catch (\Throwable $e) {
    try {
        @error_log('link.php error: ' . $e->getMessage());
    } catch (\Throwable $ignored) {}

    mc_json_fail('Server error', 500);
}