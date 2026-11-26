#!/bin/bash
set -euo pipefail
umask 077

[[ ( $# == 5 || ( $# == 6 && $6 == --host-only ) ) &&
  ( $5 == pol115 || $5 == pol115-main || $5 == notification || $5 == spot ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
scope=$5
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$plan/.."
common="$base/common"
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$common/installer.cjs"   "$base/stage-historical-takeover-333.cjs" "$base/historical-takeover-333-profile.cjs"   "$base/historical-settlement-334-profile.cjs" "$base/upward-archive-332-profile.cjs"   "$base/historical-takeover-333-installer.patch" "$base/historical-settlement-334-installer.patch"   "$base/task12-pol109-stage-browser.cjs" "$base/expense-witness/installer.patch" "$base/expense-witness-345-profile.cjs" "$base/expense-witness-346-profile.cjs" "$base/expense-witness-prefixes.json") ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-pol115-334-$scope.XXXXXXXX")
if [[ $scope == pol115 ]]; then
  child_status=0
  for shard in notification pol115-main; do
    RUNNER_TEMP="$work" bash "$0" "$repo" "$prepared" "$sha" "$4" "$shard" "${@:6}" || child_status=$?
  done
  (( child_status == 0 )) || exit "$child_status"
  node - "$work" "$prepared/source.json" "$plan" "${6-}" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [work, sourceFile, plan, mode] = process.argv.slice(2);
const { aggregatePol115Shards } = require(path.join(plan, 'verify-pol115-jest.cjs'));
const cases = require(path.join(plan, 'cases.json'));
const source = require(sourceFile);
const shards = ['notification', 'pol115-main'];
const hostOnly = mode === '--host-only';
const receipts = shards.map(scope => {
  const matching = fs.readdirSync(work).filter(name => name.startsWith('jg-pol115-334-' + scope + '.'));
  assert.equal(matching.length, 1);
  return require(path.join(work, matching[0], hostOnly ? 'pol115-334-inputs.json' : 'receipt.json'));
});
let combined;
if (hostOnly) {
  for (const [index, scope] of shards.entries()) {
    const receipt = receipts[index];
    assert.equal(receipt.scope, scope);
    assert.equal(receipt.sourceSha, source.sourceSha);
    assert.equal(receipt.sourceTree, source.sourceTree);
    assert.equal(receipt.ledgerSha256, source.ledgerSha256);
  }
  const declared = receipts.reduce((sum, item) => sum + item.declared, 0);
  const currentCases = receipts.reduce((sum, item) => sum + item.currentCases, 0);
  assert.deepEqual([declared, currentCases], [138, 140]);
  combined = { status: 'POL115_' + source.migrationCount + '_HOST_READY', sourceSha: source.sourceSha, sourceTree: source.sourceTree,
    scope: 'pol115', ledgerSha256: source.ledgerSha256, declared, currentCases,
    shards: Object.fromEntries(receipts.map(receipt => [receipt.scope, receipt.currentCases])) };
} else {
  combined = aggregatePol115Shards({ cases, source, receipts });
}
const file = path.join(work, hostOnly ? 'host-receipt.json' : 'receipt.json');
fs.writeFileSync(file, JSON.stringify(combined) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ receipt: file, ...combined }));
JS
  exit 0
fi
node "$plan/stage-pol115-334.cjs" "$prepared" "$sha" "$scope" "$work"
if [[ ${6-} == --host-only ]]; then exit 0; fi

build=$(cd "$4" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$base/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

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
  --mount "type=bind,src=$work/installer.cjs,dst=/qualification/installer.cjs,readonly"
  --mount "type=bind,src=$work/pol115-334-inputs.json,dst=/qualification/pol115-334-inputs.json,readonly"
  --mount "type=bind,src=$plan/cases.json,dst=/qualification/pol115-334-cases.json,readonly")
for file in pol115-334-entry.cjs verify-pol115-jest.cjs browser-witness.cjs; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
done
for file in task12-pol109-stage-browser.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
  args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
done
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
while IFS= read -r -d '' file; do
  args+=(--mount "type=bind,src=$file,dst=/qualification/workspace/services/api/${file#"$work/fixtures/"},readonly")
done < <(find "$work/fixtures" -type f -print0)

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol115-334-entry.cjs "$scope"   >"$work/receipt.json" 2>"$work/private.stderr" || status=$?
[[ ! -s $work/receipt.json ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$prepared/source.json" "$plan" "$scope" <<'JS'
const path = require('node:path');
const [file, sourceFile, plan, scope] = process.argv.slice(2);
const { verifyPol115ChildReceipt } = require(path.join(plan, 'verify-pol115-jest.cjs'));
verifyPol115ChildReceipt({ cases: require(path.join(plan, 'cases.json')), source: require(sourceFile), scope, receipt: require(file) });
JS
