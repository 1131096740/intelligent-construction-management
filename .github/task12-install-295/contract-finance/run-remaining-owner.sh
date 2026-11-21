#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
lane=$5
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
owner="$prior/remaining-owner.cjs"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
node - "$prepared/source.json" "$sha" "$prior/remaining-owner-modes.json" "$lane" "$common/multi-witness.cjs" <<'JS'
const [sourceFile,sha,profilesFile,lane,terminalFile]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||source.migrationCount!==295||source.ledgerSha256!==terminal.final||
  !Object.hasOwn(require(profilesFile),lane))process.exit(65);
JS
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-$lane.XXXXXXXX")
node "$owner" --mounts "$lane" "$workspace" > "$work/fixture-mounts.tsv"

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/product/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/remaining-owner-entry.cjs,dst=/qualification/remaining-owner-entry.cjs,readonly"
  --mount "type=bind,src=$owner,dst=/qualification/remaining-owner.cjs,readonly"
  --mount "type=bind,src=$prior/remaining-owner-modes.json,dst=/qualification/remaining-owner-modes.json,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
while IFS=$'\t' read -r source relative; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/workspace/services/api/$relative,readonly")
done < "$work/fixture-mounts.tsv"

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设原 $lane 业务断言可在同一 295 隔离库保持。观察 originalScope、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/remaining-owner-entry.cjs "$lane" \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" <<'JS'
const [file,sha,lane]=process.argv.slice(2);
const r=require(file);
if(r.status!=='REMAINING_OWNER_295_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
