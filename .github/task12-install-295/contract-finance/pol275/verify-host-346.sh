#!/bin/bash
set -euo pipefail
[[ $# == 3 || ( $# == 4 && ( $4 == 346 || $4 == 349 || $4 == 350 ) ) ]] || exit 64
repo=$1
prepared=$2
sha=$3
count=${4:-346}
mode=expense-witness-$count
if [[ $count == 350 ]]; then
  [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64
  mode=signed-settlement-350
fi
base="$repo/.github/task12-install-295/contract-finance"
[[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$base") ]] || exit 65
node "$base/check-ledger.cjs" "$repo" "$sha" "--$mode" | cmp -s "$prepared/source.json" - || exit 65
api="$prepared/prepared/context/workspace/services/api"
git -C "$repo" show "$sha:services/api/prisma/migration-baseline.cjs" | cmp -s "$api/prisma/migration-baseline.cjs" - || exit 65
node - "$base" "$api" "$prepared/source.json" "$mode" <<'JS'
const [base,api,source,mode]=process.argv.slice(2);
require(base+'/bank/migration-inputs-346.cjs')(api,require(source),require(base+'/'+mode+'-profile.cjs'));
JS
