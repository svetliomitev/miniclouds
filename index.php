<?php
declare(strict_types=1);

$__mcLib = __DIR__ . '/lib.php';
if (!is_file($__mcLib) || !is_readable($__mcLib)) {
    // absolute last-resort fallback: send to installer instead of 500
    $p = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? ''));
    $p = rtrim($p, '/');
    $base = ($p === '/' ? '' : $p);
    header('Location: ' . ($base === '' ? '' : $base) . '/install.php', true, 302);
    exit;
}
require_once $__mcLib;

mc_security_headers();
mc_session_start();
mc_mark_admin_session_from_basic_auth();
mc_install_gate_or_redirect();

$cspNonce = mc_csp_nonce();

/* =========================
   CONFIG
   ========================= */

$UPLOAD_DIR = __DIR__ . '/uploads';
$LINK_DIR   = __DIR__ . '/links';
$BY_DIR     = $LINK_DIR . '/byname';
$CACHE_DIR  = __DIR__ . '/cache';

if (!is_dir($UPLOAD_DIR)) @mkdir($UPLOAD_DIR, 0755, true);
if (!is_dir($LINK_DIR))   @mkdir($LINK_DIR, 0755, true);
if (!is_dir($BY_DIR))     @mkdir($BY_DIR, 0755, true);
if (!is_dir($CACHE_DIR))  @mkdir($CACHE_DIR, 0755, true);

/* =========================
   MAIN
   ========================= */

csrf_init();

if (!isset($_SESSION['mc_admin_ok'])) {
    $_SESSION['mc_admin_ok'] = true;
}

$MAX_FILE_BYTES = php_upload_file_limit_bytes();
$MAX_POST_BYTES = php_post_limit_bytes();
$MAX_FILE_UPLOADS = php_max_file_uploads();
$MAX_FILE_HUMAN = format_bytes($MAX_FILE_BYTES);
$MAX_POST_HUMAN = format_bytes($MAX_POST_BYTES);

$isAjax = mc_is_ajax();

/* =========================
   INDEX LOAD (NO SELF-HEAL)
   - Only read existing caches
   - Detect drift vs baseline uploads_fingerprint.json
   - Never rebuild automatically
   ========================= */

/* Load cached file index (if missing => empty; user must Rebuild Index) */
$fileIndex = file_index_load($CACHE_DIR);

/* Shared index meta (may be empty) */
$sharedIdx = shared_index_load($CACHE_DIR);
$sharedSet = is_array($sharedIdx['set'] ?? null) ? $sharedIdx['set'] : [];
$sharedComplete = (bool)($sharedIdx['complete'] ?? false);

/* Drift detection: uploads vs baseline fingerprint
   Do this ONLY on GET (first paint / stats / list). POSTs already know what they changed,
   and will refresh the baseline via $uploadsChanged.
*/
$indexDriftKnown = false;
$indexDrift = false;

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $ajax = (string)($_GET['ajax'] ?? '');
    $doDriftCheck = ($ajax === '' || $ajax === 'stats'); // NOT for list
    if ($doDriftCheck) {
        $drift = mc_uploads_drift_detect($CACHE_DIR, $UPLOAD_DIR);
        $indexDriftKnown = (bool)($drift['known'] ?? false);
        $indexDrift = (bool)($drift['drift'] ?? false);
    }
}

/* Missing file index is also treated as “needs rebuild” (but not “drift”) */
$fileIndexPath = $CACHE_DIR . '/file_index.json';
$fileIndexMissing = !is_file($fileIndexPath);
$indexNeedsRebuild = ($fileIndexMissing || ($indexDriftKnown && $indexDrift));

// If disk has no byname records, shared index is complete+empty.
// This fixes the "complete stays false forever" case on fresh/empty installs.
if (!$sharedComplete) {
    $txtCountNow = shared_index_count_txt($BY_DIR);
    if ($txtCountNow === 0) {
        $sharedSet = [];
        $sharedComplete = true;
        shared_index_save($CACHE_DIR, $sharedSet, true);
    }
}

