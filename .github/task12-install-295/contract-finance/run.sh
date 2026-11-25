#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 1 || ( $# == 3 && $2 == --current-320 && $3 =~ ^[a-f0-9]{40}$ ) ||
  ( ${2-} == --text-direct-330 && ( $# == 2 || ( $# == 3 && $3 == --host-only ) ) ) ]] || exit 64
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance.XXXXXXXX")
if [[ ${2-} == --text-direct-330 ]]; then
  [[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$root" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$root" status --porcelain --untracked-files=all -- "$plan") ]] || exit 65
  bash "$plan/prepare.sh" "$root" "$sha" "$work/source" --text-direct-330
  if [[ ${3-} == --host-only ]]; then
    node - "$plan" "$work/source/source.json" "$sha" <<'JS'
const [plan,file,sha]=process.argv.slice(2);
const source=require(file);
require(plan+'/text-direct-330-profile.cjs').assertSource(source,sha,require(plan+'/common/multi-witness.cjs').final);
JS
    workspace="$work/source/prepared/context/workspace"
    python3 "$plan/stage-overlays.py" "$workspace" "$work/bank" bank --text-direct-330
    bash "$plan/stage-core-payment.sh" "$workspace" "$work/core-payment" text-direct-330
    node "$plan/text-direct-330-host-receipt.cjs" "$work" "$plan"
    exit 0
  fi
fi
source "$plan/local-build-images.sh"
qualification_image_scope "$work"
predecessor_worktree=
cleanup() {
  local status=$1
  if [[ -n $predecessor_worktree ]]; then
    git -C "$root" worktree remove "$predecessor_worktree" || { [[ $status != 0 ]] || status=1; }
  fi
  qualification_image_exit "$status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ${2-} == --text-direct-330 ]]; then
  bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
  bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank --text-direct-330
  bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core
  bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" payment
  printf '%s\n' 'CONTRACT_FINANCE_330_RESTORE_UNAVAILABLE'
  exit 0
fi

if [[ $# == 3 ]]; then
  predecessor=$3
  git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
  git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
  predecessor_worktree="$work/predecessor"

  bash "$plan/prepare.sh" "$root" "$sha" "$work/source" --current-320
  bash "$plan/prepare.sh" "$work/predecessor" "$predecessor" "$work/predecessor-source"
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
