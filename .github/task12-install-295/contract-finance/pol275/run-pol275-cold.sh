#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 || $5 == --expense-witness-346 || $5 == --expense-witness-349 || $5 == --signed-settlement-350 || $5 == --company-history-352 ) ) ||
  ( $# == 6 && ( $5 == --expense-witness-346 || $5 == --expense-witness-349 || $5 == --signed-settlement-350 || $5 == --company-history-352 ) && $6 == --host-only ) ]] || exit 64
if [[ ( ${5-} == --signed-settlement-350 || ${5-} == --company-history-352 ) && ${GITHUB_ACTIONS:-} == true ]]; then exit 64; fi
count=295
mode=()
case ${5-} in
  --current-320) count=329; mode=(--current-320) ;;
  --text-direct-330) count=330; mode=(--text-direct-330) ;;
  --payment-remainder-331) count=331; mode=(--payment-remainder-331) ;;
  --upward-archive-332) count=332; mode=(--upward-archive-332) ;;
  --historical-settlement-334) count=334; mode=(--historical-settlement-334) ;;
  --expense-witness-346) count=346; mode=(--expense-witness-346) ;;
  --expense-witness-349) count=349; mode=(--expense-witness-349) ;;
  --signed-settlement-350) count=350; mode=(--signed-settlement-350) ;;
  --company-history-352) count=352; mode=(--company-history-352) ;;
esac
purpose="ORIGINAL_POL275_COLD_EXACT_$count"
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$repo/.github/task12-install-295/contract-finance"
common="$base/common"
scope=pol275-cold

node -e '
  const source=require(process.argv[1]);
  const count=Number(process.argv[3]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  const modes={329:"current-320",330:"text-direct-330",331:"payment-remainder-331",332:"upward-archive-332",334:"historical-settlement-334"};
  if(modes[count] && (source.mode!==modes[count] || source.predecessor?.migrationCount!==295))process.exit(1);
  if(count===334) require(process.argv[4]+"/historical-settlement-334-profile.cjs").assertSource(source,require(process.argv[4]+"/common/multi-witness.cjs").final);
  if(count===331||count===332){
    const base=process.argv[4];
    require(base+"/"+source.mode+"-profile.cjs").assertSource(source,process.argv[2],require(base+"/common/multi-witness.cjs").final);
  }
' "$prepared/source.json" "$sha" "$count" "$base"
if (( count >= 346 )); then
  bash "$plan/verify-host-346.sh" "$repo" "$prepared" "$sha" "$count"
fi
if [[ ${6-} != --host-only ]]; then
  build=$(cd "$4" && pwd -P)
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$base/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
evidence="$repo/.github/task12-install-289/pol275/cold-evidence.cjs"
[[ $(shasum -a 256 "$evidence" | cut -d ' ' -f1) == a338dcd1817f5dc6dacdea62cb36b3357d7933bc58587e61b4b71dec7a91d2db ]] || exit 65
installer="$common/installer.cjs"
if (( count >= 346 )); then
  bash "$plan/stage-346.sh" "$work" cold "$count"
  installer="$work/installer.cjs"
  if [[ ${6-} == --host-only ]]; then
    node --check "$plan/pol275-cold-entry.cjs"
    node --check "$plan/exact-$count.cjs"
    printf '%s\nPOL275_COLD_%s_HOST_READY sha=%s\n' "$work" "$count" "$sha"
    exit 0
  fi
elif [[ $count == 334 ]]; then
  node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
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
  --mount "type=bind,src=$evidence,dst=/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs,readonly"
  --mount "type=bind,src=$plan/pol275-cold-entry.cjs,dst=/qualification/pol275-cold-entry.cjs,readonly")
args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
if (( count == 352 )); then
  args+=(--mount "type=bind,src=$base/company-history-352-profile.cjs,dst=/qualification/company-history-352-profile.cjs,readonly"
    --mount "type=bind,src=$plan/exact-350.cjs,dst=/qualification/exact-350.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
if [[ $count == 331 ]]; then
  args+=(--mount "type=bind,src=$base/payment-remainder-331-profile.cjs,dst=/qualification/payment-remainder-331-profile.cjs,readonly")
elif [[ $count == 332 ]]; then
  args+=(--mount "type=bind,src=$base/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
if (( count >= 334 )); then
  for file in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
fi
if (( count >= 346 )); then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
  args+=(--env "JG_POL275_SOURCE_SHA=$sha"
    --mount "type=bind,src=$base/bank/migration-inputs-346.cjs,dst=/qualification/migration-inputs-346.cjs,readonly"
    --mount "type=bind,src=$plan/exact-$count.cjs,dst=/qualification/exact-$count.cjs,readonly")
fi
if (( count >= 349 )); then
  args+=(--mount "type=bind,src=$base/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
if (( count >= 350 )); then
  args+=(--mount "type=bind,src=$base/signed-settlement-350-profile.cjs,dst=/qualification/signed-settlement-350-profile.cjs,readonly"
    --mount "type=bind,src=$plan/exact-349.cjs,dst=/qualification/exact-349.cjs,readonly")
fi
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol275-cold-entry.cjs ${mode[@]+"${mode[@]}"} > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!==process.argv[3]||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$purpose" || { printf '%s_NO_RECEIPT %s\n' "$purpose" "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected=process.argv[2]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$purpose" "$sha"
