#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
API_RUNTIME_DIR="${API_RUNTIME_DIR:-/srv/jiangkong/apps/api}"
WEB_RUNTIME_DIR="${WEB_RUNTIME_DIR:-/srv/jiangkong/apps/web-admin}"
DEPLOY_SCOPE="${DEPLOY_SCOPE:-full}"
DEPLOY_CONFIRMATION_MODE="${DEPLOY_CONFIRMATION_MODE:-immediate}"
DEPLOY_CONFIRMATION_DIR="${DEPLOY_CONFIRMATION_DIR:-/run/jiangkong-deploy}"
DEPLOY_CONFIRMATION_FILE="${DEPLOY_CONFIRMATION_FILE:-}"
DEPLOY_CONFIRMATION_TIMEOUT_SECONDS="${DEPLOY_CONFIRMATION_TIMEOUT_SECONDS:-1800}"
TARGET_SHA="${TARGET_SHA:-}"
API_ENV_FILE="${API_ENV_FILE:-/etc/jiangkong/api.env}"
API_SERVICE="${API_SERVICE:-jiangkong-api}"
BACKUP_DIR="${BACKUP_DIR:-/srv/jiangkong-backups/db}"
DB_BACKUP_ENV_FILE="${DB_BACKUP_ENV_FILE:-/etc/jiangkong/db-backup.env}"
BACKUP_RUN_AS_ROOT="${BACKUP_RUN_AS_ROOT:-true}"
DEPLOY_COREPACK_HOME="${DEPLOY_COREPACK_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack}"
STAGING_PARENT_DIR="${STAGING_PARENT_DIR:-/srv/jiangkong}"
ROLLBACK_PARENT_DIR="${ROLLBACK_PARENT_DIR:-/srv/jiangkong}"
LIVENESS_URL="${LIVENESS_URL:-${HEALTH_URL:-http://127.0.0.1:3000/health}}"
READINESS_URL="${READINESS_URL:-http://127.0.0.1:3000/health/readiness}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-15}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$REPO_ROOT/scripts/ops/db-backup.sh}"
DB_BACKUP_TRANSFER_SCRIPT="${DB_BACKUP_TRANSFER_SCRIPT:-$REPO_ROOT/scripts/ops/cos-backup-transfer.mjs}"
RUNTIME_HEALTH_SCRIPT="${RUNTIME_HEALTH_SCRIPT:-$REPO_ROOT/scripts/ops/check-runtime-health.sh}"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
DRAFT_RETENTION_SERVICE_SOURCE="${DRAFT_RETENTION_SERVICE_SOURCE:-$REPO_ROOT/scripts/ops/systemd/jiangkong-draft-retention.service}"
DRAFT_RETENTION_TIMER_SOURCE="${DRAFT_RETENTION_TIMER_SOURCE:-$REPO_ROOT/scripts/ops/systemd/jiangkong-draft-retention.timer}"
PRISTINE_DRAFT_RECEIPT_PURGE_SERVICE_SOURCE="${PRISTINE_DRAFT_RECEIPT_PURGE_SERVICE_SOURCE:-$REPO_ROOT/scripts/ops/systemd/jiangkong-pristine-draft-deletion-receipt-purge.service}"
PRISTINE_DRAFT_RECEIPT_PURGE_TIMER_SOURCE="${PRISTINE_DRAFT_RECEIPT_PURGE_TIMER_SOURCE:-$REPO_ROOT/scripts/ops/systemd/jiangkong-pristine-draft-deletion-receipt-purge.timer}"
STAGING_DIR=""
ROLLBACK_DIR=""
STOP_ATTEMPTED=false
RUNTIME_SNAPSHOT_READY=false
RUNTIME_REPLACEMENT_STARTED=false
DEPLOY_SUCCEEDED=false
DEPLOY_WEB=false

case "$DEPLOY_SCOPE" in
  full)
    DEPLOY_WEB=true
    ;;
  api-only)
    ;;
  *)
    echo "DEPLOY_SCOPE must be full or api-only" >&2
    exit 1
    ;;
esac
echo "Deployment scope: $DEPLOY_SCOPE"

