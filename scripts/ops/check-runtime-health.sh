#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
SERVICE_NAME="${SERVICE_NAME:-jiangkong-api}"
DISK_PATH="${DISK_PATH:-/}"
DISK_MAX_USED_PERCENT="${DISK_MAX_USED_PERCENT:-85}"
LOG_SINCE="${LOG_SINCE:-15 minutes ago}"

failures=()

if ! curl -fsS "$HEALTH_URL" >/dev/null; then
  failures+=("health check failed: $HEALTH_URL")
fi

if command -v systemctl >/dev/null 2>&1 && ! systemctl is-active --quiet "$SERVICE_NAME"; then
  failures+=("systemd service not active: $SERVICE_NAME")
fi

used_percent="$(df -P "$DISK_PATH" | awk 'NR==2 {gsub("%", "", $5); print $5}')"
if [[ "$used_percent" =~ ^[0-9]+$ ]] && (( used_percent >= DISK_MAX_USED_PERCENT )); then
  failures+=("disk usage ${used_percent}% >= ${DISK_MAX_USED_PERCENT}% on $DISK_PATH")
fi

if command -v journalctl >/dev/null 2>&1; then
  warning_count="$(journalctl -u "$SERVICE_NAME" --since "$LOG_SINCE" -p warning --no-pager 2>/dev/null | awk '$0 != "-- No entries --" { count++ } END { print count + 0 }')"
  if [[ "$warning_count" =~ ^[0-9]+$ ]] && (( warning_count > 0 )); then
    failures+=("$warning_count warning/error log lines for $SERVICE_NAME since $LOG_SINCE")
  fi
fi

if (( ${#failures[@]} == 0 )); then
  echo "runtime health ok"
  exit 0
fi

message="JiangKong runtime health failed: ${failures[*]}"
echo "$message" >&2

if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
  curl -fsS -X POST "$ALERT_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"$message\"}}" >/dev/null || true
fi

if [[ -n "${ALERT_EMAIL_TO:-}" && -n "${SMTP_USER:-}" && -n "${SMTP_PASSWORD:-}" ]]; then
  email_from="${ALERT_EMAIL_FROM:-$SMTP_USER}"
  email_subject="${ALERT_EMAIL_SUBJECT:-JiangKong runtime health failed}"
  smtp_url="${SMTP_URL:-smtps://smtp.qq.com:465}"

  printf "From: %s\nTo: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n" \
    "$email_from" \
    "$ALERT_EMAIL_TO" \
    "$email_subject" \
    "$message" \
    | curl -fsS --ssl-reqd --url "$smtp_url" \
      --user "$SMTP_USER:$SMTP_PASSWORD" \
      --mail-from "$email_from" \
      --mail-rcpt "$ALERT_EMAIL_TO" \
      --upload-file - >/dev/null || true
fi

exit 1
