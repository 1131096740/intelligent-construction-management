#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && ( $6 == --expense-witness-346 || $6 == --expense-witness-349 ) ) ||
  ( $# == 7 && ( $6 == --expense-witness-346 || $6 == --expense-witness-349 ) && $7 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
lane=$5
case "$lane" in execution|finance|receipt) ;; *) exit 64 ;; esac
scope=expense-$lane

expense_profile=
if [[ ${6-} == --expense-witness-* ]]; then expense_profile="$plan/${6#--}-profile.cjs"; fi
count=$(node -e '
  const [sourceFile,sha,archiveProfile,terminal,historicalProfile,expenseProfile,requestedMode]=process.argv.slice(1);
  const source=require(sourceFile),final=require(terminal).final;
  const counts={"current-320":329,"text-direct-330":330,"payment-remainder-331":331,
    "upward-archive-332":332,"historical-settlement-334":334,"expense-witness-346":346,"expense-witness-349":349};
  const count=counts[source.mode]??295;
  if(source.sourceSha!==sha||source.migrationCount!==count||
    (count>=346?"--"+source.mode:"")!==requestedMode)process.exit(65);
  if(count===332) require(archiveProfile).assertSource(source,sha,final);
  if(count===334) require(historicalProfile).assertSource(source,final);
  if(expenseProfile) require(expenseProfile).assertSource(source,final);
  console.log(count);
'  "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$expense_profile" "${6-}")
if (( count >= 346 )); then
  [[ $plan == "$repo/.github/task12-install-295/contract-finance" && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$repo/.github/task12-install-290/expense") ]] || exit 65
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" "$6") || exit 65
  node - "$expense_profile" "$prepared/prepared/context/workspace" <<'JS'
const [profile,workspace]=process.argv.slice(2);
require(profile).assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
stage_args=()
case "$count" in
  334) stage_args=(--historical-settlement-334) ;;
  346|349) stage_args=("$6") ;;
esac
python3 "$plan/stage-expense.py" "$repo/.github/task12-install-290/expense" "$common" "$material" ${stage_args[@]+"${stage_args[@]}"}

if [[ ${7-} == --host-only ]]; then
  for file in installer.cjs installer-historical.cjs app/entry.cjs app/expense-app.cjs valid/entry.cjs negative/entry.cjs recovery/entry.cjs; do
    node --check "$material/$file"
  done
  printf 'EXPENSE_%s_HOST_READY sha=%s lane=%s material=%s\n' "$count" "$sha" "$lane" "$material"
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
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1024m --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
if (( count >= 334 )); then
  for file in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if (( count >= 346 )); then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if (( count == 349 )); then
  args+=(--mount "type=bind,src=$expense_profile,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
modes=(app valid negative)
if [[ $lane != receipt ]]; then modes+=(recovery); fi
for mode in "${modes[@]}"; do
  dir="$material/$mode"
  installer="$material/installer.cjs"
  if [[ $count -ge 346 && $mode == negative ]]; then
    installer="$material/installer-historical.cjs"
  fi
  lane_args=("${args[@]}" --mount "type=bind,src=$dir/entry.cjs,dst=/qualification/expense-entry.cjs,readonly"
    --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
  case "$mode" in
    app)
      case "$lane" in
        execution|finance) spec="project-expense-$lane-concurrency.owned282.spec.ts" ;;
        receipt) spec=project-expense-receipt-concurrency.spec.ts ;;
      esac
      lane_args+=(--mount "type=bind,src=$dir/$lane/$spec,dst=/qualification/workspace/services/api/src/database/$spec,readonly")
      mounts=(expense-app.cjs profiles.json)
      ;;
    valid)
      mounts=(task12-expense-execution-retained-valid.json task12-expense-finance-retained-valid.json task12-expense-receipt-retained-seed.json)
      ;;
    negative)
      mounts=(task12-expense-execution-retained-negative.cjs task12-expense-execution-retained-negative.json
        task12-expense-finance-retained-negative.cjs task12-expense-finance-retained-negative.json receipt-negative.cjs receipt-seed.cjs)
      ;;
    recovery)
      mounts=("task12-expense-$lane-recovery.cjs" "task12-expense-$lane-recovery.json")
      ;;
  esac
  for file in "${mounts[@]}"; do
    lane_args+=(--mount "type=bind,src=$dir/$file,dst=/qualification/$file,readonly")
  done
  exit_code=0
  docker run "${lane_args[@]}" --entrypoint node "$image" /qualification/expense-entry.cjs "$lane" \
    > "$work/$mode.stdout" 2> "$work/$mode.stderr" || exit_code=$?
  tail -n 1 "$work/$mode.stdout" > "$work/$mode.json"
  node -e '
    const row=require(process.argv[1]); const [mode,lane,sha,code,count,sourceFile]=process.argv.slice(2);
    console.log(JSON.stringify(row));
    if(Number(count)>=331&&mode!=="negative"){
      const {predecessor330}=require(sourceFile);
      for(const [predecessor,expected] of [[row.textDirectPredecessor,329],[row.paymentRemainderPredecessor,330]]){
        if(predecessor?.count!==expected||predecessor.sameIdentity!==true||predecessor.sameBaseB7!==true)process.exit(1);
      }
      if(row.paymentRemainderPredecessor.ledgerSha256!==predecessor330.ledgerSha256)process.exit(1);
    }
    if(count==="332"&&mode!=="negative") require(process.argv[8]).assertInstallation(row,require(sourceFile));
    if(count==="334"&&mode!=="negative") {
      require(process.argv[9]).assertFinanceInstallation(row,require(sourceFile));
      if(row.combinedAfterBusiness?.sameIdentity!==true||
        row.combinedAfterBusiness?.ledgerSha256!==require(sourceFile).ledgerSha256||
        row.historicalTakeoverCatalogAfterBusiness!==true||row.historicalSettlementCatalogAfterBusiness!==true)process.exit(1);
    }
    if(Number(count)>=346){
      if(mode==="negative"){
        if(row.forward320!==undefined||row.expenseWitnessForward!==undefined||
          row.expenseWitnessPrecisionForward!==undefined||row.installOnly295!==undefined||
          row.business!=="NOT_ENTERED") process.exit(1);
      } else if(row.forward320?.count!==334||row.expenseWitnessForward?.count!==346||
        row.expenseWitnessForward?.sameIdentity!==true||row.expenseWitnessCatalogAfterBusiness!==true||
        row.historicalSettlementCatalogAfterBusiness!==true||row.combinedAfterBusiness?.sameIdentity!==true||
        row.combinedAfterBusiness?.ledgerSha256!==require(sourceFile).ledgerSha256) process.exit(1);
    }
    if(count==="349"&&mode!=="negative"&&
      (row.expenseWitnessPrecisionForward?.count!==349||row.expenseWitnessPrecisionForward?.sameIdentity!==true||
        row.expenseWitnessPrecisionForward?.ledgerSha256!==require(sourceFile).ledgerSha256||
        row.expenseWitnessPrecisionCatalogAfterBusiness!==true)) process.exit(1);
    const status={app:"ORIGINAL_EXPENSE_"+count+"_APPLICATION_PASSED",valid:"ORIGINAL_EXPENSE_"+count+"_RETAINED_VALID_PASSED",
      negative:"ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED",recovery:"ORIGINAL_EXPENSE_"+count+"_SAME_INSTANCE_RECOVERY_PASSED"}[mode];
    if(code!=="0"||row.status!==status||row.lane!==lane||row.sourceSha!==sha||
      row.cleanup!=="POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"||
      (mode!=="negative"&&(row.installOnly295?.count!==295||row.combinedAfterBusiness?.count!==Number(count)||row.combinedAfterBusiness?.exactB7!==true)))process.exit(1);
  ' "$work/$mode.json" "$mode" "$lane" "$sha" "$exit_code" "$count" "$prepared/source.json" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" ||
    { printf 'EXPENSE_%s_STOPPED %s %s %s\n' "$count" "$lane" "$mode" "$work" >&2; exit 1; }
done