case "$DEPLOY_CONFIRMATION_MODE" in
  immediate | manual)
    ;;
  *)
    echo "DEPLOY_CONFIRMATION_MODE must be immediate or manual" >&2
    exit 1
    ;;
esac

if [[ "$DEPLOY_CONFIRMATION_MODE" == manual ]] &&
  { [[ ! "$DEPLOY_CONFIRMATION_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    (( DEPLOY_CONFIRMATION_TIMEOUT_SECONDS > 3600 )); }; then
  echo "DEPLOY_CONFIRMATION_TIMEOUT_SECONDS must be an integer from 1 to 3600" >&2
  exit 1
fi

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
  sudo --non-interactive env \
    COREPACK_HOME="$DEPLOY_COREPACK_HOME" \
    bash -s -- "$API_ENV_FILE" "$REPO_ROOT" <<'ROOT_MIGRATION'
set -euo pipefail

env_file=$1
repo_root=$2
database_url=""
database_url_count=0
database_migration_url=""
database_migration_url_count=0
operating_ledger_runtime_role=""
operating_ledger_runtime_role_count=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  case "$line" in
    DATABASE_URL=*)
      database_url_count=$((database_url_count + 1))
      value="${line#DATABASE_URL=}"
      variable_name="DATABASE_URL"
      ;;
    DATABASE_MIGRATION_URL=*)
      database_migration_url_count=$((database_migration_url_count + 1))
      value="${line#DATABASE_MIGRATION_URL=}"
      variable_name="DATABASE_MIGRATION_URL"
      ;;
    OPERATING_LEDGER_RUNTIME_ROLE=*)
      operating_ledger_runtime_role_count=$((operating_ledger_runtime_role_count + 1))
      value="${line#OPERATING_LEDGER_RUNTIME_ROLE=}"
      variable_name="OPERATING_LEDGER_RUNTIME_ROLE"
      ;;
    *)
      continue
      ;;
  esac
  if [[ "$value" == \"* ]]; then
    if [[ "$value" != *\" || ${#value} -lt 2 ]]; then
      echo "API_ENV_FILE contains an invalid quoted $variable_name" >&2
      exit 1
    fi
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'* ]]; then
    if [[ "$value" != *\' || ${#value} -lt 2 ]]; then
      echo "API_ENV_FILE contains an invalid quoted $variable_name" >&2
      exit 1
    fi
    value="${value:1:${#value}-2}"
  fi
  case "$variable_name" in
    DATABASE_URL) database_url="$value" ;;
    DATABASE_MIGRATION_URL) database_migration_url="$value" ;;
    OPERATING_LEDGER_RUNTIME_ROLE) operating_ledger_runtime_role="$value" ;;
  esac
done < "$env_file"

if [[ "$database_url_count" != 1 || -z "$database_url" ]]; then
  echo "API_ENV_FILE must contain exactly one non-empty DATABASE_URL" >&2
  exit 1
fi
if [[ "$database_migration_url_count" != 1 || -z "$database_migration_url" ]]; then
  echo "API_ENV_FILE must contain exactly one non-empty DATABASE_MIGRATION_URL for owner-only migrations" >&2
  exit 1
fi
if [[ "$operating_ledger_runtime_role_count" != 1 || -z "$operating_ledger_runtime_role" ]]; then
  echo "API_ENV_FILE must contain exactly one non-empty OPERATING_LEDGER_RUNTIME_ROLE" >&2
  exit 1
fi

runtime_database_target="$(DATABASE_URL="$database_url" node - <<'NODE'
try {
  const url = new URL(process.env.DATABASE_URL);
  const user = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!user || !host || !database || /[\t\r\n]/u.test(`${user}${host}${port}${database}`)) process.exit(1);
  process.stdout.write([user, host, port, database].join("\t"));
} catch {
  process.exit(1);
}
NODE
)" || {
  echo "API_ENV_FILE DATABASE_URL must be a valid PostgreSQL URL with a user" >&2
  exit 1
}
IFS=$'\t' read -r runtime_database_user runtime_database_host runtime_database_port runtime_database_name <<< "$runtime_database_target"
migration_database_target="$(DATABASE_URL="$database_migration_url" node - <<'NODE'
try {
  const url = new URL(process.env.DATABASE_URL);
  const user = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!user || !host || !database || /[\t\r\n]/u.test(`${user}${host}${port}${database}`)) process.exit(1);
  process.stdout.write([user, host, port, database].join("\t"));
} catch {
  process.exit(1);
}
NODE
)" || {
  echo "API_ENV_FILE DATABASE_MIGRATION_URL must be a valid PostgreSQL URL with a user" >&2
  exit 1
}
IFS=$'\t' read -r migration_database_user migration_database_host migration_database_port migration_database_name <<< "$migration_database_target"
if [[ "$runtime_database_user" != "$operating_ledger_runtime_role" ||
  "$runtime_database_user" == "$migration_database_user" ||
  "$runtime_database_host" != "$migration_database_host" ||
  "$runtime_database_port" != "$migration_database_port" ||
  "$runtime_database_name" != "$migration_database_name" ||
  "$runtime_database_user" == "postgres" ||
  "$migration_database_user" == "" ]]; then
  echo "DATABASE_URL and DATABASE_MIGRATION_URL must target the same server/database with distinct runtime and owner roles" >&2
  exit 1
