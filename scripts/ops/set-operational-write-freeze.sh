#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${API_ENV_FILE:-/etc/jiangkong/api.env}"
SERVICE_NAME="${API_SERVICE:-jiangkong-api}"
LIVENESS_URL="${LIVENESS_URL:-http://127.0.0.1:3000/health}"
READINESS_URL="${READINESS_URL:-http://127.0.0.1:3000/health/readiness}"
HEALTH_ATTEMPTS="${WRITE_FREEZE_HEALTH_ATTEMPTS:-15}"
HEALTH_DELAY_SECONDS="${WRITE_FREEZE_HEALTH_DELAY_SECONDS:-2}"
RECEIPT_DIR="${WRITE_FREEZE_RECEIPT_DIR:-/var/lib/jiangkong-write-freeze}"
LOCK_DIR="${WRITE_FREEZE_LOCK_DIR:-/run/jiangkong-write-freeze.lock}"

MODE=""
MODULES_INPUT=""
TARGET_SHA=""
CONFIRMATION=""
APPLY=false
TEMP_FILES=()
LOCK_ACQUIRED=false

KNOWN_MODULES=(
  account approval contract expense files finance master_data operations
  organization payment procurement project settlement
)

usage() {
  echo "Usage: $0 --mode off|all|modules [--modules module,...] --target-sha <40-char-sha> [--env-file <absolute-path>] [--apply --confirm <exact-confirmation>]" >&2
}

fail() {
  echo "Operational write freeze switch failed: $*" >&2
  exit 1
}

cleanup() {
  local path
  for path in ${TEMP_FILES[@]+"${TEMP_FILES[@]}"}; do
    [[ ! -e "$path" ]] || rm -f "$path"
  done
  if [[ "$LOCK_ACQUIRED" == true && -d "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

while (( $# > 0 )); do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      MODE=$2
      shift 2
      ;;
    --modules)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      MODULES_INPUT=$2
      shift 2
      ;;
    --target-sha)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      TARGET_SHA=$2
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      ENV_FILE=$2
      shift 2
      ;;
    --confirm)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      CONFIRMATION=$2
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$MODE" in
  off|all)
    [[ -z "$MODULES_INPUT" ]] || fail "--modules must be empty for $MODE mode"
    ;;
  modules)
    [[ -n "$MODULES_INPUT" ]] || fail "modules mode requires --modules"
    ;;
  *)
    fail "--mode must be off, all, or modules"
    ;;
