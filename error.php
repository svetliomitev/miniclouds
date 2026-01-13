<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

mc_security_headers();

$e = (int)($_GET['e'] ?? 0);

if ($e === 401) {
    mc_render_pretty_page(
        '401 — Authorization Required',
        'You cancelled the login prompt or did not provide valid credentials.',
        "This area is protected by browser authentication.\n\n• Click Reload / Refresh to try again.\n• If your browser keeps cancelling automatically, open the link in a new tab/window and try again.\n• If you believe you should have access, confirm you are using the correct username/password.",
        401
    );
}

if ($e === 403) {
    mc_render_pretty_page(
        '403 — Forbidden',
        'Access to this resource is not allowed.',
        'This is usually triggered by a protected directory (uploads/links) or server access rules.',
        403
    );
}

if ($e === 404) {
    mc_render_pretty_page(
        '404 — Not Found',
        'The requested page does not exist.',
        'If you typed the URL manually, check for typos.',
        404
    );
}

mc_render_pretty_page(
    '404 — Not Found',
    'The requested page does not exist.',
    '',
    404
);