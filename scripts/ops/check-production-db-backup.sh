#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SCRIPT="${DB_BACKUP_MONITOR_SCRIPT:-$SCRIPT_DIR/check-production-db-backup.mjs}"
STATE_DIR="${DB_BACKUP_MONITOR_STATE_DIR:-/var/lib/jiangkong-db-backup-monitor}"
ALERT_STATE_FILE="$STATE_DIR/active-alert.sha256"
VALIDATION_CACHE_FILE="$STATE_DIR/validation-cache.json"
SENSITIVE_TEMP_FILES=()

if (( EUID != 0 )) && [[ "${DB_BACKUP_MONITOR_ALLOW_NON_ROOT:-false}" != true ]]; then
  echo "Production database backup monitor must run as root" >&2
  exit 1
fi

if [[ "$STATE_DIR" != /* || -L "$STATE_DIR" ]]; then
  echo "Database backup monitor state directory must be an absolute non-symlink path" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

cleanup_sensitive_temp_files() {
  local file
  for file in "${SENSITIVE_TEMP_FILES[@]}"; do
    rm -f "$file"
  done
}
trap cleanup_sensitive_temp_files EXIT

for stale_config in "$STATE_DIR"/.curl-config.*; do
  [[ -e "$stale_config" ]] || continue
  rm -f "$stale_config"
done

json_field() {
  local field=$1
  node -e '
    const fs = require("node:fs");
    const field = process.argv[1];
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const value = data[field];
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(String(value));
  ' "$field"
}

curl_config_escape() {
  local value=$1
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    return 1
  fi
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

send_alert() {
  local message=$1
  local subject=$2
  local delivered=false
  local payload
  local curl_config
  local curl_status
  local escaped_url
  local escaped_user
  local escaped_password

  subject="${subject//$'\n'/ }"
  subject="${subject//$'\r'/ }"

  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    payload="$(
      ALERT_MESSAGE="$message" node -e '
        process.stdout.write(JSON.stringify({
          msgtype: "text",
          text: { content: process.env.ALERT_MESSAGE },
        }));
      '
    )"
    curl_config="$(mktemp "$STATE_DIR/.curl-config.XXXXXX")"
    SENSITIVE_TEMP_FILES+=("$curl_config")
    chmod 600 "$curl_config"
    if ! escaped_url="$(curl_config_escape "$ALERT_WEBHOOK_URL")"; then
      echo "Database backup alert webhook configuration is invalid" >&2
      rm -f "$curl_config"
      curl_config=""
    else
      printf 'url = "%s"\n' "$escaped_url" > "$curl_config"
    fi
    set +e
    if [[ -n "$curl_config" ]]; then
      curl -fsS -X POST --config "$curl_config" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null
      curl_status=$?
    else
      curl_status=1
    fi
    set -e
    [[ -z "$curl_config" ]] || rm -f "$curl_config"
    if (( curl_status == 0 )); then
      delivered=true
    else
      echo "Database backup alert webhook delivery failed" >&2
    fi
  fi

  if [[ -n "${ALERT_EMAIL_TO:-}" && -n "${SMTP_USER:-}" && -n "${SMTP_PASSWORD:-}" ]]; then
    local email_from="${ALERT_EMAIL_FROM:-$SMTP_USER}"
    local smtp_url="${SMTP_URL:-smtps://smtp.qq.com:465}"
    local smtp_curl_args=()
    if [[ "$email_from" == *$'\n'* || "$email_from" == *$'\r'* ||
      "$ALERT_EMAIL_TO" == *$'\n'* || "$ALERT_EMAIL_TO" == *$'\r'* ]]; then
      echo "Database backup alert email headers are invalid" >&2
      email_from=""
    fi
    curl_config=""
    if [[ -n "$email_from" ]]; then
      curl_config="$(mktemp "$STATE_DIR/.curl-config.XXXXXX")"
      SENSITIVE_TEMP_FILES+=("$curl_config")
      chmod 600 "$curl_config"
    fi
    if [[ -z "$curl_config" ]] ||
      ! escaped_url="$(curl_config_escape "$smtp_url")" ||
      ! escaped_user="$(curl_config_escape "$SMTP_USER")" ||
      ! escaped_password="$(curl_config_escape "$SMTP_PASSWORD")"; then
      echo "Database backup alert email configuration is invalid" >&2
      [[ -z "$curl_config" ]] || rm -f "$curl_config"
      curl_config=""
    else
      printf 'url = "%s"\nuser = "%s:%s"\n' \
        "$escaped_url" \
        "$escaped_user" \
        "$escaped_password" > "$curl_config"
    fi

    set +e
    if [[ -n "$curl_config" ]]; then
      smtp_curl_args=(
        -fsS
        --ssl-reqd
        --config "$curl_config"
        --mail-from "$email_from"
        --mail-rcpt "$ALERT_EMAIL_TO"
        --upload-file -
      )
      if [[ -n "${SMTP_LOGIN_OPTIONS:-}" ]]; then
        smtp_curl_args+=(--login-options "$SMTP_LOGIN_OPTIONS")
      fi
      printf "From: %s\nTo: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n" \
        "$email_from" \
        "$ALERT_EMAIL_TO" \
        "$subject" \
        "$message" \
        | curl "${smtp_curl_args[@]}" >/dev/null
      curl_status=$?
    else
      curl_status=1
    fi
    set -e
    [[ -z "$curl_config" ]] || rm -f "$curl_config"
    if (( curl_status == 0 )); then
      delivered=true
    else
      echo "Database backup alert email delivery failed" >&2
    fi
  fi

  if [[ "$delivered" != true ]]; then
    echo "Database backup alert has no working notification channel" >&2
    return 1
  fi
}

write_atomic() {
  local target=$1
  local content=$2
  local temp
  temp="$(mktemp "$STATE_DIR/.monitor-state.XXXXXX")"
  printf '%s\n' "$content" > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$target"
}

export DB_BACKUP_MONITOR_VALIDATION_CACHE_FILE="$VALIDATION_CACHE_FILE"
set +e
monitor_result="$(node "$MONITOR_SCRIPT")"
monitor_status=$?
set -e

if ! code="$(printf '%s' "$monitor_result" | json_field code)" ||
  ! message="$(printf '%s' "$monitor_result" | json_field message)" ||
  ! ok="$(printf '%s' "$monitor_result" | json_field ok)"; then
  code="MONITOR_OUTPUT_ERROR"
  message="数据库备份监控未返回有效结果；当前无法确认异机备份是否有效；请查看 jiangkong-db-backup-monitor.service 日志并修复后重试"
  ok=false
fi

if [[ "$ok" == true && "$monitor_status" -eq 0 ]]; then
  validation_signature="$(printf '%s' "$monitor_result" | json_field validationSignature || true)"
  if [[ "$validation_signature" =~ ^[a-f0-9]{64}$ ]]; then
    write_atomic "$VALIDATION_CACHE_FILE" "{\"validationSignature\":\"$validation_signature\"}"
  fi

  if [[ -s "$ALERT_STATE_FILE" ]]; then
    recovery_message="建工智管生产数据库异机备份已恢复；${message}；请在日常运维记录中关闭对应告警"
    if send_alert "$recovery_message" "${DB_BACKUP_RECOVERY_EMAIL_SUBJECT:-JiangKong database backup recovered}"; then
      rm -f "$ALERT_STATE_FILE"
    else
      echo "Database backup recovered, but the recovery notification will be retried" >&2
    fi
  fi

  echo "$message"
  exit 0
fi

echo "$message" >&2
fingerprint="$(
  ALERT_FINGERPRINT_INPUT="$code|$message" node -e '
    const { createHash } = require("node:crypto");
    process.stdout.write(createHash("sha256").update(process.env.ALERT_FINGERPRINT_INPUT).digest("hex"));
  '
)"

if [[ -s "$ALERT_STATE_FILE" && "$(< "$ALERT_STATE_FILE")" == "$fingerprint" ]]; then
  echo "Database backup alert already delivered; duplicate notification suppressed" >&2
  exit 1
fi

alert_message="建工智管生产数据库异机备份告警 [$code]：$message"
if send_alert "$alert_message" "${DB_BACKUP_ALERT_EMAIL_SUBJECT:-JiangKong database backup failed or stale}"; then
  write_atomic "$ALERT_STATE_FILE" "$fingerprint"
fi

exit 1
