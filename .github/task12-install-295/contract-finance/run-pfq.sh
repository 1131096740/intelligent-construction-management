#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 ) ) ]] || exit 64
count=295
mode=()
case ${5-} in
  --current-320) mode=(--current-320); count=329 ;;
  --text-direct-330) mode=(--text-direct-330); count=330 ;;
  --payment-remainder-331) mode=(--payment-remainder-331); count=331 ;;
  --upward-archive-332) mode=(--upward-archive-332); count=332 ;;
esac
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$repo/.github/task12-install-295/contract-finance/common"
archive_profile="$plan/upward-archive-332-profile.cjs"
source_tree=$(git -C "$repo" rev-parse "$sha^{tree}")
scope=pfq

node -e '
  const [file,sha,count,tree,archiveProfile,terminal]=process.argv.slice(1);
  const source=require(file);
  const modes={"329":"current-320","330":"text-direct-330","331":"payment-remainder-331"};
  if(source.sourceSha!==sha||source.migrationCount!==Number(count)||(modes[count]&&source.mode!==modes[count]))process.exit(1);
  if(count==="332") {
    require("node:assert/strict").equal(source.sourceTree,tree);
    require(archiveProfile).assertSource(source,sha,require(terminal).final);
  }
' "$prepared/source.json" "$sha" "$count" "$source_tree" "$archive_profile" "$common/multi-witness.cjs"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
python3 "$plan/stage-pfq.py" "$repo/.github/task12-install-289" "$repo/.github/task12-install-290" "$common" "$material"

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$material/installer.cjs,dst=/qualification/installer.cjs,readonly")
if (( count == 332 )); then
  args+=(--mount "type=bind,src=$archive_profile,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi

for file in task12-pfq-positive-fixtures.json task12-pfq-recovery.cjs task12-pfq-recovery.json entry.cjs; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/$file,readonly")
done
for file in task12-pfq-app.cjs task12-pfq-jest-wire.cjs; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/workspace/services/api/prisma/$file,readonly")
done
spec=project-financing-quota-concurrency.owned282.spec.ts
args+=(--mount "type=bind,src=$material/$spec,dst=/qualification/workspace/services/api/src/database/$spec,readonly")
for lane in pre115-clean pre116-legacy duplicate cross-business replacement-child replacement-parent app; do
  printf '%s\n' "验证原历史迁移行为与应用并发可在同一隔离实例延续到 ${count}。观察原断言、回滚和重试账、会话与清理。" > "$work/$lane.hypothesis.txt"
  exit_code=0
  docker run "${args[@]}" --entrypoint node "$image" /qualification/entry.cjs "$lane" ${mode[@]+"${mode[@]}"} \
    > "$work/$lane.stdout" 2> "$work/$lane.stderr" || exit_code=$?
  tail -n 1 "$work/$lane.stdout" > "$work/$lane.json"
  node -e '
    const row=require(process.argv[1]); console.log(JSON.stringify(row));
    if(row.status!=="ORIGINAL_PFQ_EXACT_"+process.argv[5]+"_PASSED"||row.sourceSha!==process.argv[2]||row.lane!==process.argv[3]||process.argv[4]!=="0")process.exit(1);
  ' "$work/$lane.json" "$sha" "$lane" "$exit_code" "$count" ||
    { printf 'PFQ_%s_STOPPED %s %s\n' "$count" "$lane" "$work" >&2; exit 1; }
done
