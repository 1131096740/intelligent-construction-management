#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=payment-execution

count=$(node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  if(count===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(count===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  console.log(count);
'  "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs")
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
portable_args=()
case "$count" in
  330) portable_args=(--text-direct-330) ;;
  331) portable_args=(--payment-remainder-331) ;;
  332) portable_args=(--upward-archive-332) ;;
  334) portable_args=(--historical-settlement-334) ;;
esac
python3 "$plan/stage-payment-execution.py" "$repo/.github/task12-install-290/payment" "$common" "$material" ${portable_args[@]+"${portable_args[@]}"}

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
  if [[ $count == 334 && ( $lane == fresh || $lane == valid ) ]]; then
    for file in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
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
    if(code!=="0"||row.status!==expected||row.cleanup!=="POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"||
      (positive&&(row.sourceSha!==sha||row.installOnly295?.count!==295||row.combinedAfterBusiness?.count!==Number(count)||row.combinedAfterBusiness?.exactB7!==true))||
      (!positive&&(row.retainedPaymentNegatives?.length!==(lane==="paid"?1:13)||row.installOnly295!==undefined)))process.exit(1);
  ' "$work/$lane.json" "$lane" "$sha" "$expected" "$exit_code" "$count" "$prepared/source.json" "$plan/upward-archive-332-profile.cjs" "$plan/historical-settlement-334-profile.cjs" ||
    { printf 'PAYMENT_EXECUTION_%s_STOPPED %s %s\n' "$count" "$lane" "$work" >&2; exit 1; }
done
