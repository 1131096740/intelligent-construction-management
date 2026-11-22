#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && $5 == --current-320 ) ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
count=$(node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2])process.exit(65);
  if(source.mode==="current-320"&&source.migrationCount===323)console.log(322);
  else if(source.mode===undefined&&source.migrationCount===295)console.log(295);
  else process.exit(65);
' "$prepared/source.json" "$sha")
mode_args=()
if [[ $count == 323 ]]; then mode_args=(--current-320)
elif [[ $# == 5 ]]; then exit 65
fi
lane=historical-financial
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
node - "$prepared/source.json" "$sha" "$common/multi-witness.cjs" "$plan/historical-financial-profile.json" "$workspace" "$count" <<'JS'
const [sourceFile,sha,terminalFile,profileFile,workspace,count]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||source.migrationCount!==Number(count))process.exit(65);
if(count==='323'){
  if(source.mode!=='current-320'||source.predecessor.ledgerSha256!==terminal.final)process.exit(65);
} else if(source.ledgerSha256!==terminal.final)process.exit(65);
const {spec,sha:digest}=require(profileFile).financial;
const bytes=require('node:fs').readFileSync(workspace+'/services/api/'+spec);
if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==digest)process.exit(65);
JS
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-$lane.XXXXXXXX")
git_tree=$(git -C "$root" rev-parse "$sha^{tree}")
[[ $git_tree =~ ^[a-f0-9]{40}$ ]] || exit 65
printf '{"commit":"%s","tree":"%s"}\n' "$sha" "$git_tree" > "$work/candidate.json"
chmod 0644 "$work/candidate.json"

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/product/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/historical-financial-entry.cjs,dst=/qualification/historical-financial-entry.cjs,readonly"
  --mount "type=bind,src=$plan/historical-financial-runner.cjs,dst=/qualification/historical-financial-runner.cjs,readonly"
  --mount "type=bind,src=$plan/historical-financial-profile.json,dst=/qualification/historical-financial-profile.json,readonly"
  --mount "type=bind,src=$work/candidate.json,dst=/qualification/historical-financial-candidate.json,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设 POL-224 原四项业务在批准的隔离 $count 实例按当前 Git SHA 保持。观察 candidateBaseline、originalSlice、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/historical-financial-entry.cjs ${mode_args[@]+"${mode_args[@]}"} \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$count" <<'JS'
const [file,sha,count]=process.argv.slice(2);
const r=require(file);
if(r.status!=='ORIGINAL_HISTORICAL_FINANCIAL_'+count+'_PASSED'||r.sourceSha!==sha||r.candidateBaseline!==sha)process.exit(1);
JS
