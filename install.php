<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

mc_security_headers();
mc_session_start();

$nonce = mc_csp_nonce();

$APP_VERSION = '1.9.14';

/* =========================
   INSTALLER / RECONFIGURATOR
   Writes ONLY: .htaccess + .htpasswd + install_state.json
   ========================= */

$HTACCESS = __DIR__ . '/.htaccess';
$HTPASSWD = __DIR__ . '/.htpasswd';

$baseUri  = mc_base_uri();

$alreadyInstalled = mc_is_installed();
$isFirstInstall   = !$alreadyInstalled;

/* If already installed, require authenticated admin session (set after BasicAuth). */
if ($alreadyInstalled) {
    mc_mark_admin_session_from_basic_auth();

    mc_require_admin_session_or_pretty_403(
        'Installer is available only to authenticated admins.',
        'Open index.php, login, then return to install.php to modify settings.'
    );
}

/* =========================
   Allowed preset values
   ========================= */
$PAGE_SIZE_CHOICES = [20, 50, 100, 200];
$QUOTA_CHOICES     = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 25000];
$DEFAULT_PAGE_SIZE   = 20;
$DEFAULT_QUOTA_FILES = 100;
$APPNAME_MIN_LEN = 3;
$APPNAME_MAX_LEN = 20;
$PASS_MIN_LEN = 8;
$PASS_MAX_LEN = 128;
$USERNAME_MIN_LEN = 5;
$USERNAME_MAX_LEN = 12;

/* -------------------------
   Inline error + form state
   ------------------------- */
$error = '';

$userVal     = 'admin';
$authNameVal = 'MiniCloudS';
$ipsVal      = '';

$pageSizeVal = (string)$DEFAULT_PAGE_SIZE;
$quotaVal    = (string)$DEFAULT_QUOTA_FILES; // default quota

$passVal     = '';
$pass2Val    = '';

$pageSize = (int)$DEFAULT_PAGE_SIZE;
$quotaFiles = (int)$DEFAULT_QUOTA_FILES;

/* Prefill from install_state.json on reinstall (reconfigurator mode) */
if ($alreadyInstalled) {
    $st = mc_read_state();
    if (is_array($st)) {
        if (!empty($st['app_name']) && is_string($st['app_name'])) {
            $authNameVal = (string)$st['app_name'];
            $authNameVal = preg_replace('~[\s\x{00A0}]+~u', ' ', $authNameVal) ?: '';
            $authNameVal = trim($authNameVal);
        }
        if (!empty($st['admin_user']) && is_string($st['admin_user'])) {
            $userVal = trim((string)$st['admin_user']);
        }

        if (!empty($st['allow_ips']) && is_array($st['allow_ips'])) {
            $ipsVal = implode(', ', $st['allow_ips']);
        } else {
            $ipsVal = '';
        }

        $ps = (int)$st['page_size']; // normalized by mc_read_state()
        if (!in_array($ps, $PAGE_SIZE_CHOICES, true)) $ps = $PAGE_SIZE_CHOICES[0];
        $pageSizeVal = (string)$ps;
        $pageSize = $ps;

        $qf = (int)$st['quota_files']; // normalized by mc_read_state()
        if (!in_array($qf, $QUOTA_CHOICES, true)) $qf = (int)$DEFAULT_QUOTA_FILES;
        $quotaVal = (string)$qf;
        $quotaFiles = $qf;
    }
}

/* Existing bcrypt hash (used for "keep password" on reinstall) */
$existingHtHash = ($alreadyInstalled ? mc_htpasswd_read_hash($HTPASSWD) : '');

