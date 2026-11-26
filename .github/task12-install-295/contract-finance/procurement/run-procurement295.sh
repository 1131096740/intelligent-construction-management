#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && $6 == --current-320 ) ||
  ( ( $# == 6 || ( $# == 7 && $7 == --host-only ) ) &&
    ( $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 || $6 == --historical-settlement-334 || $6 == --expense-witness-346 ) ) ||
  ( $# == 7 && $5 == general16 && $6 == --payment-remainder-331 && $7 == --a05 ) ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
lane=$5
mode_args=()
count=295
stage_args=()
case ${6-} in
  --current-320) mode_args=(--current-320); stage_args=("${mode_args[@]}"); count=329 ;;
  --text-direct-330) mode_args=(--text-direct-330); stage_args=("${mode_args[@]}" "$prepared/source.json"); count=330 ;;
  --payment-remainder-331) mode_args=(--payment-remainder-331); stage_args=("${mode_args[@]}" "$prepared/source.json"); count=331 ;;
  --upward-archive-332) mode_args=(--upward-archive-332); stage_args=("${mode_args[@]}" "$prepared/source.json"); count=332 ;;
  --historical-settlement-334) mode_args=(--historical-settlement-334); stage_args=("${mode_args[@]}" "$prepared/source.json"); count=334 ;;
  --expense-witness-346) mode_args=(--expense-witness-346); stage_args=("${mode_args[@]}" "$prepared/source.json"); count=346 ;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
profile=
case $count in
  330) profile="$finance/text-direct-330-profile.cjs" ;;
  331) profile="$finance/payment-remainder-331-profile.cjs" ;;
  332) profile="$finance/upward-archive-332-profile.cjs" ;;
  334) profile="$finance/historical-settlement-334-profile.cjs" ;;
  346) profile="$finance/expense-witness-346-profile.cjs" ;;
