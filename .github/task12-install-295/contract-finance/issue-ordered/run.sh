#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && $6 == --host-only ) ]] || exit 64
scope=$5
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$plan/.."
common="$base/common"
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
mode=$(node - "$prepared/source.json" "$sha" "$(git -C "$repo" rev-parse "$sha^{tree}")" "$base" "$scope" <<'JS'
const assert=require('node:assert/strict');
const [file,sha,tree,base,scope]=process.argv.slice(2),source=require(file);
const profile=require(base+'/issue-ordered/profiles.cjs').profileFor(scope);
assert.equal(source.sourceSha,sha);
assert.equal(source.sourceTree,tree);
const combined=source.mode==='expense-witness-346';
assert.equal(combined,Boolean(profile.requiredMigrationCount),'ISSUE_ORDERED_MIGRATION_SCOPE');
const ledger=require(base+(combined?'/expense-witness-346-profile.cjs':'/historical-settlement-334-profile.cjs'));
ledger.assertSource(source,require(base+'/common/multi-witness.cjs').final);
if(combined){
  const required=source.tails[profile.requiredMigrationCount-296];
  assert.equal(required?.name,profile.requiredTerminalMigration);
  assert.equal(required?.sha256,profile.requiredTerminalMigrationSha256);
}
console.log(source.mode);
JS
)
profile=$(node -e '
const scope = process.argv[2];
const { file, sourceDigest, fixtureDigest, fixturePatch = scope + ".fixture.patch" } = require(process.argv[1]).profileFor(scope);
console.log([file, sourceDigest, ...(fixtureDigest ? [fixtureDigest, fixturePatch] : [])].join(" "));
' "$plan/profiles.cjs" "$scope") || exit 64
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-$scope-334.XXXXXXXX")
read -r file source_digest fixture_digest fixture_patch <<< "$profile"
spec=services/api/$file
source_spec="$prepared/prepared/context/workspace/$spec"
[[ $(sha256sum "$source_spec" | cut -d' ' -f1) == "$source_digest" ]] || exit 65
if [[ -n $fixture_digest ]]; then
  install -m 0644 "$source_spec" "$work/fixture.ts"
  git -C "$work" apply --unidiff-zero "$plan/$fixture_patch"
  [[ $(sha256sum "$work/fixture.ts" | cut -d' ' -f1) == "$fixture_digest" ]] || exit 65
  if [[ $mode == expense-witness-346 ]]; then chmod 0644 "$work/fixture.ts"; fi
fi
node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
if [[ $mode == expense-witness-346 ]]; then
  git -C "$work" apply --unidiff-zero "$base/expense-witness/installer.patch"
  expected=$(node -e 'console.log(require(process.argv[1]).installerSha256)' "$base/expense-witness-346-profile.cjs")
  [[ $(sha256sum "$work/installer.cjs" | cut -d' ' -f1) == "$expected" ]] || exit 65
  # git apply recreates the bind source under umask 077.
  chmod 0644 "$work/installer.cjs"
fi
printf '%s\n' "$work"
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
  --mount "type=bind,src=$plan/entry.cjs,dst=/qualification/issue-ordered-entry.cjs,readonly"
  --mount "type=bind,src=$plan/profiles.cjs,dst=/qualification/issue-ordered-profiles.cjs,readonly")
if [[ -n $fixture_digest ]]; then
  args+=(--mount "type=bind,src=$work/fixture.ts,dst=/qualification/workspace/$spec,readonly")
fi
for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs; do
  args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
done
if [[ $mode == expense-witness-346 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/issue-ordered-entry.cjs "$scope" >"$work/receipt.json" 2>"$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
if [[ $mode == expense-witness-346 && $status != 0 && ! -s "$work/receipt.json" ]]; then
  printf 'ISSUE_ORDERED_346_NO_RECEIPT scope=%s exit=%s\n' "$scope" "$status" >&2
fi
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$scope" "$prepared/source.json" <<'JS'
const assert=require('node:assert/strict'),[file,sha,scope,sourcePath]=process.argv.slice(2);
const receipt=require(file),source=require(sourcePath);
assert.equal(receipt.sourceSha,sha);
assert.equal(receipt.status,scope.toUpperCase()+'_ORIGINAL_'+source.migrationCount+'_PASSED');
assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
assert.equal(receipt.suite.complete,true);
JS
