#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --expense-witness-346 || $5 == --expense-witness-349 ) ) ||
  ( $# == 6 && ( $5 == --expense-witness-346 || $5 == --expense-witness-349 ) && $6 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base="$repo/.github/task12-install-295/contract-finance"
common="$base/common"
scope=task398-browser-partial
mode=${5-}
tree=
if [[ $mode == --expense-witness-346 || $mode == --expense-witness-349 ]]; then
  [[ $plan == "$base/browser-partial" && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$base") ]] || exit 65
  tree=$(git -C "$repo" rev-parse "$sha^{tree}")
  if [[ $mode == --expense-witness-349 ]]; then
    cmp -s "$prepared/source.json" <(node "$base/check-ledger.cjs" "$repo" "$sha" "$mode") || exit 65
  fi
fi

count=$(node -e '
  const [file,sha,base,mode,tree]=process.argv.slice(1);
  const source=require(file);
  const {final}=require(base+"/common/multi-witness.cjs");
  const count=source.mode==="expense-witness-349"?349:source.mode==="expense-witness-346"?346:source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==sha||source.migrationCount!==count||(count>=346?mode!=="--"+source.mode:Boolean(mode)))process.exit(1);
  if(count===332) require(base+"/upward-archive-332-profile.cjs").assertSource(source,sha,final);
  if(count===334) require(base+"/historical-settlement-334-profile.cjs").assertSource(source,final);
  if(count===346||count===349){
    require("node:assert/strict").equal(source.sourceTree,tree);
    require(base+"/"+source.mode+"-profile.cjs").assertSource(source,final);
  }
  console.log(count);
' "$prepared/source.json" "$sha" "$base" "$mode" "$tree")
if [[ ${6-} != --host-only ]]; then
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$base/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
stage_args=()
if [[ $count == 331 ]]; then
  stage_args=(--payment-remainder-331)
elif [[ $count == 332 ]]; then
  stage_args=(--upward-archive-332)
elif [[ $count == 334 ]]; then
  stage_args=(--historical-settlement-334)
elif [[ $count == 346 || $count == 349 ]]; then
  stage_args=("$mode")
fi
python3 "$plan/stage-partial.py" \
  "$repo" "$prepared/prepared/context/workspace" "$work" ${stage_args[@]+"${stage_args[@]}"} > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 6 ]] || exit 65

installer="$common/installer.cjs"
if [[ $count == 334 || $count == 346 || $count == 349 ]]; then
  node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
if [[ $count == 346 || $count == 349 ]]; then
  git -C "$work" apply --unidiff-zero "$base/expense-witness/installer.patch"
  if [[ $count == 349 ]]; then
    git -C "$work" apply --unidiff-zero "$base/expense-witness/installer-349.patch"
  fi
  node - "$base" "$prepared" "$installer" <<'JS'
const assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const [base,prepared,installer]=process.argv.slice(2);
const source=require(join(prepared,"source.json"));
const profile=require(join(base,source.mode+"-profile.cjs"));
const installerSha256=createHash("sha256").update(readFileSync(installer)).digest("hex");
assert.equal(installerSha256,profile.installerSha256);
profile.assertRuntimeBaseline(require(join(prepared,"prepared/context/workspace/services/api/prisma/migration-baseline.cjs")));
console.log(JSON.stringify({status:"TASK398_BROWSER_PARTIAL_"+profile.count+"_HOST_READY",sourceSha:source.sourceSha,sourceTree:source.sourceTree,ledgerSha256:source.ledgerSha256,installerSha256}));
JS
  chmod 0644 "$installer"
  if [[ ${6-} == --host-only ]]; then
    node --check "$installer"
    node --check "$plan/task398-partial-entry.cjs"
    node --check "$plan/verify-receipts.cjs"
    node --check "$work/services/api/prisma/run-task398-shared-standard-local.cjs"
    printf '%s\n' "$work"
    exit 0
  fi
fi
mkdir -m 0777 "$work/owned"
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
  --mount "type=bind,src=$work/owned,dst=/run/task398-browser"
  --mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly"
  --mount "type=bind,src=$base/task398-browser-diagnostics.cjs,dst=/qualification/task398-browser-diagnostics.cjs,readonly"
  --mount "type=bind,src=$plan/task398-partial-entry.cjs,dst=/qualification/task398-partial-entry.cjs,readonly"
  --mount "type=bind,src=$base/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
if [[ $count == 334 || $count == 346 || $count == 349 ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 346 || $count == 349 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$base/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 349 ]]; then
  args+=(--mount "type=bind,src=$base/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
fi
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task398-partial-entry.cjs   > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!=="TASK398_BROWSER_PARTIAL_EXACT_"+process.argv[3]||row.sourceSha!==process.argv[2])process.exit(1);
  if(row.status.endsWith("_PASSED")){
    if(process.argv[3]==="346"&&row.expenseWitnessForward?.sourceTree!==process.argv[4])process.exit(1);
    if(process.argv[3]==="349"&&row.expenseWitnessPrecisionForward?.sourceTree!==process.argv[4])process.exit(1);
  }
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$count" "$tree" || { printf 'TASK398_BROWSER_PARTIAL_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
# The evidence directory belongs to postgres and stays private on the host.
docker run --rm -i --platform linux/amd64 --pull never --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges --user postgres \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1m \
  --mount "type=bind,src=$work/owned,dst=/evidence,readonly" \
  --mount "type=bind,src=$plan/verify-receipts.cjs,dst=/verify-receipts.cjs,readonly" \
  --entrypoint bash "$image" -ec '
    cat > /tmp/outer.json
    marker=$(find /evidence -type f -name "$1")
    [[ -n $marker && $marker != *$'\''\n'\''* ]] || exit 65
    node /verify-receipts.cjs /tmp/outer.json "$(dirname "$marker")" "$2"
  ' _ "receipt.json" "$count" < "$work/receipt.json"
