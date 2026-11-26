#!/bin/bash
set -euo pipefail
umask 077

[[ $# -ge 4 && $# -le 7 ]] || exit 64
mode=295
selected_lane=
host_only=
for option in "${@:5}"; do
  case "$option" in
    --current-320) [[ $mode == 295 ]] || exit 64; mode=329 ;;
    --text-direct-330) [[ $mode == 295 ]] || exit 64; mode=330 ;;
    --payment-remainder-331) [[ $mode == 295 ]] || exit 64; mode=331 ;;
    --upward-archive-332) [[ $mode == 295 ]] || exit 64; mode=332 ;;
    --historical-settlement-334) [[ $mode == 295 ]] || exit 64; mode=334 ;;
    --expense-witness-346) [[ $mode == 295 ]] || exit 64; mode=346 ;;
    --host-only) [[ -z $host_only ]] || exit 64; host_only=1 ;;
    --*) exit 64 ;;
    *) [[ -z $selected_lane ]] || exit 64; selected_lane=$option ;;
  esac
done
[[ -z $host_only || $mode -ge 330 ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/../common"
scope=onboarding

profile=
case $mode in
  330) profile="$plan/../text-direct-330-profile.cjs" ;;
  331) profile="$plan/../payment-remainder-331-profile.cjs" ;;
  332) profile="$plan/../upward-archive-332-profile.cjs" ;;
  334) profile="$plan/../historical-settlement-334-profile.cjs" ;;
  346) profile="$plan/../expense-witness-346-profile.cjs" ;;
esac
node - "$prepared/source.json" "$sha" "$mode" "$plan" "$profile" <<'JS'
const [file,sha,mode,plan,profile]=process.argv.slice(2);
const source=require(file);
if(mode==='334'||mode==='346') {
  if(source.sourceSha!==sha) process.exit(65);
  require(profile).assertSource(source,require(plan+'/../common/multi-witness.cjs').final);
} else if(profile) {
  require(profile).assertSource(source,sha,require(plan+'/../common/multi-witness.cjs').final);
} else if(source.sourceSha!==sha||source.migrationCount!==Number(mode)||(mode==='329'&&source.mode!=='current-320')) {
  process.exit(1);
}
JS
if [[ -n $profile ]]; then
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$common/installer.cjs" "$profile") ]] || exit 65
fi
if [[ $mode == 346 ]]; then
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan/.." "$repo/.github/task12-install-290/onboarding") ]] || exit 65
  node - "$prepared" "$(git -C "$repo" rev-parse "$sha^{tree}")" "$profile" <<'JS'
const assert=require('node:assert/strict');
const [prepared,tree,profile]=process.argv.slice(2);
assert.equal(require(prepared+'/source.json').sourceTree,tree);
require(profile).assertRuntimeBaseline(require(prepared+'/prepared/context/workspace/services/api/prisma/migration-baseline.cjs'));
JS
fi
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
python3 "$plan/stage-onboarding.py" "$repo/.github/task12-install-290/onboarding" "$common" "$prepared/prepared/context/workspace" "$material" "$prepared/source.json"

if [[ -n $host_only ]]; then
  node - "$material" "$sha" "$repo/.github/task12-install-290/onboarding/pins.json" "$selected_lane" "$mode" "$prepared/source.json" <<'JS'
const [root,sourceSha,pinFile,lane,mode,sourceFile]=process.argv.slice(2);
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const sha=file=>createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex');
const {lanes}=require(pinFile),profiles=require(root+'/lanes.json');
assert.ok(!lane||lanes.includes(lane));
const receipt={status:'ONBOARDING_'+mode+'_HOST_INPUTS_VERIFIED',sourceSha,
  lanes:Object.fromEntries(lanes.map(name=>[name,profiles[name].caseCount])),
  workspaceInputsSha256:sha('workspace-inputs.json'),installerSha256:sha('installer.cjs'),
  laneProfilesSha256:sha('lanes.json'),database:'NOT_STARTED'};
