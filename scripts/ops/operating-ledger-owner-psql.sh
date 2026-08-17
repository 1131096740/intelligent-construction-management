#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"

command -v psql >/dev/null 2>&1 || {
  echo "psql is required" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "node is required to parse DATABASE_OWNER_URL without exposing it in argv" >&2
  exit 1
}

owner_pgpass_file="$(mktemp)"
cleanup_owner_pgpass() {
  rm -f "$owner_pgpass_file" "${owner_pgpass_file}.env"
}
trap cleanup_owner_pgpass EXIT
chmod 600 "$owner_pgpass_file"

DATABASE_OWNER_URL="$DATABASE_OWNER_URL" PGPASS_FILE="$owner_pgpass_file" node <<'NODE'
const fs = require("node:fs");

const raw = process.env.DATABASE_OWNER_URL;
const pgpassFile = process.env.PGPASS_FILE;
if (!raw || !pgpassFile) throw new Error("DATABASE_OWNER_URL and PGPASS_FILE are required");

const url = new URL(raw);
if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
  throw new Error("DATABASE_OWNER_URL must use the postgres protocol");
}
const rejectLineBreaks = (name, value) => {
  if (/[\r\n]/u.test(value)) throw new Error(`${name} must not contain a line break`);
  return value;
};
const host = rejectLineBreaks("host", url.hostname.replace(/^\[|\]$/gu, ""));
const port = rejectLineBreaks("port", url.port || "5432");
const user = rejectLineBreaks("user", decodeURIComponent(url.username));
const password = rejectLineBreaks("password", decodeURIComponent(url.password));
const database = rejectLineBreaks("database", decodeURIComponent(url.pathname.replace(/^\//u, "")));
if (!host || !user || !database) throw new Error("DATABASE_OWNER_URL must contain host, user and database");

const escapePgpass = (value) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
fs.writeFileSync(
  pgpassFile,
  `${escapePgpass(host)}:${escapePgpass(port)}:${escapePgpass(database)}:${escapePgpass(user)}:${escapePgpass(password)}\n`,
  { mode: 0o600 }
);

const lines = [
  `PGHOST=${host}`,
  `PGPORT=${port}`,
  `PGUSER=${user}`,
  `PGDATABASE=${database}`
];
const sslmode = url.searchParams.get("sslmode");
if (sslmode) lines.push(`PGSSLMODE=${rejectLineBreaks("sslmode", sslmode)}`);
fs.writeFileSync(`${pgpassFile}.env`, `${lines.join("\n")}\n`, { mode: 0o600 });
NODE

while IFS='=' read -r key value; do
  case "$key" in
    PGHOST) export PGHOST="$value" ;;
    PGPORT) export PGPORT="$value" ;;
    PGUSER) export PGUSER="$value" ;;
    PGDATABASE) export PGDATABASE="$value" ;;
    PGSSLMODE) export PGSSLMODE="$value" ;;
  esac
done < "${owner_pgpass_file}.env"
rm -f "${owner_pgpass_file}.env"
unset DATABASE_OWNER_URL
export PGPASSFILE="$owner_pgpass_file"

if psql --no-password "$@"; then
  status=0
else
  status=$?
fi
cleanup_owner_pgpass
trap - EXIT
exit "$status"
