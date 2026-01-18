#!/bin/sh
set -eu

SRC="/opt/miniclouds-src"
DST="/var/www/html"

# First run only: populate empty volume with app files
if [ ! -f "$DST/index.php" ]; then
  echo "[MiniCloudS] Initializing application volume..."
  cp -a "$SRC/." "$DST/"
fi

# Ensure runtime directories exist
mkdir -p "$DST/uploads" "$DST/links" "$DST/cache"

# Make the whole app tree writable by Apache (no host-side commands needed)
chown -R www-data:www-data "$DST"
chmod -R u+rwX,g+rwX "$DST"

exec apache2-foreground