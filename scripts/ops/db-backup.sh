#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-/srv/jiangkong-backups/db}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/jiangkong-$stamp.dump"

pg_dump --format=custom --no-owner --file "$backup_file" "$DATABASE_URL"
chmod 600 "$backup_file"

echo "$backup_file"