if(mode==='346') {
  const {sourceTree,migrationCount,ledgerSha256,predecessor334,tails}=require(sourceFile);
  Object.assign(receipt,{sourceTree,migrationCount,ledgerSha256,predecessor334,terminal:tails.at(-1)});
} else if(mode==='334') {
  const {ledgerSha256,predecessor332,predecessor333}=require(sourceFile);
  Object.assign(receipt,{ledgerSha256,predecessor332,predecessor333});
} else if(mode==='332') {
  const {ledgerSha256,predecessor331}=require(sourceFile);
  Object.assign(receipt,{ledgerSha256,predecessor331});
}
writeFileSync(root+'/../host-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:root+'/../host-receipt.json',...receipt}));
JS
  exit 0
fi
build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/../context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init
  --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$material/installer.cjs,dst=/qualification/installer.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
old="$repo/.github/task12-install-290/onboarding"
if [[ -n $selected_lane ]]; then
  lane_names=$(node -e '
    const names=require(process.argv[1]).lanes;
    if(!names.includes(process.argv[2]))process.exit(64);
    console.log(process.argv[2]);
  ' "$old/pins.json" "$selected_lane")
else
  lane_names=$(node -e 'console.log(require(process.argv[1]).lanes.join("\n"))' "$old/pins.json")
fi
for file in lanes.json verify-application-source.cjs workspace-inputs.json; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/$file,readonly")
done
args+=(--mount "type=bind,src=$plan/onboarding-preflight.cjs,dst=/qualification/onboarding-preflight.cjs,readonly")
if [[ -n $profile ]]; then
  args+=(--mount "type=bind,src=$profile,dst=/qualification/${profile##*/},readonly")
fi
if [[ $mode == 334 || $mode == 346 ]]; then
  for profile_file in historical-takeover-333-profile.cjs upward-archive-332-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/../$profile_file,dst=/qualification/$profile_file,readonly")
  done
fi
if [[ $mode == 346 ]]; then
  for profile_file in historical-settlement-334-profile.cjs expense-witness-345-profile.cjs expense-witness-prefixes.json payment-execution-346.cjs; do
    args+=(--mount "type=bind,src=$plan/../$profile_file,dst=/qualification/$profile_file,readonly")
  done
fi
while IFS= read -r lane; do
  case "$lane" in
    lifecycle-rest|lifecycle-mobile) pids=256; tmp=512m ;;
    lifecycle-desktop|downstream|reset-case12|roster-read) pids=512; tmp=512m ;;
    roster) pids=512; tmp=768m ;;
    *) exit 65 ;;
  esac
  memory=4g
  if [[ ${GITHUB_ACTIONS-} == true && ( $mode == 331 || $mode == 332 || $mode == 334 || $mode == 346 ) && $lane == reset-case12 ]]; then
    memory=6g
  fi
  dir="$material/lanes/$lane"
  lane_args=("${args[@]}" --memory "$memory" --pids-limit "$pids" --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=$tmp")
  for file in "$dir"/*.cjs "$dir"/*.sql "$dir"/*.json; do
    case "${file##*/}" in checkout.cjs|owner-observation.cjs) continue ;; esac
    lane_args+=(--mount "type=bind,src=$file,dst=/qualification/${file##*/},readonly")
  done
  while IFS= read -r file; do
    lane_args+=(--mount "type=bind,src=$file,dst=/qualification/workspace/${file#"$dir/fixtures/"},readonly")
  done < <(find "$dir/fixtures" -type f | LC_ALL=C sort)
  mkdir "$work/$lane"
  docker run "${lane_args[@]}" --entrypoint node "$image" /qualification/onboarding-preflight.cjs |
    tee "$work/$lane/preflight.json"
  node -e 'const p=require(process.argv[1]);if(p.status!=="ONBOARDING_"+process.argv[4]+"_CONTEXT_NO_DATABASE_VERIFIED"||
    p.application.lane!==process.argv[2]||p.application.sourceSha!==process.argv[3])process.exit(1)' \
    "$work/$lane/preflight.json" "$lane" "$sha" "$mode"
  [[ -z $(docker ps -q) ]]
  printf '%s\n' "验证原具名角色行为可延续到 ${mode}。观察同库账本、两项撤权、所选原用例与清理。" > "$work/$lane/hypothesis.txt"
  code=0
  docker run "${lane_args[@]}" --entrypoint node "$image" /qualification/entry.cjs \
    > "$work/$lane/private.stdout" 2> "$work/$lane/private.stderr" || code=$?
  tail -n 1 "$work/$lane/private.stdout" > "$work/$lane/receipt.json"
  [[ ! -s "$work/$lane/receipt.json" ]] || cat "$work/$lane/receipt.json"
  (( code == 0 )) || exit "$code"
  node "$plan/verify-onboarding-receipts.cjs" "$work" "$lane" "$old" "$sha" "$prepared/source.json"
done <<< "$lane_names"
if [[ -z $selected_lane ]]; then
  node "$plan/verify-onboarding-receipts.cjs" "$work" '' "$old" "$sha" "$prepared/source.json"
fi
