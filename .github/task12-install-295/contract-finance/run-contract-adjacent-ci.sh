#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 2 || ( $# == 3 && $3 == --current-320 && $2 != pol275 ) ||
  ( $# == 4 && $2 == pol275 && $3 == --current-320 && $4 =~ ^[a-f0-9]{40}$ ) ]] || exit 64
sha=$1
lane=$2
mode_args=()
if (( $# >= 3 )); then
  case "$lane" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|cash-handover|principal-return|payment-execution|task398-standard|expense-execution|expense-finance|expense-receipt|company-proxy|onboarding|procurement|pfq|browser-partial|browser-completion|pol115-workbench|pol275) mode_args=(--current-320) ;; *) exit 64;; esac
fi
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent.XXXXXXXX")
bash "$plan/prepare.sh" "$root" "$sha" "$work/source" ${mode_args[@]+"${mode_args[@]}"}
profile=browser
case "$lane" in pol115-workbench|onboarding|procurement) profile=mobile ;; esac
bash "$plan/build.sh" "$work/source" "$sha" "$profile" "$work/browser"
case "$lane" in
  task398-standard) bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  cash-handover|principal-return) bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
  expense-execution|expense-finance|expense-receipt) bash "$plan/run-expense.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#expense-}" ;;
  payment-execution) bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  company-proxy) bash "$plan/run-task410-company-proxy.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  browser-partial) bash "$plan/browser-partial/run-browser-partial.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  browser-completion) bash "$plan/browser-completion/run-browser-completion.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  v7|invoice|pol279|pol280) bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol108-core|pol108-facts|pol108-impacts) bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#pol108-}" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol109) bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol115-workbench) bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pfq) bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol275)
    bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"}
    if [[ $# == 4 ]]; then
      predecessor=$4
      git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
      git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
      trap 'git -C "$root" worktree remove "$work/predecessor"' EXIT
      bash "$plan/prepare.sh" "$work/predecessor" "$predecessor" "$work/predecessor-source"
      bash "$plan/build.sh" "$work/predecessor-source" "$predecessor" browser "$work/predecessor-browser"
      bash "$plan/pol275/run-pol275.sh" "$work/predecessor" "$work/predecessor-source" "$predecessor" "$work/predecessor-browser" collision
    else
      bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/browser" collision
    fi
    bash "$plan/pol275/prepare-warm-image.sh" "$root" "$work/source" "$sha" "$work/warm" ${mode_args[@]+"${mode_args[@]}"}
    context_sha=$(cat "$work/warm/context.sha256")
    docker build --platform linux/amd64 --target pol275-warm \
      --file "$work/warm/Dockerfile" --iidfile "$work/warm/image.id" \
      --build-arg "CI_SOURCE_SHA=$sha" --build-arg "CONTEXT_SHA256=$context_sha" "$work/warm/context"
    bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/warm" warm ${mode_args[@]+"${mode_args[@]}"}
    ;;
  onboarding) bash "$plan/onboarding/run-onboarding295.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  procurement)
    for kind in general16 project11; do
      bash "$plan/procurement/run-procurement295.sh" "$root" "$work/source" "$sha" "$work/browser" "$kind" ${mode_args[@]+"${mode_args[@]}"}
    done
    ;;
  *) bash "$plan/run-contract-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ${mode_args[@]+"${mode_args[@]}"} ;;
esac
