#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || ( $# == 5 && $5 == --expense-witness-346 ) ||
  ( $# == 6 && $5 == --expense-witness-346 && $6 == --host-only ) ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
archive="$repo/.github/task12-install-289"
scope=cleanup
if [[ ${5:-} == --expense-witness-346 ]]; then
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$archive") ]] || exit 65
  node "$plan/check-ledger.cjs" "$repo" "$sha" "$5" | cmp -s "$prepared/source.json" - || exit 65
fi

node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="expense-witness-346"?346:source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count||
    (count===346)!==(process.argv[7]==="--expense-witness-346"))process.exit(1);
  if(count===346) {
    const plan=process.argv[6];
    const api=process.argv[8];
    const profile=require(plan+"/expense-witness-346-profile.cjs");
    profile.assertSource(source,require(process.argv[4]).final);
    require(plan+"/bank/migration-inputs-346.cjs")(api,source,profile);
  }
  if(count===332) require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(count===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan" "${5-}" "$prepared/prepared/context/workspace/services/api"
if [[ ${6-} != --host-only ]]; then
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
upward_mount=()
if [[ ${5-} != --expense-witness-346 ]]; then
  upward_mount=(--mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
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
  --mount "type=bind,src=$plan/remaining-cleanup-entry.cjs,dst=/qualification/remaining-cleanup-entry.cjs,readonly"
  ${upward_mount[@]+"${upward_mount[@]}"})
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
source "$plan/remaining-installer-mounts.sh"
source_mode=$(node -p 'require(process.argv[1]).mode ?? ""' "$prepared/source.json")
append_remaining_installer "$source_mode" retained
if [[ $source_mode == expense-witness-346 ]]; then
  args+=(--mount "type=bind,src=$plan/payment-execution-346.cjs,dst=/qualification/payment-execution-346.cjs,readonly")
fi
node - "$archive" "$prepared/source.json" "$work" "$plan" > "$work/cleanup-mounts.tsv" <<'JS'
const fs=require('node:fs'), path=require('node:path'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{gunzipSync}=require('node:zlib');
const [archive,sourceFile,work,plan]=process.argv.slice(2);
const current=['current-320','text-direct-330','payment-remainder-331','upward-archive-332','historical-settlement-334','expense-witness-346'].includes(require(sourceFile).mode);
const lifecycle='fixtures/contract-lifecycle-route.spec.ts';
const aggregate='fixtures/contract-draft-aggregate-concurrency.spec.ts';
const oldLifecycle='32b015b36b9093f8354281d4807edb4f304eb657902eeb22faa43a3e952f9d1f';
const newLifecycle='568c71d1620eb7fb62cbd5bfadb1644f4dcd215adeeb497a2790cd4eec16a445';
const oldAggregate='1997a922aabf03503e7c628bcf33666bf298937ef52bfd105d4c47ce35fd3ce4';
const newAggregate='1b6e0b8fb7cc61958b1b7b5eb6845bc62fc813a5168a374fabe9ecf5fd4fd65c';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const {cleanup:{mounts}}=require(path.join(archive,'remaining-special.json'));
// Keep the archived runner and registered test inventory unchanged.
const overlays=current?{
  [lifecycle]:{before:oldLifecycle,after:newLifecycle,patch:'remaining-cleanup-lifecycle-current.patch.gz',
    patchSha256:'217f7ac8eaa1923cae2ea5ae74a6d59338cc4cf972a6511b4622429f8704128b'},
  [aggregate]:{before:oldAggregate,after:newAggregate,
    old:'      expect(saved.draftOperationAvailableActions).not.toContain("submit_contract_draft");',
    next:`      expect(saved.draftOperationAvailableActions).toContain("submit_contract_draft");
      expect(saved.readiness.ready).toBe(false);
      await expect(client.approvalInstance.count({ where: { businessId: ids.version } })).resolves.toBe(0);`},
  'remaining-retained.cjs':{before:'7b6ae487f0a3d6d020ca77227c18b3b774762519952f4415edb91eec49e9a76e',
    after:'ae442e062e0e4ca27cc769cae0c5d6aaf114e1e2eb46cc63cdf02a595f0c02e1',
    old:'      failedOrMissing:results.flatMap(x=>x.passed?[]:[x.ordinal])};',
    next:String.raw`      failedOrMissing:results.flatMap(x=>x.passed?[]:[x.ordinal]),
      failureDetails:results.filter(x=>!x.passed).flatMap(({ordinal})=>{
        const title=spec.registered[ordinal-1].title;
        const error=assertions.find(test=>test.title===title)?.failureMessages?.join("\n")??"";
        const frames=[...error.matchAll(/\b(?:contract-draft-aggregate-concurrency|contract-lifecycle-route)\.spec\.ts:(\d+):(\d+)/gu)]
          .slice(0,2).map(frame=>[Number(frame[1]),Number(frame[2])]);
        const pair=/Expected:\s*([1-5][0-9]{2})[\s\S]{0,95}Received:\s*([1-5][0-9]{2})/u.exec(error);
        const prisma=/\bP[0-9]{4}\b/u.exec(error)?.[0];
        const sqlstate=/(?:SQLSTATE\s+|SqlState\(E)([0-9A-Z]{5})\b/u.exec(error)?.[1];
        return frames.length||pair||prisma||sqlstate?[{ordinal,frames,statuses:pair?.slice(1).map(Number),prisma,sqlstate}]:[];
      })};`},
  'fixtures.json':{before:'6af14063a3fd2511d757d1dd527b9dea97f06b8f504696e0e76be10aff2fb9d6',
    after:'e398024eaa553a532d868c8e927269b0d662c2be77b782faa0cdbf402d2ed5ec',old:oldLifecycle,next:newLifecycle,extra:[oldAggregate,newAggregate]},
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
    source=path.join(work,path.basename(file));
    if(overlay.patch){
      const patch=gunzipSync(fs.readFileSync(path.join(plan,overlay.patch)));
      assert.equal(digest(patch),overlay.patchSha256);
      fs.writeFileSync(source,material,{flag:'wx'});
      assert.equal(spawnSync('patch',['--batch','--fuzz=0','--silent',source],{input:patch}).status,0);
    }else{
      let staged=material.toString('utf8');
      for(const [old,next] of [[overlay.old,overlay.next],...(overlay.extra?[overlay.extra]:[])]){
        assert.equal(staged.split(old).length,2);
        staged=staged.replace(old,next);
      }
      fs.writeFileSync(source,staged,{flag:'wx'});
    }
    assert.equal(digest(fs.readFileSync(source)),overlay.after);
    fs.chmodSync(source,0o644);
  }
  console.log(source+'\t'+target);
}
JS
while IFS=$'\t' read -r source target; do
  args+=(--mount "type=bind,src=$source,dst=/qualification/$target,readonly")
done < "$work/cleanup-mounts.tsv"

if [[ ${6-} == --host-only ]]; then
  node --check "$work/installer.cjs"
  node --check "$plan/remaining-cleanup-entry.cjs"
  printf 'REMAINING_RETAINED_CLEANUP_346_HOST_READY sha=%s material=%s\n' "$sha" "$work"
  exit 0
fi

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