/* -------------------------
   POST
   ------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && (string)($_POST['action'] ?? '') === 'install') {

    $authNameVal = (string)($_POST['authname'] ?? $authNameVal);
    // Normalize Unicode whitespace (incl. NBSP) to single spaces, then trim
    $authNameVal = preg_replace('~[\s\x{00A0}]+~u', ' ', $authNameVal) ?: '';
    $authNameVal = trim($authNameVal);

    $userVal     = trim((string)($_POST['user'] ?? 'admin'));
    $ipsVal      = trim((string)($_POST['ips'] ?? ''));

    $pageSizeVal = trim((string)($_POST['pagesize'] ?? $DEFAULT_PAGE_SIZE));
    $quotaVal    = trim((string)($_POST['quota_files'] ?? $DEFAULT_QUOTA_FILES));

    // Keep password values on error (requested)
    $passVal  = (string)($_POST['pass'] ?? '');
    $pass2Val = (string)($_POST['pass2'] ?? '');

    /* Validate */
    // Letters (any language) + spaces between words, total length 3–20
    // - no leading/trailing spaces (we trim above)
    // - no double spaces (we normalize above)
    // - at least one letter
    $re = '~^(?=.{'.$APPNAME_MIN_LEN.','.$APPNAME_MAX_LEN.'}$)\p{L}+(?: \p{L}+)*$~u';

    if ($authNameVal === '' || !preg_match($re, $authNameVal)) {
        $error = 'Bad application name. Allowed: letters and spaces only (including Cyrillic), length '
            . $APPNAME_MIN_LEN . '–' . $APPNAME_MAX_LEN . '.';
    } elseif (
        $userVal === '' ||
        strlen($userVal) < $USERNAME_MIN_LEN ||
        strlen($userVal) > $USERNAME_MAX_LEN ||
        !preg_match('~^[A-Za-z][A-Za-z0-9._-]*$~', $userVal)
    ) {
        $error = 'Bad username. Allowed: ASCII letters/digits plus . _ - '
            . '(must start with a letter, length '
            . $USERNAME_MIN_LEN . '–' . $USERNAME_MAX_LEN . ').';
    } elseif (strpos($userVal, ':') !== false) {
        // Safety: ":" is a delimiter in .htpasswd (user:hash)
        $error = 'Bad username. Character ":" is not allowed.';
    } elseif (preg_match('~[._-]$~', $userVal)) {
        $error = 'Bad username. Must not end with . _ or -';
    } elseif (preg_match('~[._-]{2,}~', $userVal)) {
        $error = 'Bad username. Avoid repeated separators like "..", "__", "--".';
    } else {
        $ps = (int)$pageSizeVal;
        if (!in_array($ps, $PAGE_SIZE_CHOICES, true)) {
            $error = 'Bad files-per-page value.';
        } else {
            $pageSize = $ps;
        }
    }

    if ($error === '') {
        $qf = (int)$quotaVal;
        if (!in_array($qf, $QUOTA_CHOICES, true)) {
            $error = 'Bad quota value.';
        } else {
            $quotaFiles = $qf;
        }
    }

    if ($error === '') {
        // Password rules:
        // - ASCII printable characters only (no spaces, no Unicode)
        // - Length: 8..128
        // - First install: required + must match
        // - Reinstall: blank+blank means "keep existing"

        if (!$isFirstInstall && $passVal === '' && $pass2Val === '') {
            if ($existingHtHash === '') {
                $error = 'Existing password hash not found; please set a new password.';
            }
        } else {
            if ($passVal === '' || $passVal !== $pass2Val) {
                $error = 'Password empty or mismatch.';
            } elseif (
                strlen($passVal) < $PASS_MIN_LEN ||
                strlen($passVal) > $PASS_MAX_LEN
            ) {
                $error = 'Password length must be between '
                    . $PASS_MIN_LEN . ' and ' . $PASS_MAX_LEN . ' characters.';
            } elseif (!preg_match('~^[\x21-\x7E]+$~', $passVal)) {
                // ASCII 33 (!) .. 126 (~), excludes space and all Unicode
                $error = 'Password contains invalid characters. '
                    . 'Use standard ASCII symbols only (no spaces, no Cyrillic).';
            }
        }
    }

    /* Normalize IP allowlist (optional) only if earlier validation passed */
    $ips = [];
    if ($error === '' && $ipsVal !== '') {
        foreach (preg_split('~[,\s]+~', $ipsVal) as $ip) {
            $ip = trim((string)$ip);
            if ($ip === '') continue;

            // CIDR?
            if (strpos($ip, '/') !== false) {
                $parts = explode('/', $ip, 2);
                $addr = trim((string)($parts[0] ?? ''));
                $mask = trim((string)($parts[1] ?? ''));

                if ($addr === '' || $mask === '') {
                    $error = 'Bad CIDR in allowlist: ' . $ip;
                    break;
                }

                if (!filter_var(
                    $addr,
                    FILTER_VALIDATE_IP,
                    FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
                )) {
                    $error = 'Non-public IP in allowlist: ' . $ip;
                    break;
                }

                // Validate mask
                if (filter_var($addr, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                    if (!ctype_digit($mask) || (int)$mask < 0 || (int)$mask > 32) {
                        $error = 'Bad IPv4 CIDR mask: ' . $ip;
                        break;
                    }
                } else {
                    if (!ctype_digit($mask) || (int)$mask < 0 || (int)$mask > 128) {
                        $error = 'Bad IPv6 CIDR mask: ' . $ip;
                        break;
                    }
                }

                $ips[] = $addr . '/' . (int)$mask;
                continue;
            }

            // Single IP (no CIDR)
            if (!filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
            )) {
                $error = 'Non-public IP in allowlist: ' . $ip;
                break;
            }

            $ips[] = $ip;
        }
    }

    /* If validation ok -> write files */
    if ($error === '') {

        // Password hash: either keep existing (reinstall + blank) or compute new bcrypt
        $hash = '';
        if (!$isFirstInstall && $passVal === '' && $pass2Val === '') {
            $hash = $existingHtHash;
        } else {
            $hash = password_hash($passVal, PASSWORD_BCRYPT);
        }

        if (!$hash) {
            $error = 'Failed to obtain password hash.';
        } else {
            $hpLine = $userVal . ':' . $hash . "\n";
            if (@file_put_contents($HTPASSWD, $hpLine, LOCK_EX) === false) {
                $error = 'Cannot write .htpasswd. Fix permissions for: ' . $HTPASSWD;
            } else {
                @chmod($HTPASSWD, 0640);

                $rwBase       = mc_rewrite_base(); // from lib.php
                $authNameSafe = mc_auth_realm_from_app_name($authNameVal);

                $indexIpRules = ($ips ? ('Require ip ' . implode(' ', $ips)) : 'Require all granted');

                $err401 = ($baseUri === '' ? '' : $baseUri) . "/error.php?e=401";
                $err403 = ($baseUri === '' ? '' : $baseUri) . "/error.php?e=403";
                $err404 = ($baseUri === '' ? '' : $baseUri) . "/error.php?e=404";

                // Build htaccess
                $ht  = "Options -Indexes\n";
                $ht .= "ServerSignature Off\n\n";

                $ht .= "RewriteEngine On\n";
                $ht .= "RewriteBase " . $rwBase . "\n\n";

                $ht .= "# STOP inheriting BasicAuth from parent directories\n";
                $ht .= "AuthMerging Off\n\n";

                $ht .= "DirectoryIndex index.php\n\n";
                $ht .= "Require all granted\n\n";

                /* error pages (public) */
                $ht .= "<Files \"error.php\">\n";
                $ht .= "  Require all granted\n";
                $ht .= "</Files>\n\n";

                /* install.php (configurator) protected */
                $ht .= "<Files \"install.php\">\n";
                $ht .= "  AuthType Basic\n";
                $ht .= "  AuthName \"" . $authNameSafe . "\"\n";
                $ht .= "  AuthUserFile " . $HTPASSWD . "\n";
                $ht .= "  <RequireAll>\n";
                $ht .= "    Require valid-user\n";
                $ht .= "    " . $indexIpRules . "\n";
                $ht .= "  </RequireAll>\n";
                $ht .= "</Files>\n\n";

                $ht .= "ErrorDocument 401 " . $err401 . "\n";
                $ht .= "ErrorDocument 403 " . $err403 . "\n";
                $ht .= "ErrorDocument 404 " . $err404 . "\n\n";

                /* public assets */
                $ht .= "<FilesMatch \"^(?:app\\.js|style\\.css|miniclouds-icon\\.png)$\">\n";
                $ht .= "  Require all granted\n";
                $ht .= "</FilesMatch>\n\n";

                /* blocks with pretty 403 */
                $ht .= "# Block internal storage directories\n";
                $ht .= "RewriteRule ^(?:uploads|links|cache)(?:/|$) error.php?e=403 [L,QSA]\n\n";

                $ht .= "# Never serve install_state.json\n";
                $ht .= "RewriteRule ^install_state\\.json$ error.php?e=403 [L,QSA]\n\n";

                $ht .= "# Never serve lib.php\n";
                $ht .= "RewriteRule ^lib\\.php$ error.php?e=403 [L,QSA]\n\n";

                /* short links */
                $ht .= "# Short links -> download.php?via=1\n";
                $ht .= "RewriteRule ^d/([A-Za-z0-9_-]{6,32})$ download.php?c=\$1&via=1 [L,QSA]\n";
                $ht .= "RewriteRule ^d/.*$ error.php?e=404 [L,QSA]\n\n";

                /* pretty 404 for non-existent PHP */
                $ht .= "# Catch non-existent PHP files BEFORE PHP-FPM (pretty 404)\n";
                $ht .= "RewriteCond %{REQUEST_URI} \\.php$ [NC]\n";
                $ht .= "RewriteCond %{REQUEST_FILENAME} !-f\n";
                $ht .= "RewriteCond %{REQUEST_FILENAME} !-d\n";
                $ht .= "RewriteRule . error.php?e=404 [L,QSA]\n\n";

                /* protect ONLY index.php (front door) */
                $ht .= "<Files \"index.php\">\n";
                $ht .= "  AuthType Basic\n";
                $ht .= "  AuthName \"" . $authNameSafe . "\"\n";
                $ht .= "  AuthUserFile " . $HTPASSWD . "\n";
                $ht .= "  <RequireAll>\n";
                $ht .= "    Require valid-user\n";
                $ht .= "    " . $indexIpRules . "\n";
                $ht .= "  </RequireAll>\n";
                $ht .= "</Files>\n\n";

                if (@file_put_contents($HTACCESS, $ht, LOCK_EX) === false) {
                    $error = 'Cannot write .htaccess. Fix permissions for: ' . $HTACCESS;
                } else {
                    @chmod($HTACCESS, 0644);

                    // Write install_state.json (NO password stored)
                    try {
                        // Unified writer: version, app, page size, quota, admin user, allowlist
                        mc_write_install_state($APP_VERSION, $authNameVal, $pageSize, $quotaFiles, $userVal, $ips);
                    } catch (Throwable $e) {
                        $error = 'Failed to write install_state.json: ' . $e->getMessage();
                    }

                    if ($error === '') {

                        // Initial index build only on first install (not on configurator run)
                        if ($isFirstInstall) {
                            $UPLOAD_DIR = __DIR__ . '/uploads';
                            $LINK_DIR   = __DIR__ . '/links';
                            $BY_DIR     = $LINK_DIR . '/byname';
                            $CACHE_DIR  = __DIR__ . '/cache';

                            if (!is_dir($UPLOAD_DIR)) @mkdir($UPLOAD_DIR, 0755, true);
                            if (!is_dir($LINK_DIR))   @mkdir($LINK_DIR, 0755, true);
                            if (!is_dir($BY_DIR))     @mkdir($BY_DIR, 0755, true);
                            if (!is_dir($CACHE_DIR))  @mkdir($CACHE_DIR, 0755, true);

                            $fileIndex = file_index_rebuild_from_disk($UPLOAD_DIR);
                            file_index_save($CACHE_DIR, $fileIndex);

                            $sharedSet = shared_index_rebuild_from_disk($LINK_DIR, $BY_DIR, $UPLOAD_DIR);
                            $sharedComplete = (is_dir($BY_DIR) && is_readable($BY_DIR));
                            shared_index_save($CACHE_DIR, $sharedSet, $sharedComplete);

                            $fp = mc_uploads_signature_compute($UPLOAD_DIR);
                            if (!empty($fp)) {
                                mc_uploads_fingerprint_save($CACHE_DIR, $fp);
                            }
                        }

                        header('Location: ' . ($baseUri === '' ? '' : $baseUri) . '/index.php', true, 302);
                        exit;
                    }
                }
            }
        }
    }

    if ($error !== '') {
        http_response_code(400);
    }
}

