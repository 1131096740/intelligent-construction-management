#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 1 || ( $# == 3 && $2 == --current-320 && $3 =~ ^[a-f0-9]{40}$ ) ]] || exit 64
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance.XXXXXXXX")

if [[ $# == 3 ]]; then
  predecessor=$3
  git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
  git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
  trap 'git -C "$root" worktree remove "$work/predecessor"' EXIT

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
