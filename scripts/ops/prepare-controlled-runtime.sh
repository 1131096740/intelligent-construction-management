#!/usr/bin/env bash
set -euo pipefail
# Builds an independently retained checkout. No network install, migration,
# systemctl or production configuration reads. Existing stages are never reused.
if [[ $# != 3 || ! "$2" =~ ^[0-9a-f]{40}$ || "$1" != /* || "$3" != /* ]]; then
  echo 'Expected absolute checkout, exact SHA and absent absolute stage directory' >&2
  exit 1
fi
checkout=$1
sha=$2
stage=$3
[[ -d "$checkout" && ! -L "$checkout" ]] || exit 1
[[ ! -e "$stage" && ! -L "$stage" ]] || exit 1
[[ "$(git -C "$checkout" rev-parse HEAD)" == "$sha" ]] || exit 1
[[ -z "$(git -C "$checkout" status --porcelain --untracked-files=normal)" ]] || exit 1
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 20 ]] || exit 1
[[ "$(pnpm --version)" == 9.* ]] || exit 1
cd "$checkout"
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
# Freeze policy is loaded by the built API using ../../scripts; both cron
# entry points remain in the independently retained source checkout.
for required in services/api/dist/main.js services/api/dist/api-shutdown.js services/api/scripts/operational-write-freeze-policy.cjs apps/web-admin/dist/index.html; do
  [[ -f "$required" && ! -L "$required" ]] || exit 1
done
umask 077
mkdir "$stage"
mkdir "$stage/api" "$stage/web-admin"
cp -a services/api/dist "$stage/api/dist"
cp -a services/api/prisma "$stage/api/prisma"
cp -a services/api/scripts "$stage/api/scripts"
if [[ -d services/api/assets ]]; then cp -a services/api/assets "$stage/api/assets"; fi
ln -s "$checkout/services/api/node_modules" "$stage/api/node_modules"
cp -a apps/web-admin/dist "$stage/web-admin/dist"
echo 'Runtime stage prepared; preserve checkout and dependencies. No service started.'
