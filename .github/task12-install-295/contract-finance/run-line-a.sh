#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 3 ]] || exit 64
prepared=$(cd "$1" && pwd -P)
sha=$2
build=$(cd "$3" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
source="$prepared/source.json"

node -e '
  const source=require(process.argv[1]);
  const count=({"current-320":329,"text-direct-330":330,"payment-remainder-331":331,"upward-archive-332":332,"historical-takeover-333":333})[source.mode];
  if(!count||source.migrationCount!==count||source.sourceSha!==process.argv[2])process.exit(65);
' "$source" "$sha"
entry=line-a-entry.cjs
if [[ $(node -p 'require(process.argv[1]).mode' "$source") == historical-takeover-333 ]]; then
  entry=historical-takeover-333-entry.cjs
fi
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$source") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-line-a.XXXXXXXX")
args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1024m --env HOME=/tmp
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$source,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/$entry,dst=/qualification/$entry,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done

if [[ "$entry" == historical-takeover-333-entry.cjs ]]; then
  for file in historical-takeover-333-profile.cjs upward-archive-332-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/"$entry" > "$work/receipt.json" 2> "$work/private.stderr" || exit_code=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const source=require(process.argv[3]);
  const expected=({"current-320":"LINE_A_EXACT_329_PASSED","text-direct-330":"LINE_A_TEXT_DIRECT_330_PASSED",
    "payment-remainder-331":"LINE_A_PAYMENT_REMAINDER_331_PASSED",
    "upward-archive-332":"LINE_A_UPWARD_ARCHIVE_332_PASSED","historical-takeover-333":"HISTORICAL_TAKEOVER_A28_333_PASSED"})[source.mode];
  if(proof.status!==expected||proof.sourceSha!==process.argv[2])process.exit(65);
' "$work/receipt.json" "$sha" "$source"
