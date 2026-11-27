#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && $5 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=payment-execution

count=$(node -e '
  const source=require(process.argv[1]);
  const counts=new Map([["signed-settlement-350",350],["expense-witness-349",349],["expense-witness-346",346],["historical-settlement-334",334],["upward-archive-332",332],
    ["payment-remainder-331",331],["text-direct-330",330],["current-320",329],[undefined,295]]);
  const count=counts.get(source.mode);
  if(!count||source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(65);
  if(count===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(count===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  if(count===346||count===349||count===350) require(process.argv[6]+"/"+source.mode+"-profile.cjs").assertSource(source,require(process.argv[4]).final);
  console.log(count);
'  "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan")
if [[ $count == 350 && ${GITHUB_ACTIONS:-} == true ]]; then exit 64; fi
host_only=false
if [[ ${5-} == --host-only ]]; then
  [[ $count == 346 || $count == 349 || $count == 350 ]] || exit 64
  host_only=true
fi
if [[ $count == 346 || $count == 349 || $count == 350 ]]; then
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$repo/.github/task12-install-290/payment") ]] || exit 65
  if [[ $count == 349 || $count == 350 ]]; then
    [[ $plan == "$repo/.github/task12-install-295/contract-finance" ]] || exit 65
    mode=--expense-witness-349
    if [[ $count == 350 ]]; then mode=--signed-settlement-350; fi
    cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" "$mode") || exit 65
  fi
  node - "$prepared" "$(git -C "$repo" rev-parse "$sha^{tree}")" "$plan" <<'JS'
const assert = require('node:assert/strict');
const [prepared, tree, plan] = process.argv.slice(2);
const source = require(prepared + '/source.json');
assert.equal(source.sourceTree, tree);
const baseline = require(prepared + '/prepared/context/workspace/services/api/prisma/migration-baseline.cjs');
require(plan + '/' + source.mode + '-profile.cjs').assertRuntimeBaseline(baseline);
JS
fi
if [[ $host_only == false ]]; then
  build=$(cd "$4" && pwd -P)
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
portable_args=()
case "$count" in
  330) portable_args=(--text-direct-330) ;;
  331) portable_args=(--payment-remainder-331) ;;
  332) portable_args=(--upward-archive-332) ;;
  334) portable_args=(--historical-settlement-334) ;;
  346|349) portable_args=("--expense-witness-$count") ;;
  350) portable_args=(--signed-settlement-350) ;;
esac
python3 "$plan/stage-payment-execution.py" "$repo/.github/task12-install-290/payment" "$common" "$material" ${portable_args[@]+"${portable_args[@]}"}

if [[ $host_only == true ]]; then
  for file in installer.cjs fresh.cjs valid.cjs paid/payment-retained-ci.cjs other/payment-retained-ci.cjs; do
    node --check "$material/$file"
  done
  node --check "$plan/payment-execution-$count.cjs"
  node - "$prepared/source.json" "$material" <<'JS'
const [file, material] = process.argv.slice(2);
const { sourceSha, sourceTree, migrationCount, ledgerSha256 } = require(file);
console.log(JSON.stringify({ status: 'PAYMENT_EXECUTION_' + migrationCount + '_HOST_READY', sourceSha, sourceTree,
  migrationCount, ledgerSha256, material }));
JS
  exit 0
