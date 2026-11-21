#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 ]] || exit 64
root=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
lane=profile
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
prior="$root/.github/task12-install-289"
historical="$prior/remaining-special/profile"
finance="$root/.github/task12-install-295/contract-finance"
common="$finance/common"
workspace="$prepared/prepared/context/workspace"
node - "$prepared/source.json" "$sha" "$prior/remaining-special.json" "$historical" "$workspace" "$common/multi-witness.cjs" <<'JS'
const [sourceFile,sha,profilesFile,prior,workspace,terminalFile]=process.argv.slice(2);
const source=require(sourceFile),terminal=require(terminalFile);
if(source.sourceSha!==sha||source.migrationCount!==295||source.ledgerSha256!==terminal.final)process.exit(65);
const pins=require(profilesFile).profile.mounts;
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const name of ['remaining-retained.cjs','fixtures.json','project-profile-original-seed.sql']){
  assert.equal(hash(prior+'/'+name),pins[name].sha256);
}
const original=require(prior+'/fixtures.json').profile;
assert.equal(hash(workspace+'/services/api/'+original.file),original.sha256);
JS
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$finance/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-$lane.XXXXXXXX")
printf '%s  %s\n' '8e69f8328f7e67d07679bdcb8638a5a87f5184805d798f837552392fb69c7623' "$common/installer.cjs" | shasum -a 256 -c >/dev/null
cp "$common/installer.cjs" "$work/installer.cjs"
gzip -dc "$plan/installer-profile.patch.gz" | patch --batch --fuzz=0 --no-backup-if-mismatch "$work/installer.cjs" >/dev/null
printf '%s  %s\n' '9d28b476548760f593d537fd60cb6c75680aadaa4ab1892d3dc108ffcecb4266' "$work/installer.cjs" | shasum -a 256 -c >/dev/null
chmod 0644 "$work/installer.cjs"

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
  --mount "type=bind,src=$plan/profile-entry.cjs,dst=/qualification/profile-entry.cjs,readonly"
  --mount "type=bind,src=$plan/profile-history.cjs,dst=/qualification/profile-history.cjs,readonly"
  --mount "type=bind,src=$work/installer.cjs,dst=/qualification/installer.cjs,readonly")
for file in remaining-retained.cjs fixtures.json project-profile-original-seed.sql; do
  args+=(--mount "type=bind,src=$historical/$file,dst=/qualification/$file,readonly")
done
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done

[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
printf '%s\n' "假设原项目经营档案种子在同一实例从 125 升至 126 并保留到 295。观察 profileHistory、retainedOriginal、combinedAfterBusiness 和 cleanup。" > "$work/hypothesis.txt"
printf '%s\n' "$work"
status=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/profile-entry.cjs \
  > "$work/receipt.json" 2> "$work/private.stderr" || status=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( status == 0 )) || exit "$status"
node - "$work/receipt.json" "$sha" "$lane" <<'JS'
const [file,sha,lane]=process.argv.slice(2);
const r=require(file);
if(r.status!=='REMAINING_PROFILE_WARM_295_PASSED'||r.sourceSha!==sha||r.lane!==lane)process.exit(1);
JS
