#!/bin/bash
set -euo pipefail
umask 077

case $#:${5-}:${6-} in
  5:--signed-settlement-350:|6:--signed-settlement-350:--host-only)
    [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64 ;;
  *)
    [[ $# == 4 || ( $# == 5 && $5 == --expense-witness-34[69] ) ||
      ( $# == 6 && $5 == --expense-witness-34[69] && $6 == --host-only ) ]] || exit 64 ;;
esac
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
archive="$repo/.github/task12-install-289"
scope=direct-capacity
mode=${5-}
expense=false
if [[ $mode == --expense-witness-34[69] || $mode == --signed-settlement-350 ]]; then
  expense=true
  if [[ $mode != --expense-witness-346 ]]; then
    [[ $plan == "$repo/.github/task12-install-295/contract-finance" ]] || exit 65
  fi
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$archive") ]] || exit 65
  node "$plan/check-ledger.cjs" "$repo" "$sha" "$5" | cmp -s "$prepared/source.json" - || exit 65
fi

count=$(node -e '
  const source=require(process.argv[1]);
  const expected=source.mode==="signed-settlement-350"?350:source.mode==="expense-witness-349"?349:source.mode==="expense-witness-346"?346:source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==expected||
    (expected>=346?process.argv[7]!=="--"+source.mode:Boolean(process.argv[7])))process.exit(1);
  if(expected>=346) {
    const plan=process.argv[6];
    const api=process.argv[8];
    const profile=require(plan+"/"+source.mode+"-profile.cjs");
    profile.assertSource(source,require(process.argv[4]).final);
    require(plan+"/bank/migration-inputs-346.cjs")(api,source,profile);
  }
  if(expected===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(expected===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  console.log(expected);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan" "${5-}" "$prepared/prepared/context/workspace/services/api")
if [[ ${6-} != --host-only ]]; then
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
fixture="$archive/fixtures/direct-payment-capacity-concurrency.spec.ts"
runner="$archive/remaining-direct-capacity.cjs"
original="$prepared/prepared/context/workspace/services/api/src/database/direct-payment-capacity-concurrency.spec.ts"
archived_sha=735b7c13cafc6a54930d9c6d862fb0fe4d04467329cc5f7fce83436ca0612f31
original_sha=de31ee9d13952de4b0a03e239e490703bc2787662bdb7f167f0a39b1535e0f6d
if (( count >= 330 )); then
  original_sha=a29c42e5969183edbf80cb0677db37f45efe11cedc1704b1826af95da0be92c7
fi
printf '%s  %s\n' "$archived_sha" "$fixture" "$original_sha" "$original" |
  shasum -a 256 -c >/dev/null

if (( count >= 330 )); then
  expected=7cfdc723eda2e728e82d58a8890d320a34b1be6d7745652058b32e10927eeddc
  printf '%s  %s\n' d4fcf288002d404e86b7782ac6d9ce5c9795facf8cf2d8e424d3d02f33c521b9 "$runner" |
    shasum -a 256 -c >/dev/null
  install -m 0644 "$fixture" "$work/direct-payment-capacity-concurrency.spec.ts"
  fixture="$work/direct-payment-capacity-concurrency.spec.ts"
  (cd "$work" && git apply --unidiff-zero -p0 "$plan/direct-capacity-330.patch")
  chmod 0644 "$fixture"
  printf '%s  %s\n' "$expected" "$fixture" | shasum -a 256 -c >/dev/null
  sed "s/$archived_sha/$expected/" "$runner" > "$work/remaining-direct-capacity.cjs"
  runner="$work/remaining-direct-capacity.cjs"
  chmod 0644 "$runner"
fi

upward_mount=()
if [[ $expense == false ]]; then
  upward_mount=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
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
  --mount "type=bind,src=$plan/remaining-direct-capacity-entry.cjs,dst=/qualification/remaining-direct-capacity-entry.cjs,readonly"
  ${upward_mount[@]+"${upward_mount[@]}"})
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode" owner
if [[ $expense == true ]]; then
  witness=payment-execution-${source_mode##*-}.cjs
  args+=(--mount "type=bind,src=$plan/$witness,dst=/qualification/$witness,readonly")
fi
args+=(--mount "type=bind,src=$runner,dst=/qualification/remaining-direct-capacity.cjs,readonly"
  --mount "type=bind,src=$fixture,dst=/qualification/workspace/services/api/src/database/direct-payment-capacity-concurrency.spec.ts,readonly")

if [[ ${6-} == --host-only ]]; then
  node --check "$work/installer.cjs"
  node --check "$runner"
  node --check "$plan/remaining-direct-capacity-entry.cjs"
  printf 'REMAINING_DIRECT_CAPACITY_%s_HOST_READY sha=%s material=%s\n' "${source_mode##*-}" "$sha" "$work"
  exit 0
fi

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/remaining-direct-capacity-entry.cjs   > "$work/receipt.json" 2> "$work/private.stderr" || exit_code=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected="REMAINING_DIRECT_CAPACITY_"+require(process.argv[4]).migrationCount+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
