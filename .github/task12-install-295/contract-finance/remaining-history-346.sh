#!/bin/bash

# These three sealed history lanes share the exact 346 input checks.
verify_history_346() {
  local repo=$1 prepared=$2 sha=$3 plan=$4
  [[ "$plan" == "$repo/.github/task12-install-295/contract-finance" ]] || return 65
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || return 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$repo/.github/task12-install-289") ]] || return 65
  node "$plan/check-ledger.cjs" "$repo" "$sha" --expense-witness-346 | cmp -s "$prepared/source.json" - || return 65
  local api="$prepared/prepared/context/workspace/services/api"
  git -C "$repo" show "$sha:services/api/prisma/migration-baseline.cjs" | cmp -s "$api/prisma/migration-baseline.cjs" - || return 65
  node - "$plan" "$api" "$prepared/source.json" <<'JS'
const [plan,api,source]=process.argv.slice(2);
require(plan+'/bank/migration-inputs-346.cjs')(api,require(source),require(plan+'/expense-witness-346-profile.cjs'));
JS
}

append_history_346() {
  chmod 0644 "$work/installer.cjs"
  args+=(--env "JG_REMAINING_HISTORY_SOURCE_SHA=$sha"
    --mount "type=bind,src=$plan/bank/migration-inputs-346.cjs,dst=/qualification/migration-inputs-346.cjs,readonly"
    --mount "type=bind,src=$plan/remaining-history-346.cjs,dst=/qualification/remaining-history-346.cjs,readonly")
}

receipt_history_346() {
  node - "$work" "$prepared/source.json" "$@" <<'JS'
const {basename}=require('node:path');
const fs=require('node:fs'),{createHash}=require('node:crypto');
const [work,input,lane,...files]=process.argv.slice(2),source=require(input);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt={status:'REMAINING_HISTORY_346_HOST_READY',lane,sourceSha:source.sourceSha,sourceTree:source.sourceTree,
  sourceSha256:hash(input),ledgerSha256:source.ledgerSha256,predecessor334:source.predecessor334,
  installerSha256:hash(work+'/installer.cjs'),
  files:Object.fromEntries(files.map(file=>[basename(file),hash(file)])),database:'NOT_STARTED'};
fs.writeFileSync(work+'/host-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(work+'/host-receipt.json');
JS
}
