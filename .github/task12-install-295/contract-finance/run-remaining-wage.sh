#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 ) ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
plan=$(cd "$(dirname "$0")" && pwd -P)
count=$(node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2])process.exit(65);
  if(source.mode==="current-320"&&source.migrationCount===329)console.log(source.migrationCount);
  else if(source.mode==="text-direct-330"&&source.migrationCount===330)console.log(330);
  else if(source.mode==="payment-remainder-331"&&source.migrationCount===331)console.log(331);
  else if(source.mode==="historical-settlement-334") {
    require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
    console.log(334);
  }
  else if(source.mode==="upward-archive-332") {
    require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
    console.log(332);
  }
  else if(source.mode===undefined&&source.migrationCount===295)console.log(295);
  else process.exit(65);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$plan/common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs")
mode_args=()
case "$count" in 329) mode_args=(--current-320);; 330) mode_args=(--text-direct-330);; 331) mode_args=(--payment-remainder-331);; 332) mode_args=(--upward-archive-332);; 334) mode_args=(--historical-settlement-334);; esac
if [[ $# == 5 && ${mode_args[0]:-} != "$5" ]]; then exit 65; fi
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
common="$plan/common"
archive="$repo/.github/task12-install-289"
scope=wage

image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
archive_wage="$archive/remaining-special/wage"
node - "$archive" "$prepared/prepared/context/workspace" <<'JS'
const fs=require('node:fs'), path=require('node:path'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const [archive,workspace]=process.argv.slice(2);
const {wage:{mounts}}=require(path.join(archive,'remaining-special.json'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const name of ['wage.cjs','wage-material.json','wage-statement-constraints.spec.ts']){
  const source=path.join(archive,'remaining-special','wage',name);
  assert.ok(fs.lstatSync(source).isFile());
  assert.equal(hash(source),mounts[name].sha256);
}
const material=require(path.join(archive,'remaining-special','wage','wage-material.json'));
assert.equal(hash(path.join(workspace,'services/api/src/database/wage-statement-constraints.spec.ts')),material.originalSpecSha256);
JS
cp "$archive_wage/wage.cjs" "$work/wage.cjs"
patch --batch --forward --fuzz=0 --silent "$work/wage.cjs" "$plan/remaining-wage-runner.patch"
chmod 0644 "$work/wage.cjs"

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
  --mount "type=bind,src=$plan/remaining-wage-entry.cjs,dst=/qualification/remaining-wage-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode"
args+=(--mount "type=bind,src=$work/wage.cjs,dst=/qualification/wage.cjs,readonly"
  --mount "type=bind,src=$archive_wage/wage-material.json,dst=/qualification/wage-material.json,readonly"
  --mount "type=bind,src=$archive_wage/wage-statement-constraints.spec.ts,dst=/qualification/workspace/services/api/src/database/wage-statement-constraints.spec.ts,readonly")

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/remaining-wage-entry.cjs ${mode_args[@]+"${mode_args[@]}"}   > "$work/receipt.json" 2> "$work/private.stderr" || exit_code=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected="REMAINING_WAGE_STATEMENT_"+process.argv[4]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$count"
