#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
API_RUNTIME_DIR="${API_RUNTIME_DIR:-/srv/jiangkong/apps/api}"
WEB_RUNTIME_DIR="${WEB_RUNTIME_DIR:-/srv/jiangkong/apps/web-admin}"
API_ENV_FILE="${API_ENV_FILE:-/etc/jiangkong/api.env}"
API_SERVICE="${API_SERVICE:-jiangkong-api}"
BACKUP_DIR="${BACKUP_DIR:-/srv/jiangkong-backups/db}"
DB_BACKUP_ENV_FILE="${DB_BACKUP_ENV_FILE:-/etc/jiangkong/db-backup.env}"
BACKUP_RUN_AS_ROOT="${BACKUP_RUN_AS_ROOT:-true}"
STAGING_PARENT_DIR="${STAGING_PARENT_DIR:-/srv/jiangkong}"
ROLLBACK_PARENT_DIR="${ROLLBACK_PARENT_DIR:-/srv/jiangkong}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-15}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$REPO_ROOT/scripts/ops/db-backup.sh}"
DB_BACKUP_TRANSFER_SCRIPT="${DB_BACKUP_TRANSFER_SCRIPT:-$REPO_ROOT/scripts/ops/cos-backup-transfer.mjs}"
RUNTIME_HEALTH_SCRIPT="${RUNTIME_HEALTH_SCRIPT:-$REPO_ROOT/scripts/ops/check-runtime-health.sh}"
STAGING_DIR=""
ROLLBACK_DIR=""
STOP_ATTEMPTED=false
RUNTIME_SNAPSHOT_READY=false
RUNTIME_REPLACEMENT_STARTED=false
DEPLOY_SUCCEEDED=false

if [[ -z "${REPO_ROOT_OVERRIDE:-}" ]]; then
  BACKUP_SCRIPT="$REPO_ROOT/scripts/ops/db-backup.sh"
  DB_BACKUP_TRANSFER_SCRIPT="$REPO_ROOT/scripts/ops/cos-backup-transfer.mjs"
  DB_BACKUP_ENV_FILE="/etc/jiangkong/db-backup.env"
  BACKUP_RUN_AS_ROOT=true
fi

if [[ "$BACKUP_RUN_AS_ROOT" != true && "$BACKUP_RUN_AS_ROOT" != false ]]; then
  echo "BACKUP_RUN_AS_ROOT must be true or false" >&2
  exit 1
fi

run_pre_migration_backup() {
  if [[ "$BACKUP_RUN_AS_ROOT" == true ]]; then
    sudo --non-interactive env \
      DATABASE_ENV_FILE="$API_ENV_FILE" \
      DB_BACKUP_ENV_FILE="$DB_BACKUP_ENV_FILE" \
      DB_BACKUP_OFFSITE_REQUIRED=true \
      BACKUP_DIR="$BACKUP_DIR" \
      DB_BACKUP_TRANSFER_SCRIPT="$DB_BACKUP_TRANSFER_SCRIPT" \
      "$BACKUP_SCRIPT"
    return
  fi

  DB_BACKUP_OFFSITE_REQUIRED=true \
    DB_BACKUP_TRANSFER_SCRIPT="$DB_BACKUP_TRANSFER_SCRIPT" \
    "$BACKUP_SCRIPT"
}

