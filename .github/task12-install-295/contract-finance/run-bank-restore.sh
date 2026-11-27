#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 4 || ( $# == 5 && $4 == bank && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 || $5 == --expense-witness-346 || $5 == --expense-witness-349 ) ) ||
  ( $# == 6 && $4 == bank && ( $5 == --historical-settlement-334 || $5 == --expense-witness-346 || $5 == --expense-witness-349 ) && $6 == --host-only ) ||
  ( $# == 6 && $4 == restore && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 || $5 == --expense-witness-346 ) ) ||
  ( $# == 7 && $4 == restore && ( $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 || $5 == --historical-settlement-334 || $5 == --expense-witness-346 ) && $7 == --host-only ) ]] || exit 64

prepared=$(cd "$1" && pwd -P)
sha=$2
lane=$4
mode=${5-}
bank_args=()
if [[ $lane == bank && -n $mode ]]; then bank_args=("$mode"); fi
restore_args=()
restore_source=()
if [[ $lane == restore && -n $mode ]]; then
  current_prepared=$(cd "$6" && pwd -P)
  restore_args=("$mode")
  restore_source=("$current_prepared/source.json")
fi
plan=$(cd "$(dirname "$0")" && pwd -P)
case "$lane" in
  bank) pids=128; memory=1g; entry=named-bank-ci.cjs;;
  restore) pids=256; memory=4g; entry=run.cjs;;
  *) exit 64;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
