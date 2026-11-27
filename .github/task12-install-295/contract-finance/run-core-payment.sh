#!/bin/bash
set -euo pipefail
umask 077

if [[ ${5-} == --signed-settlement-350 ]]; then
  [[ $# == 5 && $4 == core && ${GITHUB_ACTIONS:-} != true ]] || exit 64
else
  [[ $# == 4 || ( $# == 5 && $5 == --expense-witness-34[69] ) ]] || exit 64
fi
prepared=$(cd "$1" && pwd -P)
sha=$2
build=$3
scope=$4
case "$scope" in
  core|payment) ;;
  *) exit 64 ;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
requested_profile=${5-}
workspace="$prepared/prepared/context/workspace"

mode=$(node - "$prepared/source.json" "$sha" "$plan" "$requested_profile" "$scope" <<'JS'
const [file,sha,plan,requestedProfile,scope]=process.argv.slice(2);
const source=require(file);
const modes=['expense-witness-346','expense-witness-349','signed-settlement-350'];
const expense=modes.includes(source.mode);
if(expense!==(modes.includes(requestedProfile.slice(2)))||source.sourceSha!==sha) process.exit(65);
if(expense) {
  if(requestedProfile!=='--'+source.mode) process.exit(65);
  if(scope!=='core') process.exit(64);
  require(plan+'/'+source.mode+'-profile.cjs').assertSource(source,require(plan+'/common/multi-witness.cjs').final);
} else if(source.mode==='historical-settlement-334') {
  require(plan+'/historical-settlement-334-profile.cjs').assertSource(source,require(plan+'/common/multi-witness.cjs').final);
} else if(source.mode==='upward-archive-332') {
  require(plan+'/upward-archive-332-profile.cjs').assertSource(source,sha,require(plan+'/common/multi-witness.cjs').final);
} else if(source.mode==='payment-remainder-331') {
  require(plan+'/payment-remainder-331-profile.cjs').assertSource(source,sha,require(plan+'/common/multi-witness.cjs').final);
} else if(source.mode==='text-direct-330') {
  require(plan+'/text-direct-330-profile.cjs').assertSource(source,sha,require(plan+'/common/multi-witness.cjs').final);
} else if(source.migrationCount!==(source.mode==='current-320'?329:295)) {
  process.exit(1);
}
process.stdout.write(source.mode??'legacy');
JS
)

if [[ $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  repo=$(git -C "$plan" rev-parse --show-toplevel)
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" "$requested_profile") || exit 65
  node - "$plan" "$workspace" "$mode" <<'JS'
const [plan,workspace,mode]=process.argv.slice(2);
require(plan+'/'+mode+'-profile.cjs').assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
tests=(
  services/api/src/database/contract-business-entry-http.spec.ts
  services/api/src/database/company-transfer-http-postgres.spec.ts
  services/api/src/database/payment-execution-concurrency.spec.ts
)
bash "$plan/stage-core-payment.sh" "$workspace" "$work" "$mode"

installer="$common/installer.cjs"
if [[ $mode == historical-settlement-334 || $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
if [[ $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer.patch")
  if [[ $mode == expense-witness-349 || $mode == signed-settlement-350 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
  fi
  if [[ $mode == signed-settlement-350 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-350.patch"
  fi
  node - "$installer" "$plan" "$mode" <<'JS'
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const [installer,plan,mode]=process.argv.slice(2);
assert.equal(createHash('sha256').update(readFileSync(installer)).digest('hex'),
  require(plan+'/'+mode+'-profile.cjs').installerSha256);
JS
  chmod 0644 "$installer"
  tests=("${tests[@]:0:2}")
fi
if [[ $build == --host-only ]]; then
  if [[ $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
    node --check "$installer"
    node --check "$plan/core-payment-entry.cjs"
    node --check "$plan/core-payment-runner.cjs"
    printf 'CONTRACT_FINANCE_CORE_%s_HOST_READY sha=%s material=%s\n' "${mode##*-}" "$sha" "$work"
    exit 0
  fi
  [[ $mode == historical-settlement-334 ]] || exit 64
  printf 'CONTRACT_FINANCE_%s_334_HOST_READY sha=%s\n' "$(printf '%s' "$scope" | tr '[:lower:]' '[:upper:]')" "$sha"
  exit 0
fi
build=$(cd "$build" && pwd -P)
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65


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
  --mount "type=bind,src=$plan/core-payment-entry.cjs,dst=/qualification/core-payment-entry.cjs,readonly"
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
if [[ $mode == text-direct-330 ]]; then
  args+=(--mount "type=bind,src=$plan/text-direct-330-profile.cjs,dst=/qualification/text-direct-330-profile.cjs,readonly")
elif [[ $mode == historical-settlement-334 || $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$profile,dst=/qualification/$profile,readonly")
  done
elif [[ $mode == upward-archive-332 ]]; then
  args+=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
elif [[ $mode == payment-remainder-331 ]]; then
  args+=(--mount "type=bind,src=$plan/payment-remainder-331-profile.cjs,dst=/qualification/payment-remainder-331-profile.cjs,readonly")
fi
if [[ $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  for profile in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$profile,dst=/qualification/$profile,readonly")
  done
fi
if [[ $mode == expense-witness-349 || $mode == signed-settlement-350 ]]; then
  args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
if [[ $mode == signed-settlement-350 ]]; then
  args+=(--mount "type=bind,src=$plan/signed-settlement-350-profile.cjs,dst=/qualification/signed-settlement-350-profile.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in core-payment-runner.cjs contract-finance-stage-web.cjs task12-pol109-stage-browser.cjs; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/workspace/services/api/prisma/$file,readonly")
done
ledger_support="$plan/contract-finance-owned.test-support.ts"
if [[ $mode == payment-remainder-331 || $mode == upward-archive-332 || $mode == historical-settlement-334 || $mode == expense-witness-34[69] || $mode == signed-settlement-350 ]]; then
  ledger_support="$work/services/api/src/database/contract-finance-owned.test-support.ts"
fi
args+=(--mount "type=bind,src=$ledger_support,dst=/qualification/workspace/services/api/src/database/contract-finance-owned.test-support.ts,readonly"
  --mount "type=bind,src=$plan/task12-owned-280.test-support.ts,dst=/qualification/workspace/services/api/src/database/task12-owned-280.test-support.ts,readonly")
args+=(--mount "type=bind,src=$plan/company-transfer-finite-reporter.cjs,dst=/qualification/workspace/apps/web-admin/company-transfer-finite-reporter.cjs,readonly")
for relative in "${tests[@]}"; do
  args+=(--mount "type=bind,src=$work/$relative,dst=/qualification/workspace/$relative,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/core-payment-entry.cjs "$scope"   > "$work/receipt.json" 2> "$work/private.stderr" || exit_code=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const source=require(process.argv[4]);
  const expected="CONTRACT_FINANCE_"+process.argv[2].toUpperCase()+"_"+source.migrationCount+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
