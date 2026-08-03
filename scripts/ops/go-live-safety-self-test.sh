#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d)"
FAKE_BIN="$TEST_ROOT/bin"
FAKE_LOG="$TEST_ROOT/fake.log"
REAL_NODE="$(command -v node)"

bash -n \
  "$SCRIPT_DIR/check-production-db-backup.sh" \
  "$SCRIPT_DIR/db-backup.sh" \
  "$SCRIPT_DIR/db-restore-drill.sh" \
  "$SCRIPT_DIR/deploy-production-server.sh" \
  "$SCRIPT_DIR/run-production-db-backup.sh"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "self-test failed: $*" >&2
  tail -n 20 "$FAKE_LOG" >&2 || true
  exit 1
}

DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-production-server.sh"
DEPLOY_WORKFLOW="$SCRIPT_DIR/../../.github/workflows/deploy-production.yml"
NGINX_SECURITY_SNIPPET="$SCRIPT_DIR/../../deploy/nginx/jiangkong-security-snippets.conf.example"
grep -Fq 'TARGET_SHA="${TARGET_SHA:-}"' "$DEPLOY_SCRIPT" ||
  fail "deployment script does not accept the canonical TARGET_SHA"
if grep -Fq 'CANDIDATE_SHA_CONFIRMATION' "$DEPLOY_SCRIPT"; then
  fail "deployment script still defines a second candidate SHA contract"
fi
grep -Fq '"env TARGET_SHA=$TARGET_SHA bash -s"' "$DEPLOY_WORKFLOW" ||
  fail "deployment workflow does not pass the canonical TARGET_SHA"
grep -Fq 'add_header Content-Security-Policy-Report-Only ' "$NGINX_SECURITY_SNIPPET" ||
  fail "Nginx security snippet does not define the CSP report-only gate"
if grep -Eq '^add_header Content-Security-Policy ' "$NGINX_SECURITY_SNIPPET"; then
  fail "CSP must remain report-only until production-equivalent validation is complete"
fi

assert_file() {
  [[ -f "$1" ]] || fail "expected file $1"
}

assert_no_files() {
  local directory=$1
  local pattern=$2
  if find "$directory" -maxdepth 1 -type f -name "$pattern" | grep -q .; then
    fail "unexpected $pattern file in $directory"
  fi
}

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

mkdir -p "$FAKE_BIN"
: > "$FAKE_LOG"

cat > "$FAKE_BIN/pg_dump" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_dump %s\n' "$*" >> "${FAKE_LOG:?}"
[[ " $* " != *"schema="* ]]
output=""
while (( $# > 0 )); do
  case "$1" in
    --file)
      output=$2
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
[[ -n "$output" ]]
[[ "${FAKE_PG_DUMP_FAIL:-false}" != true ]]
printf 'fake-postgresql-custom-dump\n' > "$output"
FAKE

cat > "$FAKE_BIN/pg_restore" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_restore %s\n' "$*" >> "${FAKE_LOG:?}"
if [[ " $* " == *" --list "* && "${FAKE_PG_RESTORE_LIST_FAIL:-false}" == true ]]; then
  exit 1
fi
if [[ " $* " == *" --exit-on-error "* && "${FAKE_PG_RESTORE_FAIL:-false}" == true ]]; then
  exit 1
fi
FAKE

cat > "$FAKE_BIN/sha256sum" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%064d  %s\n' 0 "$1"
FAKE

cat > "$FAKE_BIN/stat" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}:${2:-}" in
  -c:%a)
    if /usr/bin/stat -c '%a' "$3" >/dev/null 2>&1; then
      exec /usr/bin/stat -c '%a' "$3"
    fi
    exec /usr/bin/stat -f '%Lp' "$3"
    ;;
  -c:%u)
    if /usr/bin/stat -c '%u' "$3" >/dev/null 2>&1; then
      exec /usr/bin/stat -c '%u' "$3"
    fi
    exec /usr/bin/stat -f '%u' "$3"
    ;;
  -c:%s)
    if /usr/bin/stat -c '%s' "$3" >/dev/null 2>&1; then
      exec /usr/bin/stat -c '%s' "$3"
    fi
    exec /usr/bin/stat -f '%z' "$3"
    ;;
  -f:*)
    printf 'mock GNU stat filesystem output\n'
    exit 1
    ;;
  *)
    exec /usr/bin/stat "$@"
    ;;
esac
FAKE

cat > "$FAKE_BIN/flock" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'flock %s\n' "$*" >> "${FAKE_LOG:?}"
[[ "${FAKE_FLOCK_FAIL:-false}" != true ]]
FAKE

cat > "$FAKE_BIN/psql" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
[[ " $* " != *"schema="* ]]
command_text=""
while (( $# > 0 )); do
  case "$1" in
    --command)
      command_text=$2
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
case "$command_text" in
  *current_database*)
    printf '%s\n' "${FAKE_DATABASE_NAME:-jiangkong_restore_selftest}"
    ;;
  *pg_catalog.pg_tables*)
    printf '%s\n' "${FAKE_PUBLIC_TABLE_COUNT:-0}"
    ;;
  *_prisma_migrations*)
    if [[ -n "${FAKE_MIGRATION_APPLIED_MARKER:-}" && -f "$FAKE_MIGRATION_APPLIED_MARKER" ]]; then
      printf '%s\n' "${FAKE_MIGRATION_SUMMARY_AFTER:-51|0|0}"
    else
      printf '%s\n' "${FAKE_MIGRATION_SUMMARY_BEFORE:-${FAKE_MIGRATION_SUMMARY:-51|0|0}}"
    fi
    ;;
  *)
    printf 'table=0\n'
    ;;