node - "$prepared/source.json" "$sha" "$plan" ${bank_args[@]+"${bank_args[@]}"} <<'JS'
const [source,sha,plan,mode]=process.argv.slice(2);
const candidate=require(source),m=require(plan+'/common/multi-witness.cjs');
if(candidate.sourceSha!==sha)process.exit(65);
if(['--expense-witness-346','--expense-witness-349'].includes(mode)) {
  require(plan+'/'+mode.slice(2)+'-profile.cjs').assertSource(candidate,m.final);
} else if(mode==='--historical-settlement-334') {
  require(plan+'/historical-settlement-334-profile.cjs').assertSource(candidate,m.final);
} else if(mode==='--upward-archive-332') {
  require(plan+'/upward-archive-332-profile.cjs').assertSource(candidate,sha,m.final);
} else if(mode==='--payment-remainder-331') {
  require(plan+'/payment-remainder-331-profile.cjs').assertSource(candidate,sha,m.final);
} else if(mode==='--text-direct-330') {
  require(plan+'/text-direct-330-profile.cjs').assertSource(candidate,sha,m.final);
} else if(mode==='--current-320') {
  if(candidate.mode!=='current-320'||candidate.migrationCount!==329||candidate.predecessor?.migrationCount!==295||
      candidate.predecessor.ledgerSha256!==m.final||candidate.tails.length!==34||
      typeof candidate.sourceTree!=='string'||!/^[0-9a-f]{40}$/u.test(candidate.sourceTree)||
      candidate.ledgerSha256!=='3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2')process.exit(65);
} else if(candidate.migrationCount!==295||candidate.ledgerSha256!==m.final) process.exit(65);
JS
if [[ $lane == bank && $mode == --expense-witness-34[69] ]]; then
  repo=$(git -C "$plan" rev-parse --show-toplevel)
  [[ $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
  node "$plan/check-ledger.cjs" "$repo" "$sha" "$mode" | cmp -s "$prepared/source.json" - || exit 65
  api="$prepared/prepared/context/workspace/services/api"
  git -C "$repo" show "$sha:services/api/prisma/migration-baseline.cjs" | cmp -s "$api/prisma/migration-baseline.cjs" - || exit 65
  node - "$plan" "$api" "$prepared/source.json" "${mode#--}" <<'JS'
const [plan,api,source,mode]=process.argv.slice(2);
require(plan+'/bank/migration-inputs-346.cjs')(api,require(source),require(plan+'/'+mode+'-profile.cjs'));
JS
fi
if [[ $lane == restore && $mode == --expense-witness-346 ]]; then
  repo=$(git -C "$plan" rev-parse --show-toplevel)
  current_sha=$(git -C "$repo" rev-parse HEAD)
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
  node "$plan/check-ledger.cjs" "$repo" "$current_sha" "$mode" | cmp -s "$current_prepared/source.json" - || exit 65
  node - "$plan" "$prepared/source.json" "$current_prepared" <<'JS'
const [plan,oldFile,prepared]=process.argv.slice(2);
const assert=require('node:assert/strict');
const exact=require(plan+'/restore/exact-346.cjs');
const old=require(oldFile),current=require(prepared+'/source.json');
assert.equal(old.sourceSha,exact.fixtureSha,'BACKUP346_PREDECESSOR_SHA');
assert.equal(exact.hash(require('node:fs').readFileSync(oldFile)),exact.fixtureSourceSha256,'BACKUP346_PREDECESSOR_BYTES');
require(plan+'/expense-witness-346-profile.cjs').assertSource(current,old.ledgerSha256);
exact.assertMigrationBytes(prepared+'/prepared/context/workspace/services/api/prisma/migrations',current);
JS
elif [[ $lane == restore && ( $mode == --text-direct-330 || $mode == --payment-remainder-331 || $mode == --upward-archive-332 || $mode == --historical-settlement-334 ) ]]; then
  node - "$prepared/source.json" "$current_prepared/source.json" "$plan" "$mode" <<'JS'
const [oldFile,currentFile,plan,mode]=process.argv.slice(2);
const assert=require('node:assert/strict');
const old=require(oldFile),current=require(currentFile);
assert.equal(current.mode,mode.slice(2));
const profile=require(plan+'/'+current.mode+'-profile.cjs');
if(mode==='--historical-settlement-334') {
  assert.equal(old.sourceSha,'a187dc73a133114e1cfbbc891a4aec923abe2545');
  profile.assertSource(current,old.ledgerSha256);
} else profile.assertSource(current,current.sourceSha,old.ledgerSha256);
assert.notEqual(old.sourceSha,current.sourceSha);
const install={
  'text-direct-330':'withCombined330ContractPaymentForRestore',
  'payment-remainder-331':'withCombined331PaymentRemainderForRestore',
  'upward-archive-332':'withCombined332UpwardArchiveForRestore'
}[current.mode];
if (mode !== '--historical-settlement-334') assert.equal(typeof require(plan+'/common/installer.cjs')[install],'function');
JS
fi
if [[ ${7-} != --host-only && ${6-} != --host-only ]]; then
  image_dir=$(cd "$3" && pwd -P)
  image=$(cat "$image_dir/image.id")
  context_sha=$(cat "$image_dir/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $context_sha =~ ^[a-f0-9]{64}$ ]] || exit 65
  if [[ $mode == --text-direct-330 || $mode == --payment-remainder-331 || $mode == --upward-archive-332 || $mode == --historical-settlement-334 || $mode == --expense-witness-346 ]]; then
    [[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$image_dir/Dockerfile" "$prepared/source.json") == "$context_sha" ]] || exit 65
  fi
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $context_sha" ]] || exit 65
  [[ -z $(docker ps -q) ]] || exit 65
  if pgrep -x postgres >/dev/null; then exit 65; fi
fi
out=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance-$lane.XXXXXXXX")
printf '%s\n' "$out"
overlay="$out/overlay"
python3 "$plan/stage-overlays.py" "$prepared/prepared/context/workspace" "$overlay" "$lane" ${bank_args[@]+"${bank_args[@]}"}
installer="$plan/common/installer.cjs"
if [[ $mode == --historical-settlement-334 || $mode == --expense-witness-34[69] ]]; then
  installer_mode="${mode#--}"
  if [[ $mode == --expense-witness-34[69] ]]; then installer_mode=historical-settlement-334; fi
  if [[ $lane == restore && $mode != --expense-witness-346 ]]; then installer_mode+=-restore; fi
  node "$plan/stage-historical-takeover-333.cjs" "$out" "$installer_mode"
  installer="$out/installer.cjs"
fi
if [[ $mode == --expense-witness-34[69] ]]; then
  git -C "$out" apply --unidiff-zero "$plan/expense-witness/installer.patch"
  if [[ $mode == --expense-witness-349 ]]; then
    git -C "$out" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
  fi
  chmod 0644 "$installer"
  node - "$plan/${mode#--}-profile.cjs" "$installer" <<'JS'
const [profile,installer]=process.argv.slice(2);
const bytes=require('node:fs').readFileSync(installer);
require('node:assert/strict').equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
  require(profile).installerSha256,'BANK_346_INSTALLER_SHA');
JS
fi
if [[ $lane == restore && $mode == --expense-witness-346 ]]; then
  cat "$plan/restore/installer-346-tail.cjs" >> "$installer"
  node - "$plan/restore/exact-346.cjs" "$installer" <<'JS'
const [module,installer]=process.argv.slice(2);
const {hash,installerSha256}=require(module);
require('node:assert/strict').equal(hash(require('node:fs').readFileSync(installer)),installerSha256,'BACKUP346_INSTALLER_SHA');
JS
fi
if [[ $lane == bank && ${6-} == --host-only ]]; then
  count=334
  if [[ $mode == --expense-witness-34[69] ]]; then count="${mode##*-}"; fi
  printf 'BANK_%s_HOST_READY sha=%s\n' "$count" "$sha"
  exit 0
fi
if [[ ${7-} == --host-only ]]; then
  node - "$out" "$prepared/source.json" "$current_prepared/source.json" "$plan" "$installer" <<'JS'
const [out,oldFile,currentFile,plan,installer]=process.argv.slice(2);
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const old=require(oldFile),current=require(currentFile);
const profile=current.mode+'-profile.cjs';
const receipt={status:'BACKUP'+current.migrationCount+'_HOST_INPUTS_VERIFIED',candidateSha:current.sourceSha,candidateTree:current.sourceTree,
  migrationCount:current.migrationCount,ledgerSha256:current.ledgerSha256,
  ...(current.mode==='upward-archive-332'?{predecessor331:current.predecessor331}:{}),
  ...(current.mode==='historical-settlement-334'?{
    predecessor332:current.predecessor332,predecessor333:current.predecessor333,installerSha256:hash(installer)
  }:{}),
  ...(current.mode==='expense-witness-346'?{
    predecessor334:current.predecessor334,installerSha256:hash(installer),
    canonicalInstallerSha256:require(plan+'/'+profile).installerSha256,
    exactRestoreSha256:hash(plan+'/restore/exact-346.cjs')
  }:{}),
  fixturePredecessorSha:old.sourceSha,fixturePredecessorSourceSha256:hash(oldFile),candidateSourceSha256:hash(currentFile),
  appInputsSha256:hash(out+'/overlay/restore/app-inputs.json'),
  relocatedLoanSha256:hash(out+'/overlay/restore/loan-relocated-manifest.json'),
  wrappers:Object.fromEntries(['run.sh','run-bank-restore.sh','common/installer.cjs',profile,'restore/run.cjs',
    'restore/backup-fixture.cjs','restore/restore.cjs','restore/restore-profile.cjs','restore/settlement-history.cjs',
    'restore/text-direct-330.cjs','restore/extract-receipt.cjs'].map(relative=>[relative,hash(plan+'/'+relative)])),
  database:'NOT_STARTED'};
const file=out+'/host-restore-receipt.json';
writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:file,sha256:hash(file),...receipt}));
JS
  exit 0
fi

mounts=()
bank_env=()
readonly_mount(){
  [[ ( -f $1 || -d $1 ) && ! -L $1 ]] || exit 65
  mounts+=(--mount "type=bind,src=$1,dst=$2,readonly")
}
mount_tree(){
  local directory=$1 target=$2 replacement_installer=${3-} file
  while IFS= read -r -d '' file; do
    if [[ -n $replacement_installer && $file == "$directory/installer.cjs" ]]; then
      readonly_mount "$replacement_installer" "$target/installer.cjs"
    else
      readonly_mount "$file" "$target/${file#"$directory/"}"
    fi
  done < <(find "$directory" -type f -print0)
}
readonly_mount "$prepared/prepared/product/predecessor" /qualification/product289
readonly_mount "$prepared/prepared/product/intermediate" /qualification/product
readonly_mount "$prepared/prepared/product/successor.sql" /qualification/successor.sql
readonly_mount "$prepared/source.json" /qualification/hosted-source.json
readonly_mount "$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql" /qualification/terminal.sql
readonly_mount "$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql" /qualification/payout-terminal.sql
readonly_mount "$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql" /qualification/multi-witness.sql
mount_tree "$plan/common" /qualification "$installer"
if [[ $lane == bank ]]; then
  for file in named-bank-ci.cjs original-titles.json failure-projection.cjs; do
    readonly_mount "$plan/bank/$file" "/qualification/$file"
  done
  if [[ $mode == --expense-witness-34[69] ]]; then
    for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
      readonly_mount "$plan/$profile" "/qualification/$profile"
    done
    bank_env=(--env "JG_BANK_SOURCE_SHA=$sha")
    count="${mode##*-}"
    if [[ $count == 349 ]]; then
      readonly_mount "$plan/expense-witness-349-profile.cjs" /qualification/expense-witness-349-profile.cjs
    fi
    readonly_mount "$plan/bank/staging-$count.json" "/qualification/bank-staging-$count.json"
    readonly_mount "$plan/bank/migration-inputs-346.cjs" /qualification/migration-inputs-346.cjs
  elif [[ $mode == --historical-settlement-334 ]]; then
    for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs; do
      readonly_mount "$plan/$profile" "/qualification/$profile"
    done
    readonly_mount "$plan/bank/staging-334.json" /qualification/bank-staging-334.json
  elif [[ $mode == --upward-archive-332 ]]; then
    readonly_mount "$plan/upward-archive-332-profile.cjs" /qualification/upward-archive-332-profile.cjs
    readonly_mount "$plan/bank/staging-332.json" /qualification/bank-staging-332.json
  elif [[ $mode == --payment-remainder-331 ]]; then
    readonly_mount "$plan/payment-remainder-331-profile.cjs" /qualification/payment-remainder-331-profile.cjs
    readonly_mount "$plan/bank/staging-331.json" /qualification/bank-staging-331.json
  elif [[ $mode == --text-direct-330 ]]; then
    readonly_mount "$plan/text-direct-330-profile.cjs" /qualification/text-direct-330-profile.cjs
    readonly_mount "$plan/bank/staging-330.json" /qualification/bank-staging-330.json
  fi
  readonly_mount "$overlay/bank/execution-files.json" /qualification/execution-files.json
  mount_tree "$overlay/bank/overlay" /qualification/workspace
else
  for file in run.cjs backup-fixture.cjs settlement-history.cjs restore.cjs archive-contract.cjs restore-profile.cjs forward-320-inventory.json restore-diagnostic.cjs named-data.cjs text-direct-330.cjs technical-relations.json backup-original.sql business-readback.cjs approval-round-catalog.cjs controlled-correction.cjs verify-behavior.cjs combined294-source.json; do
    readonly_mount "$plan/restore/$file" "/qualification/$file"
  done
  node - "$out/committed-admission.json" "$sha" "$plan/restore/combined294-source.json" "$mode" "$prepared/source.json" ${restore_source[@]+"${restore_source[@]}"} <<'JS'
const [file,head,source,mode,predecessorSource,currentSource]=process.argv.slice(2);
const {ledgerSha256:ledger294}=require(source);
const fs=require('node:fs');
const hash=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const predecessorSourceSha256=['--text-direct-330','--payment-remainder-331','--upward-archive-332','--historical-settlement-334','--expense-witness-346'].includes(mode)
  ? hash(predecessorSource)
  : undefined;
const current=mode==='--expense-witness-346'?{currentSha:require(currentSource).sourceSha,currentSourceSha256:hash(currentSource)}:{};
fs.writeFileSync(file,JSON.stringify({status:'FINANCE294_COMMITTED_MIGRATION_INPUTS_ADMITTED_OFFLINE',head,ledger294,predecessorSourceSha256,...current}),
  {flag:'wx',mode:0o644});
JS
  chmod 0644 "$out/committed-admission.json"
  readonly_mount "$out/committed-admission.json" /qualification/committed-admission.json
  case "$mode" in
    --expense-witness-346)
      for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
        readonly_mount "$plan/$profile" "/qualification/$profile"
      done
      readonly_mount "$plan/restore/exact-346.cjs" /qualification/exact-346.cjs
      ;;
    --historical-settlement-334)
      for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs upward-archive-332-profile.cjs; do
        readonly_mount "$plan/$profile" "/qualification/$profile"
      done
      ;;
    --text-direct-330) readonly_mount "$plan/text-direct-330-profile.cjs" /qualification/text-direct-330-profile.cjs ;;
    --payment-remainder-331) readonly_mount "$plan/payment-remainder-331-profile.cjs" /qualification/payment-remainder-331-profile.cjs ;;
    --upward-archive-332) readonly_mount "$plan/upward-archive-332-profile.cjs" /qualification/upward-archive-332-profile.cjs ;;
  esac
  if [[ -n $mode ]]; then
    readonly_mount "$current_prepared/source.json" /qualification/current320-source.json
    readonly_mount "$current_prepared/prepared/context/workspace/services/api/prisma/migrations" /qualification/current320/migrations
  fi
  readonly_mount "$overlay/restore/app-inputs.json" /qualification/app-inputs.json
  readonly_mount "$overlay/restore/loan-relocated-manifest.json" /qualification/loan-relocated-manifest.json
  readonly_mount "$overlay/restore/named-roles" /qualification/named-roles
  mount_tree "$overlay/restore/correction" /qualification/workspace
  mount_tree "$overlay/restore/loan" /qualification/loan-workspace
