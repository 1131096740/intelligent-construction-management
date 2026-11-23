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
common="$plan/common"
archive="$repo/.github/task12-install-289"
scope=cleanup

node -e '
  const source=require(process.argv[1]);
  const current=source.mode==="current-320";
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==(current?329:295))process.exit(1);
' "$prepared/source.json" "$sha"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
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
  --mount "type=bind,src=$plan/remaining-cleanup-entry.cjs,dst=/qualification/remaining-cleanup-entry.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
args+=(--mount "type=bind,src=$common/installer.cjs,dst=/qualification/installer.cjs,readonly")
node - "$archive" "$prepared/source.json" "$work" > "$work/cleanup-mounts.tsv" <<'JS'
const fs=require('node:fs'), path=require('node:path'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const [archive,sourceFile,work]=process.argv.slice(2);
const current=require(sourceFile).mode==='current-320';
const lifecycle='fixtures/contract-lifecycle-route.spec.ts';
const oldLifecycle='32b015b36b9093f8354281d4807edb4f304eb657902eeb22faa43a3e952f9d1f';
const newLifecycle='9519497389690475b6b87a2b1d3daa13e57dac68951c3b4607e115b6527af48d';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const {cleanup:{mounts}}=require(path.join(archive,'remaining-special.json'));
// Keep the archived runner and registered test inventory unchanged.
const overlays=current?{
  [lifecycle]:{before:oldLifecycle,after:newLifecycle,
    old:'...readMoney, takeoverStatus: "pending_review", submittedAt: expect.any(Date)',
    next:'...readMoney, takeoverStatus: "pending_finance", submittedAt: expect.any(Date)'},
  'fixtures.json':{before:'6af14063a3fd2511d757d1dd527b9dea97f06b8f504696e0e76be10aff2fb9d6',
    after:'5419e2ecaf3eb13c2fe311e80e9a42eee405fd206c25e4e28e8895c3edcc58e0',old:oldLifecycle,next:newLifecycle},
}:{};
assert.ok(Object.keys(overlays).every(file=>Object.hasOwn(mounts,file)));
for(const [file,{target,sha256}] of Object.entries(mounts)){
  if(['entry.cjs','project-profile-original-seed.sql','workspace/services/api/src/database/project-operating-profile-upgrade.spec.ts'].includes(target))continue;
  let source=path.join(archive,'remaining-special','cleanup',file);
  assert.ok(fs.lstatSync(source).isFile());
  const material=fs.readFileSync(source);
  assert.equal(digest(material),sha256);
  if(Object.hasOwn(overlays,file)){
    const overlay=overlays[file];
    assert.equal(sha256,overlay.before);
    const original=material.toString('utf8');
    assert.equal(original.split(overlay.old).length,2);
    const staged=original.replace(overlay.old,overlay.next);
    assert.equal(digest(staged),overlay.after);
    source=path.join(work,path.basename(file));
    fs.writeFileSync(source,staged,{flag:'wx'});
    fs.chmodSync(source,0o644);
  }
  console.log(source+'\t'+target);
}
JS
while IFS=$'\t' read -r source target; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/$target,readonly")
done < "$work/cleanup-mounts.tsv"

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/remaining-cleanup-entry.cjs   > "$work/receipt.json" 2> "$work/private.stderr" || exit_code=$?
[[ ! -s "$work/receipt.json" ]] || cat "$work/receipt.json"
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const count=require(process.argv[4]).migrationCount;
  const expected="REMAINING_RETAINED_CLEANUP_"+count+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[3])process.exit(1);
' "$work/receipt.json" "$scope" "$sha" "$prepared/source.json"