/* =========================
   Installer UI (Bootstrap dropdowns)
   ========================= */

$base = $baseUri; // reuse
$rw   = mc_rewrite_base();
$dirWritable = is_writable(__DIR__);

function mc_choice_label_int(int $v): string {
    return number_format($v, 0, '.', ' ') . ' files';
}

$btnLabel = $alreadyInstalled ? 'Save Settings' : 'Install MiniCloudS';
$indexUrl = ($baseUri === '' ? '' : $baseUri) . '/index.php';

echo '<!doctype html><html lang="en" data-bs-theme="dark"><head>';
echo '<meta charset="utf-8">';
echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
echo '<title>MiniCloudS Installer</title>';
echo '<link rel="icon" type="image/png" sizes="512x512" href="miniclouds-icon.png?v=' . rawurlencode((string)$APP_VERSION) . '">';
echo '<link rel="apple-touch-icon" sizes="512x512" href="miniclouds-icon.png?v=' . rawurlencode((string)$APP_VERSION) . '">';

echo '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">';
echo '<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">';

echo '<style nonce="' . h($nonce) . '">
.mc-wrap{max-width:1040px}

.mc-title-row{display:flex;align-items:center;gap:.6rem}
.mc-app-icon{width:36px;height:36px;flex:0 0 36px;display:block}
@media (max-width: 992px){.mc-app-icon{transform: translateY(-1px)}}
@media (max-width: 480px){.mc-app-icon{transform: translateY(-2px)}}

