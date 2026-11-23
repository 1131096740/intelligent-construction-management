#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 4 || ( $# == 5 && $4 == bank && $5 == --current-320 ) ||
  ( $# == 6 && $4 == restore && $5 == --current-320 ) ]] || exit 64

prepared=$(cd "$1" && pwd -P)
sha=$2
image_dir=$(cd "$3" && pwd -P)
lane=$4
mode=${5-}
bank_args=()
if [[ $lane == bank && $mode == --current-320 ]]; then bank_args=(--current-320); fi
restore_args=()
restore_source=()
if [[ $lane == restore && $mode == --current-320 ]]; then
  current_prepared=$(cd "$6" && pwd -P)
  restore_args=(--current-320)
  restore_source=("$current_prepared/source.json")
fi
plan=$(cd "$(dirname "$0")" && pwd -P)
case "$lane" in
  bank) pids=128; memory=1g; entry=named-bank-ci.cjs;;
  restore) pids=256; memory=4g; entry=run.cjs;;
  *) exit 64;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
image=$(cat "$image_dir/image.id")
context_sha=$(cat "$image_dir/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $context_sha =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $context_sha" ]] || exit 65
node - "$prepared/source.json" "$sha" "$plan" ${bank_args[@]+"${bank_args[@]}"} <<'JS'
const [source,sha,plan,mode]=process.argv.slice(2);
const candidate=require(source),m=require(plan+'/common/multi-witness.cjs');
if(candidate.sourceSha!==sha)process.exit(65);
if(mode==='--current-320') {
  if(candidate.mode!=='current-320'||candidate.migrationCount!==328||candidate.predecessor?.migrationCount!==295||
      candidate.predecessor.ledgerSha256!==m.final||candidate.tails.length!==33||
      typeof candidate.sourceTree!=='string'||!/^[0-9a-f]{40}$/u.test(candidate.sourceTree)||
      candidate.ledgerSha256!=='afe91cc0887a53d0cf630f28f8619172362c8199c69a4678e971f2435f557891')process.exit(65);
} else if(candidate.migrationCount!==295||candidate.ledgerSha256!==m.final) process.exit(65);
JS
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
out=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance-$lane.XXXXXXXX")
printf '%s\n' "$out"
overlay="$out/overlay"
python3 "$plan/stage-overlays.py" "$prepared/prepared/context/workspace" "$overlay" "$lane" ${bank_args[@]+"${bank_args[@]}"}

mounts=()
readonly_mount(){
  [[ ( -f $1 || -d $1 ) && ! -L $1 ]] || exit 65
  mounts+=(--mount "type=bind,src=$1,dst=$2,readonly")
}
mount_tree(){
  local directory=$1 target=$2 file
  while IFS= read -r -d '' file; do
    readonly_mount "$file" "$target/${file#"$directory/"}"
  done < <(find "$directory" -type f -print0)
}
readonly_mount "$prepared/prepared/product/predecessor" /qualification/product289
readonly_mount "$prepared/prepared/product/intermediate" /qualification/product
readonly_mount "$prepared/prepared/product/successor.sql" /qualification/successor.sql
readonly_mount "$prepared/source.json" /qualification/hosted-source.json
readonly_mount "$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql" /qualification/terminal.sql
readonly_mount "$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql" /qualification/payout-terminal.sql
readonly_mount "$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql" /qualification/multi-witness.sql
mount_tree "$plan/common" /qualification
if [[ $lane == bank ]]; then
  for file in named-bank-ci.cjs original-titles.json failure-projection.cjs; do
    readonly_mount "$plan/bank/$file" "/qualification/$file"
  done
  readonly_mount "$overlay/bank/execution-files.json" /qualification/execution-files.json
  mount_tree "$overlay/bank/overlay" /qualification/workspace
else
  for file in run.cjs backup-fixture.cjs settlement-history.cjs restore.cjs archive-contract.cjs restore-profile.cjs forward-320-inventory.json restore-diagnostic.cjs named-data.cjs technical-relations.json backup-original.sql business-readback.cjs approval-round-catalog.cjs controlled-correction.cjs verify-behavior.cjs combined294-source.json; do
    readonly_mount "$plan/restore/$file" "/qualification/$file"
  done
  node - "$out/committed-admission.json" "$sha" "$plan/restore/combined294-source.json" <<'JS'
const [file,head,source]=process.argv.slice(2);
const {ledgerSha256:ledger294}=require(source);
require('node:fs').writeFileSync(file,JSON.stringify({status:'FINANCE294_COMMITTED_MIGRATION_INPUTS_ADMITTED_OFFLINE',head,ledger294}),
  {flag:'wx',mode:0o644});
JS
  chmod 0644 "$out/committed-admission.json"
  readonly_mount "$out/committed-admission.json" /qualification/committed-admission.json
  if [[ $mode == --current-320 ]]; then
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
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m "${mounts[@]}" \
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
const count=sourceMode==='--current-320'?328:295;
const result=mode==='preflight'?'DIAGNOSTIC_NO_DATABASE_PREFLIGHT_PASSED':'ORIGINAL_FULL_12_PASSED';
const expected='BANK_'+count+'_'+result;
require('node:fs').writeFileSync(receipt,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
if(r.candidateSha!==sha||r.status!==expected)process.exit(1);
JS
  fi
  if (( status != 0 || proof_status != 0 )) && [[ -s $out/$mode.json ]]; then
    node - "$out/$mode.json" >&2 <<'JS' || true
const {failure}=require(process.argv[2]);
const result={};
for (const field of ['stage','code','sqlstate','prismaCode']) {
  if (typeof failure?.[field]==='string' && /^[A-Z0-9_]{1,96}$/.test(failure[field])) {
    result[field]=failure[field];
  }
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
