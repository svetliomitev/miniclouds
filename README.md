# MiniCloudS

[![Version](https://img.shields.io/github/v/release/svetliomitev/miniclouds?label=Version&color=orange)](https://github.com/svetliomitev/miniclouds/releases/latest)
[![Website](https://img.shields.io/badge/View-Website-blue)](https://miniclouds.cloud)

**MiniCloudS** is a lightweight, self-hosted PHP file-sharing application with secure uploads, share links, and **explicit, administrator-controlled index management**. It is designed for individuals and administrators who want full control over their files **without databases, background services, or hidden automation**.

---

## Screenshots

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-installer.png" width="1024" alt="Installer">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-desktop.png" width="1024" alt="Desktop">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-storage.png" width="1024" alt="Storage">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-info.png" width="1024" alt="Info">

<img src="https://raw.githubusercontent.com/svetliomitev/miniclouds/docs/screenshots/miniclouds-mobile.png" height="800" alt="Mobile">



---

## Features

- Self-hosted file uploads and downloads
- Link-based file sharing and unsharing
- No database (filesystem + JSON indexes only)
- **Explicit index consistency checking (manual)**
- **Index drift detection for external filesystem changes**
- Manual index rebuild with progress feedback
- File-count–based upload quota (administrator-defined)
- Strict quota enforcement on both UI and server level
- Atomic file and index operations where possible
- Installer with environment checks and configuration
- CSRF protection and hardened sessions
- Simple, modern UI built on Bootstrap
- Designed for single-instance, private deployments
- Administrator Storage Control (manual inspection and cleanup tools)
- Built-in Info panel showing live totals and configured upload quota
- Optional Discord webhook notifications for public downloads

---

## Architecture Overview

MiniCloudS intentionally avoids databases, cron jobs, and background workers.

Core principles:

- **Filesystem-based storage**
- **JSON indexes** for performance
- **No automatic self-healing**
- **Administrator-controlled consistency**
- **Manual Storage Control** for inspection and cleanup (no background or automatic actions)
- **Cheap drift detection, never automatic repair**
- **Deterministic resource limits (file-count quotas)**
- **Modular vanilla JavaScript** (no build tools, each feature has a single owner module)

---

## Client-side Architecture (JavaScript modules)

MiniCloudS uses a small, explicit, **module-based vanilla JavaScript architecture**.

- No frameworks
- No build step
- No bundlers
- Modules are loaded as plain `.js` files and attach to the shared `window.MC` namespace.

**`app.js` is only the orchestrator**:
- loads BOOT state
- creates the DOM cache
- initializes modules in a deterministic order
- wires the final boot sequence

All real behavior lives in modules under `js/` (each module has a single “owner” responsibility).

### Module Map (by responsibility)

**Core utilities**
- `js/mc_helpers.js` — small DOM/format helpers (escaping, percent classes, encoding, etc.)
- `js/mc_net.js` — network layer (fetch/post + consistent JSON envelope handling)
- `js/mc_ops_ui.js` — Operation Runner + UI policy (busy tokens + button/grid enable rules)

**Modal + lock model**
- `js/mc_modals_hardlock.js` — centralized modal helpers + HardLock state machine (index drift lock)

**Lifecycle + flow**
- `js/mc_renderlife.js` — post-render lifecycle hooks (hydrate, policies, coalescing)
- `js/mc_checkindex.js` — Check Index flow (start/finish/defer lock, toast sequencing)

**UI + state owners**
- `js/mc_stats.js` — stats sync layer (totals + hard-lock decisions via HardLock)
- `js/mc_list.js` — list fetch owner (paging, preserving shared URLs, show-more)
- `js/mc_render.js` — file card renderer (grid + empty state + show-more hint)
- `js/mc_search.js` — search UI wiring (inputs, debounce, flags, reset/show-more behavior)
- `js/mc_links.js` — share/unshare + link hydration + copy-to-clipboard behavior
- `js/mc_delegated_actions.js` — delegated click/keyboard handling on the grid
- `js/mc_upload.js` — uploads flow (progress, quota checks, UI integration)
- `js/mc_storage_control.js` — admin Storage Control tool (scan + delete biggest files)
- `js/mc_guard.js` — centralized blocking rules (busy/hard/row lock checks)
- `js/mc_toast.js` — toasts (normal + search toast)
- `js/mc_init.js` — boot orchestrator (wires modules and runs initial paint)

This modular design keeps MiniCloudS predictable:
- every feature has a single code “home”
- blocking rules are uniform (busy / hard-lock / overlay)
- no scattered patches or duplicate state machines

---

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

### Storage Control vs Index Rebuild

Although related, **Storage Control** and **Index Rebuild** serve different purposes:

- **Index Rebuild**
  - Restores internal consistency
  - Reconstructs indexes from the filesystem
  - Triggered when drift is detected
  - Required for safe operation
  - Does not modify stored files (only metadata)

- **Storage Control**
  - Operational maintenance and inspection
  - Allows administrators to:
    - inspect storage usage
    - delete selected files
    - clean up share links
  - May intentionally modify stored data
  - Always explicitly initiated by the administrator

In short:

> **Index Rebuild ensures correctness.  
> Storage Control performs maintenance.**

Both are **manual**, **explicit**, and **never automatic**,  
but only Storage Control is **destructive by design**.

---

### Upload Quota Model

MiniCloudS enforces upload limits using a **maximum number of files** quota.

Design choices:
- Quotas are **count-based**, not size-based
- Enforcement is **deterministic and cheap**
- No background scanning or periodic reconciliation
- No silent cleanup or auto-deletion

Behavior:
- Uploads are blocked when the quota is reached
- Partial uploads are rejected atomically
- External filesystem changes do **not** bypass quotas
- Quotas are enforced consistently:
  - client-side (upload selection)
  - server-side (request validation)

Quota configuration is defined during installation and stored in
`install_state.json`.

---

## Storage Control (Administrator Tools)

MiniCloudS includes an **explicit, administrator-only Storage Control panel**
for inspecting and managing stored files.

Storage Control is **not automatic** and performs **no background actions**.

Available tools:

- Largest files inspection (top-N by size)
- Total file count and storage usage overview
- Manual deletion of selected files
- Safe cleanup of orphaned share links
- Full link reset (delete all share links)

Design principles:

- No automatic cleanup
- No background scanning
- No scheduled jobs
- No hidden mutations
- All actions are explicitly triggered by the administrator

Safety guarantees:

- Operations are serialized (no concurrent destructive actions)
- UI is locked during storage operations
- Index consistency is enforced before and after actions
- Destructive operations require confirmation

Storage Control is designed as an **operational maintenance tool** —
useful for audits, cleanup, and capacity planning —
without violating MiniCloudS’ core rule:
**nothing happens unless the administrator explicitly requests it**.

---

## Discord Webhook Notifications (Optional)

MiniCloudS can optionally send **Discord webhook notifications** when files are downloaded via **public share links**.

Key properties:

- Fully **optional** (disabled by default)
- Configured during installation or later reconfiguration
- No background jobs or workers
- Rate-limited and deduplicated to prevent spam
- Uses Discord’s official webhook API

Each notification includes:
- Application name (as defined during install)
- File name and size
- Share code (if applicable)
- Downloader IP address
- Referrer (if available)
- User agent string

Webhook configuration is stored in `install_state.json` and validated strictly
(HTTPS only, Discord domains only, correct webhook path).

This feature is designed for **audit visibility**, not real-time monitoring,
and follows MiniCloudS’ core principles of explicit control and predictable behavior.

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
6. The installer also defines:
- files-per-page UI behavior
- upload quota (maximum number of files)

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
Avoid such present on the same system:

/public_html/{instance}
/public_html/{instance}/{instance}
```

or

```text
Also not good in general:

/public_html/{instance}
/public_html/{instance}/mycloud/{instance}
```

Such layouts may cause .htaccess rule conflicts and unpredictable behavior.

✅ **Good structure for multi instance installs** is

```text
/public_html/{instance1}
/public_html/{instance2}
/public_html/{instance3}
```

or per example

```text
/public_html/cloudusers/{instance1}
/public_html/cloudusers/{instance2}
/public_html/cloudusers/{instance3}
```

After installation, the application is ready to use, you just enter you username and password that you filled in the installer wizard.

---

## Directory Structure

```text
/your-instance-web-path/
├─ index.php                 Main application entry point (UI + admin actions)
├─ lib.php                   Core helpers: security, sessions, CSRF, index logic
├─ link.php                  Share-link endpoint (create / resolve shared URLs)
├─ download.php              Secure file download handler (admin & shared access)
├─ error.php                 User-friendly error fallback page
├─ install.php               Installer wizard (initial setup & configuration)
├─ app.js                    Client orchestrator (boot + module init wiring)
├─ js/                       Client modules (vanilla JS, no build step)
│  ├─ mc_helpers.js           Shared helpers (escape, format, encode, etc.)
│  ├─ mc_net.js               Network layer (fetch/post + JSON envelope)
│  ├─ mc_ops_ui.js            Op runner + UI busy policy
│  ├─ mc_modals_hardlock.js   Modal helpers + HardLock state machine
│  ├─ mc_toast.js             Toast system
│  ├─ mc_guard.js             Central blocking rules
│  ├─ mc_renderlife.js        Render lifecycle hooks
│  ├─ mc_checkindex.js        Check Index flow
│  ├─ mc_stats.js             Stats sync (totals + lock sync)
│  ├─ mc_render.js            File card renderer
│  ├─ mc_list.js              List fetch/paging owner
│  ├─ mc_search.js            Search wiring (debounce, flags, reset, show-more)
│  ├─ mc_links.js             Share/unshare + link hydration/copy behavior
│  ├─ mc_delegated_actions.js Delegated grid click/keyboard handlers
│  ├─ mc_upload.js            Upload owner (progress + quota integration)
│  └─ mc_storage_control.js   Admin Storage Control (scan + delete)
├─ style.css                 Application styling (Bootstrap extensions only)
├─ miniclouds-icon.png       Application icon
├─ uploads/                  Stored user files (runtime; auto-created)
├─ links/                    Shared-link storage (runtime; auto-created)
│  └─ byname/                Filename → link index (runtime; auto-created)
└─ cache/                    Runtime cache and index metadata (runtime; auto-created)
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
js/ (all module files)
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

> 💡 **Note**  
> Upload quotas are independent from PHP upload limits.
> Both must allow an upload for it to succeed.

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
