#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 || $6 == --historical-settlement-334 || $6 == --expense-witness-346 || $6 == --expense-witness-349 || $6 == --signed-settlement-350 || $6 == --company-history-352 ) ) ||
  ( $# == 7 && ( $6 == --historical-settlement-334 || $6 == --expense-witness-346 || $6 == --expense-witness-349 || $6 == --signed-settlement-350 || $6 == --company-history-352 ) && $7 == --host-only ) ]] || exit 64
if [[ ( ${6-} == --signed-settlement-350 || ${6-} == --company-history-352 ) && ${GITHUB_ACTIONS:-} == true ]]; then exit 64; fi
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
lane=$5
mode_args=()
if (( $# >= 6 )); then mode_args=("$6"); fi
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
source_tree=
expense_profile=
if [[ ${6:-} == --expense-witness-* || ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
  expense_profile="$plan/${6#--}-profile.cjs"
  dirty=$(git -C "$root" status --porcelain --untracked-files=all -- "$plan" "$prior")
  [[ -z $dirty ]] || exit 65
  source_tree=$(git -C "$root" rev-parse "$sha^{tree}")
fi
if [[ ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
  node "$plan/check-ledger.cjs" "$root" "$sha" "$6" | cmp -s "$prepared/source.json" - || exit 65
  node - "$plan" "$workspace/services/api" "$prepared/source.json" "$expense_profile" <<'JS'
const [plan,api,sourceFile,profile]=process.argv.slice(2);
require(plan+'/bank/migration-inputs-346.cjs')(api,require(sourceFile),require(profile));
JS
fi
node - "$prepared/source.json" "$sha" "$plan/finance-adjacent-profiles.json" "$lane" "$common/multi-witness.cjs" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" "$expense_profile" "$source_tree" ${mode_args[@]+"${mode_args[@]}"} <<'JS'
const [sourceFile,sha,profilesFile,lane,terminalFile,archiveProfile,historicalProfile,expenseProfile,tree,mode]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||!Object.hasOwn(require(profilesFile),lane))process.exit(65);
if(expenseProfile) {
  require('node:assert/strict').equal(source.sourceTree,tree);
  require(expenseProfile).assertSource(source,terminal.final);
} else if(mode==='--historical-settlement-334') {
  require(historicalProfile).assertSource(source,terminal.final);
} else if(mode==='--upward-archive-332') {
  require(archiveProfile).assertSource(source,sha,terminal.final);
} else if(mode!==undefined) {
  const count={'--current-320':329,'--text-direct-330':330,'--payment-remainder-331':331}[mode];
  if(source.mode!==mode.slice(2)||source.migrationCount!==count||source.predecessor?.migrationCount!==295||
     source.predecessor.ledgerSha256!==terminal.final||source.tails.length!==count-295) process.exit(65);
} else if(source.migrationCount!==295||source.ledgerSha256!==terminal.final) process.exit(65);
JS
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-adjacent-$lane.XXXXXXXX")
node - "$plan/finance-adjacent-profiles.json" "$prior" "$workspace" "$lane" "$root" "$sha" "$work" ${mode_args[@]+"${mode_args[@]}"} > "$work/mounts.tsv" <<'JS'
const [pins,prior,workspace,lane,repo,sha,work,mode]=process.argv.slice(2),profile=require(pins)[lane];
const fs=require('node:fs'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=file=>digest(fs.readFileSync(file));
const runner=prior+'/'+profile.runner;
assert.equal(hash(runner),profile.runnerSha256);
console.log(runner+'\t'+'/qualification/'+profile.runner);
const suite=profile.fixture?prior+'/fixtures/invoice-ledger.postgres.spec.ts':workspace+'/services/api/'+profile.suite;
assert.equal(hash(suite),profile.suiteSha256);
if(profile.fixture)console.log(suite+'\t'+'/qualification/workspace/services/api/'+profile.suite);
if (mode!==undefined && profile.legacySeed) {
  const {revision,files}=profile.legacySeed;
  const dir='services/api/src/fund-execution/';
  execFileSync('git',['-C',repo,'merge-base','--is-ancestor',revision,sha]);
  for(const [source,{fixture,sha256}] of Object.entries(files)) {
    const bytes=execFileSync('git',['-C',repo,'show',revision+':'+dir+source]);
    assert.equal(digest(bytes),sha256,'V7_PRE_CUTOVER_SOURCE');
    const local=work+'/'+fixture;
    fs.writeFileSync(local,bytes,{flag:'wx'});
    // The work directory stays private; Docker mounts this file for its non-root PostgreSQL user.
    fs.chmodSync(local,0o644);
    console.log(local+'\t'+'/qualification/workspace/'+dir+fixture);
  }
}
JS

installer="$common/installer.cjs"
if [[ ${6:-} == --historical-settlement-334 || -n $expense_profile ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
if [[ -n $expense_profile ]]; then
  git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer.patch"
  expected=$(node -e 'console.log(require(process.argv[1]).installerSha256)' "$plan/expense-witness-346-profile.cjs")
  [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  if [[ ${6:-} == --expense-witness-349 || ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-349-profile.cjs")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  fi
  if [[ ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-350.patch"
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/signed-settlement-350-profile.cjs")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  fi
  if [[ ${6:-} == --company-history-352 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-352.patch"
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$expense_profile")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  fi
  chmod 0644 "$installer"
fi
if [[ ${7-} == --host-only ]]; then
  printf '%s\n' "$work"
  exit 0
fi

build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65

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
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly"
  --mount "type=bind,src=$plan/finance-adjacent-entry.cjs,dst=/qualification/finance-adjacent-entry.cjs,readonly"
  --mount "type=bind,src=$plan/finance-adjacent-profiles.json,dst=/qualification/finance-adjacent-profiles.json,readonly")
if [[ ${6:-} == --upward-archive-332 || ${6:-} == --historical-settlement-334 || -n $expense_profile ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
if [[ ${6:-} == --historical-settlement-334 || -n $expense_profile ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ -n $expense_profile ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ ${6:-} == --expense-witness-349 || ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
  args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
if [[ ${6:-} == --signed-settlement-350 || ${6:-} == --company-history-352 ]]; then
  args+=(--mount "type=bind,src=$plan/signed-settlement-350-profile.cjs,dst=/qualification/signed-settlement-350-profile.cjs,readonly")
fi
if [[ ${6:-} == --company-history-352 ]]; then
  args+=(--mount "type=bind,src=$expense_profile,dst=/qualification/company-history-352-profile.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
while IFS=$'\t' read -r source relative; do
  args+=(--mount "type=bind,src=$source,dst=$relative,readonly")
done < "$work/mounts.tsv"

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
count=295
case "${6:-}" in --current-320) count=329;; --text-direct-330) count=330;; --payment-remainder-331) count=331;; --upward-archive-332) count=332;; --historical-settlement-334) count=334;; --expense-witness-346) count=346;; --expense-witness-349) count=349;; --signed-settlement-350) count=350;; --company-history-352) count=352;; esac
printf '%s\n' "假设原 $lane 业务断言、角色及并发行为可在同一 $count 隔离库保持。观察原用例统计、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/finance-adjacent-entry.cjs "$lane" ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" "$count" <<'JS'
const [file,sha,lane,count]=process.argv.slice(2);
const r=require(file);
if(r.status!=='ORIGINAL_FINANCE_ADJACENT_'+count+'_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