.mc-pill{display:inline-flex;align-items:center;gap:.5rem}
.mc-help{font-size:.875rem}
.mc-dd-btn{display:flex;justify-content:space-between;align-items:center}

/* ---- restore old installer "code chip" look (Bootstrap makes code pink) ---- */
code{
  background:#212529;
  border:1px solid rgba(255,255,255,.12);
  padding:2px 8px;
  border-radius:10px;
  color:#cbd5e1;
  font-size: .95em;
}

/* Ensure badge/alert contexts don’t override it */
.badge code,
.alert code,
.card code{
  background:#212529;
  border:1px solid rgba(255,255,255,.12);
  color:#cbd5e1;
}

/* Optional: keep inline code from looking “too loud” inside long text blocks */
.small code{
  font-size: .95em;
}
</style>';

echo '</head><body class="bg-body">';
echo '<div class="container py-4 mc-wrap">';

echo '<div class="mb-3">';
echo '  <div class="mc-title-row">';
echo '    <img class="mc-app-icon" src="miniclouds-icon.png?v=' . h($APP_VERSION) . '" alt="">';
echo '    <div>';
echo '      <div class="h4 mb-0">MiniCloudS Installer</div>';
echo '    </div>';
echo '  </div>';
echo '</div>';

echo '<div class="card shadow-sm">';
echo '  <div class="card-body">';

