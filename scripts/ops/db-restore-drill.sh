#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${RESTORE_DATABASE_NAME_CONFIRMATION:?RESTORE_DATABASE_NAME_CONFIRMATION is required}"

APPLY_CANDIDATE_MIGRATIONS="${APPLY_CANDIDATE_MIGRATIONS:-false}"
if [[ "$APPLY_CANDIDATE_MIGRATIONS" != true && "$APPLY_CANDIDATE_MIGRATIONS" != false ]]; then
  echo "APPLY_CANDIDATE_MIGRATIONS must be true or false" >&2
  exit 1
fi

CANDIDATE_SHA=""
EXPECTED_MIGRATION_COUNT=""
if [[ "$APPLY_CANDIDATE_MIGRATIONS" == true ]]; then
  : "${CANDIDATE_REPO_ROOT:?CANDIDATE_REPO_ROOT is required when applying candidate migrations}"
  : "${CANDIDATE_SHA_CONFIRMATION:?CANDIDATE_SHA_CONFIRMATION is required when applying candidate migrations}"
  if [[ "$CANDIDATE_REPO_ROOT" != /* || ! -d "$CANDIDATE_REPO_ROOT" || -L "$CANDIDATE_REPO_ROOT" ]]; then
    echo "CANDIDATE_REPO_ROOT must be an absolute, non-symlink directory" >&2
    exit 1
  fi
  if [[ ! "$CANDIDATE_SHA_CONFIRMATION" =~ ^[0-9a-f]{40}$ ]]; then
    echo "CANDIDATE_SHA_CONFIRMATION must be a 40-character lowercase commit SHA" >&2
    exit 1
  fi
  command -v git >/dev/null 2>&1 || {
    echo "git is required to verify the release candidate" >&2
    exit 1
  }
  command -v pnpm >/dev/null 2>&1 || {
    echo "pnpm is required to apply release candidate migrations" >&2
    exit 1
  }
  CANDIDATE_SHA="$(git -C "$CANDIDATE_REPO_ROOT" rev-parse HEAD)"
  if [[ "$CANDIDATE_SHA" != "$CANDIDATE_SHA_CONFIRMATION" ]]; then
    echo "Release candidate checkout does not match CANDIDATE_SHA_CONFIRMATION" >&2
    exit 1
  fi
  if [[ -n "$(git -C "$CANDIDATE_REPO_ROOT" status --porcelain --untracked-files=normal)" ]]; then
    echo "Release candidate checkout must not contain tracked or untracked changes" >&2
    exit 1
  fi
  migrations_directory="$CANDIDATE_REPO_ROOT/services/api/prisma/migrations"
  if [[ ! -d "$migrations_directory" || -L "$migrations_directory" ]]; then
    echo "Release candidate Prisma migrations directory is missing or unsafe" >&2
    exit 1
  fi
  EXPECTED_MIGRATION_COUNT="$(
    find "$migrations_directory" -mindepth 2 -maxdepth 2 -type f -name migration.sql | wc -l | tr -d '[:space:]'
  )"
  if [[ ! "$EXPECTED_MIGRATION_COUNT" =~ ^[0-9]+$ || "$EXPECTED_MIGRATION_COUNT" == 0 ]]; then
    echo "Release candidate contains no Prisma migrations" >&2
    exit 1
  fi
fi

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

read_migration_summary() {
  psql "$PG_RESTORE_DATABASE_URL" \
    --no-password \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command 'SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL), COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM "_prisma_migrations";'
}

validate_migration_summary() {
  local summary=$1
  local stage=$2
  local completed unfinished rolled_back
  IFS='|' read -r completed unfinished rolled_back <<< "$summary"
  if [[ ! "$completed" =~ ^[0-9]+$ || "$completed" == 0 ]]; then
    echo "$stage database has no completed Prisma migrations" >&2
    exit 1
  fi
  if [[ "$unfinished" != 0 || "$rolled_back" != 0 ]]; then
    echo "$stage database contains unfinished or rolled-back Prisma migrations" >&2
    exit 1
  fi
  printf '%s' "$completed"
}

pre_migration_summary="$(read_migration_summary)"
pre_migration_count="$(validate_migration_summary "$pre_migration_summary" "Restored")"
completed_migrations="$pre_migration_count"

if [[ "$APPLY_CANDIDATE_MIGRATIONS" == true ]]; then
  (
    cd "$CANDIDATE_REPO_ROOT"
    DATABASE_URL="$PG_RESTORE_DATABASE_URL" \
      pnpm --filter @jiangkong/api exec prisma migrate deploy
    DATABASE_URL="$PG_RESTORE_DATABASE_URL" \
      pnpm --filter @jiangkong/api exec prisma migrate status
  )
  post_migration_summary="$(read_migration_summary)"
  completed_migrations="$(validate_migration_summary "$post_migration_summary" "Migrated restore")"
  if [[ "$completed_migrations" != "$EXPECTED_MIGRATION_COUNT" ]]; then
    echo "Migrated restore does not contain the exact release candidate migration set" >&2
    exit 1
  fi
fi

printf 'restore_database=%s\n' "$target_database"
printf 'backup_file=%s\n' "$(basename "$BACKUP_FILE")"
printf 'backup_sha256=%s\n' "$actual_checksum"
printf 'pre_migration_count=%s\n' "$pre_migration_count"
if [[ "$APPLY_CANDIDATE_MIGRATIONS" == true ]]; then
  printf 'candidate_sha=%s\n' "$CANDIDATE_SHA"
  printf 'candidate_migration_count=%s\n' "$EXPECTED_MIGRATION_COUNT"
fi
printf 'completed_migration_count=%s\n' "$completed_migrations"

for table in User Project Contract ContractTakeover Settlement PaymentRequest ProjectExpenseRequest FileObject AuditLog; do
  psql "$PG_RESTORE_DATABASE_URL" --no-password --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command "select '$table=' || count(*) from \"$table\";"
done
