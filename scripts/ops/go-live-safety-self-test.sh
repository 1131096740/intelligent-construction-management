#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d)"
FAKE_BIN="$TEST_ROOT/bin"
FAKE_LOG="$TEST_ROOT/fake.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "self-test failed: $*" >&2
  tail -n 20 "$FAKE_LOG" >&2 || true
  exit 1
}

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
    printf '%s\n' "${FAKE_MIGRATION_SUMMARY:-51|0|0}"
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
FAKE

cat > "$FAKE_BIN/sudo" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
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
printf 'curl runtime=%s marker=%s\n' "${API_RUNTIME_DIR:-missing}" "$(cat "${API_RUNTIME_DIR:-/missing}/dist/release.txt" 2>/dev/null || true)" >> "${FAKE_LOG:?}"
if [[ -f "${API_RUNTIME_DIR:?}/dist/release.txt" ]] &&
  [[ "$(< "${API_RUNTIME_DIR}/dist/release.txt")" == old-api ]]; then
  exit 0
fi
exit 1
FAKE

cat > "$FAKE_BIN/sleep" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN/rsync" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'rsync %s\n' "$*" >> "${FAKE_LOG:?}"
/usr/bin/rsync "$@"
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
[[ "$(stat -f '%Lp' "$backup_file" 2>/dev/null || stat -c '%a' "$backup_file")" == 600 ]] ||
  fail "backup mode must be 600"
[[ "$(stat -f '%Lp' "$backup_file.sha256" 2>/dev/null || stat -c '%a' "$backup_file.sha256")" == 600 ]] ||
  fail "checksum mode must be 600"
grep -q '^pg_restore --list ' "$FAKE_LOG" || fail "backup was not checked with pg_restore --list"
grep -q '^pg_dump .*sslmode=require' "$FAKE_LOG" || fail "backup did not preserve libpq parameters"
if grep -q '^pg_dump .*schema=' "$FAKE_LOG"; then
  fail "backup passed a Prisma-only parameter to pg_dump"
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

make_deploy_fixture() {
  local fixture=$1
  mkdir -p \
    "$fixture/repo/services/api/dist" \
    "$fixture/repo/services/api/prisma" \
    "$fixture/repo/services/api/node_modules" \
    "$fixture/repo/apps/web-admin/dist" \
    "$fixture/runtime/api/dist" \
    "$fixture/runtime/web-admin/dist" \
    "$fixture/staging-parent" \
    "$fixture/rollback-parent" \
    "$fixture/backups"
  printf 'new-api-release\n' > "$fixture/repo/services/api/dist/release.txt"
  printf 'new-web-release\n' > "$fixture/repo/apps/web-admin/dist/release.txt"
  printf 'old-api\n' > "$fixture/runtime/api/dist/release.txt"
  printf 'old-web\n' > "$fixture/runtime/web-admin/dist/release.txt"
  printf 'DATABASE_URL=postgresql://local/jiangkong\n' > "$fixture/api.env"
  cat > "$fixture/health.sh" <<'HEALTH'
#!/usr/bin/env bash
exit 0
HEALTH
  chmod +x "$fixture/health.sh"
}

run_deploy_fixture() {
  local fixture=$1
  shift
  PATH="$FAKE_BIN:$PATH" \
    FAKE_LOG="$FAKE_LOG" \
    REPO_ROOT_OVERRIDE="$fixture/repo" \
    API_RUNTIME_DIR="$fixture/runtime/api" \
    WEB_RUNTIME_DIR="$fixture/runtime/web-admin" \
    API_ENV_FILE="$fixture/api.env" \
    BACKUP_DIR="$fixture/backups" \
    BACKUP_SCRIPT="$SCRIPT_DIR/db-backup.sh" \
    RUNTIME_HEALTH_SCRIPT="$fixture/health.sh" \
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

health_failure_fixture="$TEST_ROOT/deploy-health-failure"
make_deploy_fixture "$health_failure_fixture"
: > "$FAKE_LOG"
if run_deploy_fixture "$health_failure_fixture" env >/dev/null 2>&1; then
  fail "deployment must fail when the new runtime health check fails"
fi
[[ "$(< "$health_failure_fixture/runtime/api/dist/release.txt")" == old-api ]] ||
  fail "API runtime snapshot was not restored"
[[ "$(< "$health_failure_fixture/runtime/web-admin/dist/release.txt")" == old-web ]] ||
  fail "Web runtime snapshot was not restored"
restart_count="$(grep -c '^systemctl restart jiangkong-api$' "$FAKE_LOG")"
[[ "$restart_count" -ge 2 ]] || fail "recovery did not restart the restored API runtime"

echo "go-live ops safety self-test passed"