echo '    <div class="d-flex flex-wrap gap-2 mb-3">';
echo '      <span class="badge text-bg-secondary mc-pill">Detected base URI: <code class="ms-1">' . h($base === '' ? '(root)' : $base) . '</code></span>';
echo '      <span class="badge text-bg-secondary mc-pill">RewriteBase: <code class="ms-1">' . h($rw) . '</code></span>';
echo '      <span class="badge text-bg-secondary mc-pill">Version: <code class="ms-1">' . h($APP_VERSION) . '</code></span>';
echo '    </div>';

if (!$dirWritable) {
    echo '<div class="alert alert-danger mb-3" role="alert">';
    echo '<strong>Warning:</strong> Directory is not writable: <code>' . h(__DIR__) . '</code><br>Fix ownership/permissions, then reload.';
    echo '</div>';
}

if ($error !== '') {
    echo '<div class="alert alert-danger mb-3" role="alert">';
    echo '<strong>' . ($alreadyInstalled ? 'Save error:' : 'Install error:') . '</strong> ' . h($error);
    echo '</div>';
}

echo '    <form method="post" autocomplete="off">';
echo '      <input type="hidden" name="action" value="install">';

echo '      <div class="row g-3">';

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Application Name</label>';
echo '          <input class="form-control" id="authname" name="authname" value="' . h($authNameVal) . '">';
echo '        </div>';

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Admin Username</label>';
echo '          <input class="form-control" id="user" name="user" value="' . h($userVal) . '" required>';
echo '        </div>';

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Password (ASCII only)</label>';
echo '          <div class="input-group">';
echo '            <input class="form-control" id="pass" type="password" name="pass" value="' . h($passVal) . '" ' . ($alreadyInstalled ? 'placeholder="Leave blank to keep existing password"' : 'required') . '>';
echo '            <button class="btn btn-outline-secondary" type="button" data-toggle="pw" data-target="pass" aria-label="Show password">Show</button>';
echo '          </div>';
echo '        </div>';

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Repeat Password</label>';
echo '          <div class="input-group">';
echo '            <input class="form-control" id="pass2" type="password" name="pass2" value="' . h($pass2Val) . '" ' . ($alreadyInstalled ? 'placeholder="Leave blank to keep existing password"' : 'required') . '>';
echo '            <button class="btn btn-outline-secondary" type="button" data-toggle="pw" data-target="pass2" aria-label="Show password confirmation">Show</button>';
echo '          </div>';
echo '        </div>';

