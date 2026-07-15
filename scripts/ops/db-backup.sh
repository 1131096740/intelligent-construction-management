#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

file_owner_uid() {
  stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1"
}

validate_env_file() {
  local env_file=$1
  local label=$2
  local require_process_owner=$3
  if [[ "$env_file" != /* || ! -f "$env_file" || -L "$env_file" ]]; then
    echo "$label must be an absolute, regular, non-symlink file" >&2
    exit 1
  fi
  local mode
  mode="$(file_mode "$env_file")"
  if [[ ! "$mode" =~ ^[0-7]{3,4}$ ]] || (( (8#$mode & 8#077) != 0 )); then
    echo "$label must not be readable or writable by group or others" >&2
    exit 1
  fi
  if [[ "$require_process_owner" == true && "$(file_owner_uid "$env_file")" != "$EUID" ]]; then
    echo "$label must be owned by the backup process user" >&2
    exit 1
  fi
}

unquote_env_value() {
  local value=$1
  if [[ "$value" == \"* ]]; then
    if [[ "$value" != *\" || ${#value} -lt 2 ]]; then
      return 1
    fi
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'* ]]; then
    if [[ "$value" != *\' || ${#value} -lt 2 ]]; then
      return 1
    fi
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

load_database_url_file() {
  local env_file=$1
  validate_env_file "$env_file" "DATABASE_ENV_FILE" false
  local line value="" count=0 business_bucket="" business_bucket_count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" == DATABASE_URL=* ]]; then
      count=$((count + 1))
      value="$(unquote_env_value "${line#DATABASE_URL=}")" || {
        echo "DATABASE_ENV_FILE contains an invalid quoted DATABASE_URL" >&2
        exit 1
      }
    elif [[ "$line" == COS_BUCKET=* ]]; then
      business_bucket_count=$((business_bucket_count + 1))
      business_bucket="$(unquote_env_value "${line#COS_BUCKET=}")" || {
        echo "DATABASE_ENV_FILE contains an invalid quoted COS_BUCKET" >&2
        exit 1
      }
    fi
  done < "$env_file"
  if [[ "$count" != 1 || -z "$value" ]]; then
    echo "DATABASE_ENV_FILE must contain exactly one non-empty DATABASE_URL" >&2
    exit 1
  fi
  if (( business_bucket_count > 1 )) ||
    [[ "$business_bucket_count" == 1 && -z "$business_bucket" ]]; then
    echo "DATABASE_ENV_FILE must not contain duplicate or empty COS_BUCKET values" >&2
    exit 1
  fi
  DATABASE_URL="$value"
  export DATABASE_URL
  if [[ "$business_bucket_count" == 1 ]]; then
    COS_BUCKET="$business_bucket"
    export COS_BUCKET
  fi
}

load_backup_env_file() {
  local env_file=$1
  validate_env_file "$env_file" "DB_BACKUP_ENV_FILE" true
  local line key value
  local seen_keys="|"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    line="${line#export }"
    if [[ "$line" != *=* ]]; then
      echo "DB_BACKUP_ENV_FILE contains an invalid line" >&2
      exit 1
    fi
    key="${line%%=*}"
    case "$key" in
      DB_BACKUP_COS_SECRET_ID | DB_BACKUP_COS_SECRET_KEY | DB_BACKUP_COS_BUCKET | \
        DB_BACKUP_COS_REGION | DB_BACKUP_COS_PREFIX | DB_BACKUP_LOCAL_RETENTION_DAYS)
        ;;
      *)
        echo "DB_BACKUP_ENV_FILE contains unsupported key: $key" >&2
        exit 1
        ;;
    esac
    if [[ "$seen_keys" == *"|$key|"* ]]; then
      echo "DB_BACKUP_ENV_FILE contains duplicate key: $key" >&2
      exit 1
    fi
    value="$(unquote_env_value "${line#*=}")" || {
      echo "DB_BACKUP_ENV_FILE contains an invalid quoted value for $key" >&2
      exit 1
    }
    if [[ -z "$value" ]]; then
      echo "DB_BACKUP_ENV_FILE contains an empty value for $key" >&2
      exit 1
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
    seen_keys="$seen_keys$key|"
  done < "$env_file"
}

if [[ -n "${DATABASE_ENV_FILE:-}" ]]; then
  load_database_url_file "$DATABASE_ENV_FILE"
fi
if [[ -n "${DB_BACKUP_ENV_FILE:-}" ]]; then
  load_backup_env_file "$DB_BACKUP_ENV_FILE"
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

DB_BACKUP_OFFSITE_REQUIRED="${DB_BACKUP_OFFSITE_REQUIRED:-false}"
if [[ "$DB_BACKUP_OFFSITE_REQUIRED" != true && "$DB_BACKUP_OFFSITE_REQUIRED" != false ]]; then
  echo "DB_BACKUP_OFFSITE_REQUIRED must be true or false" >&2
  exit 1
fi

DB_BACKUP_TRANSFER_SCRIPT="${DB_BACKUP_TRANSFER_SCRIPT:-$SCRIPT_DIR/cos-backup-transfer.mjs}"
DB_BACKUP_COS_PREFIX="${DB_BACKUP_COS_PREFIX:-database-backups}"
DB_BACKUP_LOCAL_RETENTION_DAYS="${DB_BACKUP_LOCAL_RETENTION_DAYS:-7}"
DB_BACKUP_LOCAL_RETENTION_DAYS_NUMBER=0
if [[ "$DB_BACKUP_OFFSITE_REQUIRED" == true ]]; then
  : "${DB_BACKUP_COS_SECRET_ID:?DB_BACKUP_COS_SECRET_ID is required}"
  : "${DB_BACKUP_COS_SECRET_KEY:?DB_BACKUP_COS_SECRET_KEY is required}"
  : "${DB_BACKUP_COS_BUCKET:?DB_BACKUP_COS_BUCKET is required}"
  : "${DB_BACKUP_COS_REGION:?DB_BACKUP_COS_REGION is required}"
  if (( ${#DB_BACKUP_COS_SECRET_ID} < 16 || ${#DB_BACKUP_COS_SECRET_KEY} < 16 )); then
    echo "Database backup COS credentials are invalid" >&2
    exit 1
  fi
  if [[ ! "$DB_BACKUP_COS_BUCKET" =~ ^([a-z0-9]|[a-z0-9][a-z0-9-]{0,48}[a-z0-9])-([1-9][0-9]*)$ ]]; then
    echo "DB_BACKUP_COS_BUCKET has an invalid Tencent COS bucket format" >&2
    exit 1
  fi
  if [[ ! "$DB_BACKUP_COS_REGION" =~ ^[a-z]{2,}-[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "DB_BACKUP_COS_REGION has an invalid Tencent COS region format" >&2
    exit 1
  fi
  if [[ -n "${COS_BUCKET:-}" && "$DB_BACKUP_COS_BUCKET" == "$COS_BUCKET" ]]; then
    echo "Database backups must not use the business file bucket" >&2
    exit 1
  fi
  if [[ ! "$DB_BACKUP_COS_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] ||
    [[ "$DB_BACKUP_COS_PREFIX" == *".."* || "$DB_BACKUP_COS_PREFIX" == */ ]]; then
    echo "DB_BACKUP_COS_PREFIX has an invalid object path" >&2
    exit 1
  fi
  if [[ ! "$DB_BACKUP_LOCAL_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
    echo "DB_BACKUP_LOCAL_RETENTION_DAYS must be an integer from 0 to 3650" >&2
    exit 1
  fi
  DB_BACKUP_LOCAL_RETENTION_DAYS_NUMBER=$((10#$DB_BACKUP_LOCAL_RETENTION_DAYS))
  if (( DB_BACKUP_LOCAL_RETENTION_DAYS_NUMBER > 3650 )); then
    echo "DB_BACKUP_LOCAL_RETENTION_DAYS must be an integer from 0 to 3650" >&2
    exit 1
  fi
  if [[ ! -f "$DB_BACKUP_TRANSFER_SCRIPT" || -L "$DB_BACKUP_TRANSFER_SCRIPT" ]]; then
    echo "DB_BACKUP_TRANSFER_SCRIPT must be a regular, non-symlink file" >&2
    exit 1
  fi
  command -v node >/dev/null 2>&1 || {
    echo "Node.js is required for verified COS backup transfer" >&2
    exit 1
  }
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

PG_DATABASE_URL="${PG_DATABASE_URL:-$(normalize_libpq_url "$DATABASE_URL")}"

BACKUP_DIR="${BACKUP_DIR:-/srv/jiangkong-backups/db}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
command -v flock >/dev/null 2>&1 || {
  echo "flock is required to serialize database backups" >&2
  exit 1
}
exec 9> "$BACKUP_DIR/.db-backup.lock"
if ! flock --nonblock 9; then
  echo "Another database backup is already running" >&2
  exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/jiangkong-$stamp.dump"
checksum_file="$backup_file.sha256"
receipt_file="$backup_file.offsite.json"

if [[ -e "$backup_file" || -e "$checksum_file" || -e "$receipt_file" ]]; then
  echo "Backup destination already exists: $backup_file" >&2
  exit 1
fi

backup_temp="$(mktemp "$BACKUP_DIR/.jiangkong-$stamp.dump.XXXXXX")"
checksum_temp="$(mktemp "$BACKUP_DIR/.jiangkong-$stamp.sha256.XXXXXX")"
receipt_temp="$(mktemp "$BACKUP_DIR/.jiangkong-$stamp.offsite.XXXXXX")"
published=false
offsite_published=false

cleanup() {
  local exit_code=$?
  trap - EXIT
  rm -f "$backup_temp" "$checksum_temp" "$receipt_temp"
  if [[ "$published" != true ]]; then
    rm -f "$backup_file" "$checksum_file"
  fi
  if [[ "$offsite_published" != true ]]; then
    rm -f "$receipt_file"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

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

upload_to_cos_with_retry() {
  local file=$1
  local object_key=$2
  local file_sha256=$3
  local attempt
  for attempt in 1 2 3; do
    if node "$DB_BACKUP_TRANSFER_SCRIPT" upload \
      --file "$file" \
      --object-key "$object_key" \
      --sha256 "$file_sha256" >/dev/null; then
      return 0
    fi
    if (( attempt < 3 )); then
      echo "Verified COS upload attempt $attempt failed; retrying" >&2
      sleep "$((attempt * 2))"
    fi
  done
  echo "Verified COS upload failed after 3 attempts for object: $object_key" >&2
  return 1
}

pg_dump --format=custom --no-owner --file "$backup_temp" "$PG_DATABASE_URL"
if [[ ! -s "$backup_temp" ]]; then
  echo "Database backup is empty" >&2
  exit 1
fi
pg_restore --list "$backup_temp" >/dev/null

checksum="$(sha256_file "$backup_temp")"
if [[ ! "$checksum" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Database backup SHA-256 could not be calculated" >&2
  exit 1
fi
printf '%s  %s\n' "$checksum" "$(basename "$backup_file")" > "$checksum_temp"

chmod 600 "$backup_temp" "$checksum_temp"
mv "$backup_temp" "$backup_file"
mv "$checksum_temp" "$checksum_file"
published=true

if [[ "$DB_BACKUP_OFFSITE_REQUIRED" == true ]]; then
  year="${stamp:0:4}"
  month="${stamp:4:2}"
  day="${stamp:6:2}"
  object_directory="$DB_BACKUP_COS_PREFIX/$year/$month/$day"
  backup_object_key="$object_directory/$(basename "$backup_file")"
  checksum_object_key="$object_directory/$(basename "$checksum_file")"
  checksum_sha256="$(sha256_file "$checksum_file")"

  upload_to_cos_with_retry "$backup_file" "$backup_object_key" "$checksum"
  upload_to_cos_with_retry "$checksum_file" "$checksum_object_key" "$checksum_sha256"

  backup_size="$(stat -f '%z' "$backup_file" 2>/dev/null || stat -c '%s' "$backup_file")"
  uploaded_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{\n' > "$receipt_temp"
  printf '  "bucket": "%s",\n' "$DB_BACKUP_COS_BUCKET" >> "$receipt_temp"
  printf '  "region": "%s",\n' "$DB_BACKUP_COS_REGION" >> "$receipt_temp"
  printf '  "backupObjectKey": "%s",\n' "$backup_object_key" >> "$receipt_temp"
  printf '  "checksumObjectKey": "%s",\n' "$checksum_object_key" >> "$receipt_temp"
  printf '  "backupSize": %s,\n' "$backup_size" >> "$receipt_temp"
  printf '  "backupSha256": "%s",\n' "$checksum" >> "$receipt_temp"
  printf '  "checksumSha256": "%s",\n' "$checksum_sha256" >> "$receipt_temp"
  printf '  "uploadedAt": "%s"\n' "$uploaded_at" >> "$receipt_temp"
  printf '}\n' >> "$receipt_temp"
  chmod 600 "$receipt_temp"
  mv "$receipt_temp" "$receipt_file"
  offsite_published=true

  if (( DB_BACKUP_LOCAL_RETENTION_DAYS_NUMBER > 0 )); then
    while IFS= read -r -d '' expired_receipt; do
      expired_backup="${expired_receipt%.offsite.json}"
      rm -f "$expired_backup" "$expired_backup.sha256" "$expired_receipt"
    done < <(
      find "$BACKUP_DIR" -maxdepth 1 -type f \
        -name 'jiangkong-*.dump.offsite.json' \
        -mtime "+$DB_BACKUP_LOCAL_RETENTION_DAYS_NUMBER" \
        -print0
    )
  fi
fi

echo "$backup_file"
