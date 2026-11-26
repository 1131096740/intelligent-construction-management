#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && $5 == --expense-witness-346 ) ||
  ( $# == 6 && $5 == --expense-witness-346 && $6 == --host-only ) ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
lane=profile
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
historical="$prior/remaining-special/profile"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
if [[ ${5:-} == --expense-witness-346 ]]; then
  [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$plan" "$historical") ]] || exit 65
  node "$plan/check-ledger.cjs" "$root" "$sha" "$5" | cmp -s "$prepared/source.json" - || exit 65
fi
node - "$prepared/source.json" "$sha" "$prior/remaining-special.json" "$historical" "$workspace" "$common/multi-witness.cjs" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan" "${5-}" <<'JS'
const [sourceFile,sha,profilesFile,prior,workspace,terminalFile,upwardProfile,historicalProfile,plan,option]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
const count=source.mode==='expense-witness-346'?346:source.mode==='historical-settlement-334'?334:source.mode==='upward-archive-332'?332:source.mode==='payment-remainder-331'?331:source.mode==='text-direct-330'?330:source.mode==='current-320'?329:295;
if(source.sourceSha!==sha||source.migrationCount!==count||
  (count===346)!==(option==="--expense-witness-346")||
  (count!==295?source.predecessor.ledgerSha256:source.ledgerSha256)!==terminal.final)process.exit(65);
if(count===332) require(upwardProfile).assertSource(source,sha,terminal.final);
if(count===334) require(historicalProfile).assertSource(source,terminal.final);
if(count===346){
  const profile=require(plan+'/expense-witness-346-profile.cjs');
  profile.assertSource(source,terminal.final);
  require(plan+'/bank/migration-inputs-346.cjs')(workspace+'/services/api',source,profile);
}
const pins=require(profilesFile).profile.mounts;
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const name of ['remaining-retained.cjs','fixtures.json','project-profile-original-seed.sql']){
  assert.equal(hash(prior+'/'+name),pins[name].sha256);
}
const original=require(prior+'/fixtures.json').profile;
assert.equal(hash(workspace+'/services/api/'+original.file),original.sha256);
JS
if [[ ${6-} != --host-only ]]; then
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-$lane.XXXXXXXX")
git -C "$root" show "$sha:.github/task12-install-295/contract-finance/common/installer.cjs" |
  cmp -s - "$common/installer.cjs" || exit 65

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
  --mount "type=bind,src=$plan/profile-entry.cjs,dst=/qualification/profile-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly"
  --mount "type=bind,src=$plan/profile-history.cjs,dst=/qualification/profile-history.cjs,readonly")
for file in remaining-retained.cjs fixtures.json project-profile-original-seed.sql; do
  args+=(--mount "type=bind,src=$historical/$file,dst=/qualification/$file,readonly")
done
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode" retained
if [[ $source_mode == expense-witness-346 ]]; then
  args+=(--mount "type=bind,src=$plan/payment-execution-346.cjs,dst=/qualification/payment-execution-346.cjs,readonly")
fi

if [[ ${6-} == --host-only ]]; then
  node --check "$work/installer.cjs"
  node --check "$plan/profile-entry.cjs"
  printf 'REMAINING_PROFILE_WARM_346_HOST_READY sha=%s material=%s\n' "$sha" "$work"
  exit 0
fi

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设原项目经营档案种子在同一实例从 125 升至 126 并保留到本轮已验证迁移终点。观察 profileHistory、retainedOriginal、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/profile-entry.cjs \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" "$prepared/source.json" <<'JS'
const [file,sha,lane,sourceFile]=process.argv.slice(2);
const r=require(file);
const count=require(sourceFile).migrationCount;
if(r.status!=='REMAINING_PROFILE_WARM_'+count+'_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
