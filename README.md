# MiniCloudS

[![Version](https://img.shields.io/github/v/release/svetliomitev/miniclouds?label=Version&color=orange)](https://github.com/svetliomitev/miniclouds/releases/latest)
[![Website](https://img.shields.io/badge/View-Website-blue)](https://miniclouds.cloud)

**MiniCloudS** is a lightweight, self-hosted PHP file-sharing application with secure uploads, share links, and **explicit, administrator-controlled index management**.  
It is designed for individuals and administrators who want full control over their files **without databases, background services, or hidden automation**.

---

## Screenshots

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-desktop.png" width="1024" alt="Desktop">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-mobile.png" height="800" alt="Mobile">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-installer.png" width="1024" alt="Installer">

---

## Features

- Self-hosted file uploads and downloads
- Link-based file sharing and unsharing
- No database (filesystem + JSON indexes only)
- **Explicit index consistency checking (manual)**
- **Index drift detection for external filesystem changes**
- Manual index rebuild with progress feedback
- Atomic file and index operations where possible
- Installer with environment checks and configuration
- CSRF protection and hardened sessions
- Simple, modern UI built on Bootstrap
- Designed for single-instance, private deployments

---

## Architecture Overview

MiniCloudS intentionally avoids databases, cron jobs, and background workers.

Core principles:

- **Filesystem-based storage**
- **JSON indexes** for performance
- **No automatic self-healing**
- **Administrator-controlled consistency**
- **Cheap drift detection, never automatic repair**

### Index Management Model

MiniCloudS maintains JSON-based indexes for uploaded files and shared links.  
To ensure correctness without hidden behavior:

- A **cheap fingerprint (signature)** of the uploads directory is maintained  
  (based on metadata only — count, size, mtimes, checksums)
- On each page load, MiniCloudS can **detect index drift**
- **No automatic rebuild is ever performed**
- When drift is detected, the UI is locked and the administrator is prompted to:
  **“Check Index”** (manual rebuild)

This design guarantees:
- No unexpected heavy operations
- No silent mutations
- Full operator awareness and control

---

## Requirements

- PHP **8.1+**
- Apache with:
  - `mod_rewrite`
  - `.htaccess` support
- Writable directories for runtime data
- No database required

---

## Installation (single or multiple instances)

1. Upload the project files to your web directory
2. Ensure PHP and Apache requirements are met
3. Open the application in your browser
4. Follow the installer wizard
5. The installer will create:
   - `.htaccess`
   - `.htpasswd` (HTTP Basic Authentication)
   - `install_state.json`

After installation, access is protected via classic browser authentication using the credentials defined in the installer.

---

### Multiple Instances

> 💡 **Note**  
> You may run more than one MiniCloudS instance by installing it in
> separate subdirectories under your web-accessible path.

Each instance is fully independent:
- no shared state
- no database
- isolated runtime files and indexes
- separate authentication

⚠️ **Avoid nested instance layouts**, such as:

```text
/public_html/{instance}
/public_html/mycloud/{instance}
```

or

```text
/public_html/{instance}
/public_html/{instance}/mycloud/{instance}
```

Such layouts may cause .htaccess rule conflicts and unpredictable behavior.

After installation, the application is ready to use, you just enter you username and password that you filled in the installer wizard.

---

## Directory Structure

```text
/your-instance-web-path/
├─ index.php            Main application entry point (UI + admin actions)
├─ lib.php              Core helpers: security, sessions, CSRF, index logic
├─ link.php             Share-link endpoint (create / resolve shared URLs)
├─ download.php         Secure file download handler (admin & shared access)
├─ error.php            User-friendly error fallback page
├─ install.php          Installer wizard (initial setup & configuration)
├─ app.js               Client-side logic (AJAX, uploads, UI state)
├─ style.css            Application styling (Bootstrap extensions only)
├─ miniclouds-icon.png  Application icon
├─ uploads/             Stored user files (runtime; auto-created)
├─ links/               Shared-link storage (runtime; auto-created)
│  └─ byname/           Filename → link index (runtime; auto-created)
└─ cache/               Runtime cache and index metadata (runtime; auto-created)
```

Runtime directories are created automatically if missing, so no need to create them manually. If you choose not to clone this repo, but upload files before installation, these are the files that you must have in your directory (web accessible):

```text
index.php
lib.php
link.php
download.php
error.php
install.php
app.js
style.css
miniclouds-icon.png
```
---

## Security Notes

- Hardened PHP sessions
- CSRF protection for all state-changing actions
- Strict Content Security Policy (CSP) with nonces
- No public API exposure
- No database credentials to leak
- Designed for private and controlled environments

You are responsible for:
- HTTPS configuration
- Server-level access control
- Backup strategy

---

## License

This project is licensed under the **MIT License**.

You are free to use, modify, and distribute this software, provided the original license and copyright notice are retained.

---

## Status

MiniCloudS is actively developed and intended for real-world self-hosted use.

The project favors:

- explicit control
- predictable behavior
- operational safety
- long-term maintainability

over automation, background magic, or feature bloat.