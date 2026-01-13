<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

mc_security_headers();

$UPLOAD_DIR = __DIR__ . '/uploads';
$LINK_DIR   = __DIR__ . '/links';

function redirect_home(): never {
    mc_redirect_home();
}

function redirect_404(): never {
    mc_redirect_error(404);
}

/**
 * Allowed modes:
 * - via=1      : public short link download (/d/<code> rewrite) -> requires links/<code>.json
 * - via=admin  : admin direct download (index.php Download button) -> requires ?name=<filename>, NO link files
 */
$via = (string)($_GET['via'] ?? '');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    mc_pretty_403('Forbidden', 'GET only.');
}

if ($via !== '1' && $via !== 'admin') {
    mc_pretty_403('Forbidden', 'Missing or invalid download mode.');
}

if ($via === 'admin') {
    // admin direct download must never trigger browser auth prompt; enforce via session gate
    mc_require_admin_session_or_pretty_403(
        'You are not allowed to access this download.',
        'Open the app (index.php) and download from there.'
    );

    $filename = safe_basename((string)($_GET['name'] ?? ''));
    if ($filename === '' || (isset($filename[0]) && $filename[0] === '.')) {
        mc_pretty_403('Forbidden', 'Bad filename.');
    }

    $filePath = $UPLOAD_DIR . '/' . $filename;

    if (!is_file($filePath) || is_link($filePath)) {
        redirect_404();
    }

    $size = filesize($filePath);
    if ($size === false) redirect_404();

    $fh = fopen($filePath, 'rb');
    if (!$fh) redirect_404();

    while (ob_get_level() > 0) { @ob_end_clean(); }

    @set_time_limit(0);
    @ignore_user_abort(true);

    $ascii = preg_replace('/[^A-Za-z0-9._-]/', '_', $filename);
    if ($ascii === '' || $ascii === '.' || $ascii === '..') $ascii = 'download';

    header('Content-Description: File Transfer');
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Content-Length: ' . $size);
    header('Cache-Control: private, max-age=0, no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');

    fpassthru($fh);
    fclose($fh);
    exit;
}

/* via=1 : public short link download */
$code = mc_safe_code((string)($_GET['c'] ?? ''));
if ($code === '') {
    redirect_404();
}

$mapPath = $LINK_DIR . '/' . $code . '.json';
if (!is_file($mapPath)) {
    redirect_404();
}

$raw = @file_get_contents($mapPath);
$data = json_decode((string)$raw, true);
if (!is_array($data) || empty($data['f'])) {
    redirect_404();
}

$filename = safe_basename((string)$data['f']);
if ($filename === '' || (isset($filename[0]) && $filename[0] === '.')) {
    redirect_404();
}

$filePath = $UPLOAD_DIR . '/' . $filename;
if (!is_file($filePath) || is_link($filePath)) {
    redirect_404();
}

$size = filesize($filePath);
if ($size === false) redirect_404();

$fh = fopen($filePath, 'rb');
if (!$fh) redirect_404();

while (ob_get_level() > 0) { @ob_end_clean(); }

@set_time_limit(0);
@ignore_user_abort(true);

$ascii = preg_replace('/[^A-Za-z0-9._-]/', '_', $filename);
if ($ascii === '' || $ascii === '.' || $ascii === '..') $ascii = 'download';

header('Content-Description: File Transfer');
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
header('Content-Length: ' . $size);
header('Cache-Control: private, max-age=0, no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

fpassthru($fh);
fclose($fh);
exit;