echo '        <div class="col-12">';
echo '          <label class="form-label">Allow public IPs for admin access (optional)</label>';
echo '          <input class="form-control" id="ips" name="ips" value="' . h($ipsVal) . '" placeholder="e.g. 1.2.3.4, 5.6.7.0/24, 2001:4860::/32">';
echo '          <div class="text-body-secondary mc-help mt-1">IPs separated by comma/spaces. If empty: any IP allowed. No private/local IPs.</div>';
echo '        </div>';

/* ---- Files per page dropdown ---- */
$psInt = (int)$pageSizeVal;
if (!in_array($psInt, $PAGE_SIZE_CHOICES, true)) $psInt = (int)$DEFAULT_PAGE_SIZE;

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Files per page</label>';
echo '          <div class="dropdown w-100">';
echo '            <button class="btn btn-outline-light dropdown-toggle w-100 mc-dd-btn" type="button" id="mcPageSizeBtn" data-bs-toggle="dropdown" aria-expanded="false">';
echo '              <span id="mcPageSizeLabel">' . h((string)$psInt) . '</span>';
echo '            </button>';
echo '            <ul class="dropdown-menu w-100" aria-labelledby="mcPageSizeBtn">';
foreach ($PAGE_SIZE_CHOICES as $v) {
    echo '              <li><button class="dropdown-item" type="button" data-set-pagesize="' . h((string)$v) . '">' . h((string)$v) . '</button></li>';
}
echo '            </ul>';
echo '          </div>';
echo '          <input type="hidden" name="pagesize" id="mcPageSizeInput" value="' . h((string)$psInt) . '">';
echo '          <div class="text-body-secondary mc-help mt-1">Controls initial list and “Show more” step.</div>';
echo '        </div>';

/* ---- Quota dropdown ---- */
$qInt = (int)$quotaVal;
if (!in_array($qInt, $QUOTA_CHOICES, true)) $qInt = (int)$DEFAULT_QUOTA_FILES;

echo '        <div class="col-12 col-md-6">';
echo '          <label class="form-label">Quota (max number of files)</label>';
echo '          <div class="dropdown w-100">';
echo '            <button class="btn btn-outline-light dropdown-toggle w-100 mc-dd-btn" type="button" id="mcQuotaBtn" data-bs-toggle="dropdown" aria-expanded="false">';
echo '              <span id="mcQuotaLabel">' . h(mc_choice_label_int($qInt)) . '</span>';
echo '            </button>';
echo '            <ul class="dropdown-menu w-100" aria-labelledby="mcQuotaBtn">';
foreach ($QUOTA_CHOICES as $v) {
    echo '              <li><button class="dropdown-item" type="button" data-set-quota="' . h((string)$v) . '">' . h(mc_choice_label_int((int)$v)) . '</button></li>';
}
echo '            </ul>';
echo '          </div>';
echo '          <input type="hidden" name="quota_files" id="mcQuotaInput" value="' . h((string)$qInt) . '">';
echo '          <div class="text-body-secondary mc-help mt-1">Limits how many files may exist in <code>uploads/</code>.</div>';
echo '        </div>';

