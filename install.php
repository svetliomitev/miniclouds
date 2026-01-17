<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

mc_security_headers();
mc_session_start();

$nonce = mc_csp_nonce();

$APP_VERSION = '1.8.18';

/* =========================
   INSTALLER / RECONFIGURATOR
   Writes ONLY: .htaccess + .htpasswd + install_state.json
   (No .user.ini, no robots.txt)
   ========================= */

$HTACCESS = __DIR__ . '/.htaccess';
$HTPASSWD = __DIR__ . '/.htpasswd';

$baseUri  = mc_base_uri();
$indexUrl = ($baseUri === '' ? '' : $baseUri) . '/index.php';

$alreadyInstalled = mc_is_installed();
$isFirstInstall   = !$alreadyInstalled;

/* If already installed, require authenticated admin session (set after BasicAuth on index.php). */
if ($alreadyInstalled) {
    if (!empty($_SERVER['REMOTE_USER'])) {
        $_SESSION['mc_admin_ok'] = true;
    }

    mc_require_admin_session_or_pretty_403(
        'Installer is available only to authenticated admins.',
        'Open index.php, login, then return to install.php to change settings.'
    );
}

/* -------------------------
   Inline error + form state
   ------------------------- */
$error = '';

$userVal     = 'admin';
$authNameVal = 'MiniCloudS';
$ipsVal      = '';
$pageSizeVal = '20';
$passVal     = '';
$pass2Val    = '';

$pageSize = 20;

/* Prefill from install_state.json on reinstall (reconfigurator mode) */
if ($alreadyInstalled) {
    $st = mc_read_state();
    if (is_array($st)) {
        if (!empty($st['app_name']) && is_string($st['app_name'])) {
            $authNameVal = trim((string)$st['app_name']);
        }
        if (!empty($st['admin_user']) && is_string($st['admin_user'])) {
            $userVal = trim((string)$st['admin_user']);
        }

        if (isset($st['allow_ips']) && is_array($st['allow_ips'])) {
            $tmp = [];
            foreach ($st['allow_ips'] as $v) {
                if (!is_string($v)) continue;
                $v = trim($v);
                if ($v !== '') $tmp[] = $v;
            }
            if ($tmp) $ipsVal = implode(', ', $tmp);
        }

        $ps = (int)($st['page_size'] ?? 20);
        if ($ps < 20) $ps = 20;
        if ($ps > 200) $ps = 200;
        $pageSizeVal = (string)$ps;
        $pageSize = $ps;
    }
}

/* Existing bcrypt hash (used for "keep password" on reinstall) */
$existingHtHash = ($alreadyInstalled ? mc_htpasswd_read_hash($HTPASSWD) : '');

