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

$MAX_FILE_BYTES = php_upload_file_limit_bytes();
$MAX_POST_BYTES = php_post_limit_bytes();
$MAX_FILE_UPLOADS = php_max_file_uploads();
$MAX_FILE_HUMAN = format_bytes($MAX_FILE_BYTES);
$MAX_POST_HUMAN = format_bytes($MAX_POST_BYTES);

$isAjax = mc_is_ajax();
$baseUri  = mc_base_uri();
$indexUrl = ($baseUri === '' ? '' : $baseUri) . '/index.php';

/* =========================
   INSTANCE / CONFIG
   - Read once, used for POST + HTML
   ========================= */
$state = mc_read_state();

$APP_NAME = (string)($state['app_name'] ?? 'MiniCloudS');

// Normalize Unicode whitespace (incl. NBSP) to single spaces, then trim
$APP_NAME = preg_replace('~[\s\x{00A0}]+~u', ' ', $APP_NAME) ?: '';
$APP_NAME = trim($APP_NAME);

// Allow letters (any language) + spaces between words, length 3–20
$re = '~^(?=.{3,20}$)\p{L}+(?: \p{L}+)*$~u';
if ($APP_NAME === '' || !preg_match($re, $APP_NAME)) {
    $APP_NAME = 'MiniCloudS';
}

$APP_VERSION = (string)($state['version'] ?? 'unknown');

$INSTANCE_ID = (string)($state['instance_id'] ?? '');
$INSTANCE_ID = (preg_match('~^[a-f0-9]{16,64}$~i', $INSTANCE_ID) ? strtolower($INSTANCE_ID) : '');

$ALLOW_IPS = (!empty($state['allow_ips']) && is_array($state['allow_ips'])) ? $state['allow_ips'] : [];
$tmp = [];
foreach ($ALLOW_IPS as $ip) {
    $ip = trim((string)$ip);
    if ($ip !== '') $tmp[] = $ip;
}
$ALLOWED_IPS = $tmp ? implode(', ', $tmp) : 'Any';

$INSTALLED_AT_RAW = (string)($state['installed_at'] ?? '');
$INSTALLED_AT_TS  = ($INSTALLED_AT_RAW !== '' ? strtotime($INSTALLED_AT_RAW) : false);
$INSTALLED_AT_HUMAN = ($INSTALLED_AT_TS !== false) ? date('Y-m-d H:i', (int)$INSTALLED_AT_TS) : '';

$PAGE_SIZE = (int)($state['page_size'] ?? 20);
if ($PAGE_SIZE < 20) $PAGE_SIZE = 20;
if ($PAGE_SIZE > 200) $PAGE_SIZE = 200;

$QUOTA_FILES = (int)($state['quota_files'] ?? 0);
if ($QUOTA_FILES < 0) $QUOTA_FILES = 0;
if ($QUOTA_FILES > 25000) $QUOTA_FILES = 25000;

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

$idx = mc_index_state($CACHE_DIR, $UPLOAD_DIR);
$idx_blocked = (int)$idx['idx_blocked'];
$idx_missing = (int)$idx['idx_missing'];
$idx_known   = (int)$idx['idx_known'];

