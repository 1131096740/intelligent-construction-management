#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 ) ) ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
lane=$5
mode_args=()
if [[ $# == 6 ]]; then mode_args=("$6"); fi
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
node - "$prepared/source.json" "$sha" "$plan/contract-adjacent-profiles.json" "$lane" "$common/multi-witness.cjs" "$plan/upward-archive-332-profile.cjs" ${mode_args[@]+"${mode_args[@]}"} <<'JS'
const [sourceFile,sha,profilesFile,lane,terminalFile,archiveProfile,mode]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||!Object.hasOwn(require(profilesFile).profiles,lane))process.exit(65);
if(mode==='--upward-archive-332') {
  require(archiveProfile).assertSource(source,sha,terminal.final);
} else if(mode!==undefined) {
  const count={'--current-320':329,'--text-direct-330':330,'--payment-remainder-331':331}[mode];
  if(source.mode!==mode.slice(2)||source.migrationCount!==count||source.predecessor?.migrationCount!==295||
     source.predecessor.ledgerSha256!==terminal.final||source.tails.length!==count-295) process.exit(65);
} else if(source.migrationCount!==295||source.ledgerSha256!==terminal.final) process.exit(65);
JS
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent-$lane.XXXXXXXX")
node - "$plan/contract-adjacent-profiles.json" "$prior" "$lane" > "$work/fixture-mounts.tsv" <<'JS'
const [profiles,prior,lane]=process.argv.slice(2),pins=require(profiles);
const fs=require('node:fs'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(prior+'/contract-ci.cjs'),pins.runnerSha256);
for(const name of ['task12-owned-280.test-support.ts',...pins.profiles[lane].specs]){
  const file=prior+'/fixtures/'+name;
  assert.equal(hash(file),pins.fixtures[name]);
  console.log(file+'\t'+'src/database/'+name);
}
JS

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
  --mount "type=bind,src=$prior/contract-ci.cjs,dst=/qualification/contract-ci.cjs,readonly"
  --mount "type=bind,src=$plan/contract-adjacent-profiles.json,dst=/qualification/contract-adjacent-profiles.json,readonly")
if [[ ${6:-} == --upward-archive-332 ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
while IFS=$'\t' read -r source relative; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/workspace/services/api/$relative,readonly")
done < "$work/fixture-mounts.tsv"

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
count=295
case "${6:-}" in --current-320) count=329;; --text-direct-330) count=330;; --payment-remainder-331) count=331;; --upward-archive-332) count=332;; esac
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
