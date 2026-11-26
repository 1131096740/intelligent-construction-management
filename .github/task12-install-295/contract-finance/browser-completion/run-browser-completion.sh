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
base="$repo/.github/task12-install-295/contract-finance"
common="$base/common"
scope=task398-browser-completion

count=$(node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  if(count===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(count===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  console.log(count);
' "$prepared/source.json" "$sha" "$base/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$base/historical-settlement-334-profile.cjs")
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$base/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
stage_args=()
if [[ $count == 331 ]]; then
  stage_args=(--payment-remainder-331)
elif [[ $count == 332 ]]; then
  stage_args=(--upward-archive-332)
elif [[ $count == 334 ]]; then
  stage_args=(--historical-settlement-334)
fi
python3 "$plan/stage-completion.py" \
  "$repo" "$prepared/prepared/context/workspace" "$work" ${stage_args[@]+"${stage_args[@]}"} > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 8 ]] || exit 65

installer="$common/installer.cjs"
if [[ $count == 334 ]]; then
  node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
mkdir -m 0777 "$work/owned"
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
  --mount "type=bind,src=$work/owned,dst=/run/task398-browser"
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly"
  --mount "type=bind,src=$base/task398-browser-diagnostics.cjs,dst=/qualification/task398-browser-diagnostics.cjs,readonly"
  --mount "type=bind,src=$plan/task398-completion-entry.cjs,dst=/qualification/task398-completion-entry.cjs,readonly"
  --mount "type=bind,src=$base/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
if [[ $count == 334 ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task398-completion-entry.cjs   > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!=="TASK398_BROWSER_COMPLETION_EXACT_"+process.argv[3]||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$count" || { printf 'TASK398_BROWSER_COMPLETION_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
# The evidence directory belongs to postgres and stays private on the host.
docker run --rm -i --platform linux/amd64 --pull never --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges --user postgres \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1m \
  --mount "type=bind,src=$work/owned,dst=/evidence,readonly" \
  --mount "type=bind,src=$plan/verify-receipts.cjs,dst=/verify-receipts.cjs,readonly" \
  --entrypoint bash "$image" -ec '
    cat > /tmp/outer.json
    marker=$(find /evidence -type f -name "$1")
    [[ -n $marker && $marker != *$'\''\n'\''* ]] || exit 65
    node /verify-receipts.cjs /tmp/outer.json "$(dirname "$marker")" "$2"
  ' _ "receipt-complete.json" "$count" < "$work/receipt.json"