fi

cd "$repo_root"
DATABASE_URL="$database_migration_url" pnpm --filter @jiangkong/api exec prisma migrate deploy
DATABASE_OWNER_URL="$database_migration_url" OPERATING_LEDGER_RUNTIME_ROLE="$operating_ledger_runtime_role" \
  "$repo_root/scripts/ops/verify-operating-ledger-runtime-role.sh"
ROOT_MIGRATION
}

install_draft_retention_units() {
  if [[ ! -f "$DRAFT_RETENTION_SERVICE_SOURCE" || ! -f "$DRAFT_RETENTION_TIMER_SOURCE" ]]; then
    echo "Contract draft retention systemd units are missing" >&2
    return 1
  fi
  sudo --non-interactive install -m 0644 \
    "$DRAFT_RETENTION_SERVICE_SOURCE" \
    "$SYSTEMD_UNIT_DIR/jiangkong-draft-retention.service"
  sudo --non-interactive install -m 0644 \
    "$DRAFT_RETENTION_TIMER_SOURCE" \
    "$SYSTEMD_UNIT_DIR/jiangkong-draft-retention.timer"
  sudo --non-interactive systemctl daemon-reload
  echo "Installed contract draft retention units without enabling or starting the timer."
}

install_pristine_draft_receipt_purge_units() {
  if [[ ! -f "$PRISTINE_DRAFT_RECEIPT_PURGE_SERVICE_SOURCE" || ! -f "$PRISTINE_DRAFT_RECEIPT_PURGE_TIMER_SOURCE" ]]; then
    echo "Pristine draft deletion receipt purge systemd units are missing" >&2
    return 1
  fi
  sudo --non-interactive install -m 0644 \
    "$PRISTINE_DRAFT_RECEIPT_PURGE_SERVICE_SOURCE" \
    "$SYSTEMD_UNIT_DIR/jiangkong-pristine-draft-deletion-receipt-purge.service"
  sudo --non-interactive install -m 0644 \
    "$PRISTINE_DRAFT_RECEIPT_PURGE_TIMER_SOURCE" \
    "$SYSTEMD_UNIT_DIR/jiangkong-pristine-draft-deletion-receipt-purge.timer"
  sudo --non-interactive systemctl daemon-reload
  echo "Installed pristine draft deletion receipt purge units without enabling or starting the timer."
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

wait_for_url() {
  local url=$1
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if curl -fsS "$url" >/dev/null; then
      return 0
    fi
    if (( attempt < HEALTH_ATTEMPTS )); then
      sleep 2
    fi
  done
  return 1
}

wait_for_liveness() {
  wait_for_url "$LIVENESS_URL"
}

wait_for_readiness() {
  wait_for_url "$READINESS_URL"
}

assert_dependency_tree_writable() {
  local path
  for path in \
    "$REPO_ROOT" \
    "$REPO_ROOT/node_modules" \
    "$REPO_ROOT/node_modules/.bin" \
    "$REPO_ROOT/services/api/node_modules" \
    "$REPO_ROOT/apps/web-admin/node_modules"; do
    if [[ -e "$path" ]] &&
      { [[ ! -d "$path" ]] || [[ ! -w "$path" ]]; }; then
      echo "deployment dependency path is not writable by $(id -un): $path" >&2
      return 1
    fi
  done
}

await_deployment_confirmation() {
  if [[ "$DEPLOY_CONFIRMATION_MODE" == immediate ]]; then
    return 0
  fi

  local elapsed=0
  local interval=2
  local decision=""
  echo "Deployment is healthy and awaiting an explicit smoke-test decision."
  echo "Decision file: $DEPLOY_CONFIRMATION_FILE"
  echo "Expected content: CONFIRM $TARGET_SHA or ROLLBACK $TARGET_SHA"

  while (( elapsed <= DEPLOY_CONFIRMATION_TIMEOUT_SECONDS )); do
    if sudo --non-interactive test -f "$DEPLOY_CONFIRMATION_FILE"; then
      if sudo --non-interactive test -L "$DEPLOY_CONFIRMATION_FILE"; then
        echo "Deployment decision file must not be a symbolic link" >&2
        return 1
      fi
      decision="$(sudo --non-interactive cat "$DEPLOY_CONFIRMATION_FILE")"
      sudo --non-interactive rm -f "$DEPLOY_CONFIRMATION_FILE"
      case "$decision" in
        "CONFIRM $TARGET_SHA")
          echo "Deployment confirmed after the smoke-test window."
          return 0
          ;;
        "ROLLBACK $TARGET_SHA")
          echo "Deployment rollback requested after the smoke-test window." >&2
          return 1
          ;;
        *)
          echo "Deployment decision content is invalid; starting runtime recovery" >&2
          return 1
          ;;
      esac
    fi

    if (( elapsed == DEPLOY_CONFIRMATION_TIMEOUT_SECONDS )); then
      break
    fi
    if (( DEPLOY_CONFIRMATION_TIMEOUT_SECONDS - elapsed < interval )); then
      interval=$((DEPLOY_CONFIRMATION_TIMEOUT_SECONDS - elapsed))
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  echo "Deployment confirmation timed out; starting runtime recovery" >&2
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
      mkdir -p "$API_RUNTIME_DIR"
      if ! rsync -a --delete "$ROLLBACK_DIR/api/" "$API_RUNTIME_DIR/"; then
        echo "Failed to restore the previous API runtime snapshot" >&2
        recovery_failed=true
      fi
      if [[ "$DEPLOY_WEB" == true ]]; then
        mkdir -p "$WEB_RUNTIME_DIR"
        if ! rsync -a --delete "$ROLLBACK_DIR/web-admin/" "$WEB_RUNTIME_DIR/"; then
          echo "Failed to restore the previous Web runtime snapshot" >&2
          recovery_failed=true
        fi
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
    if ! wait_for_liveness; then
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