esac
node - "$prepared/source.json" "$sha" "$lane" "$finance" "$count" "$profile" "$workspace" <<'JS'
const [sourceFile,sha,lane,finance,count,profile,workspace]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(finance+'/common/multi-witness.cjs');
if(source.sourceSha!==sha||source.migrationCount!==Number(count)||!['general16','project11'].includes(lane))process.exit(65);
if(count==='346') {
  const exact=require(profile);
  exact.assertSource(source,terminal.final);
  exact.assertRuntimeBaseline(require(workspace+'/services/api/prisma/migration-baseline.cjs'));
} else if(count==='334') {
  require(profile).assertSource(source,terminal.final);
} else if(profile) {
  require(profile).assertSource(source,sha,terminal.final);
} else if(count==='329') {
  if(source.mode!=='current-320'||source.predecessor.ledgerSha256!==terminal.final)process.exit(65);
} else if(source.ledgerSha256!==terminal.final)process.exit(65);
JS
if [[ -n $profile ]]; then
  [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$plan" "$common/installer.cjs" "$profile") ]] || exit 65
fi
profiles346=(historical-settlement-334-profile.cjs expense-witness-345-profile.cjs expense-witness-prefixes.json)
if [[ $count == 346 ]]; then
  for file in "${profiles346[@]}" expense-witness/installer.patch payment-execution-346.cjs historical-takeover-333-profile.cjs upward-archive-332-profile.cjs; do
    [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$finance/$file") ]] || exit 65
  done
fi
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-procurement-$lane.XXXXXXXX")
python3 "$plan/stage-procurement295.py" "$lane" "$root" "$workspace" "$work/runtime" ${stage_args[@]+"${stage_args[@]}"}

if [[ ${7-} == --host-only ]]; then
  for file in "$work/runtime/"*.cjs; do node --check "$file"; done
  node - "$work" "$sha" "$lane" "$count" "$prepared/source.json" <<'JS'
const [work,sourceSha,lane,count,sourceFile]=process.argv.slice(2);
const {readFileSync,writeFileSync,readdirSync}=require('node:fs');
const {createHash}=require('node:crypto');
const dir=work+'/runtime';
const hash=file=>createHash('sha256').update(readFileSync(dir+'/'+file)).digest('hex');
const files=readdirSync(dir,{withFileTypes:true}).filter(file=>file.isFile()).map(({name})=>name);
const receipt={status:'PROCUREMENT_'+count+'_HOST_INPUTS_VERIFIED',sourceSha,lane,cases:lane==='general16'?16:11,
  stagedInputs:Object.fromEntries(files.sort().map(file=>[file,hash(file)])),database:'NOT_STARTED'};
if(count==='346') {
  const {sourceTree,ledgerSha256,predecessor334,tails}=require(sourceFile);
  const walk=(parent,prefix='')=>readdirSync(parent,{withFileTypes:true}).flatMap(file=>{
    const name=prefix+file.name;
    return file.isDirectory()?walk(parent+'/'+file.name,name+'/'):[name];
  });
  Object.assign(receipt,{sourceTree,ledgerSha256,predecessor334,terminal:tails.at(-1),
    browserCases:lane==='project11'?4:0,
    workspaceOverlays:Object.fromEntries(walk(dir+'/workspace','workspace/').sort().map(file=>[file,hash(file)]))});
} else if(count==='334') {
  const {ledgerSha256,predecessor332,predecessor333}=require(sourceFile);
  Object.assign(receipt,{ledgerSha256,predecessor332,predecessor333});
} else if(count==='332') {
  const {ledgerSha256,predecessor331}=require(sourceFile);
  Object.assign(receipt,{ledgerSha256,predecessor331});
}
writeFileSync(work+'/host-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:work+'/host-receipt.json',...receipt}));
JS
  exit 0
fi
build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
memory=4g
if [[ ${GITHUB_ACTIONS-} == true && $count -ge 331 && -z ${7-} ]]; then
  memory=6g
fi
args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory "$memory"
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/product/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/procurement-entry.cjs,dst=/qualification/procurement-entry.cjs,readonly")
if [[ -n $profile ]]; then
  args+=(--mount "type=bind,src=$profile,dst=/qualification/${profile##*/},readonly")
fi
if [[ $count -ge 334 ]]; then
  for profile_file in historical-takeover-333-profile.cjs upward-archive-332-profile.cjs; do
    args+=(--mount "type=bind,src=$finance/$profile_file,dst=/qualification/$profile_file,readonly")
  done
fi
if [[ $count == 346 ]]; then
  for profile_file in "${profiles346[@]}"; do
    args+=(--mount "type=bind,src=$finance/$profile_file,dst=/qualification/$profile_file,readonly")
  done
fi
if [[ ${7-} == --a05 ]]; then
  args+=(--env JG_PROCUREMENT_A05=1)
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "$work"/runtime/*; do
  [[ ! -f "$file" ]] || args+=(--mount "type=bind,src=$file,dst=/qualification/${file##*/},readonly")
done
while IFS= read -r -d '' source; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/workspace/${source#"$work/runtime/workspace/"},readonly")
done < <(find "$work/runtime/workspace" -type f -print0)

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设原 $lane 角色下的采购验收、浏览器和临时权限清理在同一 $count 隔离实例通过。观察原套件、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/procurement-entry.cjs ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" "$count" "$profile" "$prepared/source.json" "${7-}" "$finance" <<'JS'
const [file,sha,lane,count,profile,source,option,finance]=process.argv.slice(2);
const r=require(file);
const a05=option==='--a05';
const expected=a05?'PROCUREMENT_A05_331_PASSED':
  lane==='general16'?'GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_'+count+'_PASSED':'PROJECT_SCOPE_ORIGINAL_11_'+count+'_PASSED';
if(r.status!==expected||r.sourceSha!==sha||(a05&&r.approvalA05?.passed!==1))process.exit(1);
if(count==='346') {
  require(finance+'/payment-execution-346.cjs').assertInstallation(r,require(source));
  if(r.multiWitnessCatalogAfterBusiness!==true)process.exit(1);
} else if(count==='334') {
  require(profile).assertFinanceInstallation(r,require(source));
  if(r.multiWitnessCatalogAfterBusiness!==true||r.historicalTakeoverCatalogAfterBusiness!==true||
    r.historicalSettlementCatalogAfterBusiness!==true)process.exit(1);
} else if(profile) {
  require(profile).assertInstallation(r,require(source));
  if(r.multiWitnessCatalogAfterBusiness!==true)process.exit(1);
}
JS