fi

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1024m --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
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
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
for lane in fresh valid paid other; do
  case "$lane" in
    fresh) entry=fresh.cjs; inputs=$material; expected=PAYMENT_EXECUTION_FRESH_${count}_PASSED ;;
    valid) entry=valid.cjs; inputs=$material; expected=PAYMENT_EXECUTION_RETAINED_VALID_${count}_PASSED ;;
    paid) entry=payment-retained-ci.cjs; inputs="$material/paid"; expected=PAYMENT_RETAINED_PAID_MISMATCH_ROLLBACK_PASSED ;;
    other) entry=payment-retained-ci.cjs; inputs="$material/other"; expected=PAYMENT_RETAINED_OTHER_13_NEGATIVES_PASSED ;;
  esac
  lane_args=("${args[@]}")
  for file in "$entry" retained-payment.cjs retained-payment.json; do
    lane_args+=(--mount "type=bind,src=$inputs/$file,dst=/qualification/$file,readonly")
  done
  if [[ $lane == fresh ]]; then
    lane_args+=(--mount "type=bind,src=$material/seed-readback.sql,dst=/qualification/seed-readback.sql,readonly")
    for file in payment-execution-concurrency.spec.ts task12-owned-280.test-support.ts; do
      lane_args+=(--mount "type=bind,src=$material/$file,dst=/qualification/workspace/services/api/src/database/$file,readonly")
    done
    ledger_support="$plan/contract-finance-owned.test-support.ts"
    if (( count >= 331 )); then ledger_support="$material/contract-finance-owned.test-support.ts"; fi
    lane_args+=(--mount "type=bind,src=$ledger_support,dst=/qualification/workspace/services/api/src/database/contract-finance-owned.test-support.ts,readonly")
  fi
  if [[ $count == 332 && ( $lane == fresh || $lane == valid ) ]]; then
    lane_args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
  fi
  if [[ ( $count == 334 || $count == 346 || $count == 349 || $count == 350 ) && ( $lane == fresh || $lane == valid ) ]]; then
    for file in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
      lane_args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
    done
  fi
  if [[ ( $count == 346 || $count == 349 || $count == 350 ) && ( $lane == fresh || $lane == valid ) ]]; then
    for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json "payment-execution-$count.cjs"; do
      lane_args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
    done
  fi
  if [[ $count == 349 && ( $lane == fresh || $lane == valid ) ]]; then
    lane_args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
  fi
  if [[ $count == 350 && ( $lane == fresh || $lane == valid ) ]]; then
    for file in expense-witness-349-profile.cjs signed-settlement-350-profile.cjs; do
      lane_args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
    done
  fi
  exit_code=0
  docker run "${lane_args[@]}" --entrypoint node "$image" "/qualification/$entry" \
    > "$work/$lane.stdout" 2> "$work/$lane.stderr" || exit_code=$?
  if [[ ! -s "$work/$lane.stdout" ]]; then
    printf 'PAYMENT_EXECUTION_%s_NO_RECEIPT %s exit=%s stderr_bytes=%s\n' \
      "$count" "$lane" "$exit_code" "$(wc -c < "$work/$lane.stderr" | tr -d '[:space:]')" >&2
    exit 1
  fi
  tail -n 1 "$work/$lane.stdout" > "$work/$lane.json"
  node -e '
    const row=require(process.argv[1]); const [lane,sha,expected,code,count]=process.argv.slice(2);
    console.log(JSON.stringify(row));
    const positive=lane==="fresh"||lane==="valid";
    if(positive&&count==="331"){
      const source=require(process.argv[7]), predecessor=row.paymentRemainderPredecessor;
      if(predecessor?.count!==330||predecessor.ledgerSha256!==source.predecessor330?.ledgerSha256||
         predecessor.sameIdentity!==true||predecessor.sameBaseB7!==true||
         row.forward320?.count!==331||row.forward320?.ledgerSha256!==source.ledgerSha256||
         row.combinedAfterBusiness?.ledgerSha256!==source.ledgerSha256)process.exit(1);
    }
    if(positive&&count==="332") require(process.argv[8]).assertInstallation(row,require(process.argv[7]));
    if(positive&&count==="334"){
      const source=require(process.argv[7]);
      require(process.argv[9]).assertFinanceInstallation(row,source);
      if(row.combinedAfterBusiness?.sameIdentity!==true||row.combinedAfterBusiness?.ledgerSha256!==source.ledgerSha256||
         row.historicalTakeoverCatalogAfterBusiness!==true||row.historicalSettlementCatalogAfterBusiness!==true)process.exit(1);
    }
    if(positive&&(count==="346"||count==="349"||count==="350")) require(process.argv[10]+"/payment-execution-"+count+".cjs").assertInstallation(row,require(process.argv[7]));
    if(code!=="0"||row.status!==expected||row.cleanup!=="POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"||
      (positive&&(row.sourceSha!==sha||row.installOnly295?.count!==295||row.combinedAfterBusiness?.count!==Number(count)||row.combinedAfterBusiness?.exactB7!==true))||
      (!positive&&(row.retainedPaymentNegatives?.length!==(lane==="paid"?1:13)||row.installOnly295!==undefined)))process.exit(1);
  ' "$work/$lane.json" "$lane" "$sha" "$expected" "$exit_code" "$count" "$prepared/source.json" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan" ||
    { printf 'PAYMENT_EXECUTION_%s_STOPPED %s %s\n' "$count" "$lane" "$work" >&2; exit 1; }
done