/* =========================
   GET AJAX ROUTER
   ========================= */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $ajax = (string)($_GET['ajax'] ?? '');

    if ($ajax === 'stats') {
        $state = mc_index_state($CACHE_DIR, $UPLOAD_DIR);
        $idxNow = file_index_load($CACHE_DIR);

        $stats = mc_stats_payload($state, $idxNow);

        // HARD: never let stats payload drop/override the guard flags
        $stats['idx_blocked'] = (int)($state['idx_blocked'] ?? 0);
        $stats['idx_missing'] = (int)($state['idx_missing'] ?? 0);
        $stats['idx_known']   = (int)($state['idx_known'] ?? 0);

        mc_json_send([
            'ok' => true,
            'stats' => $stats,
        ]);
    }

    if ($ajax === 'list') {
        $q = (string)($_GET['q'] ?? '');
        $from = parse_ymd((string)($_GET['from'] ?? ''), false);
        $to   = parse_ymd((string)($_GET['to'] ?? ''), true);

        $qFlags = (string)($_GET['flags'] ?? 'all');
        if ($qFlags !== 'all' && $qFlags !== 'shared') $qFlags = 'all';

        $offset = (int)($_GET['offset'] ?? 0);
        if ($offset < 0) $offset = 0;

        $limit = (int)($_GET['limit'] ?? $PAGE_SIZE);
        if ($limit < 1) $limit = $PAGE_SIZE;
        if ($limit > 200) $limit = 200;

        if ($qFlags === 'shared' && $sharedComplete && is_array($sharedSet) && count($sharedSet) === 0) {
            mc_json_send([
                'ok' => true,
                'files' => [],
                'count' => 0,
                'total' => 0,
                'offset' => $offset,
                'limit' => $limit,
                'has_more' => false,
                'flags_shared_index' => true,
            ]);
        }

        // If we have a complete shared index, always pass it (fast in-memory shared checks).
        // If it's not complete, pass null (will fall back to disk byname checks when needed).
        $useSharedSet = ($sharedComplete && is_array($sharedSet)) ? $sharedSet : null;

        [$page, $totalMatches] = query_files_paged(
            $fileIndex,
            $q,
            $from,
            $to,
            $qFlags,
            $offset,
            $limit,
            $BY_DIR,
            $useSharedSet
        );

        $hasMore = ($offset + count($page)) < $totalMatches;

        mc_json_send([
            'ok' => true,
            'files' => $page,
            'count' => count($page),
            'total' => $totalMatches,
            'offset' => $offset,
            'limit' => $limit,
            'has_more' => $hasMore,
            'flags_shared_index' => ($qFlags === 'shared' && $useSharedSet !== null),
        ]);
    }
}

