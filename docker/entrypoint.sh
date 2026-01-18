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

# Start Apache (official image entrypoint)
exec apache2-foreground