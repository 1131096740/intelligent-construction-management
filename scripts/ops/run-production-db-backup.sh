#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Production database backup entrypoint must run as root" >&2
  exit 1
fi

exec env \
  DATABASE_ENV_FILE=/etc/jiangkong/api.env \
  DB_BACKUP_ENV_FILE=/etc/jiangkong/db-backup.env \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  BACKUP_DIR=/srv/jiangkong-backups/db \
  DB_BACKUP_TRANSFER_SCRIPT=/opt/jiangkong/scripts/ops/cos-backup-transfer.mjs \
  /opt/jiangkong/scripts/ops/db-backup.sh