echo '      </div>'; // row

if ($alreadyInstalled) {
    echo '      <div class="d-grid gap-2 d-md-flex mt-4">';
    echo '        <button class="btn btn-primary flex-md-fill" type="submit" ' . ($dirWritable ? '' : 'disabled') . '>' . h($btnLabel) . '</button>';
    echo '        <a class="btn btn-secondary flex-md-fill" href="' . h($indexUrl) . '">Cancel</a>';
    echo '      </div>';
} else {
    echo '      <button class="btn btn-primary w-100 mt-4" type="submit" ' . ($dirWritable ? '' : 'disabled') . '>' . h($btnLabel) . '</button>';
}
echo '    </form>';

echo '    <hr class="my-4">';

echo '    <div class="small text-body-secondary">';
echo '      <div class="fw-semibold text-body mb-2">PHP Limits (set in hosting control panel)</div>';
echo '      MiniCloudS does not create <code>.user.ini</code>. To increase upload limits, adjust these in your hosting control panel / PHP configuration:';
echo '      <ul class="mb-2">';
echo '        <li><code>upload_max_filesize</code></li>';
echo '        <li><code>post_max_size</code></li>';
echo '        <li><code>memory_limit</code></li>';
echo '        <li><code>max_file_uploads</code></li>';
echo '        <li><code>max_input_vars</code></li>';
echo '      </ul>';
echo '      Also check web-server/proxy limits like Nginx <code>client_max_body_size</code> or Apache <code>LimitRequestBody</code>.';
echo '    </div>';

echo '  </div>'; // card-body
echo '</div>';   // card

echo '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>';

echo '<script nonce="' . h($nonce) . '">
(function(){
  function togglePw(btn){
    var id = btn.getAttribute("data-target");
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    var isPw = (el.type === "password");
    el.type = isPw ? "text" : "password";
    btn.textContent = isPw ? "Hide" : "Show";
  }

  function setPageSize(v){
    v = String(v || "");
    var input = document.getElementById("mcPageSizeInput");
    var label = document.getElementById("mcPageSizeLabel");
    if (input) input.value = v;
    if (label) label.textContent = v;
  }

  function quotaLabel(v){
    v = String(v || "").replace(/[^0-9]/g, "");
    if (!v) return "0 files";
    // group with spaces: 10000 -> 10 000
    var out = "";
      for (var i = 0; i < v.length; i++) {
      var pos = v.length - i;
      out += v[i];
      if (pos > 1 && (pos - 1) % 3 === 0) out += " ";
      }
    return out + " files";
  }

  function setQuota(v){
    v = String(v || "");
    var input = document.getElementById("mcQuotaInput");
    var label = document.getElementById("mcQuotaLabel");
    if (input) input.value = v;
    if (label) label.textContent = quotaLabel(v);
  }

  document.addEventListener("click", function(ev){
    var t = ev.target;

    var pwBtn = t && t.closest ? t.closest("button[data-toggle=\\"pw\\"]") : null;
    if (pwBtn) {
      ev.preventDefault();
      togglePw(pwBtn);
      return;
    }

    var psBtn = t && t.closest ? t.closest("button[data-set-pagesize]") : null;
    if (psBtn) {
      ev.preventDefault();
      setPageSize(psBtn.getAttribute("data-set-pagesize") || "");
      return;
    }

    var qBtn = t && t.closest ? t.closest("button[data-set-quota]") : null;
    if (qBtn) {
      ev.preventDefault();
      setQuota(qBtn.getAttribute("data-set-quota") || "");
      return;
    }
  });
})();
</script>';

echo '</div></body></html>';
exit;