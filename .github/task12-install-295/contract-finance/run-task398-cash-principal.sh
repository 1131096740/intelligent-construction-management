#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=$5
case "$scope" in cash-handover|principal-return|cash-transfer|project-advance) ;; *) exit 64 ;; esac

count=$(node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  if(count===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  console.log(count);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs")
extended=false
if [[ $scope == cash-transfer || $scope == project-advance ]]; then
  [[ $count == 332 ]] || exit 64
  extended=true
fi
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
python3 "$plan/stage-task398-cash-principal.py" \
  "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work" > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 7 ]] || exit 65
if [[ $extended == true ]]; then
  python3 "$plan/stage-task398-standard.py" \
    "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work/standard" > "$work/standard-files.txt"
  coordinate=services/api/src/database/task16-shared-standard.http.pg.spec.ts
  [[ $(shasum -a 256 "$work/standard/$coordinate" | cut -d' ' -f1) == e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901 ]] || exit 65
  install -m 0644 "$work/standard/$coordinate" "$work/$coordinate"
  overlay_files+=("$coordinate")
fi
if (( count >= 330 )); then
  runner="$work/services/api/prisma/run-task398-shared-standard-local.cjs"
  runner_sha() { node -e 'const fs=require("node:fs"),{createHash}=require("node:crypto"); console.log(createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$runner"; }
  [[ $(runner_sha) == feb96f723d58b7108add5b193c710fc61f1f3280469d7e3766dbfdcf3fdd7b6d ]] || exit 65
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-cash-principal-330.patch"
  [[ $(runner_sha) == df3fb0d359512f3a85ebb907b4c7b71fa72034b2c2ed2f5ee4b479c03db1ebbb ]] || exit 65
  if (( count >= 331 )); then
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-cash-principal-331.patch"
    [[ $(runner_sha) == 6dacd1f230b28d13a76dc42e510affe8230f4fa8c87339624d1a4993814afb74 ]] || exit 65
  fi
fi
if [[ $count == 332 ]]; then
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-cash-principal-332.patch"
  [[ $(runner_sha) == 1d46ecbe7796b613e996fe8652d7147f68147ae6f43adb53c1c37d902f675471 ]] || exit 65
fi

if [[ $extended == true ]]; then
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-cash-transfer-advance-332.patch"
  [[ $(runner_sha) == 660f0f60e2bf7bcd83f453d35fc1aa78cfa5f84bee827c39bbe42188783a4947 ]] || exit 65
fi

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
  --mount "type=bind,src=$plan/task398-cash-principal-entry.cjs,dst=/qualification/task398-cash-principal-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task398-cash-principal-entry.cjs "$scope" > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  const count=require(process.argv[3]).migrationCount;
  if(row.purpose!=="TASK398_CASH_PRINCIPAL_EXACT_"+count||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$prepared/source.json" || { printf 'TASK398_CASH_PRINCIPAL_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const count=require(process.argv[4]).migrationCount;
  const expected="TASK398_CASH_PRINCIPAL_EXACT_"+count+"_PASSED";
  if(proof.status!==expected||proof.lane!==process.argv[2]||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
