#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --host-only || $5 == --issue417-history-expense ) ) ||
  ( $# == 6 && $5 == --issue417-history-expense && $6 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$plan/.."
common="$base/common"
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$base") ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-expense-witness.XXXXXXXX")
node "$plan/stage.cjs" "$prepared" "$sha" "$work" "${5-}"
if [[ ${5-} == --host-only || ${6-} == --host-only ]]; then
  printf '%s\n' "$work"
  exit 0
fi

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
  --mount "type=bind,src=$work/expense-witness-inputs.json,dst=/qualification/expense-witness-inputs.json,readonly"
  --mount "type=bind,src=$plan/entry.cjs,dst=/qualification/expense-witness-entry.cjs,readonly")
entry=expense-witness-entry.cjs
if [[ ${5-} == --issue417-history-expense ]]; then
  entry=historical-expense-335-entry.cjs
  for file in "$entry" historical-expense-335-profile.cjs; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
  race="$base/historical-expense-335-race.cjs"
  if [[ -f $work/historical-expense-335-race.cjs ]]; then
    race="$work/historical-expense-335-race.cjs"
    args+=(--mount "type=bind,src=$base/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
  fi
  args+=(--mount "type=bind,src=$race,dst=/qualification/historical-expense-335-race.cjs,readonly")
fi
for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs; do
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
docker run "${args[@]}" --entrypoint node "$image" /qualification/"$entry" >"$work/receipt.json" 2>"$work/private.stderr" || status=$?
[[ ! -s $work/receipt.json ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$prepared/source.json" "${5-}" <<'JS'
const assert=require('node:assert/strict');
const [file,sha,sourceFile,scope]=process.argv.slice(2),r=require(file),source=require(sourceFile);
assert.equal(r.sourceSha,sha);
if (scope === '--issue417-history-expense') {
  assert.ok([346,349].includes(source.migrationCount));
  assert.equal(r.status,'ISSUE417_HISTORY_EXPENSE_EXACT_'+source.migrationCount+'_PASSED');
  assert.equal(r.original.operatingLedgerPort,'ORIGINAL_RECORDED_INPUTS');
  assert.equal(r.original.complete,true);
  assert.equal(r.sceneRace.staleSceneWriteSqlstate,'40001');
  assert.equal(r.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(r.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  process.exit(0);
}
assert.equal(r.status,'EXPENSE_WITNESS_'+source.migrationCount+'_PASSED');
assert.equal(r.fullShardEligible,false);
assert.equal(r.forward320.count,334);
assert.equal(r.expenseWitnessForward.count,source.migrationCount);
assert.equal(r.combinedAfterBusiness.count,source.migrationCount);
assert.deepEqual(r.jest,{exit:0,registered:63,passed:2,failed:0,skipped:61});
assert.equal(r.controls.deniedByWitnessConstraint,5);
assert.equal(r.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
JS
