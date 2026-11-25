#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == standard-330 || $5 == standard-331 || $5 == ledger-loss-330 || $5 == ledger-loss-331 || $5 == competition-331 ) ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=task398-standard

count=$(node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  console.log(count);
' "$prepared/source.json" "$sha")
variant_args=()
purpose=TASK398_STANDARD_EXACT_$count
if [[ ${5-} == standard-330 || ${5-} == standard-331 ]]; then
  [[ $5 == "standard-$count" ]] || exit 64
  variant_args=("$5")
elif [[ ${5-} == ledger-loss-330 || ${5-} == ledger-loss-331 ]]; then
  [[ $5 == "ledger-loss-$count" ]] || exit 64
  variant_args=("$5")
  purpose=TASK398_LEDGER_LOSS_EXACT_$count
elif [[ ${5-} == competition-331 ]]; then
  [[ $count == 331 ]] || exit 64
  variant_args=("$5")
  purpose=TASK398_COMPETITION_EXACT_331
elif [[ $count == 330 || $count == 331 ]]; then
  purpose=TASK425_TEXT_DIRECT_FINANCE_$count
fi
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
python3 "$plan/stage-task398-standard.py" \
  "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work" > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 6 ]] || exit 65
if [[ $count == 329 || $count == 330 || $count == 331 ]]; then
  patch --batch --forward --fuzz=0 --silent "$work/services/api/prisma/run-task398-shared-standard-local.cjs" < "$plan/task398-standard-320.patch"
fi
if [[ $count == 330 || $count == 331 ]]; then
  runner="$work/services/api/prisma/run-task398-shared-standard-local.cjs"
  runner_sha() { node -e 'const fs=require("node:fs"),{createHash}=require("node:crypto"); console.log(createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$runner"; }
  [[ $(runner_sha) == 08bacc09e2870c23bc4e73ff5d6473ae1a64c005d3ed92790713609406369b96 ]] || exit 65
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-text-direct-330.patch"
  [[ $(runner_sha) == 2a38871242e820e1164c3a68ca1373795dc05adf14a147500ec981e06a403b97 ]] || exit 65
  if [[ ${5-} == ledger-loss-330 || ${5-} == ledger-loss-331 ]]; then
    spec="$work/services/api/src/database/task16-shared-standard.http.pg.spec.ts"
    [[ $(sha256sum "$spec" | cut -d' ' -f1) == e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901 ]] || exit 65
    patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-commit-fault-330.patch"
    [[ $(sha256sum "$spec" | cut -d' ' -f1) == 4f374450ef008d745d67807529521d36b1d6a598a60dc5b161804b626b183b78 ]] || exit 65
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-330.patch"
    [[ $(runner_sha) == d21d72c39d6a3baead9ff149607b4cdac607b13ce0c810508997f44c3278c50d ]] || exit 65
    if [[ $count == 331 ]]; then
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-331.patch"
      [[ $(runner_sha) == af42b4c2fb8489cd6560b8dfb2775f4880ed806730e9e00d36073ebd1bb89b29 ]] || exit 65
    fi
  elif [[ $count == 331 ]]; then
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-331.patch"
    [[ $(runner_sha) == a53edcb4f8dd60c88ee74f784d9eb1e5d04296e2c024a74680f1f38f84e92f33 ]] || exit 65
    if [[ ${5-} == competition-331 ]]; then
      spec="$work/services/api/src/database/task16-shared-standard.http.pg.spec.ts"
      [[ $(sha256sum "$spec" | cut -d' ' -f1) == e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901 ]] || exit 65
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-competition-runner-331.patch"
      patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-competition-spec-331.patch"
      [[ $(runner_sha) == bc73cdda637bc241c4f421afb4807b4035666f83e301ac60cfe8f591d4f3567a ]] || exit 65
      [[ $(sha256sum "$spec" | cut -d' ' -f1) == ae9e20d37f17846fa64fe0223d7d7bdcfac9f1315fa687216b71d8fd411dddd5 ]] || exit 65
    fi
  fi
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
  --mount "type=bind,src=$plan/task398-standard-entry.cjs,dst=/qualification/task398-standard-entry.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task398-standard-entry.cjs ${variant_args[@]+"${variant_args[@]}"} > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  const purpose=process.argv[3];
  if(row.purpose!==purpose||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$purpose" || { printf 'TASK398_STANDARD_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected=process.argv[3]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[2])process.exit(1);
' "$work/receipt.json" "$sha" "$purpose"
