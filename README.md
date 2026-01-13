# MiniCloudS

**MiniCloudS** is a lightweight, self-hosted PHP file-sharing application with secure uploads, share links, and self-healing indexes. It is designed for administrators and individuals who want full control over their files without databases or external services.

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

- PHP **7.3+**
- Apache with:
  - `mod_rewrite`
  - `.htaccess` support
- Writable directories for runtime data
- No database required

---

## Installation

1. Upload the project files to your web directory
2. Ensure PHP and Apache requirements are met
3. Open the application in your browser
4. Follow the installer wizard
5. The installer will create:
   - `.htaccess`
   - `.htpasswd` (if authentication is enabled)
   - `install_state.json`

After installation, the application is ready to use.

---

## Directory Structure

- /uploads/ Uploaded files
- /links/ Share link data
- /links/byname/ Reverse share index
- /cache/ Runtime caches
- index.php Main application
- install.php Installer
- download.php File downloads
- link.php Share / unshare endpoint
- lib.php Shared helpers


Runtime directories are created automatically if missing.

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
