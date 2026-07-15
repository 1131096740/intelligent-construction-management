#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"

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

stamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/jiangkong-$stamp.dump"
checksum_file="$backup_file.sha256"

if [[ -e "$backup_file" || -e "$checksum_file" ]]; then
  echo "Backup destination already exists: $backup_file" >&2
  exit 1
fi

backup_temp="$(mktemp "$BACKUP_DIR/.jiangkong-$stamp.dump.XXXXXX")"
checksum_temp="$(mktemp "$BACKUP_DIR/.jiangkong-$stamp.sha256.XXXXXX")"
published=false

cleanup() {
  local exit_code=$?
  trap - EXIT
  rm -f "$backup_temp" "$checksum_temp"
  if [[ "$published" != true ]]; then
    rm -f "$backup_file" "$checksum_file"
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

echo "$backup_file"
