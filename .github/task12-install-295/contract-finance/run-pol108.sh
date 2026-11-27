#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 || $6 == --historical-settlement-334 || $6 == --expense-witness-346 || $6 == --expense-witness-349 ) ) ||
  ( $# == 7 && ( $6 == --expense-witness-346 || $6 == --expense-witness-349 ) && $7 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
mode_args=()
count=295
if (( $# >= 6 )); then
  mode_args=("$6")
  case "$6" in --current-320) count=329;; --text-direct-330) count=330;; --payment-remainder-331) count=331;; --upward-archive-332) count=332;; --historical-settlement-334) count=334;; --expense-witness-346) count=346;; --expense-witness-349) count=349;; esac
fi
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
shard=$5
case "$shard" in core) size=512m ;; facts) size=1g ;; impacts) size=2g ;; *) exit 64 ;; esac
scope=pol108-$shard

source_tree=
if [[ $count == 346 || $count == 349 ]]; then
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  dirty=$(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" .github/task12-install-289 .github/task12-install-290)
  [[ -z $dirty ]] || exit 65
  source_tree=$(git -C "$repo" rev-parse "$sha^{tree}")
fi
node -e '
  const source=require(process.argv[1]);
  const modes={329:"current-320",330:"text-direct-330",331:"payment-remainder-331",332:"upward-archive-332",334:"historical-settlement-334",346:"expense-witness-346",349:"expense-witness-349"};
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==Number(process.argv[3])||source.mode!==modes[process.argv[3]])process.exit(1);
  if(source.mode==="upward-archive-332"){
    const plan=process.argv[4];
    require(plan+"/upward-archive-332-profile.cjs").assertSource(source,process.argv[2],require(plan+"/common/multi-witness.cjs").final);
  } else if(source.mode==="historical-settlement-334"){
    const plan=process.argv[4];
    require(plan+"/historical-settlement-334-profile.cjs").assertSource(source,require(plan+"/common/multi-witness.cjs").final);
  } else if([346,349].includes(source.migrationCount)){
    const plan=process.argv[4];
    require("node:assert/strict").equal(source.sourceTree,process.argv[5]);
    require(plan+"/"+source.mode+"-profile.cjs").assertSource(source,require(plan+"/common/multi-witness.cjs").final);
  }
' "$prepared/source.json" "$sha" "$count" "$plan" "$source_tree"
if [[ $count == 349 ]]; then
  [[ $plan == "$repo/.github/task12-install-295/contract-finance" ]] || exit 65
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" --expense-witness-349) || exit 65
  node - "$plan" "$prepared/prepared/context/workspace" <<'JS'
const [plan,workspace]=process.argv.slice(2);
require(plan+'/expense-witness-349-profile.cjs').assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
python3 "$plan/stage-pol108.py" "$repo/.github/task12-install-289" "$repo/.github/task12-install-290" "$common" "$material" "$shard" "$count"
if [[ ${7-} == --host-only ]]; then
  for file in "$plan/pol108-295-entry.cjs" "$material"/*.cjs; do
    node --check "$file"
  done
  printf '%s\n' "$material"
  exit 0
fi

build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 128 --memory 4g
  --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=$size" --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
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
if [[ $count == 332 || $count == 334 || $count == 346 || $count == 349 ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
if [[ $count == 334 || $count == 346 || $count == 349 ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 346 || $count == 349 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 349 ]]; then
  args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi

for file in pol108-289.cjs pol108-observability.cjs pol108-shards.cjs; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/$file,readonly")
done
args+=(--mount "type=bind,src=$plan/pol108-295-entry.cjs,dst=/qualification/pol108-295-entry.cjs,readonly"
  --mount "type=bind,src=$material/jest.runtime.config.cjs,dst=/qualification/workspace/services/api/jest.runtime.config.cjs,readonly")
if [[ $shard == core ]]; then
  args+=(--mount "type=bind,src=$material/operating-projection-postgresql.cases.ts,dst=/qualification/workspace/services/api/src/database/operating-projection-postgresql.cases.ts,readonly")
fi
printf '%s\n' "验证原参与角色、账务报表与规模断言在 $count 的同库行为。观察原用例状态、PG 采样、业务阶段和清理。" > "$work/hypothesis.txt"
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol108-295-entry.cjs "$shard" ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]); console.log(JSON.stringify(row));
  if(row.status!==("ORIGINAL_POL108_EXACT_"+process.argv[5]+"_PASSED")||row.sourceSha!==process.argv[2]||row.shard!==process.argv[3]||process.argv[4]!=="0")process.exit(1);
' "$work/receipt.json" "$sha" "$shard" "$exit_code" "$count" ||
  { printf "POL108_${count}_STOPPED %s %s\n" "$shard" "$work" >&2; exit 1; }
