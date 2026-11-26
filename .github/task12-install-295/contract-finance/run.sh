#!/bin/bash
set -euo pipefail
umask 077

[[ ( ( $# == 3 || ( $# == 4 && $4 == --host-only ) ) &&
  ( ${2-} == --historical-settlement-334 || ${2-} == --expense-witness-346 ) &&
  $3 == a187dc73a133114e1cfbbc891a4aec923abe2545 ) ||
  $# == 1 || ( $# == 3 && $2 == --current-320 && $3 =~ ^[a-f0-9]{40}$ ) ||
  ( ( ${2-} == --text-direct-330 || ${2-} == --payment-remainder-331 || ${2-} == --upward-archive-332 ) && ( $# == 2 ||
    ( $# == 3 && ( $3 == --host-only || $3 =~ ^[a-f0-9]{40}$ ) ) ||
    ( $# == 4 && $3 =~ ^[a-f0-9]{40}$ && $4 == --host-only ) ) ) ]] || exit 64
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance.XXXXXXXX")
predecessor_worktree=
remove_predecessor() {
  if [[ -n $predecessor_worktree ]]; then
    git -C "$root" worktree remove "$predecessor_worktree"
  fi
}
prepare_predecessor() {
  local predecessor=$1
  git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
  git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
  predecessor_worktree="$work/predecessor"
  bash "$plan/prepare.sh" "$predecessor_worktree" "$predecessor" "$work/predecessor-source"
}
mode=${2-}
restore_predecessor=
if [[ $mode == --text-direct-330 || $mode == --payment-remainder-331 || $mode == --upward-archive-332 ||
  $mode == --historical-settlement-334 || $mode == --expense-witness-346 ]]; then
  [[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
  plan_status=$(git -C "$root" status --porcelain --untracked-files=all -- "$plan")
  [[ -z $plan_status ]] || exit 65
  bash "$plan/prepare.sh" "$root" "$sha" "$work/source" "$mode"
  if [[ ${3-} =~ ^[a-f0-9]{40}$ ]]; then
    restore_predecessor=$3
    trap 'remove_predecessor' EXIT
    prepare_predecessor "$restore_predecessor"
  fi
  if [[ ${3-} == --host-only || ${4-} == --host-only ]]; then
    if [[ $mode == --historical-settlement-334 || $mode == --expense-witness-346 ]]; then
      export RUNNER_TEMP="$work"
      bash "$plan/run-bank-restore.sh" "$work/source" "$sha" --host-only bank "$mode" --host-only
      bash "$plan/run-bank-restore.sh" "$work/predecessor-source" "$restore_predecessor" --host-only restore "$mode" "$work/source" --host-only
      if [[ $mode == --expense-witness-346 ]]; then
        bash "$plan/run-core-payment.sh" "$work/source" "$sha" --host-only core "$mode"
        bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" --host-only --host-only
      else
        bash "$plan/run-core-payment.sh" "$work/source" "$sha" --host-only core
        bash "$plan/run-core-payment.sh" "$work/source" "$sha" --host-only payment
      fi
      exit 0
    fi
    node - "$plan" "$work/source/source.json" "$sha" <<'JS'
const [plan,file,sha]=process.argv.slice(2);
const source=require(file);
const profile=source.mode+'-profile.cjs';
require(plan+'/'+profile).assertSource(source,sha,require(plan+'/common/multi-witness.cjs').final);
JS
    workspace="$work/source/prepared/context/workspace"
    python3 "$plan/stage-overlays.py" "$workspace" "$work/bank" bank "$mode"
    bash "$plan/stage-core-payment.sh" "$workspace" "$work/core-payment" "${mode#--}"
    if [[ -n $restore_predecessor ]]; then
      bash "$plan/run-bank-restore.sh" "$work/predecessor-source" "$restore_predecessor" "$work/restore" \
        restore "$mode" "$work/source" --host-only
    else
      node "$plan/text-direct-330-host-receipt.cjs" "$work" "$plan"
    fi
    exit 0
  fi
fi
source "$plan/local-build-images.sh"
qualification_image_scope "$work"
cleanup() {
  local status=$1
  remove_predecessor || { [[ $status != 0 ]] || status=1; }
  qualification_image_exit "$status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $mode == --text-direct-330 || $mode == --payment-remainder-331 || $mode == --upward-archive-332 ||
  $mode == --historical-settlement-334 || $mode == --expense-witness-346 ]]; then
  bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
  if [[ -n $restore_predecessor ]]; then
    bash "$plan/build.sh" "$work/predecessor-source" "$restore_predecessor" restore "$work/restore"
  fi
  bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank "$mode"
  if [[ -n $restore_predecessor ]]; then
    bash "$plan/run-bank-restore.sh" "$work/predecessor-source" "$restore_predecessor" "$work/restore" \
      restore "$mode" "$work/source"
  else
    printf 'CONTRACT_FINANCE_%s_RESTORE_PREDECESSOR_NOT_SUPPLIED\n' "${mode##*-}"
  fi
  if [[ $mode == --expense-witness-346 ]]; then
    bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core "$mode"
    bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work/browser"
  else
    bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core
    bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" payment
  fi
  exit 0
fi

if [[ $# == 3 ]]; then
  predecessor=$3
  bash "$plan/prepare.sh" "$root" "$sha" "$work/source" --current-320
  prepare_predecessor "$predecessor"
  bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
  bash "$plan/build.sh" "$work/predecessor-source" "$predecessor" restore "$work/restore"
  bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank --current-320
  bash "$plan/run-bank-restore.sh" "$work/predecessor-source" "$predecessor" "$work/restore" restore --current-320 "$work/source"
  bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core
  bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" payment
  exit 0
fi

bash "$plan/prepare.sh" "$root" "$sha" "$work/source"
bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
bash "$plan/build.sh" "$work/source" "$sha" restore "$work/restore"
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/restore" restore
bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core
bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" payment
