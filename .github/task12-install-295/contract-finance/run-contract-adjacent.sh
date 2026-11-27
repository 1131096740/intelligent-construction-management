#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 || $6 == --historical-settlement-334 || $6 == --expense-witness-346 || $6 == --expense-witness-349 ) ) ||
  ( $# == 7 && ( $6 == --expense-witness-346 || $6 == --expense-witness-349 ) && $7 == --host-only ) ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
lane=$5
mode_args=()
expense_profile=expense-witness-346-profile.cjs
if [[ ${6:-} == --expense-witness-349 ]]; then expense_profile=expense-witness-349-profile.cjs; fi
if [[ $# -ge 6 ]]; then mode_args=("$6"); fi
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
node - "$prepared/source.json" "$sha" "$plan/contract-adjacent-profiles.json" "$lane" "$common/multi-witness.cjs" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan/$expense_profile" ${mode_args[@]+"${mode_args[@]}"} <<'JS'
const [sourceFile,sha,profilesFile,lane,terminalFile,archiveProfile,historicalProfile,expenseProfile,mode]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||!Object.hasOwn(require(profilesFile).profiles,lane))process.exit(65);
if(['--expense-witness-346','--expense-witness-349'].includes(mode)) {
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
if [[ ${6:-} == --expense-witness-34[69] ]]; then
  [[ $plan == "$finance" ]] || exit 65
  [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$finance" "$prior") ]] || exit 65
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$root" "$sha" "$6") || exit 65
  node - "$plan" "$prepared/prepared/context/workspace" "$expense_profile" <<'JS'
const [plan,workspace,profile]=process.argv.slice(2);
require(plan+'/'+profile).assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent-$lane.XXXXXXXX")
node - "$plan/contract-adjacent-profiles.json" "$prior" "$lane" "$prepared" "${6:-}" "$work" > "$work/fixture-mounts.tsv" <<'JS'
const [profiles,prior,lane,prepared,mode,work]=process.argv.slice(2),pins=require(profiles);
const fs=require('node:fs'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(prior+'/contract-ci.cjs'),pins.runnerSha256);
for(const name of ['task12-owned-280.test-support.ts',...pins.profiles[lane].specs]){
  const file=prior+'/fixtures/'+name;
  assert.equal(hash(file),pins.fixtures[name]);
  if(['--historical-settlement-334','--expense-witness-346','--expense-witness-349'].includes(mode) && name!=='task12-owned-280.test-support.ts'){
    assert.equal(hash(prepared+'/prepared/context/workspace/services/api/src/database/'+name),pins.candidateFixtures334[name],name);
  }
  let mounted=file;
  if(['--expense-witness-346','--expense-witness-349'].includes(mode) && lane==='draft' && name===pins.profiles.draft.specs[0]){
    mounted=work+'/'+name;
    fs.copyFileSync(file,mounted,fs.constants.COPYFILE_EXCL);
    const patch=require('node:path').join(require('node:path').dirname(profiles),'contract-adjacent-draft-346.fixture.patch');
    require('node:child_process').execFileSync('git',['apply','--unidiff-zero',patch],{cwd:work,stdio:'inherit'});
    assert.equal(hash(mounted),pins.draft346FixtureSha256);
    if(mode==='--expense-witness-349') {
      const patch349=require('node:path').join(require('node:path').dirname(profiles),'contract-adjacent-draft-349.fixture.patch');
      require('node:child_process').execFileSync('git',['apply','--unidiff-zero',patch349],{cwd:work,stdio:'inherit'});
      assert.equal(hash(mounted),pins.draft349FixtureSha256);
    }
    fs.chmodSync(mounted,0o644);
  }
  console.log(mounted+'\t'+'src/database/'+name);
}
JS

contract_runner="$prior/contract-ci.cjs"
if [[ $lane == draft && ${6:-} == --expense-witness-34[69] ]]; then
  contract_runner="$work/contract-ci.cjs"
  install -m 0644 "$prior/contract-ci.cjs" "$contract_runner"
  git -C "$work" apply --unidiff-zero "$plan/contract-adjacent-draft-346.runner.patch"
  draft_runner_digest=$(node -e 'console.log(require(process.argv[1]).draft346RunnerSha256)' "$plan/contract-adjacent-profiles.json")
  [[ $(sha256sum "$contract_runner" | cut -d' ' -f1) == "$draft_runner_digest" ]] || exit 65
  chmod 0644 "$contract_runner"
fi

installer="$common/installer.cjs"
if [[ ${6:-} == --historical-settlement-334 || ${6:-} == --expense-witness-34[69] ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
if [[ ${6:-} == --expense-witness-34[69] ]]; then
  (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer.patch")
  node - "$installer" "$plan" <<'JS'
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const [installer,plan]=process.argv.slice(2);
assert.equal(createHash('sha256').update(readFileSync(installer)).digest('hex'),
  require(plan+'/expense-witness-346-profile.cjs').installerSha256);
JS
  if [[ ${6:-} == --expense-witness-349 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/$expense_profile")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  fi
  chmod 0644 "$installer"
fi
if [[ ${7-} == --host-only ]]; then
  for file in "$installer" "$plan/contract-adjacent-entry.cjs" "$contract_runner"; do
    node --check "$file"
  done
  printf 'CONTRACT_ADJACENT_%s_HOST_READY sha=%s lane=%s material=%s\n' "${6##*-}" "$sha" "$lane" "$work"
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
  --mount "type=bind,src=$plan/contract-adjacent-entry.cjs,dst=/qualification/contract-adjacent-entry.cjs,readonly"
  --mount "type=bind,src=$contract_runner,dst=/qualification/contract-ci.cjs,readonly"
  --mount "type=bind,src=$plan/contract-adjacent-profiles.json,dst=/qualification/contract-adjacent-profiles.json,readonly")
if [[ ${6:-} == --historical-settlement-334 || ${6:-} == --expense-witness-34[69] ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ ${6:-} == --upward-archive-332 || ${6:-} == --historical-settlement-334 || ${6:-} == --expense-witness-34[69] ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
if [[ ${6:-} == --expense-witness-34[69] ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ ${6:-} == --expense-witness-349 ]]; then
  args+=(--mount "type=bind,src=$plan/$expense_profile,dst=/qualification/$expense_profile,readonly")
fi
args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
while IFS=$'\t' read -r source relative; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/workspace/services/api/$relative,readonly")
done < "$work/fixture-mounts.tsv"

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
count=295
case "${6:-}" in --current-320) count=329;; --text-direct-330) count=330;; --payment-remainder-331) count=331;; --upward-archive-332) count=332;; --historical-settlement-334) count=334;; --expense-witness-346) count=346;; --expense-witness-349) count=349;; esac
printf '%s\n' "假设原 $lane 业务断言和迁移状态在同一 $count 隔离库通过。观察 settlement、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/contract-adjacent-entry.cjs "$lane" ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" "$count" <<'JS'
const [file,sha,lane,count]=process.argv.slice(2);
const r=require(file);
if(r.status!=='ORIGINAL_CONTRACT_ADJACENT_'+count+'_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