/* JSON stats endpoint */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && (string)($_GET['ajax'] ?? '') === 'stats') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

    $totalBytes = 0;
    foreach ($fileIndex as $it) $totalBytes += (int)($it['size'] ?? 0);

    echo json_encode([
    'ok' => true,

    // NEW: drift/missing index detection (UI will block actions)
    'index_changed' => ($indexNeedsRebuild ? 1 : 0),
    'index_changed_known' => ($indexDriftKnown ? 1 : 0),
    'index_missing' => ($fileIndexMissing ? 1 : 0),

    'total_files' => count($fileIndex),
    'total_bytes' => $totalBytes,
    'total_human' => format_bytes((int)$totalBytes),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    exit;
}

/* JSON paged list endpoint */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && (string)($_GET['ajax'] ?? '') === 'list') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

    $q = (string)($_GET['q'] ?? '');
    $from = parse_ymd((string)($_GET['from'] ?? ''), false);
    $to   = parse_ymd((string)($_GET['to'] ?? ''), true);

    $flags = (string)($_GET['flags'] ?? 'all');
    if ($flags !== 'all' && $flags !== 'shared') $flags = 'all';

    $offset = (int)($_GET['offset'] ?? 0);
    if ($offset < 0) $offset = 0;

    $limit = (int)($_GET['limit'] ?? 20);
    if ($limit < 1) $limit = 20;
    if ($limit > 200) $limit = 200;

    if ($flags === 'shared' && $sharedComplete && is_array($sharedSet) && count($sharedSet) === 0) {
        echo json_encode([
            'ok' => true,
            'files' => [],
            'count' => 0,
            'total' => 0,
            'offset' => $offset,
            'limit' => $limit,
            'has_more' => false,
            'flags_shared_index' => true,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    // If we have a complete shared index, always pass it (fast in-memory shared checks).
    // If it's not complete, pass null (will fall back to disk byname checks when needed).
    $useSharedSet = ($sharedComplete && is_array($sharedSet)) ? $sharedSet : null;

    [$page, $totalMatches] = query_files_paged(
        $fileIndex,
        $q,
        $from,
        $to,
        $flags,
        $offset,
        $limit,
        $BY_DIR,
        $useSharedSet
    );

    $hasMore = ($offset + count($page)) < $totalMatches;

    echo json_encode([
        'ok' => true,
        'files' => $page,
        'count' => count($page),
        'total' => $totalMatches,
        'offset' => $offset,
        'limit' => $limit,
        'has_more' => $hasMore,
        'flags_shared_index' => ($flags === 'shared' && $useSharedSet !== null),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/* =========================
   POST ACTIONS
   ========================= */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = (string)($_POST['action'] ?? '');

    $ok = [];
    $err = [];
    $redirectTo = '';

    $indexChanged = false;
    $sharedChanged = false;
    $uploadsChanged = false; // internal change to /uploads -> refresh baseline fingerprint

    if ($action === 'upload') {
        if (!isset($_FILES['files'])) {
            $err[] = 'No files received.';
        } else {
            $files = $_FILES['files'];
            $count = is_array($files['name']) ? count($files['name']) : 0;

            if ($MAX_FILE_UPLOADS > 0 && $count > $MAX_FILE_UPLOADS) {
                $err[] = 'Too many files selected (' . $count . '). Max allowed is ' . $MAX_FILE_UPLOADS . '.';
            } else {
                $total = 0;
                for ($i = 0; $i < $count; $i++) {
                    $total += (int)($files['size'][$i] ?? 0);
                }

                if ($count > 0 && $total > $MAX_POST_BYTES) {
                    $err[] = 'Selected files total ' . format_bytes($total) . ' exceeds server limit ' . format_bytes($MAX_POST_BYTES) . '.';
                } else {
                    for ($i = 0; $i < $count; $i++) {
                        $orig  = (string)$files['name'][$i];
                        $tmp   = (string)$files['tmp_name'][$i];
                        $upErr = (int)$files['error'][$i];
                        $size  = (int)$files['size'][$i];

                        if ($upErr === UPLOAD_ERR_NO_FILE) continue;
                        if ($upErr !== UPLOAD_ERR_OK) { $err[] = $orig . ': upload error (' . $upErr . ').'; continue; }
                        if ($size <= 0) { $err[] = $orig . ': empty file.'; continue; }
                        if ($size > $MAX_FILE_BYTES) { $err[] = $orig . ': too large (max ' . format_bytes($MAX_FILE_BYTES) . ').'; continue; }

                        $base = safe_basename($orig);
                        $base = clamp_filename($base);
                        if ($base === '' || (isset($base[0]) && $base[0] === '.')) { $err[] = 'Invalid filename: ' . $orig; continue; }

                        $target = $UPLOAD_DIR . '/' . $base;

                        if (file_exists($target)) {
                            $ext  = pathinfo($base, PATHINFO_EXTENSION);
                            $name = pathinfo($base, PATHINFO_FILENAME);

                            $n = 1;
                            do {
                                $candidateBase = $name . '-' . $n . ($ext !== '' ? '.' . $ext : '');
                                $candidateBase = clamp_filename($candidateBase);
                                $target = $UPLOAD_DIR . '/' . $candidateBase;
                                $n++;
                            } while (file_exists($target) && $n < 10000);

                            $base = basename($target);
                        }

                        if (!is_uploaded_file($tmp)) { $err[] = $orig . ': invalid upload source.'; continue; }
                        if (!@move_uploaded_file($tmp, $target)) { $err[] = $orig . ': failed to save.'; continue; }

                        $uploadsChanged = true;

                        @chmod($target, 0644);

                        $mtime = (int)(filemtime($target) ?: time());
                        $actualSize = (int)(filesize($target) ?: $size);

                        $fileIndex = file_index_upsert($fileIndex, [
                            'name' => $base,
                            'size' => $actualSize,
                            'mtime' => $mtime,
                        ]);
                        $indexChanged = true;
                        $uploadsChanged = true;

                        $ok[] = 'Uploaded: ' . $base;
                    }

                    if (!$ok && !$err) $err[] = 'No files selected.';
                }
            }
        }
    }
    elseif ($action === 'delete_one') {
        $name = safe_basename((string)($_POST['name'] ?? ''));
        if ($name === '' || (isset($name[0]) && $name[0] === '.')) {
            $err[] = 'Invalid file.';
        } else {
            $path = $UPLOAD_DIR . '/' . $name;
            if (!is_file($path)) {
                $err[] = 'File not found.';
            } else {
                $wasSharedBefore = is_shared_file($BY_DIR, $name);

                if (@unlink($path)) {
                    $ok[] = 'Deleted: ' . $name;

                    $fileIndex = file_index_remove_name($fileIndex, $name);
                    $indexChanged = true;
                    $uploadsChanged = true;

                    [$ldel, $lfail] = delete_links_for_filename($LINK_DIR, $BY_DIR, $name);

                    if ($wasSharedBefore && is_array($sharedSet)) {
                        shared_index_remove($sharedSet, $name);
                        $sharedChanged = true;
                    }

                    if ($ldel > 0 || $wasSharedBefore) $ok[] = 'Removed shared record(s) for this file.';
                    if ($lfail > 0) $err[] = 'Failed to remove ' . $lfail . ' record(s).';
                } else {
                    $err[] = 'Failed to delete: ' . $name;
                }
            }
        }
    }
    elseif ($action === 'delete_all') {
        if (!$fileIndex) {
            $err[] = 'No files to delete.';
        } else {
            $deleted = 0; $failed = 0;

            foreach ($fileIndex as $f) {
                $fn = (string)($f['name'] ?? '');
                if ($fn === '') continue;
                $p = $UPLOAD_DIR . '/' . $fn;
                if (@unlink($p)) $deleted++;
                else $failed++;
            }

            $ok[] = 'Deleted ' . $deleted . ' file(s).';
            if ($failed) $err[] = 'Failed to delete ' . $failed . ' file(s).';

            $fileIndex = [];
            $indexChanged = true;
            $uploadsChanged = true;

            [$txtDel, $jsonDel, $lFail] = delete_all_links($LINK_DIR, $BY_DIR);

            $sharedSet = [];
            $sharedComplete = true; // after deleting all links, shared index is definitely complete and empty
            $sharedChanged = true;

            $linksRemoved = min($txtDel, $jsonDel);
            if ($linksRemoved > 0) $ok[] = 'Removed ' . $linksRemoved . ' shared link(s).';

            if ($txtDel !== $jsonDel) {
                $ok[] = 'Cleanup note: removed ' . $txtDel . ' index record(s) and ' . $jsonDel . ' link file(s).';
            }
            if ($lFail > 0) $err[] = 'Failed to remove ' . $lFail . ' shared record(s).';
        }
    }
    elseif ($action === 'unshare_one') {
        $name = safe_basename((string)($_POST['name'] ?? ''));
        if ($name === '' || (isset($name[0]) && $name[0] === '.')) {
            $err[] = 'Invalid file.';
        } else {
            $path = $UPLOAD_DIR . '/' . $name;
            if (!is_file($path)) {
                $err[] = 'File not found.';
            } else {
                $wasSharedBefore = is_shared_file($BY_DIR, $name);

                [$ldel, $lfail] = delete_links_for_filename($LINK_DIR, $BY_DIR, $name);

                if (!$wasSharedBefore && $ldel === 0 && $lfail === 0) {
                    $ok[] = 'File was not shared: ' . $name;
                } else {
                    if ($lfail === 0) {
                        $ok[] = 'Shared link removed for: ' . $name;
                    } else {
                        $ok[] = 'Shared link partially removed for: ' . $name;
                        $err[] = 'Some shared record(s) could not be removed.';
                    }
                }

                if ($wasSharedBefore && is_array($sharedSet)) {
                    shared_index_remove($sharedSet, $name);
                    $sharedChanged = true;
                }
            }
        }
    }
    elseif ($action === 'rebuild_index') {
    // Rebuild BOTH file index + shared index + baseline fingerprint.
    // This is the ONLY place where rebuild is allowed.
    // (AJAX only in practice, but we keep it safe for non-AJAX too.)

    // Step 1: rebuild file index from disk
    $rebuilt = file_index_rebuild_from_disk($UPLOAD_DIR);
    file_index_save($CACHE_DIR, $rebuilt);
    $fileIndex = $rebuilt;
    $indexChanged = false; // already saved explicitly

    // Step 2: rebuild shared set from disk (byname/*.txt + links/*.json validation)
    $rebuiltShared = shared_index_rebuild_from_disk($LINK_DIR, $BY_DIR, $UPLOAD_DIR);
    $sharedSet = $rebuiltShared;
    $sharedComplete = (is_dir($BY_DIR) && is_readable($BY_DIR));
    shared_index_save($CACHE_DIR, $sharedSet, $sharedComplete);
    $sharedChanged = true;

    // Step 3: write baseline uploads fingerprint (v2) + strong sha (optional)
    $fp = mc_uploads_signature_compute($UPLOAD_DIR);
    if ($fp) {
        $strong = mc_uploads_strong_sha256_compute($UPLOAD_DIR);
        if ($strong !== '') $fp['strong_sha256'] = $strong;
        mc_uploads_fingerprint_save($CACHE_DIR, $fp);
    }
    
    $ok[] = 'Index rebuild completed.';
    $ok[] = 'Files indexed: ' . count($fileIndex) . '. Shared records: ' . count($sharedSet) . '.';
    }
    elseif ($action === 'reinstall') {
        $ht = __DIR__ . '/.htaccess';
        $st = mc_state_path();

        $ht_ok = true;
        $st_ok = true;

        if (is_file($ht)) {
            $ht_ok = @unlink($ht);
            if (!$ht_ok) $err[] = 'Failed to remove .htaccess (check permissions).';
        } else {
            $err[] = '.htaccess not found (already removed?).';
        }

        if (is_file($st)) {
            $st_ok = @unlink($st);
            if (!$st_ok) $err[] = 'Failed to remove install_state.json (check permissions).';
        } else {
            $err[] = 'install_state.json not found (already removed?).';
        }

        if ($ht_ok && $st_ok) {
            $ok[] = 'Reinstall initiated. Redirecting to installer...';
            $base = mc_base_uri();
            $redirectTo = ($base === '' ? '' : $base) . '/install.php';
        }
    }
    else {
        $err[] = 'Unknown action.';
    }

    // If uploads changed via THIS app action, update baseline fingerprint
    // so drift detection does NOT trigger a rebuild warning on normal use.
    if ($uploadsChanged) {
        $fp = mc_uploads_signature_compute($UPLOAD_DIR);
        if ($fp) {
            mc_uploads_fingerprint_save($CACHE_DIR, $fp);
        }
    }

    if ($indexChanged) file_index_save($CACHE_DIR, $fileIndex);
    if ($sharedChanged) {
        // Preserve completeness unless we explicitly know the index is complete.
        shared_index_save($CACHE_DIR, is_array($sharedSet) ? $sharedSet : [], $sharedComplete);
    }

    $totalBytes = 0;
    foreach ($fileIndex as $it) $totalBytes += (int)($it['size'] ?? 0);

    if ($isAjax) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok' => $ok,
            'err' => $err,
            'redirect' => $redirectTo,
            'stats' => [
                'total_files' => count($fileIndex),
                'total_bytes' => $totalBytes,
                'total_human' => format_bytes((int)$totalBytes),
            ],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    foreach ($ok as $m)  flash_add('ok', $m);
    foreach ($err as $m) flash_add('err', $m);
    header('Location: index.php');
    exit;
}

$flash = flash_pop();
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

/* =========================
   INSTANCE / CONFIG
   ========================= */

$state = mc_read_state();

$APP_NAME = (string)($state['app_name'] ?? 'MiniCloudS');
$APP_NAME = trim((string)preg_replace('~\s+~', ' ', $APP_NAME));
if ($APP_NAME === '' || !preg_match('~^[A-Za-z](?:[A-Za-z ]{0,62}[A-Za-z])?$~', $APP_NAME)) {
    $APP_NAME = 'MiniCloudS';
}

$APP_VERSION = (string)($state['version'] ?? 'unknown');

$INSTANCE_ID = (string)($state['instance_id'] ?? '');
$INSTANCE_ID = (preg_match('~^[a-f0-9]{16,64}$~i', $INSTANCE_ID) ? strtolower($INSTANCE_ID) : '');

$INSTALLED_AT_RAW = (string)($state['installed_at'] ?? '');
$INSTALLED_AT_TS  = ($INSTALLED_AT_RAW !== '' ? strtotime($INSTALLED_AT_RAW) : false);
$INSTALLED_AT_HUMAN = ($INSTALLED_AT_TS !== false)
    ? date('Y-m-d H:i', (int)$INSTALLED_AT_TS) // keep this, or change format if you want
    : '';

$PAGE_SIZE = (int)($state['page_size'] ?? 20);
if ($PAGE_SIZE < 20) $PAGE_SIZE = 20;
if ($PAGE_SIZE > 200) $PAGE_SIZE = 200;

/* =========================
   FIRST PAINT
   ========================= */

$initialOffset = 0;
$initialLimit  = $PAGE_SIZE;

$useSharedSetForPaint = ($sharedComplete && is_array($sharedSet)) ? $sharedSet : null;

[$filesPage, $totalMatches] = query_files_paged(
    $fileIndex,
    '',
    null,
    null,
    'all',
    $initialOffset,
    $initialLimit,
    $BY_DIR,
    $useSharedSetForPaint
);

$shownFiles = count($filesPage);
$totalFiles = $totalMatches;

$totalBytes = 0;
foreach ($fileIndex as $it) $totalBytes += (int)($it['size'] ?? 0);
$totalHuman = format_bytes((int)$totalBytes);

?>
<!doctype html>
<html lang="en" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?=h($APP_NAME)?></title>
  <link rel="icon" type="image/png" sizes="512x512" href="miniclouds-icon.png">
  <link rel="apple-touch-icon" sizes="512x512" href="miniclouds-icon.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <link rel="stylesheet" href="style.css?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>">
</head>
<body class="bg-body">

<nav class="navbar border-bottom mc-navbar">
  <div class="container">
    <div class="mc-navbar-inner">

<div class="mc-app-name">
  <span class="mc-brand" aria-label="<?= h($APP_NAME) ?>">
    <span class="mc-brand-icon" aria-hidden="true">
      <img
        src="miniclouds-icon.png"
        class="mc-brand-img"
        width="28"
        height="28"
        alt=""
        decoding="async"
      >
    </span>
    <span class="mc-brand-text"><?= h($APP_NAME) ?></span>
  </span>
</div>


      <button
        type="button"
        class="btn btn-outline-primary btn-sm mc-info-btn"
        id="mcInfoBtn"
        data-bs-toggle="modal"
        data-bs-target="#mcInfoModal"
        aria-controls="mcInfoModal"
        title="App info"
      >
        <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
        Info
      </button>

    </div>
  </div>
</nav>

<div class="container py-4 mc-page-pad">
  <div class="row g-3">

    <!-- UPLOAD -->
    <div class="col-12">
      <div class="card shadow-sm">
        <div class="card-body">
          <h5 class="card-title mb-3">Upload</h5>

          <form id="uploadForm" method="post" enctype="multipart/form-data">
            <input type="hidden" name="csrf" value="<?= h($_SESSION['csrf']) ?>">
            <input type="hidden" name="action" value="upload">

            <div class="mb-3">
              <input class="form-control" type="file" name="files[]" id="filesInput" multiple required>
            </div>

            <div class="progress mb-3 d-none" id="uploadProgressWrap" role="progressbar" aria-label="Upload progress">
              <div class="progress-bar mc-w-0" id="uploadProgressBar">0%</div>
            </div>

            <button class="btn btn-primary w-100" type="submit" id="uploadBtn">Upload</button>
          </form>

          <hr class="my-4">

          <div class="row g-2">
            <div class="col-12 col-md-4">
                <form method="post" class="js-ajax" id="rebuildIndexForm"
                    data-confirm="Rebuild file index and shared index now?">
                <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                <input type="hidden" name="action" value="rebuild_index">
                <button class="btn btn-outline-info w-100" type="submit" id="rebuildIndexBtn">
                    Rebuild Index
                </button>
                </form>
            </div>

            <div class="col-12 col-md-4">
                <form method="post" class="js-ajax" id="reinstallForm"
                    data-confirm="<?=h('Reinstall ' . $APP_NAME . '? This will remove .htaccess and install_state.json and redirect you to installer.')?>">
                <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                <input type="hidden" name="action" value="reinstall">
                <button class="btn btn-outline-warning w-100" type="submit" id="reinstallBtn">
                    Reinstall App
                </button>
                </form>
            </div>

            <div class="col-12 col-md-4">
                <form method="post" class="js-ajax" id="deleteAllForm" data-confirm="Delete ALL files?">
                <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                <input type="hidden" name="action" value="delete_all">
                <button class="btn btn-outline-danger w-100"
                        id="deleteAllBtn"
                        type="submit"
                        <?= ($totalFiles === 0) ? 'disabled aria-disabled="true"' : '' ?>>
                    Delete Files
                </button>
                </form>
            </div>
        </div>

        </div>
      </div>
    </div>

    <!-- SEARCH -->
    <div class="col-12">
      <div class="card shadow-sm">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="card-title mb-0">Search</h5>
            <div class="small text-body-secondary">
              <span id="fileCount"><?=$shownFiles?></span>
              <span class="text-body-secondary"> / </span>
              <span id="fileTotal"><?=$totalFiles?></span>
              file(s)
            </div>
          </div>

          <div class="row g-2 align-items-end">

            <div class="col-12 col-md-4">
              <label class="form-label mb-1">File Name</label>
              <input id="searchQ" class="form-control" placeholder="Searching for..." autocomplete="off">
            </div>

            <div class="col-6 col-md-2">
              <label class="form-label mb-1">From Date</label>
              <input id="searchFrom" type="date" class="form-control">
            </div>

            <div class="col-6 col-md-2">
              <label class="form-label mb-1">To Date</label>
              <input id="searchTo" type="date" class="form-control">
            </div>

            <div class="col-12 col-md-2">
              <label class="form-label mb-1">Flags</label>
              <div class="dropdown mc-flag-dd">
                <button class="btn btn-outline-light dropdown-toggle w-100" type="button"
                        id="flagsDropdownBtn" data-bs-toggle="dropdown" aria-expanded="false"
                        data-value="all">
                  <span id="flagsDropdownLabel">All files</span>
                </button>
                <ul class="dropdown-menu w-100" aria-labelledby="flagsDropdownBtn">
                  <li><button class="dropdown-item" type="button" data-flag="all">All files</button></li>
                  <li><button class="dropdown-item" type="button" data-flag="shared">Shared only</button></li>
                </ul>
              </div>
            </div>

            <div class="col-12 col-md-2 d-grid">
              <button type="button" class="btn btn-outline-warning search-clear" id="searchClear">
                Clear
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- FILES GRID -->
    <div class="col-12" id="filesSection">
      <div class="card shadow-sm">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="card-title mb-0">Files</h5>
            <div class="small text-body-secondary">
              Showing <span id="fileCount2"><?=$shownFiles?></span> / <span id="fileTotal2"><?=$totalFiles?></span>
            </div>
          </div>

          <div id="filesEmpty" class="<?= ($totalFiles > 0) ? 'd-none' : '' ?>">
            <div class="alert alert-secondary mb-0" role="alert">Use Clear button to show all files or upload new ones if you have not already.</div>
          </div>

          <div id="filesGrid" class="row g-2 <?= ($totalFiles > 0) ? '' : 'd-none' ?>">
            <?php foreach ($filesPage as $i => $f): ?>
              <?php $isShared = !empty($f['shared']); ?>
              <div class="col-12 col-md-6" data-file-card="<?=h(rawurlencode($f['name']))?>">
                <div class="file-card <?=($i % 2 === 1 ? 'alt' : '')?> <?= $isShared ? 'shared' : '' ?>"
                     data-shared="<?= $isShared ? '1' : '0' ?>"
                     data-url="">
                  <div class="file-name"><?=h($f['name'])?></div>

                  <div class="file-meta">
                    <div class="file-meta-row">
                      <div><span class="text-body-secondary">Size:</span> <?=h(format_bytes((int)$f['size']))?></div>
                      <div><span class="text-body-secondary">Date:</span> <?=h(date('Y-m-d H:i', (int)$f['mtime']))?></div>
                    </div>
                  </div>

                  <div class="file-link-row">
                    <div class="file-link-pill <?= $isShared ? 'is-clickable' : '' ?>"
                        <?= $isShared ? 'title="Click to copy link"' : '' ?>
                        role="<?= $isShared ? 'button' : 'note' ?>"
                        tabindex="<?= $isShared ? '0' : '-1' ?>"
                        data-link-pill
                        data-f="<?=h(rawurlencode($f['name']))?>">
                        <span data-link-text>
                        <?= $isShared ? h('loading…') : h('File entry not shared') ?>
                        </span>
                    </div>
                  </div>

                  <div class="file-actions">
                    <button class="btn btn-outline-secondary btn-sm" type="button"
                            data-f="<?=h(rawurlencode($f['name']))?>" data-share-btn>
                      <?= $isShared ? 'Unshare' : 'Share' ?>
                    </button>

                    <button class="btn btn-outline-primary btn-sm" type="button"
                            data-f="<?=h(rawurlencode($f['name']))?>" data-download-btn>
                      Download
                    </button>

                    <form method="post" class="js-ajax" data-confirm="Delete this file?">
                      <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                      <input type="hidden" name="action" value="delete_one">
                      <input type="hidden" name="name" value="<?=h($f['name'])?>">
                      <button class="btn btn-outline-danger btn-sm" type="submit">Delete</button>
                    </form>
                  </div>

                </div>
              </div>
            <?php endforeach; ?>
          </div>

          <div id="showMoreWrap" class="<?= ($totalFiles > $shownFiles) ? 'mt-3' : 'd-none mt-3' ?>">
            <button type="button" class="btn btn-outline-light w-100" id="showMoreBtn">Show more</button>
            <div class="small text-body-secondary text-center mt-2" id="showMoreHint">
              <?= ($totalFiles > $shownFiles) ? h('Showing ' . $shownFiles . ' of ' . $totalFiles . ' file(s).') : '' ?>
            </div>
          </div>

        </div>
      </div>
    </div>

  </div>

<div class="footerbar">
  <div class="footcard">

    <!-- ROW 1: version | size -->
    <div class="footcard-row">
      <div class="left">
        <i class="bi bi-cloud-fill" aria-hidden="true"></i>
        <span><code>v.<?= h($APP_VERSION) ?></code></span>
      </div>

      <div class="right">
        <i class="bi bi-hdd-stack-fill" aria-hidden="true"></i>
        <span><code id="totalUploaded"><?= h($totalHuman) ?></code></span>
      </div>
    </div>

    <!-- ROW 2: separator -->
    <div class="footcard-sep"></div>

    <!-- ROW 3: copyright -->
    <div class="footcard-note">
      © <?= date('Y') ?> Svetoslav Mitev. Based on MiniCloudS.
    </div>

  </div>
</div>

</div>

<!-- ACTION TOAST (pretty) -->
<div class="toast-wrap toast-wrap-action position-fixed p-3" aria-live="polite" aria-atomic="true">
  <div id="toast" class="toast border-0 w-100 pretty" role="alert" aria-live="assertive" aria-atomic="true">
    <div class="toast-body">
      <div class="toast-icon" aria-hidden="true">
        <i id="toastIcon" class="bi bi-dot"></i>
      </div>
      <div class="toast-vline" aria-hidden="true"></div>
      <div class="toast-text">
        <div class="toast-title" id="toastTitle">Message</div>
        <div class="toast-msg" id="toastBody"></div>
      </div>
      <div class="toast-close" aria-hidden="false">
        <button type="button" class="toast-x" id="toastCloseBtn" aria-label="Close">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</div>

<!-- SEARCH RESULTS TOAST (sticky) -->
<div class="toast-wrap toast-wrap-search position-fixed p-3" aria-live="polite" aria-atomic="true">
  <div id="toastSearch" class="toast border-0 w-100 pretty text-bg-warning" role="alert" aria-live="polite" aria-atomic="true">
    <div class="toast-body">
      <div class="toast-icon" aria-hidden="true">
        <i id="toastSearchIcon" class="bi bi-funnel-fill"></i>
      </div>
      <div class="toast-vline" aria-hidden="true"></div>
      <div class="toast-text">
        <div class="toast-title" id="toastSearchTitle">Search Results</div>
        <div class="toast-msg" id="toastSearchBody"></div>
      </div>
      <div class="toast-close" aria-hidden="false">
        <button type="button" class="toast-x" id="toastSearchCloseBtn" aria-label="Close">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</div>

<!-- INFORMATION MESSAGE BOX -->
<div class="modal fade" id="mcInfoModal" tabindex="-1"
     aria-labelledby="mcInfoModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="mcInfoModalLabel">
          <?= h($APP_NAME) ?> Info
        </h5>
        <button type="button" class="btn-close"
                data-bs-dismiss="modal" aria-label="Close"></button>
      </div>

      <div class="modal-body mc-info-modal-body">
        <div class="mc-info-grid">

          <div class="mc-info-section">
            <div class="mc-info-h">Instance</div>
            <div class="mc-info-v">
              <span class="mc-code-primary"><?= h($INSTANCE_ID) ?></span>
            </div>
          </div>

          <div class="mc-info-section">
            <div class="mc-info-h">Installed</div>
            <div class="mc-info-v">
              <span class="mc-code-primary"><?= h($INSTALLED_AT_HUMAN) ?></span>
            </div>
          </div>

          <div class="mc-info-section">
            <div class="mc-info-h">Version</div>
            <div class="mc-info-v">
              <span class="mc-code-primary"><?= h($APP_VERSION) ?></span>
            </div>
          </div>

        </div>

        <hr class="my-3">

        <div class="mc-info-small">
          <div class="mc-info-h2">Current Upload limits</div>
          <ul class="mc-info-list">
            <li>
              Currently uploaded:
              <span class="mc-code-primary">
                <span id="mcInfoFilesCount"><?= h((string)$totalFiles) ?></span> files,
                <span id="mcInfoTotalSize"><?= h($totalHuman) ?></span>
              </span>
            </li>
            <li>Max size per file: <span class="mc-code-primary"><?= h((string)$MAX_FILE_HUMAN) ?></span></li>
            <li>Max total size per upload: <span class="mc-code-primary"><?= h((string)$MAX_POST_HUMAN) ?></span></li>
            <li>Max number of files per upload: <span class="mc-code-primary"><?= h((string)$MAX_FILE_UPLOADS) ?></span></li>
          </ul>

          <div class="mc-info-h2 mt-3">PHP limits (hosting control panel)</div>
          <p class="mc-info-note">
            These values are controlled by your hosting panel / PHP configuration (often via
            <span class="mc-code-primary">.user.ini</span>). If uploads fail, make sure these limits are high enough.
          </p>
          <ul class="mc-info-list">
            <li>
              <span class="mc-code-primary">upload_max_filesize</span> —
              maximum size of a <em>single</em> uploaded file.
            </li>
            <li>
              <span class="mc-code-primary">post_max_size</span> —
              maximum total size of the whole upload request (all files together + form data).
            </li>
            <li>
              <span class="mc-code-primary">memory_limit</span> —
              should be comfortably above what PHP needs during upload/processing (too low can break uploads).
            </li>
            <li>
              <span class="mc-code-primary">max_file_uploads</span> —
              maximum number of files per request.
            </li>
            <li>
              <span class="mc-code-primary">max_input_vars</span> —
              not usually a blocker for file uploads, but can affect large forms in general.
            </li>
          </ul>
          <div class="mc-info-h2 mt-3">Web-server / proxy limits</div>
          <p class="mc-info-note">
            Your web server (or a reverse proxy in front of it) can also block large requests even if PHP allows them.
          </p>
          <ul class="mc-info-list">
            <li>
              <span class="mc-code-primary">client_max_body_size</span> —
              Nginx request body limit (common with reverse-proxy setups).
            </li>
            <li>
              <span class="mc-code-primary">LimitRequestBody</span> —
              Apache request body limit.
            </li>
          </ul>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- INDEX CHANGED (blocking) -->
<div class="modal fade" id="mcIndexChangedModal" tabindex="-1"
     aria-labelledby="mcIndexChangedModalLabel" aria-hidden="true"
     data-bs-backdrop="static" data-bs-keyboard="false">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="mcIndexChangedModalLabel">Index Changed</h5>
      </div>

      <div class="modal-body">
        <div class="alert alert-warning mb-0" role="alert">
          Index of files has changed because of outer intervention. You must use Rebuild Index button to rebuild the index.
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-info" data-bs-dismiss="modal" id="mcIndexChangedCloseBtn">
          OK
        </button>
      </div>

    </div>
  </div>
</div>

<!-- REBUILD PROGRESS (blocking) -->
<div class="modal fade" id="mcRebuildModal" tabindex="-1"
     aria-labelledby="mcRebuildModalLabel" aria-hidden="true"
     data-bs-backdrop="static" data-bs-keyboard="false">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="mcRebuildModalLabel">Rebuild Index</h5>
      </div>

      <div class="modal-body">
        <div class="d-flex align-items-center gap-2 mb-2">
          <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
          <div id="mcRebuildStatusText">Rebuilding indexes…</div>
        </div>
        <ul class="small text-body-secondary mb-0" id="mcRebuildSteps">
          <li>Scanning uploads and rebuilding file index…</li>
          <li>Validating shared records (links/byname)…</li>
          <li>Saving baseline fingerprint…</li>
        </ul>
      </div>

    </div>
  </div>
</div>

<button type="button" class="btn btn-primary back-to-top" id="backToTop" aria-label="Back to top" title="Back to top">↑</button>
<iframe id="mcDownloadFrame" aria-hidden="true"></iframe>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

<script nonce="<?=h($cspNonce)?>" type="application/json" id="mc-boot"><?=
  json_encode([
    'pageSize'       => $PAGE_SIZE,
    'csrf'           => $_SESSION['csrf'],
    'totalFiles'     => $totalFiles,
    'filesPage'      => $filesPage,
    'flashOk'        => $flash['ok'],
    'flashErr'       => $flash['err'],
    'maxPostBytes'   => $MAX_POST_BYTES,
    'maxFileBytes'   => $MAX_FILE_BYTES,
    'maxFileUploads' => $MAX_FILE_UPLOADS,
    'indexChanged' => ($indexNeedsRebuild ? 1 : 0),
    'indexMissing' => ($fileIndexMissing ? 1 : 0),
    'indexKnown'   => ($indexDriftKnown ? 1 : 0),
  ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
?></script>

<script src="app.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>

</body>
</html>