/* -------------------------
   POST
   ------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && (string)($_POST['action'] ?? '') === 'install') {

    $authNameVal = trim((string)($_POST['authname'] ?? 'MiniCloudS'));
    $authNameVal = preg_replace('~\s+~', ' ', $authNameVal) ?: '';

    $userVal     = trim((string)($_POST['user'] ?? 'admin'));

    $ipsVal      = trim((string)($_POST['ips'] ?? ''));

    $pageSizeVal = trim((string)($_POST['pagesize'] ?? '20'));

    // Keep password values on error (requested)
    $passVal  = (string)($_POST['pass'] ?? '');
    $pass2Val = (string)($_POST['pass2'] ?? '');

    /* Validate */
    if ($authNameVal === '' || !preg_match('~^[A-Za-z](?:[A-Za-z ]{0,62}[A-Za-z])?$~', $authNameVal)) {
        $error = 'Bad application name. Allowed: latin letters and spaces only (1-64 chars).';
    } elseif ($pageSizeVal === '' || !ctype_digit($pageSizeVal)) {
        $error = 'Bad files-per-page value. Must be a whole number greater than or equal to 20.';
    } else {
        $pageSize = (int)$pageSizeVal;
        if ($pageSize < 20) {
            $error = 'Bad files-per-page value. Must be greater than or equal to 20.';
        } elseif ($pageSize > 200) {
            $error = 'Bad files-per-page value. Must be less than or equal to 200.';
        } elseif ($userVal === '' || !preg_match('~^[A-Za-z0-9._-]{1,64}$~', $userVal)) {
            $error = 'Bad username (allowed: A-Z a-z 0-9 . _ -)';
        } else {
            // Password rules:
            // - First install: required + must match
            // - Reinstall: blank+blank means "keep existing"
            if (!$isFirstInstall && $passVal === '' && $pass2Val === '') {
                if ($existingHtHash === '') {
                    $error = 'Existing password hash not found; please set a new password.';
                }
            } elseif ($passVal === '' || $passVal !== $pass2Val) {
                $error = 'Password empty or mismatch.';
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
                $authNameSafe = str_replace('"', '', $authNameVal);

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
                        mc_write_install_state($APP_VERSION, $authNameVal, $pageSize, $userVal, $ips);
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

/* Installer UI */
$base = mc_base_uri();
$rw   = mc_rewrite_base();
$dirWritable = is_writable(__DIR__);

echo '<!doctype html><html lang="en"><head>';
echo '<meta charset="utf-8">';
echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
echo '<title>MiniCloudS Installer</title>';
echo '<link rel="icon" type="image/png" sizes="512x512" href="miniclouds-icon.png?v=' . rawurlencode((string)$APP_VERSION) . '">';
echo '<link rel="apple-touch-icon" sizes="512x512" href="miniclouds-icon.png?v=' . rawurlencode((string)$APP_VERSION) . '">';

/* installer has its own CSS, no bootstrap needed */
echo '<style nonce="' . h($nonce) . '">
:root{
--bg:#212529;
--panel:#2b3035;
--field:#212529;
--text:#f8f9fa;
--muted:#adb5bd;
--border:rgba(255,255,255,.12);
--border2:rgba(255,255,255,.12);
--btn:#0d6efd;
--danger:#842029;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial}
.wrap{max-width:1040px;margin:0 auto;padding:20px}
.top{padding:22px 0 10px}
.h1{font-size:24px;font-weight:600;margin:0 0 6px;letter-spacing:.2px;line-height:1.1}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:none}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
@media (max-width:720px){.grid{grid-template-columns:1fr}}
label{display:block;margin:0 0 7px;color:#cbd5e1;font-weight:600}
input{
width:100%;
padding:10px 12px;
border-radius:8px;
border:1px solid var(--border2);
background:var(--field);
color:var(--text);
outline:none;
font-size:15px;
}
input:focus{border-color:rgba(255,255,255,.35);box-shadow:none}
.help{color:var(--muted);font-size:13.5px;margin-top:7px}
.pillrow{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:999px;border:1px solid var(--border2);background:rgba(255,255,255,.03);color:var(--muted);font-size:13px}
code{background:var(--field);border:1px solid var(--border2);padding:2px 8px;border-radius:10px;color:#cbd5e1}
.warn{margin-top:14px;padding:11px 12px;border-radius:12px;background:var(--danger);border:1px solid var(--border);color:var(--text)}
.alert{margin-top:14px;padding:11px 12px;border-radius:12px;background:var(--danger);border:1px solid var(--border);color:var(--text)}
.alert strong{font-weight:600}
.btn{
margin-top:16px;
width:100%;
border:1px solid transparent;
border-radius:8px;
padding:10px 14px;
font-weight:normal;
background:var(--btn);
color:#fff;
cursor:pointer;
font-size:15px;
}
.btn:disabled{opacity:.65;cursor:not-allowed}
.note{margin-top:16px;padding:14px 14px;border-radius:12px;border:1px solid var(--border2);background:rgba(255,255,255,.03);color:var(--muted);font-size:13.5px}
.note b{color:var(--text);font-weight:600}
.note ul{margin:8px 0 0 18px;padding:0}
.note li{margin:4px 0}

/* password input with show/hide button */
.pw{display:flex;gap:8px;align-items:stretch}
.pw input{flex:1;min-width:0}
.pwbtn{
padding:10px 12px;
border-radius:8px;
border:1px solid var(--border2);
background:rgba(255,255,255,.06);
color:var(--text);
font-weight:normal;
cursor:pointer;
white-space:nowrap;
}
.pwbtn:focus{outline:none;border-color:rgba(255,255,255,.35)}

/* kill Chrome autofill blue */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus{
-webkit-text-fill-color: var(--text);
-webkit-box-shadow: 0 0 0 1000px var(--field) inset;
box-shadow: 0 0 0 1000px var(--field) inset;
transition: background-color 9999s ease-in-out 0s;
}

/* installer icon before application name, inline */
.title-row{display:flex;align-items:center;gap:8px}
.app-icon{
width:36px;height:36px;flex:0 0 36px;display:block;position:relative;top:-1px
}
/* tablet */
@media (max-width: 992px){.app-icon{top:-2px}}
/* mobile */
@media (max-width: 480px){.app-icon{top:-3px}}
</style>';

echo '</head><body><div class="wrap">';
echo '<div class="top">';
echo '  <div class="title-row">';
echo '    <img class="app-icon" src="miniclouds-icon.png?v=' . h($APP_VERSION) . '" alt="">';
echo '    <div class="h1">MiniCloudS Installer</div>';
echo '  </div>';
echo '</div>';

echo '<div class="card">';
echo '<div class="pillrow">';
echo '<span class="pill">Detected base URI: <code>' . h($base === '' ? '(root)' : $base) . '</code></span>';
echo '<span class="pill">RewriteBase: <code>' . h($rw) . '</code></span>';
echo '<span class="pill">Version: <code>' . h($APP_VERSION) . '</code></span>';
echo '</div>';

if (!$dirWritable) {
    echo '<div class="warn"><strong>Warning:</strong> Directory is not writable: <code>' . h(__DIR__) . '</code><br>Fix ownership/permissions, then reload.</div>';
}

if ($error !== '') {
    echo '<div class="alert"><strong>' . ($alreadyInstalled ? 'Save error:' : 'Install error:') . '</strong> ' . h($error) . '</div>';
}

echo '<form method="post" autocomplete="off">';
echo '<input type="hidden" name="action" value="install">';

echo '<div class="grid">';
echo '<div><label>Application Name</label><input id="authname" name="authname" value="' . h($authNameVal) . '"></div>';
echo '<div><label>Admin Username</label><input id="user" name="user" value="' . h($userVal) . '" required></div>';

echo '<div><label>Password</label>';
echo '<div class="pw">';
echo '<input id="pass" type="password" name="pass" value="' . h($passVal) . '" '
   . ($alreadyInstalled ? 'placeholder="Leave blank to keep existing password"' : 'required') . '>';
echo '<button class="pwbtn" type="button" data-toggle="pw" data-target="pass" aria-label="Show password">Show</button>';
echo '</div>';
echo '</div>';

echo '<div><label>Repeat Password</label>';
echo '<div class="pw">';
echo '<input id="pass2" type="password" name="pass2" value="' . h($pass2Val) . '" '
   . ($alreadyInstalled ? 'placeholder="Leave blank to keep existing password"' : 'required') . '>';
echo '<button class="pwbtn" type="button" data-toggle="pw" data-target="pass2" aria-label="Show password confirmation">Show</button>';
echo '</div></div>';

echo '<div><label>Allow public IPs for admin access (optional)</label>';
echo '<input id="ips" name="ips" value="' . h($ipsVal) . '" placeholder="e.g. 1.2.3.4, 5.6.7.0/24, 2001:4860::/32">';
echo '<div class="help">IPs separated by coma. If empty: any IP allowed. No private/local IPs.</div></div>';

echo '<div><label>Files per page</label>';
echo '<input id="pagesize" name="pagesize" value="' . h($pageSizeVal) . '" inputmode="numeric" pattern="[0-9]*" required>';
echo '<div class="help">Whole number &ge; 20. Controls initial list and “Show more” step.</div></div>';

echo '</div>';

$btnLabel = $alreadyInstalled ? 'Save Settings' : 'Install MiniCloudS';
echo '<button class="btn" type="submit" ' . ($dirWritable ? '' : 'disabled') . '>' . h($btnLabel) . '</button>';
echo '</form>';

echo '<div class="note">';
echo '<div class="full"><label>PHP Limits (set in hosting control panel)</label></div>';
echo 'MiniCloudS does not create <code>.user.ini</code>. To increase upload/limits, adjust these in your hosting control panel / PHP-FPM pool settings (often SYSTEM-level):';
echo '<ul>';
echo '<li><code>upload_max_filesize</code></li>';
echo '<li><code>post_max_size</code></li>';
echo '<li><code>memory_limit</code></li>';
echo '<li><code>max_file_uploads</code></li>';
echo '<li><code>max_input_vars</code></li>';
echo '</ul>';
echo 'Also check web-server/proxy limits like Nginx <code>client_max_body_size</code> or Apache <code>LimitRequestBody</code>.';
echo '</div>';

echo '</div>';

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
  document.addEventListener("click", function(ev){
    var btn = ev.target && ev.target.closest ? ev.target.closest("button[data-toggle=\\"pw\\"]") : null;
    if (!btn) return;
    ev.preventDefault();
    togglePw(btn);
  });
})();
</script>';

echo '</div></div></body></html>';
exit;