#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && $5 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=company-proxy-repayment

count=$(node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==(source.mode==="expense-witness-349"?349:source.mode==="expense-witness-346"?346:source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295))process.exit(1);
  if(source.migrationCount===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(source.migrationCount===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  if(source.migrationCount===346) require(process.argv[6]).assertSource(source,require(process.argv[4]).final);
  if(source.migrationCount===349) require(process.argv[7]).assertSource(source,require(process.argv[4]).final);
  console.log(source.migrationCount);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan/expense-witness-346-profile.cjs" "$plan/expense-witness-349-profile.cjs")
mode_args=()
case $(node -p 'require(process.argv[1]).mode' "$prepared/source.json") in
  current-320) mode_args=(--current-320) ;;
  text-direct-330) mode_args=(--text-direct-330) ;;
  payment-remainder-331) mode_args=(--payment-remainder-331) ;;
  upward-archive-332) mode_args=(--upward-archive-332) ;;
  historical-settlement-334|expense-witness-346|expense-witness-349) mode_args=(--historical-settlement-334) ;;
esac
if [[ $count == 346 || $count == 349 ]]; then
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  dirty=$(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" .github/task12-install-290)
  [[ -z $dirty ]] || exit 65
  node -e 'require("node:assert/strict").equal(require(process.argv[1]).sourceTree, process.argv[2])' \
    "$prepared/source.json" "$(git -C "$repo" rev-parse "$sha^{tree}")"
fi
if [[ ${5-} == --host-only && $count != 334 && $count != 346 && $count != 349 ]]; then exit 64; fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
python3 "$plan/stage-task410.py" \
  "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work" \
  ${mode_args[@]+"${mode_args[@]}"} > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 9 ]] || exit 65

if [[ $count == 346 || $count == 349 ]]; then
  runner="$work/services/api/prisma/run-task398-shared-standard-local.cjs"
  support="$work/services/api/src/database/task410-owned-test-database.ts"
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task410-runner-346.patch"
  [[ $(sha256sum "$runner" | cut -d' ' -f1) == 4e1e78d46d5216ffeacd687d811406812370d319fc63be0f0f14a848b9145af0 ]] || exit 65
  patch --batch --forward --fuzz=0 --silent "$support" < "$plan/task410-support-346.patch"
  [[ $(sha256sum "$support" | cut -d' ' -f1) == 7acab0f94ff522aba999ae7a2fb3378b90140c46699b10588068b58eecf448e0 ]] || exit 65
  spec="$work/services/api/src/database/company-proxy-repayment.http.pg.spec.ts"
  patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task410-signed-competition-346.patch"
  [[ $(sha256sum "$spec" | cut -d' ' -f1) == ce26a99c9e966f67a4d09c669c488b86f394f1d2998b2eac119d98ada70b1c32 ]] || exit 65
  if [[ $count == 349 ]]; then
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task410-runner-349.patch"
    [[ $(sha256sum "$runner" | cut -d' ' -f1) == a63260e7e9af23e658ff1f62a8e1a5d175b318eee6592e8f47f8c359760c61fa ]] || exit 65
    patch --batch --forward --fuzz=0 --silent "$support" < "$plan/task410-support-349.patch"
    [[ $(sha256sum "$support" | cut -d' ' -f1) == e877f9efd6e1d6090be1eeefad3096f969806839d5d664115b1272f84f8efe1e ]] || exit 65
    node --check "$runner"
  fi
fi

installer="$common/installer.cjs"
if [[ $count == 334 || $count == 346 || $count == 349 ]]; then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
fi
if [[ $count == 346 || $count == 349 ]]; then
  git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer.patch"
  expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-346-profile.cjs")
  [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  if [[ $count == 349 ]]; then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-349-profile.cjs")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected" ]] || exit 65
  fi
  chmod 0644 "$installer"
fi
if [[ ${5-} == --host-only ]]; then
  printf '%s\n' "$work"
  exit 0
fi

build=$(cd "$4" && pwd -P)
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
  --mount "type=bind,src=$plan/task410-entry.cjs,dst=/qualification/task410-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
if [[ $count == 334 || $count == 346 || $count == 349 ]]; then
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 346 || $count == 349 ]]; then
  for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
if [[ $count == 349 ]]; then
  args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
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
docker run "${args[@]}" --entrypoint node "$image" /qualification/task410-entry.cjs "$scope" > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  const count=require(process.argv[3]).migrationCount;
  if(row.purpose!=="TASK410_COMPANY_PROXY_EXACT_"+count||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$prepared/source.json" || { printf 'TASK410_COMPANY_PROXY_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const count=require(process.argv[4]).migrationCount;
  const expected="TASK410_COMPANY_PROXY_EXACT_"+count+"_PASSED";
  if(proof.status!==expected||proof.lane!==process.argv[2]||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