fi

run(){
  docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user postgres --init --pids-limit "$pids" --memory "$memory" \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m "${mounts[@]}" ${bank_env[@]+"${bank_env[@]}"} \
    --entrypoint node "$image" "/qualification/$entry" "$@"
}
capture(){
  local mode=$1 status=0 proof_status=0
  shift
  run ${bank_args[@]+"${bank_args[@]}"} ${restore_args[@]+"${restore_args[@]}"} "$@" > "$out/$mode.stdout" 2> "$out/$mode.stderr" || status=$?
  if [[ $lane == restore ]]; then
    node "$plan/restore/extract-receipt.cjs" "--$mode" "$out/$mode.stdout" "$out/$mode.json" "$status" "$out/committed-admission.json" ${restore_source[@]+"${restore_source[@]}"} || proof_status=$?
  else
    node - "$out/$mode.stdout" "$out/$mode.json" "$mode" "$sha" ${bank_args[@]+"${bank_args[@]}"} <<'JS' || proof_status=$?
const [file,receipt,mode,sha,sourceMode]=process.argv.slice(2);
const r=JSON.parse(require('node:fs').readFileSync(file,'utf8').trimEnd().split('\n').at(-1));
const count=sourceMode==='--expense-witness-349'?349:sourceMode==='--expense-witness-346'?346:sourceMode==='--historical-settlement-334'?334:sourceMode==='--upward-archive-332'?332:sourceMode==='--payment-remainder-331'?331:sourceMode==='--text-direct-330'?330:sourceMode==='--current-320'?329:295;
const result=mode==='preflight'?'DIAGNOSTIC_NO_DATABASE_PREFLIGHT_PASSED':'ORIGINAL_FULL_12_PASSED';
const expected='BANK_'+count+'_'+result;
require('node:fs').writeFileSync(receipt,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
if(r.candidateSha!==sha||r.status!==expected)process.exit(1);
JS
  fi
  if (( status != 0 || proof_status != 0 )) && [[ -s $out/$mode.json ]]; then
    node - "$out/$mode.json" >&2 <<'JS' || true
const {failure, forwardFailedLedger, namedBank}=require(process.argv[2]);
const result={};
for (const field of ['stage','code','sqlstate','prismaCode']) {
  if (typeof failure?.[field]==='string' && /^[A-Z0-9_]{1,96}$/.test(failure[field])) {
    result[field]=failure[field];
  }
}
if (result.code==='BANK_295_ORIGINAL_SUITE_FAILED' && Array.isArray(namedBank?.failures?.failed)) {
  result.bank=namedBank.failures;
}
if (result.stage==='INSTALL_320_CONTRACT_DETAIL_READERS' && Array.isArray(forwardFailedLedger)) {
  const migrations=forwardFailedLedger.filter(row=>row?.finished===false && row.rolledBack===false &&
    typeof row.name==='string' && /^\d{14}_[a-z0-9_]{1,100}$/u.test(row.name))
    .map(({name, sqlstate})=>typeof sqlstate==='string' && /^[A-Z0-9]{5}$/u.test(sqlstate)?{name,sqlstate}:{name});
  if (migrations.length) result.migrations=migrations;
}
if (Object.keys(result).length) {
  process.stderr.write('CONTRACT_FINANCE_FAILURE_RECEIPT '+JSON.stringify(result)+'\n');
}
JS
  fi
  if (( status != 0 )); then
    printf 'CONTRACT_FINANCE_CONTAINER_FAILED lane=%s phase=%s status=%d\n' "$lane" "$mode" "$status" >&2
    # Node can fail before a receipt exists. Print the error class only.
    grep -m1 -oE "code: '(EACCES|EPERM|ENOENT|MODULE_NOT_FOUND)'" "$out/$mode.stderr" >&2 || true
    return "$status"
  fi
  return "$proof_status"
}
capture preflight --preflight
case "$lane" in
  bank) hypothesis='原 12 个具名银行场景在最终 SHA 上均通过，双归还见证和角色按原契约清理。';;
  restore) hypothesis='具名角色在同一独占集群恢复完整业务数据并撤回临时权限，保留四类历史读回。';;
esac
printf '%s\n' "$hypothesis" > "$out/hypothesis.txt"
capture once
