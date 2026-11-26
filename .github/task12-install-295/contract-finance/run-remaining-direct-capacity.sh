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
archive="$repo/.github/task12-install-289"
scope=direct-capacity

count=$(node -e '
  const source=require(process.argv[1]);
  const expected=source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==expected)process.exit(1);
  if(expected===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(expected===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  console.log(expected);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs")
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

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
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode"
args+=(--mount "type=bind,src=$runner,dst=/qualification/remaining-direct-capacity.cjs,readonly"
  --mount "type=bind,src=$fixture,dst=/qualification/workspace/services/api/src/database/direct-payment-capacity-concurrency.spec.ts,readonly")

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
