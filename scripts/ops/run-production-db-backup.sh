#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Production database backup entrypoint must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATABASE_ENV_FILE="${DATABASE_ENV_FILE:-/etc/jiangkong/api.env}"
DB_BACKUP_ENV_FILE="${DB_BACKUP_ENV_FILE:-/etc/jiangkong/db-backup.env}"
BACKUP_DIR="${BACKUP_DIR:-/srv/jiangkong-backups/db}"
DB_BACKUP_TRANSFER_SCRIPT="${DB_BACKUP_TRANSFER_SCRIPT:-$SCRIPT_DIR/cos-backup-transfer.mjs}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$SCRIPT_DIR/db-backup.sh}"

exec env \
  DATABASE_ENV_FILE="$DATABASE_ENV_FILE" \
  DB_BACKUP_ENV_FILE="$DB_BACKUP_ENV_FILE" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  BACKUP_DIR="$BACKUP_DIR" \
  DB_BACKUP_TRANSFER_SCRIPT="$DB_BACKUP_TRANSFER_SCRIPT" \
  "$BACKUP_SCRIPT"
