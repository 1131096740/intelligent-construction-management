#!/bin/bash
set -euo pipefail
umask 077

if [[ ${5-} == --signed-settlement-350 || ${5-} == --company-history-352 ]]; then
  [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64
  [[ $# == 5 || ( $# == 6 && $6 == --host-only ) ]] || exit 64
else
  [[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 || $5 == --expense-witness-346 || $5 == --expense-witness-349 ) ) ||
    ( $# == 6 && ( $5 == --expense-witness-346 || $5 == --expense-witness-349 ) && $6 == --host-only ) ]] || exit 64
fi
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
mode_args=()
count=295
if [[ $# -ge 5 ]]; then
  mode_args=("$5")
  case "$5" in --current-320) count=329;; --text-direct-330) count=330;; --payment-remainder-331) count=331;; --upward-archive-332) count=332;; --historical-settlement-334) count=334;; --expense-witness-346) count=346;; --expense-witness-349) count=349;; --signed-settlement-350) count=350;; --company-history-352) count=352;; esac
fi
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=pol109

node -e '
  const source=require(process.argv[1]);
  const modes={329:"current-320",330:"text-direct-330",331:"payment-remainder-331",332:"upward-archive-332",334:"historical-settlement-334",346:"expense-witness-346",349:"expense-witness-349",350:"signed-settlement-350",352:"company-history-352"};
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==Number(process.argv[3])||source.mode!==modes[process.argv[3]])process.exit(1);
  if(source.mode==="upward-archive-332"){
    const plan=process.argv[4];
    require(plan+"/upward-archive-332-profile.cjs").assertSource(source,process.argv[2],require(plan+"/common/multi-witness.cjs").final);
  } else if(source.mode==="historical-settlement-334"){
    const plan=process.argv[4];
    require(plan+"/historical-settlement-334-profile.cjs").assertSource(source,require(plan+"/common/multi-witness.cjs").final);
  } else if([346,349,350,352].includes(source.migrationCount)){
    const plan=process.argv[4];
    require(plan+"/"+source.mode+"-profile.cjs").assertSource(source,require(plan+"/common/multi-witness.cjs").final);
  }
' "$prepared/source.json" "$sha" "$count" "$plan"
if [[ $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  [[ $plan == "$repo/.github/task12-install-295/contract-finance" && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$repo/.github/task12-install-289" "$repo/.github/task12-install-290") ]] || exit 65
  profile=expense-witness-$count
  if [[ $count == 350 ]]; then profile=signed-settlement-350; fi
  if [[ $count == 352 ]]; then profile=company-history-352; fi
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" "--$profile") || exit 65
  node - "$plan" "$prepared/prepared/context/workspace" "$profile" <<'JS'
const [plan,workspace,profile]=process.argv.slice(2);
require(plan+'/'+profile+'-profile.cjs').assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
python3 "$plan/stage-pol109.py" "$repo/.github/task12-install-289" "$repo/.github/task12-install-290" "$common" "$prepared/prepared/context/workspace" "$prepared/source.json" "$material"

installer="$common/installer.cjs"
if [[ $count == 334 || $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi

if [[ $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer.patch")
  if [[ $count == 349 || $count == 350 || $count == 352 ]]; then
    (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer-349.patch")
  fi
  if [[ $count == 350 || $count == 352 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-350.patch"
  fi
  if [[ $count == 352 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-352.patch"
  fi
  node - "$installer" "$plan" "$profile" <<'JS'
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const [installer,plan,profile]=process.argv.slice(2);
assert.equal(createHash('sha256').update(readFileSync(installer)).digest('hex'),
  require(plan+'/'+profile+'-profile.cjs').installerSha256);
JS
  chmod 0644 "$installer"
fi
if [[ ${6-} == --host-only ]]; then
  for file in "$installer" "$plan/pol109-295-entry.cjs" "$material"/*.cjs; do
    node --check "$file"
  done
  printf 'POL109_%s_HOST_READY sha=%s material=%s\n' "$count" "$sha" "$material"
  exit 0
fi
build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=512m" --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly"
  --mount "type=bind,src=$plan/pol109-295-entry.cjs,dst=/qualification/pol109-295-entry.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
if [[ $count == 332 || $count == 334 || $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
if [[ $count == 334 || $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 349 || $count == 350 || $count == 352 ]]; then
  args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
if [[ $count == 350 || $count == 352 ]]; then
  args+=(--mount "type=bind,src=$plan/signed-settlement-350-profile.cjs,dst=/qualification/signed-settlement-350-profile.cjs,readonly")
fi
if [[ $count == 352 ]]; then
  args+=(--mount "type=bind,src=$plan/company-history-352-profile.cjs,dst=/qualification/company-history-352-profile.cjs,readonly")
fi
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi

for file in task12-pol109-ci.cjs task12-pol109-stage-browser.cjs task12-pol109-stage-workspace.cjs; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/workspace/services/api/prisma/$file,readonly")
done
for file in workspace-proof.cjs workspace-inputs.json; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/$file,readonly")
done
spec=project-close-profit.owned282.http.pg.spec.ts
args+=(--mount "type=bind,src=$material/$spec,dst=/qualification/workspace/services/api/src/project-close-profit/$spec,readonly")
printf '%s\n' "验证原项目收口 8 项数据库与 HTTP、5 项浏览器断言在 $count 同库通过。观察原 Jest/浏览器计数、同库 B7、Nest 清理。" > "$work/hypothesis.txt"
if [[ $count == 346 || $count == 349 || $count == 350 || $count == 352 ]]; then
  printf '%s\n' "追加 A27 正式业主结算的同库 HTTP 与只读浏览器核对，保留原 13 项。" >> "$work/hypothesis.txt"
fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol109-295-entry.cjs ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]); console.log(JSON.stringify(row));
  if(row.status!==("ORIGINAL_POL109_"+process.argv[4]+"_PASSED")||row.sourceSha!==process.argv[2]||process.argv[3]!=="0")process.exit(1);
' "$work/receipt.json" "$sha" "$exit_code" "$count" ||
  { printf "POL109_${count}_STOPPED %s\n" "$work" >&2; exit 1; }