run_prisma_migrations() {
  sudo --non-interactive bash -s -- "$API_ENV_FILE" "$REPO_ROOT" <<'ROOT_MIGRATION'
set -euo pipefail

env_file=$1
repo_root=$2
database_url=""
database_url_count=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" == DATABASE_URL=* ]] || continue
  database_url_count=$((database_url_count + 1))
  database_url="${line#DATABASE_URL=}"
  if [[ "$database_url" == \"* ]]; then
    if [[ "$database_url" != *\" || ${#database_url} -lt 2 ]]; then
      echo "API_ENV_FILE contains an invalid quoted DATABASE_URL" >&2
      exit 1
    fi
    database_url="${database_url:1:${#database_url}-2}"
  elif [[ "$database_url" == \'* ]]; then
    if [[ "$database_url" != *\' || ${#database_url} -lt 2 ]]; then
      echo "API_ENV_FILE contains an invalid quoted DATABASE_URL" >&2
      exit 1
    fi
    database_url="${database_url:1:${#database_url}-2}"
  fi
done < "$env_file"

if [[ "$database_url_count" != 1 || -z "$database_url" ]]; then
  echo "API_ENV_FILE must contain exactly one non-empty DATABASE_URL" >&2
  exit 1
fi

cd "$repo_root"
DATABASE_URL="$database_url" pnpm --filter @jiangkong/api exec prisma migrate deploy
ROOT_MIGRATION
}

verified_backup_artifacts_exist() {
  local backup_file=$1
  if [[ "$BACKUP_RUN_AS_ROOT" == true ]]; then
    sudo --non-interactive test -s "$backup_file" &&
      sudo --non-interactive test -s "$backup_file.sha256" &&
      sudo --non-interactive test -s "$backup_file.offsite.json"
    return
  fi

  [[ -s "$backup_file" && -s "$backup_file.sha256" && -s "$backup_file.offsite.json" ]]
}

wait_for_health() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    if (( attempt < HEALTH_ATTEMPTS )); then
      sleep 2
    fi
  done
  return 1
}

cleanup() {
  local exit_code=$?
  local recovery_failed=false
  trap - EXIT
  set +e

  if [[ "$DEPLOY_SUCCEEDED" != true && "$STOP_ATTEMPTED" == true ]]; then
    echo "Deployment failed after the API stop was attempted; starting runtime recovery" >&2
    if [[ "$RUNTIME_REPLACEMENT_STARTED" == true && "$RUNTIME_SNAPSHOT_READY" == true ]]; then
      mkdir -p "$API_RUNTIME_DIR" "$WEB_RUNTIME_DIR"
      if ! rsync -a --delete "$ROLLBACK_DIR/api/" "$API_RUNTIME_DIR/"; then
        echo "Failed to restore the previous API runtime snapshot" >&2
        recovery_failed=true
      fi
      if ! rsync -a --delete "$ROLLBACK_DIR/web-admin/" "$WEB_RUNTIME_DIR/"; then
        echo "Failed to restore the previous Web runtime snapshot" >&2
        recovery_failed=true
      fi
    fi

    if ! sudo systemctl restart "$API_SERVICE"; then
      echo "Failed to restart the API service during recovery" >&2
      recovery_failed=true
    fi
    if ! sudo nginx -t || ! sudo systemctl reload nginx; then
      echo "Failed to validate or reload Nginx during recovery" >&2
      recovery_failed=true
    fi
    if ! wait_for_health; then
      echo "Recovered runtime did not pass the API health check" >&2
      recovery_failed=true
    fi
    if [[ "$recovery_failed" == true ]]; then
      echo "Deployment recovery requires immediate operator attention" >&2
    else
      echo "Previous runtime recovered and passed the API health check" >&2
    fi
  fi

  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
  if [[ -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]]; then
    rm -rf "$ROLLBACK_DIR"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

cd "$REPO_ROOT"

if [[ -L "$API_RUNTIME_DIR" || -L "$WEB_RUNTIME_DIR" ]]; then
  echo "production runtime directories must not be symbolic links" >&2
  exit 1
fi
if [[ ! -d "$API_RUNTIME_DIR" || ! -d "$WEB_RUNTIME_DIR" ]]; then
  echo "production runtime directories must exist before an in-place deployment" >&2
  exit 1
fi

# Build everything before applying database migrations. A build failure must not
# leave production with a new schema and the previous API process.
CI=true pnpm install --frozen-lockfile --prod=false
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build

STAGING_DIR="$(mktemp -d "$STAGING_PARENT_DIR/.deploy-stage.XXXXXX")"
mkdir -p "$STAGING_DIR/api" "$STAGING_DIR/web-admin"
rsync -a --delete "$REPO_ROOT/services/api/dist/" "$STAGING_DIR/api/dist/"
rsync -a --delete "$REPO_ROOT/services/api/prisma/" "$STAGING_DIR/api/prisma/"
if [[ -d "$REPO_ROOT/services/api/assets" ]]; then
  rsync -a --delete "$REPO_ROOT/services/api/assets/" "$STAGING_DIR/api/assets/"
fi
ln -sfn "$REPO_ROOT/services/api/node_modules" "$STAGING_DIR/api/node_modules"
rsync -a --delete "$REPO_ROOT/apps/web-admin/dist/" "$STAGING_DIR/web-admin/dist/"

ROLLBACK_DIR="$(mktemp -d "$ROLLBACK_PARENT_DIR/.deploy-rollback.XXXXXX")"
mkdir -p "$ROLLBACK_DIR/api" "$ROLLBACK_DIR/web-admin"
rsync -a --delete "$API_RUNTIME_DIR/" "$ROLLBACK_DIR/api/"
rsync -a --delete "$WEB_RUNTIME_DIR/" "$ROLLBACK_DIR/web-admin/"
RUNTIME_SNAPSHOT_READY=true

sudo nginx -t
sudo systemctl is-active --quiet "$API_SERVICE"

PRE_MIGRATION_BACKUP="$(run_pre_migration_backup)"
if ! verified_backup_artifacts_exist "$PRE_MIGRATION_BACKUP"; then
  echo "Pre-migration backup did not produce a verified local dump, checksum, and offsite receipt" >&2
  exit 1
fi
echo "Verified local and offsite pre-migration backup: $PRE_MIGRATION_BACKUP"
echo "Only backward-compatible database migrations are allowed; migrations are never rolled back automatically."

STOP_ATTEMPTED=true
sudo systemctl stop "$API_SERVICE"

run_prisma_migrations

RUNTIME_REPLACEMENT_STARTED=true
mkdir -p "$API_RUNTIME_DIR" "$WEB_RUNTIME_DIR"
rsync -a --delete "$STAGING_DIR/api/" "$API_RUNTIME_DIR/"
rsync -a --delete "$STAGING_DIR/web-admin/" "$WEB_RUNTIME_DIR/"

sudo systemctl restart "$API_SERVICE"
sudo nginx -t
sudo systemctl reload nginx

if ! wait_for_health; then
  echo "production API health check did not recover after restart" >&2
  exit 1
fi

LOG_SINCE="2 minutes ago" \
  "$RUNTIME_HEALTH_SCRIPT"

DEPLOY_SUCCEEDED=true
