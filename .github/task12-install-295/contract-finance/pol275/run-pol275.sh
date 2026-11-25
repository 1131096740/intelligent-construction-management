#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 5 || ( $# == 6 && $5 == warm && ( $6 == --current-320 || $6 == --text-direct-330 || $6 == --payment-remainder-331 || $6 == --upward-archive-332 ) ) ]] || exit 64
count=295
mode=()
case ${6-} in
  --current-320) count=329; mode=(--current-320) ;;
  --text-direct-330) count=330; mode=(--text-direct-330) ;;
  --payment-remainder-331) count=331; mode=(--payment-remainder-331) ;;
  --upward-archive-332) count=332; mode=(--upward-archive-332) ;;
esac
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
base=$(cd "$plan/.." && pwd -P)
common="$base/common"
lane=$5
case "$lane" in
  warm)
    purpose=ORIGINAL_POL275_WARM_EXACT_$count
    context="$build/context"
    ;;
  collision)
    purpose=ORIGINAL_POL275_COLLISION_EXACT_295
    context="$prepared/prepared/context"
    ;;
  *) exit 64 ;;
esac
scope=pol275-$lane

node -e '
  const source=require(process.argv[1]);
  const count=Number(process.argv[3]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  const modes={329:"current-320",330:"text-direct-330",331:"payment-remainder-331",332:"upward-archive-332"};
  if(modes[count] && (source.mode!==modes[count] || source.predecessor?.migrationCount!==295))process.exit(1);
  const base=process.argv[4];
  const sealed295=require(base+"/common/multi-witness.cjs").final;
  if(count===295&&source.ledgerSha256!==sealed295)process.exit(1);
  if(count===331||count===332)require(base+"/"+source.mode+"-profile.cjs").assertSource(source,process.argv[2],sealed295);
' "$prepared/source.json" "$sha" "$count" "$base"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$base/context-sha.cjs" "$context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
pol="$repo/.github/task12-install-289/pol275"
check() {
  [[ $(shasum -a 256 "$1" | cut -d ' ' -f1) == "$2" ]] || exit 65
}
evidence="$pol/$lane-evidence.cjs"
if [[ $lane == warm ]]; then
  check "$evidence" 000cfa476cd3501ef8195a7552b01be32608e768d57f72ebe5488b30a74acdd5
  check "$pol/warm-current.spec.ts" 018dd673815edfeed9c9dc4448dda0bfe1e4b4a1fa78b2e1b1897db03ba162cf
  check "$pol/warm-pol275.cjs" efe40c82aa689ce333c1403dd8d076c9ce37a8530bf4d1b3fa3c09b13e7984ef
  cp "$pol/warm-pol275.cjs" "$work/pol275.cjs"
  patch -f -F 0 -s "$work/pol275.cjs" "$plan/warm-pol275.patch"
  chmod 644 "$work/pol275.cjs"
  node --check "$work/pol275.cjs"
else
  check "$evidence" aada0a6d3aa800ed5269419314f9a090cc3dd1230c54562423cba155088f10b6
  check "$pol/collision-observation.cjs" 650f65bc653c2f2bd31b010dd008f175306969811b68b4837ffa94916b0d792b
fi
# The predecessor checkout can be mode 0600 under the caller's umask.
# Copy only the verified fixture bytes for the non-root container.
install -m 0644 "$evidence" "$work/pol275-original-evidence.cjs"
if [[ $lane == warm ]]; then
  install -m 0644 "$pol/warm-current.spec.ts" "$work/warm-current.spec.ts"
else
  install -m 0644 "$pol/collision-observation.cjs" "$work/collision-observation.cjs"
fi
check "$common/installer.cjs" 298f163d1c8b5495cae25176cc3c242c2595ccf531e08d071e6036b970b87b93
cp "$common/installer.cjs" "$work/installer.cjs"
patch -f -F 0 -s "$work/installer.cjs" "$plan/installer-pol275.patch"
check "$work/installer.cjs" 6f0e092d648a5d4a9855d64a068399e7f5750ef5db8318c4c65332781fceb8ae
chmod 644 "$work/installer.cjs"
node --check "$work/installer.cjs"
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
  --mount "type=bind,src=$work/pol275-original-evidence.cjs,dst=/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs,readonly"
  --mount "type=bind,src=$plan/pol275-entry.cjs,dst=/qualification/pol275-entry.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
if [[ $count == 331 ]]; then
  args+=(--mount "type=bind,src=$base/payment-remainder-331-profile.cjs,dst=/qualification/payment-remainder-331-profile.cjs,readonly")
elif [[ $count == 332 ]]; then
  args+=(--mount "type=bind,src=$base/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
fi
args+=(--mount "type=bind,src=$work/installer.cjs,dst=/qualification/installer.cjs,readonly")
if [[ $lane == warm ]]; then
  args+=(--mount "type=bind,src=$work/pol275.cjs,dst=/qualification/pol275.cjs,readonly"
    --mount "type=bind,src=$work/warm-current.spec.ts,dst=/qualification/workspace/services/api/src/database/clearing-reconciliation-concurrency.spec.ts,readonly")
else
  args+=(--mount "type=bind,src=$work/collision-observation.cjs,dst=/qualification/collision-observation.cjs,readonly")
fi
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol275-entry.cjs "$lane" ${mode[@]+"${mode[@]}"} > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  if(row.purpose!==process.argv[3]||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$purpose" || { printf '%s_NO_RECEIPT %s\n' "$purpose" "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected=process.argv[2]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$purpose" "$sha"
