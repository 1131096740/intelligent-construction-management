#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

pg_restore --dbname "$RESTORE_DATABASE_URL" "$BACKUP_FILE"

for table in User Project Contract ContractTakeover Settlement PaymentRequest ProjectExpenseRequest FileObject AuditLog; do
  psql "$RESTORE_DATABASE_URL" --tuples-only --no-align \
    --command "select '$table=' || count(*) from \"$table\";"
done
