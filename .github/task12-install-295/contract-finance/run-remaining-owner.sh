#!/bin/bash
set -euo pipefail
umask 077

case $#:${6-}:${7-} in
  6:--signed-settlement-350:|7:--signed-settlement-350:--host-only)
    [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64 ;;
  *)
    [[ $# == 5 || ( $# == 6 && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 || $6 == --historical-settlement-334 || $6 == --expense-witness-34[69] ) ) ||
      ( $# == 7 && $6 == --expense-witness-34[69] && $7 == --host-only ) ]] || exit 64 ;;
esac
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
lane=$5
mode_args=()
count=295
if [[ $# -ge 6 ]]; then
  mode_args=("$6")
  case "$6" in
    --current-320) count=329 ;;
    --text-direct-330) count=330 ;;
    --payment-remainder-331) count=331 ;;
    --upward-archive-332) count=332 ;;
    --historical-settlement-334) count=334 ;;
    --expense-witness-346) count=346 ;;
    --expense-witness-349) count=349 ;;
    --signed-settlement-350) count=350 ;;
  esac
fi
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
owner="$prior/remaining-owner.cjs"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
node - "$prepared/source.json" "$sha" "$prior/remaining-owner-modes.json" "$lane" "$common/multi-witness.cjs" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" ${mode_args[@]+"${mode_args[@]}"} <<'JS'
const [sourceFile,sha,profilesFile,lane,terminalFile,upwardProfile,historicalProfile,mode]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||!Object.hasOwn(require(profilesFile),lane))process.exit(65);
if(mode!==undefined) {
  const count={'--current-320':329,'--text-direct-330':330,'--payment-remainder-331':331,'--upward-archive-332':332,
    '--historical-settlement-334':334,'--expense-witness-346':346,'--expense-witness-349':349,'--signed-settlement-350':350}[mode];
  if(source.mode!==mode.slice(2)||source.migrationCount!==count||source.predecessor?.migrationCount!==295||
     source.predecessor.ledgerSha256!==terminal.final||source.tails.length!==count-295) process.exit(65);
  if(count===332) require(upwardProfile).assertSource(source,sha,terminal.final);
  if(count===334) require(historicalProfile).assertSource(source,terminal.final);
} else if(source.migrationCount!==295||source.ledgerSha256!==terminal.final) process.exit(65);
JS
if (( count >= 346 )); then
  [[ "$plan" == "$finance" ]] || exit 65
  [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$plan" "$prior") ]] || exit 65
  node "$plan/check-ledger.cjs" "$root" "$sha" "$6" | cmp -s "$prepared/source.json" - || exit 65
  api="$workspace/services/api"
  git -C "$root" show "$sha:services/api/prisma/migration-baseline.cjs" | cmp -s "$api/prisma/migration-baseline.cjs" - || exit 65
  node - "$plan" "$api" "$prepared/source.json" <<'JS'
const [plan,api,sourceFile]=process.argv.slice(2);
const source=require(sourceFile),profile=require(plan+'/'+source.mode+'-profile.cjs');
profile.assertSource(source,require(plan+'/common/multi-witness.cjs').final);
require(plan+'/bank/migration-inputs-346.cjs')(api,source,profile);
JS
fi
if [[ ${7-} != --host-only ]]; then
  build=$(cd "$4" && pwd -P)
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
fi
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-$lane.XXXXXXXX")
profiles="$prior/remaining-owner-modes.json"
node "$owner" --mounts "$lane" "$workspace" > "$work/fixture-mounts.tsv"
spec=
current_profile=
if [[ $count != 295 && $lane == generic-batch ]]; then
  spec=src/database/pol05-operating-source-facts.spec.ts
  expected=e22999bfe33cbab9b963e0d61d94ac5bd27762dadda606f7838274de74a8cd04
  fixture="$work/pol05-operating-source-facts.spec.ts"
  cp "$prior/remaining-fixtures/$spec" "$fixture"
  patch --batch --forward --fuzz=0 --silent "$fixture" < "$plan/pol05-owner-comparison-320.patch"
elif [[ $count != 295 && $lane == takeover-task1 ]]; then
  spec=src/database/contract-takeover-confirmation-concurrency.spec.ts
  fixture="$work/contract-takeover-confirmation-concurrency.spec.ts"
  expected=$(git -C "$root" show "$sha:services/api/$spec" | shasum -a 256 | cut -d' ' -f1)
  cp "$workspace/services/api/$spec" "$fixture"
elif [[ $count != 295 && $lane == payable-settlement ]]; then
  spec=src/database/payable-settlement-concurrency.spec.ts
  fixture="$work/payable-settlement-concurrency.spec.ts"
  current_profile="$plan/payable-settlement-329-fixture.json"
  expected=$(node -p "require(process.argv[1]).sha" "$current_profile")
  cp "$workspace/services/api/$spec" "$fixture"
fi
if [[ -n "$spec" ]]; then
  node - "$profiles" "$work" "$spec" "$fixture" "$lane" "$expected" "$current_profile" <<'JS'
const fs=require('node:fs'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const [input,work,spec,fixture,lane,expected,currentProfile]=process.argv.slice(2);
const profile=require(input);
const sha=createHash('sha256').update(fs.readFileSync(fixture)).digest('hex');
assert.equal(sha,expected);
const archived=profile[lane].files[spec];
if (currentProfile) {
  const candidate=require(currentProfile);
  assert.equal(candidate.count,archived.count);
  assert.equal(candidate.titles.length,archived.count);
  assert.equal(new Set(candidate.titles).size,archived.count);
  profile[lane].files[spec]=candidate;
} else {
  archived.sha=sha;
}
fs.writeFileSync(work+'/remaining-owner-modes.json',JSON.stringify(profile));
const mounts=work+'/fixture-mounts.tsv';
const rows=fs.readFileSync(mounts,'utf8').split('\n').map(row=>row.endsWith('\t'+spec)?fixture+'\t'+spec:row);
assert.equal(rows.filter(row=>row===fixture+'\t'+spec).length,1);
fs.writeFileSync(mounts,rows.join('\n'));
JS
  profiles="$work/remaining-owner-modes.json"
  chmod 0644 "$fixture" "$profiles"
fi
if [[ $count != 295 ]]; then
  cp "$owner" "$work/remaining-owner.cjs"
  owner="$work/remaining-owner.cjs"
  patch --batch --forward --fuzz=0 --silent "$owner" < "$plan/remaining-owner-320-observation.patch"
  # The host work directory stays private. The postgres user reads the bind-mounted file.
  chmod 0644 "$owner"
fi

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/product/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/remaining-owner-entry.cjs,dst=/qualification/remaining-owner-entry.cjs,readonly"
  --mount "type=bind,src=$owner,dst=/qualification/remaining-owner.cjs,readonly"
  --mount "type=bind,src=$profiles,dst=/qualification/remaining-owner-modes.json,readonly")
if [[ $count == 332 || $count == 334 ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode" owner
if (( count >= 346 )); then
  args+=(--env "JG_REMAINING_OWNER_SOURCE_SHA=$sha"
    --mount "type=bind,src=$plan/bank/migration-inputs-346.cjs,dst=/qualification/migration-inputs-346.cjs,readonly")
fi
while IFS=$'\t' read -r source relative; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/workspace/services/api/$relative,readonly")
done < "$work/fixture-mounts.tsv"
if [[ ${7-} == --host-only ]]; then
  installer_hash=$(shasum -a 256 "$work/installer.cjs" | cut -d ' ' -f1)
  node - "$work" "$prepared/source.json" "$lane" "$profiles" "$owner" "$installer_hash" <<'JS'
const fs=require('node:fs'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const [out,sourceFile,lane,profiles,owner,installerSha256]=process.argv.slice(2);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const source=require(sourceFile),profile=require(profiles)[lane];
const fixtures=fs.readFileSync(out+'/fixture-mounts.tsv','utf8').trimEnd().split('\n').map(row=>{
  const [file,relative]=row.split('\t');
  const sha256=hash(file);
  assert.equal(sha256,profile.files[relative]?.sha??profile.sql[relative.split('/')[2]]);
  return {relative,sha256};
});
const receipt={status:'REMAINING_OWNER_'+source.migrationCount+'_HOST_READY',sourceSha:source.sourceSha,sourceTree:source.sourceTree,lane,
  ledgerSha256:source.ledgerSha256,predecessor334:source.predecessor334,sourceSha256:hash(sourceFile),installerSha256,
  profileSha256:hash(profiles),runnerSha256:hash(owner),fixtures,
  suites:Object.keys(profile.files).length,cases:Object.values(profile.files).reduce((n,file)=>n+file.count,0),database:'NOT_STARTED'};
if(source.migrationCount>=349) receipt.predecessor346=source.predecessor346;
if(source.migrationCount===350) {
  receipt.predecessor349=source.predecessor349;
  receipt.terminal=source.tails.at(-1);
}
fs.writeFileSync(out+'/host-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(out+'/host-receipt.json');
JS
  exit 0
fi

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设原 $lane 业务断言可在同一 $count 隔离库保持。观察 originalScope、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/remaining-owner-entry.cjs "$lane" ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" "$count" <<'JS'
const [file,sha,lane,count]=process.argv.slice(2);
const r=require(file);
if(r.status!=='REMAINING_OWNER_'+count+'_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