esac

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "--target-sha must be a 40-character lowercase SHA"
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9@_.-]+$ ]] || fail "API service name is invalid"
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "WRITE_FREEZE_HEALTH_ATTEMPTS must be a positive integer"
[[ "$HEALTH_DELAY_SECONDS" =~ ^[0-9]+$ ]] || fail "WRITE_FREEZE_HEALTH_DELAY_SECONDS must be a non-negative integer"
[[ "$ENV_FILE" == /* && -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "environment file must be an existing absolute regular non-symlink file"
[[ "$REPO_ROOT" == /* && -d "$REPO_ROOT" && ! -L "$REPO_ROOT" ]] || fail "repository root must be an absolute non-symlink directory"
[[ "$RECEIPT_DIR" == /* && ! -L "$RECEIPT_DIR" ]] || fail "receipt directory must be an absolute non-symlink path"
[[ "$LOCK_DIR" == /* && ! -L "$LOCK_DIR" ]] || fail "lock directory must be an absolute non-symlink path"

for url in "$LIVENESS_URL" "$READINESS_URL"; do
  [[ "$url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/ ]] ||
    fail "health checks must use an explicit loopback HTTP URL"
done

canonical_modules=""
if [[ -n "$MODULES_INPUT" ]]; then
  [[ "$MODULES_INPUT" =~ ^[a-z_]+(,[a-z_]+)*$ ]] || fail "module list format is invalid"
  selected_modules=","
  IFS=',' read -r -a requested_modules <<< "$MODULES_INPUT"
  for module in "${requested_modules[@]}"; do
    known=false
    for candidate in "${KNOWN_MODULES[@]}"; do
      if [[ "$module" == "$candidate" ]]; then
        known=true
        break
      fi
    done
    [[ "$known" == true ]] || fail "module list contains an unknown module"
    [[ "$selected_modules" != *",$module,"* ]] || fail "module list contains a duplicate module"
    selected_modules+="$module,"
  done
  for module in "${KNOWN_MODULES[@]}"; do
    if [[ "$selected_modules" == *",$module,"* ]]; then
      canonical_modules="${canonical_modules:+$canonical_modules,}$module"
    fi
  done
  [[ "$MODULES_INPUT" == "$canonical_modules" ]] || fail "module list must use canonical registry order"
fi

actual_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)" || fail "unable to resolve repository HEAD"
[[ "$actual_sha" == "$TARGET_SHA" ]] || fail "target SHA does not match repository HEAD"
[[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]] || fail "repository worktree must be clean"

mode_count="$(awk -F= '$1 == "OPERATIONAL_WRITE_FREEZE_MODE" { count++ } END { print count + 0 }' "$ENV_FILE")"
modules_count="$(awk -F= '$1 == "OPERATIONAL_WRITE_FREEZE_MODULES" { count++ } END { print count + 0 }' "$ENV_FILE")"
(( mode_count <= 1 && modules_count <= 1 )) || fail "environment file contains duplicate write freeze keys"

required_confirmation="APPLY_OPERATIONAL_WRITE_FREEZE_${TARGET_SHA}_${MODE}_${canonical_modules:-none}"
if [[ "$APPLY" != true ]]; then
  echo "Dry run valid for candidate $TARGET_SHA: mode=$MODE modules=${canonical_modules:-none}"
  echo "Apply requires: --apply --confirm $required_confirmation"
  exit 0
fi

if (( EUID != 0 )) && [[ "${OPERATIONAL_WRITE_FREEZE_ALLOW_NON_ROOT:-false}" != true ]]; then
  fail "apply must run as root"
fi
[[ "$CONFIRMATION" == "$required_confirmation" ]] || fail "confirmation does not match the exact candidate and requested freeze state"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another write freeze switch is active"
fi
LOCK_ACQUIRED=true

env_directory="$(dirname "$ENV_FILE")"
backup_file="$(mktemp "$env_directory/.jiangkong-write-freeze-backup.XXXXXX")"
next_file="$(mktemp "$env_directory/.jiangkong-write-freeze-next.XXXXXX")"
TEMP_FILES+=("$backup_file" "$next_file")
chmod 600 "$backup_file" "$next_file"
cp -p "$ENV_FILE" "$backup_file"

previous_mode="$(awk -F= '$1 == "OPERATIONAL_WRITE_FREEZE_MODE" { print substr($0, index($0, "=") + 1) }' "$ENV_FILE")"
case "$previous_mode" in
  off|all|modules) ;;
  *) previous_mode="invalid_or_absent" ;;
esac

awk -v mode="$MODE" -v modules="$canonical_modules" '
  BEGIN { mode_seen = 0; modules_seen = 0 }
  /^OPERATIONAL_WRITE_FREEZE_MODE=/ {
    if (!mode_seen) print "OPERATIONAL_WRITE_FREEZE_MODE=" mode
    mode_seen = 1
    next
  }
  /^OPERATIONAL_WRITE_FREEZE_MODULES=/ {
    if (!modules_seen) print "OPERATIONAL_WRITE_FREEZE_MODULES=" modules
    modules_seen = 1
    next
  }
  { print }
  END {
    if (!mode_seen) print "OPERATIONAL_WRITE_FREEZE_MODE=" mode
    if (!modules_seen) print "OPERATIONAL_WRITE_FREEZE_MODULES=" modules
  }
' "$ENV_FILE" > "$next_file"

if stat -c '%a' "$ENV_FILE" >/dev/null 2>&1; then
  chmod "$(stat -c '%a' "$ENV_FILE")" "$next_file"
else
  chmod "$(stat -f '%Lp' "$ENV_FILE")" "$next_file"
fi
if (( EUID == 0 )); then
  if stat -c '%u:%g' "$ENV_FILE" >/dev/null 2>&1; then
    chown "$(stat -c '%u:%g' "$ENV_FILE")" "$next_file"
  else
    chown "$(stat -f '%u:%g' "$ENV_FILE")" "$next_file"
  fi
fi

mv "$next_file" "$ENV_FILE"

restore_previous_environment() {
  local restore_file
  restore_file="$(mktemp "$env_directory/.jiangkong-write-freeze-restore.XXXXXX")"
  TEMP_FILES+=("$restore_file")
  cp -p "$backup_file" "$restore_file"
  mv "$restore_file" "$ENV_FILE"
}

wait_for_health() {
  local attempt
  for (( attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++ )); do
    if curl -fsS "$LIVENESS_URL" >/dev/null && curl -fsS "$READINESS_URL" >/dev/null; then
      return 0
    fi
    if (( attempt < HEALTH_ATTEMPTS )); then
      sleep "$HEALTH_DELAY_SECONDS"
    fi
  done
  return 1
}

if ! systemctl restart "$SERVICE_NAME"; then
  restore_previous_environment
  systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 || true
  fail "API restart failed; the previous environment was restored"
fi

if ! wait_for_health; then
  restore_previous_environment
  rollback_recovered=false
  if systemctl restart "$SERVICE_NAME" && wait_for_health; then
    rollback_recovered=true
  fi
  if [[ "$rollback_recovered" == true ]]; then
    fail "new freeze state did not become healthy; the previous environment was restored"
  fi
  fail "new freeze state did not become healthy and rollback requires immediate operator attention"
fi

mkdir -p "$RECEIPT_DIR"
chmod 700 "$RECEIPT_DIR"
timestamp_file="$(date -u +%Y%m%dT%H%M%SZ)"
timestamp_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
receipt_file="$(mktemp "$RECEIPT_DIR/write-freeze-${timestamp_file}-${TARGET_SHA:0:12}-${MODE}.XXXXXX.json")"
TEMP_FILES+=("$receipt_file")
chmod 600 "$receipt_file"
modules_json="["
if [[ -n "$canonical_modules" ]]; then
  IFS=',' read -r -a receipt_modules <<< "$canonical_modules"
  separator=""
  for module in "${receipt_modules[@]}"; do
    modules_json+="$separator\"$module\""
    separator=","
  done
fi
modules_json+="]"
printf '{\n  "schemaVersion": 1,\n  "status": "applied",\n  "observedAt": "%s",\n  "candidateSha": "%s",\n  "service": "%s",\n  "previousMode": "%s",\n  "mode": "%s",\n  "modules": %s,\n  "liveness": "ok",\n  "readiness": "ok",\n  "productionBusinessWriteExecuted": false\n}\n' \
  "$timestamp_iso" \
  "$TARGET_SHA" \
  "$SERVICE_NAME" \
  "$previous_mode" \
  "$MODE" \
  "$modules_json" > "$receipt_file"

# Keep the successful receipt; all other transaction files are removed by trap.
for index in "${!TEMP_FILES[@]}"; do
  if [[ "${TEMP_FILES[$index]}" == "$receipt_file" ]]; then
    unset 'TEMP_FILES[index]'
  fi
done
echo "Operational write freeze applied: mode=$MODE modules=${canonical_modules:-none}"
echo "Receipt: $receipt_file"