esac
FAKE

cat > "$FAKE_BIN/pnpm" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm %s\n' "$*" >> "${FAKE_LOG:?}"
if [[ " $* " == *" prisma migrate deploy "* && "${FAKE_MIGRATE_FAIL:-false}" == true ]]; then
  exit 1
fi
if [[ " $* " == *" prisma migrate deploy "* && -n "${FAKE_MIGRATION_APPLIED_MARKER:-}" ]]; then
  : > "$FAKE_MIGRATION_APPLIED_MARKER"
fi
FAKE

cat > "$FAKE_BIN/git" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "${FAKE_LOG:?}"
case " $* " in
  *" rev-parse HEAD "*)
    printf '%s\n' "${FAKE_GIT_HEAD:-0123456789abcdef0123456789abcdef01234567}"
    ;;
  *" status --porcelain --untracked-files=normal "*)
    if [[ "${FAKE_GIT_DIRTY:-false}" == true ]]; then
      printf '?? unexpected-file\n'
    fi
    ;;
  *)
    exit 1
    ;;
esac
FAKE

cat > "$FAKE_BIN/sudo" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
while (( $# > 0 )) && [[ "$1" == --* ]]; do
  shift
done
"$@"
FAKE

cat > "$FAKE_BIN/systemctl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >> "${FAKE_LOG:?}"
FAKE

cat > "$FAKE_BIN/nginx" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'nginx %s\n' "$*" >> "${FAKE_LOG:?}"
FAKE

cat > "$FAKE_BIN/curl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl args=%s runtime=%s marker=%s\n' "$*" "${API_RUNTIME_DIR:-missing}" "$(cat "${API_RUNTIME_DIR:-/missing}/dist/release.txt" 2>/dev/null || true)" >> "${FAKE_LOG:?}"
if [[ -f "${API_RUNTIME_DIR:?}/dist/release.txt" ]] &&
  [[ "$(< "${API_RUNTIME_DIR}/dist/release.txt")" == old-api ]]; then
  exit 0
fi
if [[ "${FAKE_RUNTIME_HEALTH_ALLOW_NEW:-false}" == true ]] &&
  [[ -f "${API_RUNTIME_DIR}/dist/release.txt" ]] &&
  [[ "$(< "${API_RUNTIME_DIR}/dist/release.txt")" == new-api-release ]]; then
  exit 0
fi
exit 1
FAKE

cat > "$FAKE_BIN/sleep" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${FAKE_DEPLOY_CONFIRMATION_FILE:-}" ]] &&
  [[ ! -e "$FAKE_DEPLOY_CONFIRMATION_FILE" ]]; then
  printf '%s %s\n' \
    "${FAKE_DEPLOY_CONFIRMATION_ACTION:-CONFIRM}" \
    "${TARGET_SHA:?}" \
    > "$FAKE_DEPLOY_CONFIRMATION_FILE"
fi
exit 0
FAKE

cat > "$FAKE_BIN/rsync" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'rsync %s\n' "$*" >> "${FAKE_LOG:?}"
/usr/bin/rsync "$@"
FAKE

cat > "$FAKE_BIN/node" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'node bucket=%s region=%s %s\n' \
  "${DB_BACKUP_COS_BUCKET:-missing}" \
  "${DB_BACKUP_COS_REGION:-missing}" \
  "$*" >> "${FAKE_LOG:?}"
count=1
if [[ -n "${FAKE_NODE_COUNT_FILE:-}" ]]; then
  if [[ -f "$FAKE_NODE_COUNT_FILE" ]]; then
    count="$(( $(< "$FAKE_NODE_COUNT_FILE") + 1 ))"
  fi
  printf '%s\n' "$count" > "$FAKE_NODE_COUNT_FILE"
fi
if [[ "${FAKE_NODE_FAIL_ON:-0}" == "$count" ]] ||
  { [[ "${FAKE_NODE_FAIL_FROM:-0}" != 0 ]] && (( count >= FAKE_NODE_FAIL_FROM )); }; then
  exit 1
fi
printf '{"verified":true}\n'
FAKE

chmod +x "$FAKE_BIN"/*

backup_success_dir="$TEST_ROOT/backup-success"
mkdir -p "$backup_success_dir"
backup_file="$(
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    DATABASE_URL="postgresql://local/jiangkong?schema=public&sslmode=require" \
    BACKUP_DIR="$backup_success_dir" \
    "$SCRIPT_DIR/db-backup.sh"
)"
assert_file "$backup_file"
assert_file "$backup_file.sha256"
[[ "$(file_mode "$backup_file")" == 600 ]] ||
  fail "backup mode must be 600"
[[ "$(file_mode "$backup_file.sha256")" == 600 ]] ||
  fail "checksum mode must be 600"
grep -q '^pg_restore --list ' "$FAKE_LOG" || fail "backup was not checked with pg_restore --list"
grep -q '^pg_dump .*sslmode=require' "$FAKE_LOG" || fail "backup did not preserve libpq parameters"
if grep -q '^pg_dump .*schema=' "$FAKE_LOG"; then
  fail "backup passed a Prisma-only parameter to pg_dump"
fi
grep -q '^flock --nonblock 9$' "$FAKE_LOG" || fail "backup did not acquire its process lock"

: > "$FAKE_LOG"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_FLOCK_FAIL=true \
  DATABASE_URL="postgresql://local/jiangkong" \
  BACKUP_DIR="$TEST_ROOT/backup-lock-failure" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "backup must reject a concurrent execution"
fi
if grep -q '^pg_dump ' "$FAKE_LOG"; then
  fail "backup started pg_dump without acquiring the process lock"
fi

offsite_success_dir="$TEST_ROOT/backup-offsite-success"
offsite_success_count="$TEST_ROOT/backup-offsite-success.count"
mkdir -p "$offsite_success_dir"
old_verified="$offsite_success_dir/jiangkong-20200101-000000.dump"
old_unverified="$offsite_success_dir/jiangkong-20200101-000001.dump"
printf 'old verified\n' > "$old_verified"
printf 'checksum\n' > "$old_verified.sha256"
printf '{}\n' > "$old_verified.offsite.json"
printf 'old unverified\n' > "$old_unverified"
printf 'checksum\n' > "$old_unverified.sha256"
touch -t 202001010000 "$old_verified" "$old_verified.sha256" "$old_verified.offsite.json" \
  "$old_unverified" "$old_unverified.sha256"
: > "$FAKE_LOG"
offsite_backup_file="$(
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    FAKE_NODE_COUNT_FILE="$offsite_success_count" \
    DATABASE_URL="postgresql://local/jiangkong" \
    COS_BUCKET="jiangkong-prod-files-1438687719" \
    BACKUP_DIR="$offsite_success_dir" \
    DB_BACKUP_OFFSITE_REQUIRED=true \
    DB_BACKUP_COS_SECRET_ID="test-database-backup-secret-id" \
    DB_BACKUP_COS_SECRET_KEY="database-backup-secret-for-tests-only" \
    DB_BACKUP_COS_BUCKET="jiangkong-prod-db-backups-1438687719" \
    DB_BACKUP_COS_REGION="ap-chengdu" \
    DB_BACKUP_COS_PREFIX="database-backups" \
    DB_BACKUP_TRANSFER_SCRIPT="$SCRIPT_DIR/cos-backup-transfer.mjs" \
    "$SCRIPT_DIR/db-backup.sh"
)"
assert_file "$offsite_backup_file"
assert_file "$offsite_backup_file.sha256"
assert_file "$offsite_backup_file.offsite.json"
grep -Eq '^  "backupSize": [0-9]+,$' "$offsite_backup_file.offsite.json" ||
  fail "offsite receipt backup size must be numeric"
[[ "$(< "$offsite_success_count")" == 2 ]] || fail "backup did not upload dump and checksum"
grep -q 'node bucket=jiangkong-prod-db-backups-1438687719 region=ap-chengdu' "$FAKE_LOG" ||
  fail "backup did not use the dedicated COS configuration"
grep -q 'database-backups/[0-9]\{4\}/[0-9]\{2\}/[0-9]\{2\}/jiangkong-' "$FAKE_LOG" ||
  fail "backup object key does not contain the date hierarchy"
[[ ! -e "$old_verified" && ! -e "$old_verified.sha256" && ! -e "$old_verified.offsite.json" ]] ||
  fail "verified local backups older than the retention window were not cleaned"
[[ -e "$old_unverified" && -e "$old_unverified.sha256" ]] ||
  fail "local backup without an offsite receipt was removed"

offsite_retry_dir="$TEST_ROOT/backup-offsite-retry"
offsite_retry_count="$TEST_ROOT/backup-offsite-retry.count"
mkdir -p "$offsite_retry_dir"
offsite_retry_file="$(
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    FAKE_NODE_COUNT_FILE="$offsite_retry_count" \
    FAKE_NODE_FAIL_ON=1 \
    DATABASE_URL="postgresql://local/jiangkong" \
    BACKUP_DIR="$offsite_retry_dir" \
    DB_BACKUP_OFFSITE_REQUIRED=true \
    DB_BACKUP_COS_SECRET_ID="test-database-backup-secret-id" \
    DB_BACKUP_COS_SECRET_KEY="database-backup-secret-for-tests-only" \
    DB_BACKUP_COS_BUCKET="jiangkong-prod-db-backups-1438687719" \
    DB_BACKUP_COS_REGION="ap-chengdu" \
    DB_BACKUP_TRANSFER_SCRIPT="$SCRIPT_DIR/cos-backup-transfer.mjs" \
    "$SCRIPT_DIR/db-backup.sh"
)"
assert_file "$offsite_retry_file.offsite.json"
[[ "$(< "$offsite_retry_count")" == 3 ]] || fail "transient COS failure was not retried once"

offsite_failure_dir="$TEST_ROOT/backup-offsite-failure"
offsite_failure_count="$TEST_ROOT/backup-offsite-failure.count"
mkdir -p "$offsite_failure_dir"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_NODE_COUNT_FILE="$offsite_failure_count" \
  FAKE_NODE_FAIL_FROM=2 \
  DATABASE_URL="postgresql://local/jiangkong" \
  COS_BUCKET="jiangkong-prod-files-1438687719" \
  BACKUP_DIR="$offsite_failure_dir" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  DB_BACKUP_COS_SECRET_ID="test-database-backup-secret-id" \
  DB_BACKUP_COS_SECRET_KEY="database-backup-secret-for-tests-only" \
  DB_BACKUP_COS_BUCKET="jiangkong-prod-db-backups-1438687719" \
  DB_BACKUP_COS_REGION="ap-chengdu" \
  DB_BACKUP_COS_PREFIX="database-backups" \
  DB_BACKUP_TRANSFER_SCRIPT="$SCRIPT_DIR/cos-backup-transfer.mjs" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "backup must fail when checksum upload fails"
fi
find "$offsite_failure_dir" -name '*.dump' -type f | grep -q . ||
  fail "offsite failure removed the verified local dump"
find "$offsite_failure_dir" -name '*.dump.sha256' -type f | grep -q . ||
  fail "offsite failure removed the verified local checksum"
assert_no_files "$offsite_failure_dir" '*.offsite.json'

insecure_env_file="$TEST_ROOT/insecure-backup.env"
printf 'DB_BACKUP_COS_BUCKET=jiangkong-prod-db-backups-1438687719\n' > "$insecure_env_file"
chmod 644 "$insecure_env_file"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  DATABASE_URL="postgresql://local/jiangkong" \
  BACKUP_DIR="$TEST_ROOT/insecure-env-backups" \
  DB_BACKUP_ENV_FILE="$insecure_env_file" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "backup must reject a group/world-readable credential file"
fi

database_env_marker="$TEST_ROOT/database-env-command-must-not-run"
database_env_file="$TEST_ROOT/api.env"
cat > "$database_env_file" <<DATABASE_ENV
DATABASE_URL=postgresql://local/jiangkong
COS_BUCKET=jiangkong-prod-files-1438687719
UNRELATED_VALUE=\$(touch $database_env_marker)
DATABASE_ENV
chmod 600 "$database_env_file"
database_env_backup_dir="$TEST_ROOT/database-env-backup"
PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  DATABASE_ENV_FILE="$database_env_file" \
  BACKUP_DIR="$database_env_backup_dir" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null
[[ ! -e "$database_env_marker" ]] || fail "DATABASE_ENV_FILE was executed as shell code"

database_env_reused_bucket_dir="$TEST_ROOT/database-env-reused-business-bucket"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  DATABASE_ENV_FILE="$database_env_file" \
  BACKUP_DIR="$database_env_reused_bucket_dir" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  DB_BACKUP_COS_SECRET_ID="test-database-backup-secret-id" \
  DB_BACKUP_COS_SECRET_KEY="database-backup-secret-for-tests-only" \
  DB_BACKUP_COS_BUCKET="jiangkong-prod-files-1438687719" \
  DB_BACKUP_COS_REGION="ap-chengdu" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "database backup must discover and reject the business bucket from DATABASE_ENV_FILE"
fi

backup_env_marker="$TEST_ROOT/backup-env-command-must-not-run"
unsupported_backup_env_file="$TEST_ROOT/unsupported-backup.env"
cat > "$unsupported_backup_env_file" <<BACKUP_ENV
DB_BACKUP_COS_SECRET_ID=test-database-backup-secret-id
UNSUPPORTED_COMMAND=\$(touch $backup_env_marker)
BACKUP_ENV
chmod 600 "$unsupported_backup_env_file"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  DATABASE_URL="postgresql://local/jiangkong" \
  BACKUP_DIR="$TEST_ROOT/unsupported-env-backups" \
  DB_BACKUP_ENV_FILE="$unsupported_backup_env_file" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "backup must reject unsupported credential-file keys"
fi
[[ ! -e "$backup_env_marker" ]] || fail "DB_BACKUP_ENV_FILE was executed as shell code"

if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  DATABASE_URL="postgresql://local/jiangkong" \
  COS_BUCKET="jiangkong-prod-db-backups-1438687719" \
  BACKUP_DIR="$TEST_ROOT/reused-business-bucket" \
  DB_BACKUP_OFFSITE_REQUIRED=true \
  DB_BACKUP_COS_SECRET_ID="test-database-backup-secret-id" \
  DB_BACKUP_COS_SECRET_KEY="database-backup-secret-for-tests-only" \
  DB_BACKUP_COS_BUCKET="jiangkong-prod-db-backups-1438687719" \
  DB_BACKUP_COS_REGION="ap-chengdu" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "database backups must reject the business file bucket"
fi

backup_failure_dir="$TEST_ROOT/backup-failure"
mkdir -p "$backup_failure_dir"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_PG_RESTORE_LIST_FAIL=true \
  DATABASE_URL="postgresql://local/jiangkong" \
  BACKUP_DIR="$backup_failure_dir" \
  "$SCRIPT_DIR/db-backup.sh" >/dev/null 2>&1; then
  fail "backup must fail when pg_restore --list fails"
fi
assert_no_files "$backup_failure_dir" '*.dump'
assert_no_files "$backup_failure_dir" '*.sha256'

: > "$FAKE_LOG"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_DATABASE_NAME=jiangkong \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong \
  BACKUP_FILE="$backup_file" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "restore drill must reject the production database name"
fi
[[ ! -s "$FAKE_LOG" ]] || fail "restore command ran for a rejected database name"

if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_DATABASE_NAME=jiangkong_restore_selftest \
  FAKE_PUBLIC_TABLE_COUNT=1 \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_selftest" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_selftest \
  BACKUP_FILE="$backup_file" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "restore drill must reject a non-empty target schema"
fi
[[ ! -s "$FAKE_LOG" ]] || fail "restore command ran for a non-empty target schema"

PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_DATABASE_NAME=jiangkong_restore_selftest \
  FAKE_PUBLIC_TABLE_COUNT=0 \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_selftest?schema=public" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_selftest \
  BACKUP_FILE="$backup_file" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null
grep -q '^pg_restore --list ' "$FAKE_LOG" || fail "restore drill did not validate the archive"
grep -q 'pg_restore --exit-on-error --dbname ' "$FAKE_LOG" ||
  fail "restore drill did not enable exit-on-error"

candidate_restore_root="$TEST_ROOT/candidate-restore"
candidate_migrations="$candidate_restore_root/services/api/prisma/migrations"
mkdir -p "$candidate_migrations"
for migration_number in $(seq 1 51); do
  migration_directory="$candidate_migrations/$(printf '%014d_candidate' "$migration_number")"
  mkdir -p "$migration_directory"
  : > "$migration_directory/migration.sql"
done
candidate_sha=0123456789abcdef0123456789abcdef01234567
candidate_migration_marker="$TEST_ROOT/candidate-migration-applied"
: > "$FAKE_LOG"
candidate_restore_output="$(
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    FAKE_GIT_HEAD="$candidate_sha" \
    FAKE_MIGRATION_APPLIED_MARKER="$candidate_migration_marker" \
    FAKE_MIGRATION_SUMMARY_BEFORE='50|0|0' \
    FAKE_MIGRATION_SUMMARY_AFTER='51|0|0' \
    FAKE_DATABASE_NAME=jiangkong_restore_candidate \
    FAKE_PUBLIC_TABLE_COUNT=0 \
    RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_candidate?schema=public" \
    RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_candidate \
    BACKUP_FILE="$backup_file" \
    APPLY_CANDIDATE_MIGRATIONS=true \
    CANDIDATE_REPO_ROOT="$candidate_restore_root" \
    CANDIDATE_SHA_CONFIRMATION="$candidate_sha" \
    "$SCRIPT_DIR/db-restore-drill.sh"
)"
grep -q '^pnpm --filter @jiangkong/api exec prisma migrate deploy$' "$FAKE_LOG" ||
  fail "candidate restore drill did not apply release candidate migrations"
grep -q '^pnpm --filter @jiangkong/api exec prisma migrate status$' "$FAKE_LOG" ||
  fail "candidate restore drill did not verify Prisma migration status"
grep -q "^candidate_sha=$candidate_sha$" <<< "$candidate_restore_output" ||
  fail "candidate restore evidence did not bind the exact candidate SHA"
grep -q '^pre_migration_count=50$' <<< "$candidate_restore_output" ||
  fail "candidate restore evidence did not record the source migration count"
grep -q '^completed_migration_count=51$' <<< "$candidate_restore_output" ||
  fail "candidate restore evidence did not record the final migration count"

: > "$FAKE_LOG"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_GIT_HEAD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  FAKE_DATABASE_NAME=jiangkong_restore_candidate \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_candidate" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_candidate \
  BACKUP_FILE="$backup_file" \
  APPLY_CANDIDATE_MIGRATIONS=true \
  CANDIDATE_REPO_ROOT="$candidate_restore_root" \
  CANDIDATE_SHA_CONFIRMATION="$candidate_sha" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "candidate restore drill must reject a checkout at a different SHA"
fi
if grep -q '^pg_restore --exit-on-error ' "$FAKE_LOG"; then
  fail "candidate restore drill restored data before verifying the candidate SHA"
fi

: > "$FAKE_LOG"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_GIT_HEAD="$candidate_sha" \
  FAKE_GIT_DIRTY=true \
  FAKE_DATABASE_NAME=jiangkong_restore_candidate \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_candidate" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_candidate \
  BACKUP_FILE="$backup_file" \
  APPLY_CANDIDATE_MIGRATIONS=true \
  CANDIDATE_REPO_ROOT="$candidate_restore_root" \
  CANDIDATE_SHA_CONFIRMATION="$candidate_sha" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "candidate restore drill must reject a dirty candidate checkout"
fi
if grep -q '^pg_restore --exit-on-error ' "$FAKE_LOG"; then
  fail "candidate restore drill restored data before verifying candidate checkout cleanliness"
fi

rm -f "$candidate_migration_marker"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_GIT_HEAD="$candidate_sha" \
  FAKE_MIGRATE_FAIL=true \
  FAKE_MIGRATION_APPLIED_MARKER="$candidate_migration_marker" \
  FAKE_MIGRATION_SUMMARY_BEFORE='50|0|0' \
  FAKE_DATABASE_NAME=jiangkong_restore_candidate \
  FAKE_PUBLIC_TABLE_COUNT=0 \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_candidate" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_candidate \
  BACKUP_FILE="$backup_file" \
  APPLY_CANDIDATE_MIGRATIONS=true \
  CANDIDATE_REPO_ROOT="$candidate_restore_root" \
  CANDIDATE_SHA_CONFIRMATION="$candidate_sha" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "candidate restore drill must fail when candidate migration deployment fails"
fi

rm -f "$candidate_migration_marker"
if PATH="$FAKE_BIN:$PATH" \
  FAKE_LOG="$FAKE_LOG" \
  FAKE_GIT_HEAD="$candidate_sha" \
  FAKE_MIGRATION_APPLIED_MARKER="$candidate_migration_marker" \
  FAKE_MIGRATION_SUMMARY_BEFORE='50|0|0' \
  FAKE_MIGRATION_SUMMARY_AFTER='50|0|0' \
  FAKE_DATABASE_NAME=jiangkong_restore_candidate \
  FAKE_PUBLIC_TABLE_COUNT=0 \
  RESTORE_DATABASE_URL="postgresql://local/jiangkong_restore_candidate" \
  RESTORE_DATABASE_NAME_CONFIRMATION=jiangkong_restore_candidate \
  BACKUP_FILE="$backup_file" \
  APPLY_CANDIDATE_MIGRATIONS=true \
  CANDIDATE_REPO_ROOT="$candidate_restore_root" \
  CANDIDATE_SHA_CONFIRMATION="$candidate_sha" \
  "$SCRIPT_DIR/db-restore-drill.sh" >/dev/null 2>&1; then
  fail "candidate restore drill must reject an incomplete candidate migration set"
fi

make_deploy_fixture() {
  local fixture=$1
  mkdir -p \
    "$fixture/repo/services/api/dist" \
    "$fixture/repo/services/api/prisma" \
    "$fixture/repo/services/api/node_modules" \
    "$fixture/repo/apps/web-admin/dist" \
    "$fixture/repo/scripts/ops/systemd" \
    "$fixture/runtime/api/dist" \
    "$fixture/runtime/web-admin/dist" \
    "$fixture/staging-parent" \
    "$fixture/rollback-parent" \
    "$fixture/systemd" \
    "$fixture/backups"
  printf 'new-api-release\n' > "$fixture/repo/services/api/dist/release.txt"
  printf 'new-web-release\n' > "$fixture/repo/apps/web-admin/dist/release.txt"
  printf '[Unit]\nDescription=fixture retention service\n' \
    > "$fixture/repo/scripts/ops/systemd/jiangkong-draft-retention.service"
  printf '[Unit]\nDescription=fixture retention timer\n' \
    > "$fixture/repo/scripts/ops/systemd/jiangkong-draft-retention.timer"
  printf 'old-api\n' > "$fixture/runtime/api/dist/release.txt"
  printf 'old-web\n' > "$fixture/runtime/web-admin/dist/release.txt"
  printf 'DATABASE_URL=postgresql://local/jiangkong\n' > "$fixture/api.env"
  printf 'UNRELATED_VALUE=$(touch %s)\n' "$fixture/api-env-command-must-not-run" >> "$fixture/api.env"
  cat > "$fixture/db-backup.env" <<'BACKUP_ENV'
DB_BACKUP_COS_SECRET_ID=test-database-backup-secret-id
DB_BACKUP_COS_SECRET_KEY=database-backup-secret-for-tests-only
DB_BACKUP_COS_BUCKET=jiangkong-prod-db-backups-1438687719
DB_BACKUP_COS_REGION=ap-chengdu
DB_BACKUP_COS_PREFIX=database-backups
BACKUP_ENV
  chmod 600 "$fixture/api.env" "$fixture/db-backup.env"
  cat > "$fixture/health.sh" <<'HEALTH'
#!/usr/bin/env bash
exit 0
HEALTH
  chmod +x "$fixture/health.sh"
}

run_deploy_fixture() {
  local fixture=$1
  shift
  local candidate_sha=0123456789abcdef0123456789abcdef01234567
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    FAKE_GIT_HEAD="$candidate_sha" \
    TARGET_SHA="$candidate_sha" \
    REPO_ROOT_OVERRIDE="$fixture/repo" \
    API_RUNTIME_DIR="$fixture/runtime/api" \
    WEB_RUNTIME_DIR="$fixture/runtime/web-admin" \
    API_ENV_FILE="$fixture/api.env" \
    BACKUP_DIR="$fixture/backups" \
    BACKUP_SCRIPT="$SCRIPT_DIR/db-backup.sh" \
    BACKUP_RUN_AS_ROOT=true \
    DB_BACKUP_ENV_FILE="$fixture/db-backup.env" \
    DB_BACKUP_TRANSFER_SCRIPT="$SCRIPT_DIR/cos-backup-transfer.mjs" \
    FAKE_NODE_COUNT_FILE="$fixture/node-count" \
    RUNTIME_HEALTH_SCRIPT="$fixture/health.sh" \
    SYSTEMD_UNIT_DIR="$fixture/systemd" \
    STAGING_PARENT_DIR="$fixture/staging-parent" \
    ROLLBACK_PARENT_DIR="$fixture/rollback-parent" \
    HEALTH_ATTEMPTS=1 \
    "$@" \
    "$SCRIPT_DIR/deploy-production-server.sh"
}

migration_failure_fixture="$TEST_ROOT/deploy-migration-failure"
make_deploy_fixture "$migration_failure_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$migration_failure_fixture" env FAKE_MIGRATE_FAIL=true >/dev/null 2>&1; then
  fail "deployment must fail when migration fails"
fi
grep -q '^systemctl stop jiangkong-api$' "$FAKE_LOG" || fail "API was not stopped"
grep -q '^systemctl restart jiangkong-api$' "$FAKE_LOG" ||
  fail "API was not restarted after migration failure"
[[ "$(< "$migration_failure_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "migration failure changed the API runtime"
find "$migration_failure_fixture/backups" -name '*.dump' -type f | grep -q . ||
  fail "deployment did not create a pre-migration backup"
find "$migration_failure_fixture/backups" -name '*.offsite.json' -type f | grep -q . ||
  fail "deployment did not require a verified offsite pre-migration backup"

offsite_failure_fixture="$TEST_ROOT/deploy-offsite-failure"
make_deploy_fixture "$offsite_failure_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$offsite_failure_fixture" env FAKE_NODE_FAIL_FROM=2 >/dev/null 2>&1; then
  fail "deployment must fail when the offsite backup cannot be verified"
fi
if grep -q '^systemctl stop jiangkong-api$' "$FAKE_LOG"; then
  fail "deployment stopped the API before the offsite backup was verified"
fi
if grep -q ' prisma migrate deploy ' "$FAKE_LOG"; then
  fail "deployment migrated the database before the offsite backup was verified"
fi

invalid_scope_fixture="$TEST_ROOT/deploy-invalid-scope"
make_deploy_fixture "$invalid_scope_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$invalid_scope_fixture" env DEPLOY_SCOPE=web-only >/dev/null 2>&1; then
  fail "deployment must reject an unknown deployment scope"
fi
if [[ -s "$FAKE_LOG" ]]; then
  fail "deployment performed work before rejecting an unknown deployment scope"
fi

invalid_candidate_fixture="$TEST_ROOT/deploy-invalid-candidate"
make_deploy_fixture "$invalid_candidate_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$invalid_candidate_fixture" \
  env TARGET_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa >/dev/null 2>&1; then
  fail "deployment must reject a candidate SHA that does not match HEAD"
fi
if grep -Eq '^(pnpm|flock|systemctl stop|pg_dump|rsync) ' "$FAKE_LOG"; then
  fail "deployment performed work before rejecting the candidate SHA"
fi

api_only_fixture="$TEST_ROOT/deploy-api-only"
make_deploy_fixture "$api_only_fixture"
: > "$FAKE_LOG"
run_deploy_fixture "$api_only_fixture" \
  env DEPLOY_SCOPE=api-only FAKE_RUNTIME_HEALTH_ALLOW_NEW=true >/dev/null 2>&1
[[ "$(< "$api_only_fixture/runtime/api/dist/release.txt")" == new-api-release ]] ||
  fail "API-only deployment did not switch the API runtime"
[[ "$(< "$api_only_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "API-only deployment changed the Web runtime"
grep -q '^pnpm --filter @jiangkong/api build$' "$FAKE_LOG" ||
  fail "API-only deployment did not build the API"
if grep -q '^pnpm --filter @jiangkong/web-admin build$' "$FAKE_LOG"; then
  fail "API-only deployment built the Web application"
fi
if grep -Fq "$api_only_fixture/runtime/web-admin" "$FAKE_LOG"; then
  fail "API-only deployment touched the Web runtime"
fi
grep -Fq 'curl args=-fsS http://127.0.0.1:3000/health runtime=' "$FAKE_LOG" ||
  fail "deployment did not check API liveness"
grep -Fq 'curl args=-fsS http://127.0.0.1:3000/health/readiness runtime=' "$FAKE_LOG" ||
  fail "deployment did not check database readiness"

api_only_health_failure_fixture="$TEST_ROOT/deploy-api-only-health-failure"
make_deploy_fixture "$api_only_health_failure_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$api_only_health_failure_fixture" \
  env DEPLOY_SCOPE=api-only >/dev/null 2>&1; then
  fail "API-only deployment must fail when the new runtime health check fails"
fi
[[ "$(< "$api_only_health_failure_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "API-only recovery did not restore the API runtime"
[[ "$(< "$api_only_health_failure_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "API-only recovery changed the Web runtime"
if grep -Fq "$api_only_health_failure_fixture/runtime/web-admin" "$FAKE_LOG"; then
  fail "API-only recovery touched the Web runtime"
fi

manual_confirmation_fixture="$TEST_ROOT/deploy-manual-confirmation"
make_deploy_fixture "$manual_confirmation_fixture"
manual_confirmation_file="$manual_confirmation_fixture/decision"
: > "$FAKE_LOG"
run_deploy_fixture "$manual_confirmation_fixture" env \
  DEPLOY_CONFIRMATION_MODE=manual \
  DEPLOY_CONFIRMATION_DIR="$manual_confirmation_fixture" \
  DEPLOY_CONFIRMATION_FILE="$manual_confirmation_file" \
  DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=2 \
  FAKE_DEPLOY_CONFIRMATION_FILE="$manual_confirmation_file" \
  FAKE_DEPLOY_CONFIRMATION_ACTION=CONFIRM \
  FAKE_RUNTIME_HEALTH_ALLOW_NEW=true >/dev/null 2>&1
[[ "$(< "$manual_confirmation_fixture/runtime/api/dist/release.txt")" == new-api-release ]] ||
  fail "manually confirmed deployment did not keep the new API runtime"
[[ "$(< "$manual_confirmation_fixture/runtime/web-admin/dist/release.txt")" == new-web-release ]] ||
  fail "manually confirmed deployment did not keep the new Web runtime"
[[ ! -e "$manual_confirmation_file" ]] ||
  fail "manual confirmation marker was not removed"

manual_rollback_fixture="$TEST_ROOT/deploy-manual-rollback"
make_deploy_fixture "$manual_rollback_fixture"
manual_rollback_file="$manual_rollback_fixture/decision"
: > "$FAKE_LOG"
if run_deploy_fixture "$manual_rollback_fixture" env \
  DEPLOY_CONFIRMATION_MODE=manual \
  DEPLOY_CONFIRMATION_DIR="$manual_rollback_fixture" \
  DEPLOY_CONFIRMATION_FILE="$manual_rollback_file" \
  DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=2 \
  FAKE_DEPLOY_CONFIRMATION_FILE="$manual_rollback_file" \
  FAKE_DEPLOY_CONFIRMATION_ACTION=ROLLBACK \
  FAKE_RUNTIME_HEALTH_ALLOW_NEW=true >/dev/null 2>&1; then
  fail "manual rollback decision must fail the deployment"
fi
[[ "$(< "$manual_rollback_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "manual rollback did not restore the API runtime"
[[ "$(< "$manual_rollback_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "manual rollback did not restore the Web runtime"
[[ ! -e "$manual_rollback_file" ]] ||
  fail "manual rollback marker was not removed"

manual_timeout_fixture="$TEST_ROOT/deploy-manual-timeout"
make_deploy_fixture "$manual_timeout_fixture"
manual_timeout_file="$manual_timeout_fixture/decision"
: > "$FAKE_LOG"
if run_deploy_fixture "$manual_timeout_fixture" env \
  DEPLOY_CONFIRMATION_MODE=manual \
  DEPLOY_CONFIRMATION_DIR="$manual_timeout_fixture" \
  DEPLOY_CONFIRMATION_FILE="$manual_timeout_file" \
  DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=1 \
  FAKE_RUNTIME_HEALTH_ALLOW_NEW=true >/dev/null 2>&1; then
  fail "manual confirmation timeout must fail the deployment"
fi
[[ "$(< "$manual_timeout_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "manual confirmation timeout did not restore the API runtime"
[[ "$(< "$manual_timeout_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "manual confirmation timeout did not restore the Web runtime"

stale_confirmation_fixture="$TEST_ROOT/deploy-stale-confirmation"
make_deploy_fixture "$stale_confirmation_fixture"
stale_confirmation_file="$stale_confirmation_fixture/decision"
printf 'CONFIRM 0123456789abcdef0123456789abcdef01234567\n' \
  > "$stale_confirmation_file"
: > "$FAKE_LOG"
if run_deploy_fixture "$stale_confirmation_fixture" env \
  DEPLOY_CONFIRMATION_MODE=manual \
  DEPLOY_CONFIRMATION_DIR="$stale_confirmation_fixture" \
  DEPLOY_CONFIRMATION_FILE="$stale_confirmation_file" >/dev/null 2>&1; then
  fail "deployment must reject a stale confirmation marker"
fi
if grep -Eq '^(pnpm|flock|systemctl stop|pg_dump|rsync) ' "$FAKE_LOG"; then
  fail "deployment performed work before rejecting a stale confirmation marker"
fi

health_failure_fixture="$TEST_ROOT/deploy-health-failure"
make_deploy_fixture "$health_failure_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$health_failure_fixture" env >/dev/null 2>&1; then
  fail "deployment must fail when the new runtime health check fails"
fi
[[ ! -e "$health_failure_fixture/api-env-command-must-not-run" ]] ||
  fail "deployment executed API_ENV_FILE as shell code"
[[ "$(< "$health_failure_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "API runtime snapshot was not restored"
[[ "$(< "$health_failure_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "Web runtime snapshot was not restored"
restart_count="$(grep -c '^systemctl restart jiangkong-api$' "$FAKE_LOG")"
[[ "$restart_count" -ge 2 ]] || fail "recovery did not restart the restored API runtime"

"$REAL_NODE" --test "$SCRIPT_DIR/cos-backup-transfer.test.mjs" >/dev/null
"$REAL_NODE" --test "$SCRIPT_DIR/check-production-db-backup.test.mjs" >/dev/null

echo "go-live ops safety self-test passed"
