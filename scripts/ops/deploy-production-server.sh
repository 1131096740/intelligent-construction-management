#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_RUNTIME_DIR="/srv/jiangkong/apps/api"
WEB_RUNTIME_DIR="/srv/jiangkong/apps/web-admin"
API_ENV_FILE="/etc/jiangkong/api.env"
API_SERVICE="jiangkong-api"
STAGING_DIR=""

cleanup() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
}
trap cleanup EXIT

cd "$REPO_ROOT"

if [[ -L "$API_RUNTIME_DIR" || -L "$WEB_RUNTIME_DIR" ]]; then
  echo "production runtime directories must not be symbolic links" >&2
  exit 1
fi

# Build everything before applying database migrations. A build failure must not
# leave production with a new schema and the previous API process.
CI=true pnpm install --frozen-lockfile --prod=false
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build

STAGING_DIR="$(mktemp -d /srv/jiangkong/.deploy-stage.XXXXXX)"
mkdir -p "$STAGING_DIR/api" "$STAGING_DIR/web-admin"
rsync -a --delete "$REPO_ROOT/services/api/dist/" "$STAGING_DIR/api/dist/"
rsync -a --delete "$REPO_ROOT/services/api/prisma/" "$STAGING_DIR/api/prisma/"
if [[ -d "$REPO_ROOT/services/api/assets" ]]; then
  rsync -a --delete "$REPO_ROOT/services/api/assets/" "$STAGING_DIR/api/assets/"
fi
ln -sfn "$REPO_ROOT/services/api/node_modules" "$STAGING_DIR/api/node_modules"
rsync -a --delete "$REPO_ROOT/apps/web-admin/dist/" "$STAGING_DIR/web-admin/dist/"

set -a
. "$API_ENV_FILE"
set +a

sudo nginx -t
sudo systemctl stop "$API_SERVICE"

pnpm --filter @jiangkong/api exec prisma migrate deploy

mkdir -p "$API_RUNTIME_DIR" "$WEB_RUNTIME_DIR"
rsync -a --delete "$STAGING_DIR/api/" "$API_RUNTIME_DIR/"
rsync -a --delete "$STAGING_DIR/web-admin/" "$WEB_RUNTIME_DIR/"

sudo systemctl restart "$API_SERVICE"
sudo nginx -t
sudo systemctl reload nginx

for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
    break
  fi
  if (( attempt == 15 )); then
    echo "production API health check did not recover after restart" >&2
    exit 1
  fi
  sleep 2
done

LOG_SINCE="2 minutes ago" \
  "$REPO_ROOT/scripts/ops/check-runtime-health.sh"
