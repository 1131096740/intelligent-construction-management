#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 ]] || exit 64
prepared=$(cd "$1" && pwd -P)
sha=$2
build=$(cd "$3" && pwd -P)
scope=$4
case "$scope" in
  core|payment) ;;
  *) exit 64 ;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
workspace="$prepared/prepared/context/workspace"

node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==295)process.exit(1);
' "$prepared/source.json" "$sha"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
tests=(
  services/api/src/database/contract-business-entry-http.spec.ts
  services/api/src/database/company-transfer-http-postgres.spec.ts
  services/api/src/database/payment-execution-concurrency.spec.ts
)
for relative in "${tests[@]}"; do
  mkdir -p "$work/${relative%/*}"
  cp "$workspace/$relative" "$work/$relative"
done
gzip -dc "$plan/core-payment-tests.patch.gz" | patch --batch --forward --fuzz=0 --silent -p1 -d "$work"
for relative in "${tests[@]}"; do chmod 0644 "$work/$relative"; done

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
  --mount "type=bind,src=$plan/core-payment-entry.cjs,dst=/qualification/core-payment-entry.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in core-payment-runner.cjs contract-finance-stage-web.cjs task12-pol109-stage-browser.cjs; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/workspace/services/api/prisma/$file,readonly")
done
for file in contract-finance-owned.test-support.ts task12-owned-280.test-support.ts; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/workspace/services/api/src/database/$file,readonly")
done
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
  const expected=process.argv[2]==="core"?"CONTRACT_FINANCE_CORE_295_PASSED":"CONTRACT_FINANCE_PAYMENT_295_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha"