if [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "TARGET_SHA must be the approved 40-character lowercase SHA" >&2
  exit 1
fi
actual_candidate_sha="$(git rev-parse HEAD)"
if [[ "$actual_candidate_sha" != "$TARGET_SHA" ]]; then
  echo "TARGET_SHA does not match the checked out HEAD" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Candidate worktree must be clean before production deployment" >&2
  exit 1
fi

if [[ "$DEPLOY_CONFIRMATION_MODE" == manual ]]; then
  if [[ "$DEPLOY_CONFIRMATION_DIR" != /* ]] ||
    [[ -L "$DEPLOY_CONFIRMATION_DIR" ]]; then
    echo "DEPLOY_CONFIRMATION_DIR must be an absolute non-symbolic-link directory" >&2
    exit 1
  fi
  sudo --non-interactive install -d -m 0750 "$DEPLOY_CONFIRMATION_DIR"
  DEPLOY_CONFIRMATION_FILE="${DEPLOY_CONFIRMATION_FILE:-$DEPLOY_CONFIRMATION_DIR/$TARGET_SHA.decision}"
  if [[ "$(dirname -- "$DEPLOY_CONFIRMATION_FILE")" != "$DEPLOY_CONFIRMATION_DIR" ]] ||
    [[ -e "$DEPLOY_CONFIRMATION_FILE" ]] ||
    [[ -L "$DEPLOY_CONFIRMATION_FILE" ]] ||
    sudo --non-interactive test -e "$DEPLOY_CONFIRMATION_FILE"; then
    echo "Deployment decision file must be absent and inside DEPLOY_CONFIRMATION_DIR" >&2
    exit 1
  fi
fi

if [[ -L "$API_RUNTIME_DIR" ]] || { [[ "$DEPLOY_WEB" == true ]] && [[ -L "$WEB_RUNTIME_DIR" ]]; }; then
  echo "selected production runtime directories must not be symbolic links" >&2
  exit 1
fi
if [[ ! -d "$API_RUNTIME_DIR" ]] ||
  { [[ "$DEPLOY_WEB" == true ]] && [[ ! -d "$WEB_RUNTIME_DIR" ]]; }; then
  echo "selected production runtime directories must exist before an in-place deployment" >&2
  exit 1
fi

assert_dependency_tree_writable

# Build every selected runtime before applying database migrations. A build
# failure must not leave production with a new schema and the previous API
# process.
CI=true pnpm install --frozen-lockfile --prod=false
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api build
if [[ "$DEPLOY_WEB" == true ]]; then
  pnpm --filter @jiangkong/web-admin build
fi

STAGING_DIR="$(mktemp -d "$STAGING_PARENT_DIR/.deploy-stage.XXXXXX")"
mkdir -p "$STAGING_DIR/api"
rsync -a --delete "$REPO_ROOT/services/api/dist/" "$STAGING_DIR/api/dist/"
rsync -a --delete "$REPO_ROOT/services/api/prisma/" "$STAGING_DIR/api/prisma/"
if [[ -d "$REPO_ROOT/services/api/assets" ]]; then
  rsync -a --delete "$REPO_ROOT/services/api/assets/" "$STAGING_DIR/api/assets/"
fi
ln -sfn "$REPO_ROOT/services/api/node_modules" "$STAGING_DIR/api/node_modules"
if [[ "$DEPLOY_WEB" == true ]]; then
  mkdir -p "$STAGING_DIR/web-admin"
  rsync -a --delete "$REPO_ROOT/apps/web-admin/dist/" "$STAGING_DIR/web-admin/dist/"
fi

ROLLBACK_DIR="$(mktemp -d "$ROLLBACK_PARENT_DIR/.deploy-rollback.XXXXXX")"
mkdir -p "$ROLLBACK_DIR/api"
rsync -a --delete "$API_RUNTIME_DIR/" "$ROLLBACK_DIR/api/"
if [[ "$DEPLOY_WEB" == true ]]; then
  mkdir -p "$ROLLBACK_DIR/web-admin"
  rsync -a --delete "$WEB_RUNTIME_DIR/" "$ROLLBACK_DIR/web-admin/"
fi
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
mkdir -p "$API_RUNTIME_DIR"
rsync -a --delete "$STAGING_DIR/api/" "$API_RUNTIME_DIR/"
if [[ "$DEPLOY_WEB" == true ]]; then
  mkdir -p "$WEB_RUNTIME_DIR"
  rsync -a --delete "$STAGING_DIR/web-admin/" "$WEB_RUNTIME_DIR/"
fi

sudo systemctl restart "$API_SERVICE"
sudo nginx -t
sudo systemctl reload nginx

if ! wait_for_liveness; then
  echo "production API liveness check did not recover after restart" >&2
  exit 1
fi

if ! wait_for_readiness; then
  echo "production API readiness check did not recover after restart" >&2
  exit 1
fi

LOG_SINCE="2 minutes ago" \
  "$RUNTIME_HEALTH_SCRIPT"

if ! await_deployment_confirmation; then
  exit 1
fi

install_draft_retention_units
install_pristine_draft_receipt_purge_units

DEPLOY_SUCCEEDED=true
