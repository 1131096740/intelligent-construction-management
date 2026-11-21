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
base="$repo/.github/task12-install-295/contract-finance"
common="$base/common"
scope=pol115-workbench

node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==295)process.exit(1);
' "$prepared/source.json" "$sha"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$base/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
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
  --mount "type=bind,src=$plan/workbench-entry.cjs,dst=/qualification/workbench-entry.cjs,readonly"
  --mount "type=bind,src=$plan/workbench-inputs.cjs,dst=/qualification/workbench-inputs.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
args+=(--mount "type=bind,src=$base/task12-pol109-stage-browser.cjs,dst=/qualification/task12-pol109-stage-browser.cjs,readonly")
for file in browser-preflight.cjs task12-pol115-workbench-ci.cjs; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
done
spec=settlement-template-workbench.owned290.http.pg.spec.ts
args+=(--mount "type=bind,src=$plan/$spec,dst=/qualification/workspace/services/api/src/settlement/$spec,readonly")

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
docker run "${args[@]}" --env NODE_ENV=test --entrypoint node "$image" /qualification/browser-preflight.cjs   >"$work/browser-preflight.json" 2>"$work/browser-preflight.stderr"
node -e 'if(require(process.argv[1]).status!=="POL115_290_REUSED_BROWSER_PRECHECK_PASSED")process.exit(1)' "$work/browser-preflight.json"
printf '%s\n' "$work"
printf '%s\n' '检验原工作台九项在准确 295 的动态角色下通过。观察 workbench、combinedAfterBusiness 和 cleanup。' > "$work/hypothesis.txt"
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/workbench-entry.cjs   > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!=="POL115_WORKBENCH_ORIGINAL_295"||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" || { printf 'POL115_WORKBENCH_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected="POL115_WORKBENCH_ORIGINAL_295_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha"
