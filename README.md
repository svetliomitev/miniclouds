# MiniCloudS

[![Version](https://img.shields.io/github/v/release/svetliomitev/miniclouds?label=Version&color=orange)](https://github.com/svetliomitev/miniclouds/releases/latest) [![Website](https://img.shields.io/badge/View-Website-blue)](https://miniclouds.cloud)

**MiniCloudS** is a lightweight, self-hosted PHP file-sharing application with secure uploads, share links, and self-healing indexes. It is designed for administrators and individuals who want full control over their files without databases or external services.

---

# Screenshots

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-desktop.png" width="1024" alt="Desktop">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-mobile.png" height="800" alt="Mobile">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-installer.png" width="1024" alt="Installer">

---

## Features

- Self-hosted file uploads and downloads
- Link-based file sharing and unsharing
- No database (filesystem + JSON indexes only)
- Self-healing file and share indexes
- Atomic file operations where possible
- Installer with environment checks and configuration
- CSRF protection and hardened sessions
- Simple, modern UI with Bootstrap
- Designed for single-instance, private deployments

---

## Architecture Overview

MiniCloudS intentionally avoids databases and background services.

Core characteristics:
- **Filesystem-based storage**
- **JSON indexes** for performance and consistency
- **Automatic index recovery** when inconsistencies are detected
- **Single-entry UI** (`index.php`) with supporting endpoints

Indexes are rebuilt only when needed, keeping runtime overhead low.

---

## Requirements

- PHP **8.1+**
- Apache with:
  - `mod_rewrite`
  - `.htaccess` support
- Writable directories for runtime data
- No database required

---

## Installation (might be multi instance, see below)

1. Upload the project files to your web directory
2. Ensure PHP and Apache requirements are met
3. Open the application in your browser
4. Follow the installer wizard
5. The installer will create:
   - `.htaccess`
   - `.htpasswd` (authentication is enabled that way, via classic prompt in your browser)
   - `install_state.json`
6. **Multiple instances**

> 💡 **Note**  
> You may want to run more than one MiniCloudS instance by installing it in
> separate subdirectories under your web-accessible path.
>
> Each instance is fully independent:
> - no database required
> - `.htaccess` rules apply per instance
> - isolated runtime state and files
>
> **Avoid the following setup:**

```text
/public_html/{instance}
/public_html/mycloud/{instance}
```

or

```text
/public_html/{instance}
/public_html/{instance}/mycloud/{instance}
```

Such structure would lead to confusion and unpredictable outcome in .htaccess rules, applied to your Apache behavior for the second MiniCloudS instances.

After installation, the application is ready to use, you just enter you username and password that you filled in the installer wizard.

---

## Directory Structure

```text
/your-instance-root/
├─ index.php            Main application entry point (UI + admin actions)
├─ lib.php              Core helpers: security, sessions, CSRF, indexes
├─ link.php             Share-link endpoint (create / resolve shared URLs)
├─ download.php         Secure file download handler (admin & shared access)
├─ error.php            User-friendly error fallback page
├─ install.php          Installer wizard (initial setup & configuration)
├─ app.js               Client-side logic (AJAX, uploads, UI state)
├─ style.css            Application styling (Bootstrap extensions only)
├─ miniclouds-icon.png  Application icon (tabs, mobile install)
├─ uploads/             Stored user files (runtime; auto-created)
├─ links/               Shared-link storage (runtime; auto-created)
│  └─ byname/           Filename → link index (runtime; auto-created)
└─ cache/               Runtime cache & indexes (runtime; auto-created)
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
The project favors correctness, simplicity, and long-term maintainability over feature bloat.
