#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 ) ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
mode_args=()
count=295
case ${5-} in
  --current-320) mode_args=(--current-320); count=329 ;;
  --text-direct-330) mode_args=(--text-direct-330); count=330 ;;
  --payment-remainder-331) mode_args=(--payment-remainder-331); count=331 ;;
  --upward-archive-332) mode_args=(--upward-archive-332); count=332 ;;
  --historical-settlement-334) mode_args=(--historical-settlement-334); count=334 ;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$repo/.github/task12-install-295/contract-finance"
common="$base/common"
scope=pol115-workbench

node -e '
  const [file,sha,count,base]=process.argv.slice(1);
  const source=require(file);
  const modes={"329":"current-320","330":"text-direct-330","331":"payment-remainder-331","332":"upward-archive-332","334":"historical-settlement-334"};
  if(source.sourceSha!==sha||source.migrationCount!==Number(count)||(modes[count]&&source.mode!==modes[count]))process.exit(1);
  if(count==="334") require(base+"/historical-settlement-334-profile.cjs").assertSource(source,require(base+"/common/multi-witness.cjs").final);
' "$prepared/source.json" "$sha" "$count" "$base"
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
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
installer="$common/installer.cjs"
if [[ $count == 334 ]]; then
  node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
  for profile_file in historical-settlement-334-profile.cjs historical-takeover-333-profile.cjs upward-archive-332-profile.cjs; do
    args+=(--mount "type=bind,src=$base/$profile_file,dst=/qualification/$profile_file,readonly")
  done
fi
args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
args+=(--mount "type=bind,src=$base/task12-pol109-stage-browser.cjs,dst=/qualification/task12-pol109-stage-browser.cjs,readonly")
for file in browser-preflight.cjs task12-pol115-workbench-ci.cjs issue430-approval-sms-ci.cjs; do
  args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
done
spec=settlement-template-workbench.owned290.http.pg.spec.ts
args+=(--mount "type=bind,src=$plan/$spec,dst=/qualification/workspace/services/api/src/settlement/$spec,readonly")

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
docker run "${args[@]}" --env NODE_ENV=test --entrypoint node "$image" /qualification/browser-preflight.cjs   >"$work/browser-preflight.json" 2>"$work/browser-preflight.stderr"
node -e 'if(require(process.argv[1]).status!=="POL115_290_REUSED_BROWSER_PRECHECK_PASSED")process.exit(1)' "$work/browser-preflight.json"
printf '%s\n' "$work"
printf '%s\n' "检验原工作台九项在准确 $count 的动态角色下通过。观察 workbench、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/workbench-entry.cjs ${mode_args[@]+"${mode_args[@]}"}   > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!=="POL115_WORKBENCH_ORIGINAL_"+process.argv[3]||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$count" || { printf 'POL115_WORKBENCH_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected="POL115_WORKBENCH_ORIGINAL_"+process.argv[4]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
  if(Number(process.argv[4])>=331&&(proof.issue430?.tests!==5||proof.issue430?.externalSends!==0))process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$count"
