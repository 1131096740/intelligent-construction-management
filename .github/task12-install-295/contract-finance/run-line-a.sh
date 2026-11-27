#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 3 || ( $# == 4 && ( $4 == original || $4 == --a28-continuation || $4 == --a29-opening || $4 == --a28-unknown-overpay ) ) ||
  ( $# == 5 && ( $4 == original || $4 == --a28-continuation || $4 == --a29-opening ) && $5 == --host-only ) ]] || exit 64
prepared=$(cd "$1" && pwd -P)
sha=$2
build=$(cd "$3" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
source="$prepared/source.json"

node -e '
  const source=require(process.argv[1]);
  const count=({"current-320":329,"text-direct-330":330,"payment-remainder-331":331,"upward-archive-332":332,"historical-takeover-333":333,"historical-settlement-334":334,"expense-witness-346":346,"expense-witness-349":349})[source.mode];
  if(!count||source.migrationCount!==count||source.sourceSha!==process.argv[2])process.exit(65);
' "$source" "$sha"
entry=line-a-entry.cjs
mode=$(node -p 'require(process.argv[1]).mode' "$source")
case "$mode:${4:-}:${5:-}" in
  expense-witness-349:original:|expense-witness-349:original:--host-only) ;;
  expense-witness-349:--a28-continuation:|expense-witness-349:--a28-continuation:--host-only)
    entry=historical-takeover-333-entry.cjs ;;
  expense-witness-346:original:|expense-witness-346:original:--host-only|historical-settlement-334:original:) ;;
  expense-witness-346:--a28-continuation:|expense-witness-346:--a28-continuation:--host-only|\
  expense-witness-346:--a29-opening:|expense-witness-346:--a29-opening:--host-only|\
  historical-settlement-334::|historical-settlement-334:--a29-opening:|historical-settlement-334:--a28-unknown-overpay:|\
  historical-takeover-333::)
    entry=historical-takeover-333-entry.cjs ;;
  expense-witness-346:*|expense-witness-349:*|historical-settlement-334:*|historical-takeover-333:*) exit 64 ;;
  *::) ;;
  *) exit 64 ;;
esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-line-a.XXXXXXXX")
installer="$common/installer.cjs"
if [[ "$mode" == expense-witness-346 || "$mode" == expense-witness-349 ]]; then
  if [[ "$mode" == expense-witness-349 ]]; then
    root=$(git -C "$plan" rev-parse --show-toplevel)
    [[ $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
    [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
    cmp -s "$source" <(node "$plan/check-ledger.cjs" "$root" "$sha" --expense-witness-349) || exit 65
  fi
  node - "$plan" "$source" "$prepared" "$work" "$4" <<'JS'
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [plan, sourceFile, prepared, work, lane] = process.argv.slice(2);
const source = require(sourceFile);
const profile = require(path.join(plan, source.mode + '-profile.cjs'));
const historical = require(path.join(plan, 'historical-settlement-334-profile.cjs'));
const { final } = require(path.join(plan, 'common/multi-witness.cjs'));
profile.assertSource(source, final);

const workspace = path.join(prepared, 'prepared/context/workspace');
const api = path.join(workspace, 'services/api');
if (lane !== 'original' || profile.count === 349) {
  profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
}
if (lane !== 'original') {
  assert.ok(fs.statSync(path.join(api, 'src/contract-takeover/contract-takeover-a28.http.pg.spec.ts')).isFile());
  process.exit(0);
}

const spec = 'services/api/src/database/line-a-real-db.http.pg.spec.ts';
const original = fs.readFileSync(path.join(workspace, spec), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(original), '2b6ce431862fe986dce8aee61f68b8509510977e117faafe3e8be73e193f5e1f', 'LINE_A_334_ORIGINAL_FIXTURE');
const before = '{ count: 334n, terminal: "' + historical.terminal.name + '" }';
const after = '{ count: ' + profile.count + 'n, terminal: "' + profile.terminal.name + '" }';
assert.equal(original.split(before).length, 2, 'LINE_A_334_LEDGER_ANCHOR');
const fixture = original.replace(before, after);
const output = path.join(work, path.basename(spec));
fs.writeFileSync(output, fixture, { flag: 'wx' });
fs.chmodSync(output, 0o644);
JS
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer.patch"
  if [[ "$mode" == expense-witness-349 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
  fi
  chmod 644 "$work/installer.cjs"
  node -e '
    const fs=require("node:fs"),hash=require("node:crypto").createHash("sha256");
    if(hash.update(fs.readFileSync(process.argv[1])).digest("hex")!==require(process.argv[2]).installerSha256)process.exit(65);
  ' "$work/installer.cjs" "$plan/$mode-profile.cjs"
  installer="$work/installer.cjs"
  if [[ ${5:-} == --host-only ]]; then
    node --check "$installer"
    node --check "$plan/$entry"
    printf '%s\n' "$work"
    exit 0
  fi
elif [[ "$mode" == historical-takeover-333 || "$mode" == historical-settlement-334 ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" "$mode"
  installer="$work/installer.cjs"
fi
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$source") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

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
  --mount "type=bind,src=$plan/$entry,dst=/qualification/$entry,readonly"
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done

if [[ "$mode" == historical-takeover-333 || "$mode" == historical-settlement-334 ]]; then
  args+=(--mount "type=bind,src=$plan/historical-takeover-333-profile.cjs,dst=/qualification/historical-takeover-333-profile.cjs,readonly")
  if [[ "$mode" == historical-settlement-334 ]]; then
    args+=(--mount "type=bind,src=$plan/historical-settlement-334-profile.cjs,dst=/qualification/historical-settlement-334-profile.cjs,readonly")
  fi
fi

if [[ "$mode" == expense-witness-346 || "$mode" == expense-witness-349 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
  if [[ "$mode" == expense-witness-349 ]]; then
    args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
  fi
  if [[ $4 == original ]]; then
    args+=(--mount "type=bind,src=$work/line-a-real-db.http.pg.spec.ts,dst=/qualification/workspace/services/api/src/database/line-a-real-db.http.pg.spec.ts,readonly")
  fi
  printf '%s\n' "$work"
fi

case ${4:-} in
  --a28-continuation|--a29-opening|--a28-unknown-overpay) args+=(--env "JG_HISTORICAL_ACCEPTANCE_SCENARIO=${4#--}");;
esac
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
    "upward-archive-332":"LINE_A_UPWARD_ARCHIVE_332_PASSED","historical-takeover-333":"HISTORICAL_TAKEOVER_A28_333_PASSED","historical-settlement-334":"HISTORICAL_TAKEOVER_A28_334_PASSED"})[source.mode];
  const required=({"original":source.mode.startsWith("expense-witness-")
      ?"LINE_A_EXPENSE_WITNESS_"+source.migrationCount+"_PASSED":"LINE_A_HISTORICAL_SETTLEMENT_334_PASSED",
    "--a28-continuation":"HISTORICAL_TAKEOVER_A28_"+source.migrationCount+"_PASSED",
    "--a29-opening":"HISTORICAL_TAKEOVER_A29_OPENING_"+source.migrationCount+"_PASSED",
    "--a28-unknown-overpay":"HISTORICAL_TAKEOVER_A28_UNKNOWN_OVERPAY_334_PASSED"})[process.argv[4]]??expected;
  if(proof.status!==required||proof.sourceSha!==process.argv[2])process.exit(65);
' "$work/receipt.json" "$sha" "$source" "${4:-}"
