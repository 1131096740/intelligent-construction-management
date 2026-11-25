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
scope=company-proxy-repayment

node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==(source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295))process.exit(1);
  if(source.migrationCount===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs"
mode_args=()
case $(node -p 'require(process.argv[1]).mode' "$prepared/source.json") in
  current-320) mode_args=(--current-320) ;;
  text-direct-330) mode_args=(--text-direct-330) ;;
  payment-remainder-331) mode_args=(--payment-remainder-331) ;;
  upward-archive-332) mode_args=(--upward-archive-332) ;;
esac
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
python3 "$plan/stage-task410.py" \
  "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work" \
  ${mode_args[@]+"${mode_args[@]}"} > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 9 ]] || exit 65

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
  --mount "type=bind,src=$plan/task410-entry.cjs,dst=/qualification/task410-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task410-entry.cjs "$scope" > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  const count=require(process.argv[3]).migrationCount;
  if(row.purpose!=="TASK410_COMPANY_PROXY_EXACT_"+count||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$prepared/source.json" || { printf 'TASK410_COMPANY_PROXY_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const count=require(process.argv[4]).migrationCount;
  const expected="TASK410_COMPANY_PROXY_EXACT_"+count+"_PASSED";
  if(proof.status!==expected||proof.lane!==process.argv[2]||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
