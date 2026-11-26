#!/bin/bash
set -euo pipefail
umask 077

[[ ( $# == 5 || ( $# == 6 && $6 == --host-only ) ) && $5 == --expense-witness-346 ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
workspace="$prepared/prepared/context/workspace"
[[ $plan == "$repo/.github/task12-install-295/contract-finance" ]] || exit 65
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
node "$plan/check-ledger.cjs" "$repo" "$sha" "$5" | cmp -s "$prepared/source.json" - || exit 65
node - "$plan" "$prepared/source.json" "$workspace/services/api" <<'JS'
const [plan,file,api] = process.argv.slice(2);
const source = require(file), profile = require(plan+'/expense-witness-346-profile.cjs');
profile.assertSource(source,require(plan+'/common/multi-witness.cjs').final);
require(plan+'/bank/migration-inputs-346.cjs')(api,source,profile);
require(plan+'/file-binding-catalog-entry.cjs').assertFixture(api);
JS

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-file-binding-catalog.XXXXXXXX")
args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1024m --env HOME=/tmp
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/file-binding-catalog-entry.cjs,dst=/qualification/file-binding-catalog-entry.cjs,readonly"
  --mount "type=bind,src=$plan/payment-execution-346.cjs,dst=/qualification/payment-execution-346.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
append_remaining_installer expense-witness-346

if [[ ${6-} == --host-only ]]; then
  node --check "$work/installer.cjs"
  node --check "$plan/file-binding-catalog-entry.cjs"
  printf 'FILE_BINDING_CATALOG_346_HOST_READY sha=%s material=%s\n' "$sha" "$work"
  exit 0
fi

image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/file-binding-catalog-entry.cjs \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" <<'JS'
const [file,sha] = process.argv.slice(2);
const assert = require('node:assert/strict'), receipt = require(file);
assert.equal(receipt.status,'FILE_BINDING_CATALOG_346_PASSED');
assert.equal(receipt.sourceSha,sha);
assert.deepEqual(receipt.original,{passed:6,skipped:0,scratchClean:true,outerIdentityUnchanged:true});
JS
