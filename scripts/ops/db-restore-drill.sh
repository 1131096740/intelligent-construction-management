#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${RESTORE_DATABASE_NAME_CONFIRMATION:?RESTORE_DATABASE_NAME_CONFIRMATION is required}"

normalize_libpq_url() {
  local raw_url=$1
  if [[ "$raw_url" != *\?* ]]; then
    printf '%s' "$raw_url"
    return
  fi

  local base_url="${raw_url%%\?*}"
  local query="${raw_url#*\?}"
  local fragment=""
  if [[ "$query" == *#* ]]; then
    fragment="#${query#*#}"
    query="${query%%#*}"
  fi

  local parameter key
  local -a kept_parameters=()
  local -a parameters=()
  IFS='&' read -r -a parameters <<< "$query"
  for parameter in "${parameters[@]}"; do
    key="${parameter%%=*}"
    case "$key" in
      schema|connection_limit|pool_timeout|socket_timeout|pgbouncer|statement_cache_size|sslaccept) ;;
      *)
        if [[ -n "$parameter" ]]; then
          kept_parameters+=("$parameter")
        fi
        ;;
    esac
  done

  if (( ${#kept_parameters[@]} > 0 )); then
    local kept_query
    kept_query="$(IFS='&'; printf '%s' "${kept_parameters[*]}")"
    printf '%s?%s%s' "$base_url" "$kept_query" "$fragment"
  else
    printf '%s%s' "$base_url" "$fragment"
  fi
}

PG_RESTORE_DATABASE_URL="${PG_RESTORE_DATABASE_URL:-$(normalize_libpq_url "$RESTORE_DATABASE_URL")}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

checksum_file="$BACKUP_FILE.sha256"
if [[ ! -f "$checksum_file" ]]; then
  echo "Backup checksum file not found: $checksum_file" >&2
  exit 1
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  echo "Neither sha256sum nor shasum is available" >&2
  return 1
}

target_database="$(
  psql "$PG_RESTORE_DATABASE_URL" \
    --no-password \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT current_database();"
)"
target_database="${target_database//$'\n'/}"
target_database="${target_database//$'\r'/}"

if [[ ! "$target_database" =~ ^jiangkong_restore_[A-Za-z0-9_]+$ ]]; then
  echo "Restore drill target must be an isolated jiangkong_restore_* database" >&2
  exit 1
fi
if [[ "$RESTORE_DATABASE_NAME_CONFIRMATION" != "$target_database" ]]; then
  echo "Restore database confirmation does not exactly match the connected database" >&2
  exit 1
fi

existing_public_tables="$(
  psql "$PG_RESTORE_DATABASE_URL" \
    --no-password \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';"
)"
if [[ ! "$existing_public_tables" =~ ^[0-9]+$ || "$existing_public_tables" != 0 ]]; then
  echo "Restore drill target public schema must be empty" >&2
  exit 1
fi

read -r expected_checksum expected_name < "$checksum_file"
expected_name="${expected_name#\*}"
if [[ ! "$expected_checksum" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Backup checksum file is invalid" >&2
  exit 1
fi
if [[ "$expected_name" != "$(basename "$BACKUP_FILE")" ]]; then
  echo "Backup checksum filename does not match the selected backup" >&2
  exit 1
fi
actual_checksum="$(sha256_file "$BACKUP_FILE")"
expected_checksum="$(printf '%s' "$expected_checksum" | tr '[:upper:]' '[:lower:]')"
actual_checksum="$(printf '%s' "$actual_checksum" | tr '[:upper:]' '[:lower:]')"
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 1
fi

pg_restore --list "$BACKUP_FILE" >/dev/null
pg_restore --exit-on-error --dbname "$PG_RESTORE_DATABASE_URL" "$BACKUP_FILE"

migration_summary="$(
  psql "$PG_RESTORE_DATABASE_URL" \
    --no-password \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command 'SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL), COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM "_prisma_migrations";'
)"
IFS='|' read -r completed_migrations unfinished_migrations rolled_back_migrations <<< "$migration_summary"
if [[ ! "$completed_migrations" =~ ^[0-9]+$ || "$completed_migrations" == 0 ]]; then
  echo "Restored database has no completed Prisma migrations" >&2
  exit 1
fi
if [[ "$unfinished_migrations" != 0 || "$rolled_back_migrations" != 0 ]]; then
  echo "Restored database contains unfinished or rolled-back Prisma migrations" >&2
  exit 1
fi

for table in User Project Contract ContractTakeover Settlement PaymentRequest ProjectExpenseRequest FileObject AuditLog; do
  psql "$PG_RESTORE_DATABASE_URL" --no-password --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command "select '$table=' || count(*) from \"$table\";"
done
