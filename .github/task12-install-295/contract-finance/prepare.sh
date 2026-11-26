#!/bin/bash
set -euo pipefail
umask 022

[[ $# == 3 || ( $# == 4 && ( $4 == --current-320 || $4 == --text-direct-330 || $4 == --payment-remainder-331 || $4 == --upward-archive-332 || $4 == --historical-takeover-333 || $4 == --historical-settlement-334 ) ) ]] || exit 64
root=$(cd "$1" && pwd -P)
sha=$2
out=$3
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
historical_sha=233e0d6808352e4b169ec0a82909afc0d3b8f8fa
git -C "$root" merge-base --is-ancestor "$historical_sha" "$sha"

mkdir "$out"
out=$(cd "$out" && pwd -P)
plan=$(cd "$(dirname "$0")" && pwd -P)
node "$plan/check-ledger.cjs" "$root" "$sha" "${@:4}" > "$out/source.json"
historical="$out/historical-checkout"
git -C "$root" worktree add --detach "$historical" "$historical_sha"
trap 'git -C "$root" worktree remove "$historical"' EXIT
[[ $(git -C "$historical" rev-parse HEAD) == "$historical_sha" ]] || exit 65
bash "$historical/.github/task12-install-292/prepare.sh" "$historical" "$historical_sha" "$out/prepared"

workspace="$out/prepared/context/workspace"
mkdir "$workspace" "$out/tails"
git -C "$root" archive "$sha" -- package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs \
  packages/shared-domain apps/web-admin services/api | tar xf - -C "$workspace"
node - "$out" <<'JS'
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const output=process.argv[2];
const source=require(path.join(output,'source.json'));
const tails=source.predecessor ? [...source.predecessor.tails,...source.tails] : source.tails;
for(const {name,sha256} of tails){
  const relative=path.join('services/api/prisma/migrations',name,'migration.sql');
  const bytes=fs.readFileSync(path.join(output,'prepared/context/workspace',relative));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);
  const dir=path.join(output,'tails',name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'migration.sql'),bytes,{flag:'wx',mode:0o644});
}
JS
printf '%s\n' 'CONTRACT_FINANCE_HOSTED_BASE_MATERIALIZED_NO_DATABASE'
