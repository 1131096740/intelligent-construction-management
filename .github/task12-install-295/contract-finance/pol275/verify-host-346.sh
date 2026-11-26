#!/bin/bash
set -euo pipefail
[[ $# == 3 ]] || exit 64
repo=$1
prepared=$2
sha=$3
base="$repo/.github/task12-install-295/contract-finance"
[[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$base") ]] || exit 65
node "$base/check-ledger.cjs" "$repo" "$sha" --expense-witness-346 | cmp -s "$prepared/source.json" - || exit 65
api="$prepared/prepared/context/workspace/services/api"
git -C "$repo" show "$sha:services/api/prisma/migration-baseline.cjs" | cmp -s "$api/prisma/migration-baseline.cjs" - || exit 65
node - "$base" "$api" "$prepared/source.json" <<'JS'
const [base,api,source]=process.argv.slice(2);
require(base+'/bank/migration-inputs-346.cjs')(api,require(source),require(base+'/expense-witness-346-profile.cjs'));
JS