/* =========================
   POST ACTIONS
   ========================= */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = (string)($_POST['action'] ?? '');

    // HARD GUARD: never mutate when index/baseline is unsafe.
    $guard = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

    if (!empty($guard['idx_blocked']) && $action !== 'rebuild_index') {
        $ok = [];
        $err = ['Index changed or baseline missing. Please use Rebuild Index first.'];
        $redirectTo = '';

        if ($isAjax) {
            mc_ajax_respond(
                $ok,
                $err,
                $redirectTo,
                [],
                mc_stats_payload($guard, $fileIndex)
            );
            exit;
        }

        foreach ($err as $m) flash_add('err', $m);
        header('Location: ' . $indexUrl, true, 303);
        exit;
    }

    $ok = [];
    $err = [];
    $redirectTo = '';

    $indexChanged = false;
    $sharedChanged = false;
    $uploadsChanged = false; // internal change to /uploads -> refresh baseline fingerprint

    switch ($action) {

        case 'upload':
            if (!isset($_FILES['files'])) {
                $err[] = 'No files received.';
            } else {
                $files = $_FILES['files'];
                $count = is_array($files['name']) ? count($files['name']) : 0;

                // Quota enforcement: max number of files in uploads (0 => unlimited)
                if ($QUOTA_FILES > 0) {
                    $currentCount = count($fileIndex);

                    if ($currentCount >= $QUOTA_FILES) {
                        $err[] = 'Quota reached (' . $QUOTA_FILES . ' files). Delete files to upload new ones.';
                    } elseif ($count > ($QUOTA_FILES - $currentCount)) {
                        $left = $QUOTA_FILES - $currentCount;
                        $err[] = 'Quota allows ' . $left . ' more file(s). You selected ' . $count . '.';
                    }
                }

                if ($MAX_FILE_UPLOADS > 0 && $count > $MAX_FILE_UPLOADS) {
                    $err[] = 'Too many files selected (' . $count . '). Max allowed is ' . $MAX_FILE_UPLOADS . '.';
                }

                // If any validation error so far, do not proceed into total/loop
                if (!$err) {
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
            break;

        case 'delete_one':
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
            break;

        case 'delete_all':
            $diskFiles = mc_uploads_list_files($UPLOAD_DIR);
            if (!$diskFiles) {
                $err[] = 'No files to delete.';
            } else {
                $deleted = 0; $failed = 0;

                foreach ($diskFiles as $fn) {
                    $p = $UPLOAD_DIR . '/' . $fn;
                    if (@unlink($p)) $deleted++;
                    else $failed++;
                }

                $ok[] = 'Deleted ' . $deleted . ' file(s).';
                if ($failed) $err[] = 'Failed to delete ' . $failed . ' file(s).';
                if ($failed) {
                    $err[] = 'Some files could not be removed from disk. Index will require rebuild after you fix permissions.';
                }

                // If we failed to delete anything, keep index/baseline conservative:
                $fileIndex = [];
                $indexChanged = true;

                // Only refresh baseline when disk delete succeeded fully.
                if ($failed === 0) {
                    $uploadsChanged = true;
                } else {
                    $uploadsChanged = false;
                }

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
            break;

        case 'storage_scan':
            // Admin tool: scan biggest files (AJAX only) - real progress via chunked steps
            if (!$isAjax) {
                $err[] = 'Storage scan is available only via AJAX.';
            } else {
                $mode = (string)($_POST['mode'] ?? 'start'); // start | step

                $limit = (int)($_POST['limit'] ?? 200);
                if ($limit < 10) $limit = 10;
                if ($limit > 500) $limit = 500;

                // Shared checks: fast when we have a complete shared index
                $useSharedSetScan = ($sharedComplete && is_array($sharedSet)) ? $sharedSet : null;

                // Where we store scan session state
                $scanDir = $CACHE_DIR . '/storage_scan';
                if (!is_dir($scanDir)) @mkdir($scanDir, 0755, true);

                // Start: build sorted name list ONCE and persist for stepping
                if ($mode === 'start') {
                    $idxNow = file_index_load($CACHE_DIR);

                    $rows = array_values($idxNow);
                    usort($rows, function($a, $b){
                        $sa = (int)($a['size'] ?? 0);
                        $sb = (int)($b['size'] ?? 0);
                        if ($sa === $sb) return 0;
                        return ($sa > $sb) ? -1 : 1;
                    });

                    $names = [];
                    $n = min($limit, count($rows));
                    for ($i = 0; $i < $n; $i++) {
                        $nm = (string)($rows[$i]['name'] ?? '');
                        if ($nm !== '') $names[] = $nm;
                    }

                    // Scan id (short, safe)
                    $scanId = bin2hex(random_bytes(8));
                    $scanPath = $scanDir . '/scan_' . $scanId . '.json';

                    // Persist name list (items will be computed in steps)
                    @file_put_contents($scanPath, json_encode([
                        't' => time(),
                        'limit' => $limit,
                        'names' => $names,
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

                    $ok[] = 'Storage scan started.';
                    $idxNowState = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

                    mc_ajax_respond(
                        $ok,
                        $err,
                        '',
                        [
                            'scan_id' => $scanId,
                            'total' => count($names),
                        ],
                        mc_stats_payload($idxNowState, $idxNow)
                    );
                    exit;
                }

                // Step: compute shared flag + read size/mtime from index for a chunk
                if ($mode === 'step') {
                    $scanId = preg_replace('~[^a-f0-9]~i', '', (string)($_POST['scan_id'] ?? ''));
                    $offset = (int)($_POST['offset'] ?? 0);
                    if ($offset < 0) $offset = 0;

                    $chunk = (int)($_POST['chunk'] ?? 25);
                    if ($chunk < 5) $chunk = 5;
                    if ($chunk > 50) $chunk = 50;

                    if ($scanId === '') {
                        $err[] = 'Invalid scan id.';
                        mc_ajax_respond($ok, $err, '', [], mc_stats_payload(mc_index_state($CACHE_DIR, $UPLOAD_DIR), $fileIndex));
                        exit;
                    }

                    $scanPath = $scanDir . '/scan_' . $scanId . '.json';
                    if (!is_file($scanPath)) {
                        $err[] = 'Scan expired.';
                        mc_ajax_respond($ok, $err, '', [], mc_stats_payload(mc_index_state($CACHE_DIR, $UPLOAD_DIR), $fileIndex));
                        exit;
                    }

                    $raw = @file_get_contents($scanPath);
                    $j = json_decode((string)$raw, true);
                    $names = (is_array($j) && is_array($j['names'] ?? null)) ? $j['names'] : [];

                    $total = count($names);
                    if ($total === 0) {
                        $ok[] = 'Storage scan completed.';
                        $idxNow = file_index_load($CACHE_DIR);
                        $idxNowState = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

                        mc_ajax_respond(
                            $ok,
                            $err,
                            '',
                            [
                                'items' => [],
                                'done' => 0,
                                'total' => 0,
                                'done_flag' => 1,
                            ],
                            mc_stats_payload($idxNowState, $idxNow)
                        );
                        exit;
                    }

                    $idxNow = file_index_load($CACHE_DIR);

                    $items = [];
                    $end = min($total, $offset + $chunk);

                    for ($i = $offset; $i < $end; $i++) {
                        $nm = (string)$names[$i];
                        if ($nm === '') continue;

                        $r = $idxNow[$nm] ?? null;

                        $isShared = false;
                        if (is_array($useSharedSetScan)) {
                            $isShared = shared_index_has($useSharedSetScan, $nm);
                        } else {
                            $isShared = is_shared_file($BY_DIR, $nm);
                        }

                        $items[] = [
                            'name'   => $nm,
                            'size'   => (int)($r['size'] ?? 0),
                            'mtime'  => (int)($r['mtime'] ?? 0),
                            'shared' => $isShared ? 1 : 0,
                        ];
                    }

                    $done = $end;
                    $doneFlag = ($done >= $total) ? 1 : 0;

                    // If done, we can delete the scan file to keep cache clean
                    if ($doneFlag) {
                        @unlink($scanPath);
                        $ok[] = 'Storage scan completed.';
                    }

                    $idxNowState = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

                    mc_ajax_respond(
                        $ok,
                        $err,
                        '',
                        [
                            'items' => $items,     // chunk only
                            'done'  => $done,
                            'total' => $total,
                            'done_flag' => $doneFlag,
                        ],
                        mc_stats_payload($idxNowState, $idxNow)
                    );
                    exit;
                }

                $err[] = 'Unknown scan mode.';
            }
            break;

        case 'storage_delete':
            // Admin tool: delete selected (AJAX only) - chunk-friendly
            if (!$isAjax) {
                $err[] = 'Storage delete is available only via AJAX.';
            } else {
                $names = $_POST['names'] ?? [];
                if (!is_array($names)) $names = [];

                // When deleting in chunks, we don't want to rebuild/return the big list every time.
                // return_items=1 => include refreshed scan list in response (use only on last chunk).
                $returnItems = (int)($_POST['return_items'] ?? 1);
                if ($returnItems !== 0) $returnItems = 1;

                $deleted = 0;
                $failed = 0;

                foreach ($names as $raw) {
                    $name = safe_basename((string)$raw);
                    if ($name === '' || (isset($name[0]) && $name[0] === '.')) {
                        $failed++;
                        $err[] = 'Invalid filename.';
                        continue;
                    }

                    $path = $UPLOAD_DIR . '/' . $name;
                    if (!is_file($path)) {
                        $failed++;
                        $err[] = 'File not found: ' . $name;
                        continue;
                    }

                    $wasSharedBefore = is_shared_file($BY_DIR, $name);

                    if (@unlink($path)) {
                        $deleted++;
                        $ok[] = 'Deleted: ' . $name;

                        $fileIndex = file_index_remove_name($fileIndex, $name);
                        $indexChanged = true;
                        $uploadsChanged = true;

                        [$ldel, $lfail] = delete_links_for_filename($LINK_DIR, $BY_DIR, $name);

                        if ($wasSharedBefore && is_array($sharedSet)) {
                            shared_index_remove($sharedSet, $name);
                            $sharedChanged = true;
                        }

                        if ($ldel > 0 || $wasSharedBefore) $ok[] = 'Removed shared record(s) for: ' . $name;
                        if ($lfail > 0) $err[] = 'Failed to remove ' . $lfail . ' shared record(s) for: ' . $name;

                    } else {
                        $failed++;
                        $err[] = 'Failed to delete: ' . $name;
                    }
                }

                // If anything failed, DO NOT refresh baseline (force drift rebuild if needed)
                if ($failed > 0) $uploadsChanged = false;

                // Persist changes BEFORE we re-load for the returned list / stats
                if ($uploadsChanged) {
                    $fp = mc_uploads_signature_compute($UPLOAD_DIR);
                    if ($fp) mc_uploads_fingerprint_save($CACHE_DIR, $fp);
                }

                if ($indexChanged) file_index_save($CACHE_DIR, $fileIndex);
                if ($sharedChanged) {
                    shared_index_save($CACHE_DIR, is_array($sharedSet) ? $sharedSet : [], $sharedComplete);
                }

                // Fresh load for accurate stats + optional refreshed scan list
                $idxNow = file_index_load($CACHE_DIR);
                $afterState = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

                $data = [
                    'deleted' => $deleted,
                    'failed' => $failed,
                ];

                if ($returnItems === 1) {
                    // Return the updated scan list (now consistent)
                    $useSharedSetScan = ($sharedComplete && is_array($sharedSet)) ? $sharedSet : null;

                    $rows = array_values($idxNow);
                    usort($rows, function($a, $b){
                        $sa = (int)($a['size'] ?? 0);
                        $sb = (int)($b['size'] ?? 0);
                        if ($sa === $sb) return 0;
                        return ($sa > $sb) ? -1 : 1;
                    });

                    $items = [];
                    $n = min(200, count($rows));
                    for ($i = 0; $i < $n; $i++) {
                        $r = $rows[$i];
                        $nm = (string)($r['name'] ?? '');
                        if ($nm === '') continue;

                        $isShared = false;
                        if (is_array($useSharedSetScan)) $isShared = shared_index_has($useSharedSetScan, $nm);
                        else $isShared = is_shared_file($BY_DIR, $nm);

                        $items[] = [
                            'name'   => $nm,
                            'size'   => (int)($r['size'] ?? 0),
                            'mtime'  => (int)($r['mtime'] ?? 0),
                            'shared' => $isShared ? 1 : 0,
                        ];
                    }

                    $data['items'] = $items;
                }

                mc_ajax_respond(
                    $ok,
                    $err,
                    '',
                    $data,
                    mc_stats_payload($afterState, $idxNow)
                );
                exit;
            }
            break;

        case 'unshare_one':
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
            break;

        case 'rebuild_index':
            // Rebuild BOTH file index + shared index + baseline fingerprint.
            // This is the ONLY place where rebuild is allowed.

            // Step 1: rebuild file index from disk
            $rebuilt = file_index_rebuild_from_disk($UPLOAD_DIR);
            file_index_save($CACHE_DIR, $rebuilt);
            $fileIndex = $rebuilt;
            $indexChanged = false; // already saved explicitly

            // Step 2: rebuild shared set from disk
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
            break;

        case 'reinstall':
            $ok[] = 'Reconfigure: redirecting to installer…';
            $redirectTo = ($baseUri === '' ? '' : $baseUri) . '/install.php';
            break;

        default:
            $err[] = 'Unknown action.';
            break;
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

    $afterState = mc_index_state($CACHE_DIR, $UPLOAD_DIR);

    if ($isAjax) {
        mc_ajax_respond(
            $ok,
            $err,
            $redirectTo,
            [],
            mc_stats_payload($afterState, $fileIndex)
        );
        exit;
    }

    foreach ($ok as $m)  flash_add('ok', $m);
    foreach ($err as $m) flash_add('err', $m);
    header('Location: ' . $indexUrl, true, 303);
    exit;
}

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
$totalFiles = $totalMatches;         // matches current query/filter
$totalFilesAll = count($fileIndex);  // ALL files in index (filter-independent)

$totalBytes = mc_index_total_bytes($fileIndex);
$totalHuman = format_bytes($totalBytes);

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

          <button class="btn btn-outline-warning w-100 d-md-none mb-2"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#mcAdminActions"
                  aria-expanded="false"
                  aria-controls="mcAdminActions">
            <span class="d-flex justify-content-between align-items-center">
              <span>Admin Actions</span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </span>
          </button>

          <div id="mcAdminActions" class="collapse d-md-block">
            <div class="row g-2">
              <div class="col-12 col-md-3">
                <!-- Check Index = use ajax to detect drift -->
                <button class="btn btn-outline-light w-100"
                        type="button"
                        id="checkIndexBtn"
                        title="Check for uploads drift (outer changes via SSH/FTP)."
                        aria-label="Check for uploads drift (outer changes via SSH/FTP).">
                  Check Index
                </button>

                <!-- Hidden AJAX rebuild form (triggered from blocking modal) -->
                <form method="post" class="js-ajax d-none" id="rebuildIndexForm">
                  <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                  <input type="hidden" name="action" value="rebuild_index">
                  <button type="submit" id="rebuildIndexHiddenSubmit" tabindex="-1" aria-hidden="true"></button>
                </form>
              </div>

              <div class="col-12 col-md-3">
                <form method="post" class="js-ajax" id="reinstallForm"
                      data-confirm="<?=h('Reconfigure ' . $APP_NAME . '? This will open the installer to update settings (password can be left blank to keep current one). All uploaded files and shared links will be retained.')?>">
                  <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                  <input type="hidden" name="action" value="reinstall">
                  <button class="btn btn-outline-primary w-100"
                          type="submit"
                          id="reinstallBtn"
                          title="Opens the installer to update settings. Uploads are preserved."
                          aria-label="Opens the installer to update settings. Uploads are preserved.">
                    Reconfigure App
                  </button>
                </form>
              </div>

              <div class="col-12 col-md-3">
                <button
                  class="btn btn-outline-warning w-100"
                  type="button"
                  id="storageControlBtn"
                  title="Scan biggest files and delete selected ones."
                  aria-label="Scan biggest files and delete selected ones."
                >
                  Storage Control
                </button>
              </div>

              <div class="col-12 col-md-3">
                <form method="post" class="js-ajax" id="deleteAllForm" data-confirm="Delete ALL uploaded files and ALL shared links, also clear file index and share index? This cannot be undone.">
                  <input type="hidden" name="csrf" value="<?=h($_SESSION['csrf'])?>">
                  <input type="hidden" name="action" value="delete_all">
                  <button class="btn btn-outline-danger w-100"
                          id="deleteAllBtn"
                          type="submit"
                          title="Deletes ALL uploaded files and clears all share links."
                          aria-label="Deletes ALL uploaded files and clears all share links."
                          <?= ($totalFilesAll === 0) ? 'disabled aria-disabled="true"' : '' ?>>
                    Delete Files
                  </button>
                </form>
              </div>
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
                Reset
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
            <div class="alert alert-secondary mb-0" role="alert">Use Reset button to show all files or upload new ones if you have not already.</div>
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
  <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
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

            <div class="mc-info-section">
              <div class="mc-info-h">Allowed IPs</div>
              <div class="mc-info-v">
                <span class="mc-code-primary"><?= h($ALLOWED_IPS) ?></span>
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
                <span id="mcInfoFilesCount"><?= h((string)$totalFilesAll) ?></span> files,
                <span id="mcInfoTotalSize"><?= h($totalHuman) ?></span>
              </span>
            </li>
            <li>
              Current upload quota:
              <span class="mc-code-primary">
                <?= ($QUOTA_FILES > 0 ? h((string)$QUOTA_FILES) . ' files' : 'Unlimited') ?>
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
              <span class="mc-code-primary">upload_max_filesize</span> -
              maximum size of a <em>single</em> uploaded file.
            </li>
            <li>
              <span class="mc-code-primary">post_max_size</span> -
              maximum total size of the whole upload request (all files together + form data).
            </li>
            <li>
              <span class="mc-code-primary">memory_limit</span> -
              should be comfortably above what PHP needs during upload/processing (too low can break uploads).
            </li>
            <li>
              <span class="mc-code-primary">max_file_uploads</span> -
              maximum number of files per request.
            </li>
            <li>
              <span class="mc-code-primary">max_input_vars</span> -
              not usually a blocker for file uploads, but can affect large forms in general.
            </li>
          </ul>
          <div class="mc-info-h2 mt-3">Web-server / proxy limits</div>
          <p class="mc-info-note">
            Your web server (or a reverse proxy in front of it) can also block large requests even if PHP allows them.
          </p>
          <ul class="mc-info-list">
            <li>
              <span class="mc-code-primary">client_max_body_size</span> -
              Nginx request body limit (common with reverse-proxy setups).
            </li>
            <li>
              <span class="mc-code-primary">LimitRequestBody</span> -
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
          Index of files has changed because of outer intervention, or the baseline fingerprint is missing.
          You must rebuild the index to continue.
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-info w-100" id="mcRebuildIndexNowBtn">
          Rebuild Index Now
        </button>
      </div>

    </div>
  </div>
</div>

<!-- STORAGE CONTROL (admin) -->
<div class="modal fade" id="mcStorageModal" tabindex="-1"
     aria-labelledby="mcStorageModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="mcStorageModalLabel">Storage Control</h5>
        <button type="button" class="btn-close"
                data-bs-dismiss="modal" aria-label="Close"></button>
      </div>

      <div class="modal-body">

        <div class="row g-2 mb-3 align-items-center">
          <!-- Buttons row -->
          <div class="col-6 col-sm-auto">
            <button type="button"
                    class="btn btn-outline-info w-100"
                    id="mcStorageScanBtn">
              Scan biggest files
            </button>
          </div>

          <div class="col-6 col-sm-auto">
            <button type="button"
                    class="btn btn-outline-danger w-100"
                    id="mcStorageDeleteBtn"
                    disabled aria-disabled="true">
              Delete selected
            </button>
          </div>

          <!-- Summary row -->
          <div class="col-12 col-sm ms-sm-auto">
            <div class="small text-body-secondary text-sm-end">
              <span id="mcStorageSummary">No data.</span>
            </div>
          </div>
        </div>

        <div class="progress mb-3 d-none" id="mcStorageProgressWrap" role="progressbar" aria-label="Storage tool progress">
          <div class="progress-bar mc-w-0" id="mcStorageProgressBar">0%</div>
        </div>

        <div id="mcStorageMsg" class="small mb-3 d-none" role="status" aria-live="polite"></div>

        <div id="mcStorageList" class="mc-storage-list">
          <!-- JS renders rows here -->
        </div>

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
    'quotaFiles'     => $QUOTA_FILES,
    'csrf'           => $_SESSION['csrf'],
    'totalFiles'     => $totalFilesAll, // IMPORTANT: all uploads, not filtered matches
    'filesPage'      => $filesPage,
    'flashOk'        => $flash['ok'],
    'flashErr'       => $flash['err'],
    'maxPostBytes'   => $MAX_POST_BYTES,
    'maxFileBytes'   => $MAX_FILE_BYTES,
    'maxFileUploads' => $MAX_FILE_UPLOADS,
    'idx_blocked' => $idx_blocked,
    'idx_missing' => $idx_missing,
    'idx_known'   => $idx_known,
  ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
?></script>

<script src="js/mc_helpers.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_net.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_ops_ui.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_guard.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_modals_hardlock.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_toast.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_renderlife.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_render_files.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_endpoints.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_stats.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_checkindex.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_links.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_list.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_upload.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_search.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_ajaxforms.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_delegated_actions.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_storage_control.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_rowbusy.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="js/mc_init.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>
<script src="app.js?v=<?=rawurlencode((string)($APP_VERSION ?? '1'))?>" defer></script>

</body>
</html>