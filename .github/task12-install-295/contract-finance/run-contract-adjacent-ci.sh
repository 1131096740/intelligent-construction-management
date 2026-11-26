#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 2 || ( $# == 3 && ( $3 == --current-320 || $3 == --text-direct-330 ) && $2 != pol275 ) ||
  ( $# == 3 && $3 == --payment-remainder-331 && $2 != pol275 ) ||
  ( $# == 3 && $3 == --historical-settlement-334 && ( $2 == settlement || $2 == template || $2 == draft ||
    $2 == task398-standard || $2 == cash-handover || $2 == principal-return ||
    $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt || $2 == payment-execution ||
    $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts ) ) ||
  ( $# == 3 && $3 == --upward-archive-332 && ( $2 == line-a || $2 == pol115-workbench || $2 == onboarding || $2 == procurement || $2 == cash-handover || $2 == principal-return ||
    $2 == settlement || $2 == template || $2 == draft || $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 || $2 == company-proxy || $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt || $2 == payment-execution ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts || $2 == pol109 || $2 == task398-standard || $2 == task398-ledger-loss || $2 == browser-partial || $2 == browser-completion || $2 == pfq || $2 == cash-transfer || $2 == project-advance ) ) ||
  ( $# == 3 && ( $2 == historical-takeover-a28 || $2 == line-a || $2 == onboarding || $2 == procurement || $2 == pol115-workbench || $2 == pol115-full ) && $3 == --historical-settlement-334 ) ||
  ( $# == 4 && $2 == pol275 && ( $3 == --current-320 || $3 == --text-direct-330 || $3 == --payment-remainder-331 || $3 == --upward-archive-332 ) && $4 =~ ^[a-f0-9]{40}$ ) ]] || exit 64
sha=$1
lane=$2
mode_args=()
if (( $# >= 3 )); then
  case "$lane" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|cash-handover|principal-return|payment-execution|task398-standard|task398-ledger-loss|expense-execution|expense-finance|expense-receipt|company-proxy|onboarding|procurement|pfq|browser-partial|browser-completion|pol115-workbench|pol115-full|pol275|line-a|cash-transfer|project-advance|historical-takeover-a28) mode_args=("$3") ;; *) exit 64;; esac
fi
if [[ ${3:-} == --text-direct-330 ]]; then
  case "$lane" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|line-a|onboarding|procurement|task398-standard|task398-ledger-loss|cash-handover|principal-return|pol115-workbench|company-proxy|payment-execution|browser-partial|browser-completion|expense-execution|expense-finance|expense-receipt|pfq|pol275) ;; *) exit 64;; esac
fi
if [[ ${3:-} == --payment-remainder-331 ]]; then
  case "$lane" in
    line-a|task398-ledger-loss|task398-standard|company-proxy|browser-partial|browser-completion|cash-handover|principal-return|payment-execution|settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|expense-execution|expense-finance|expense-receipt|pol115-workbench|pfq|onboarding|procurement|pol275) ;;
    *) exit 64 ;;
  esac
fi
if [[ ( $lane == historical-takeover-a28 || $lane == pol115-full ) && ${3:-} != --historical-settlement-334 ]]; then exit 64; fi
if [[ ( $lane == cash-transfer || $lane == project-advance ) && ${3:-} != --upward-archive-332 ]]; then exit 64; fi
if [[ $lane == task398-ledger-loss && ${3:-} != --text-direct-330 && ${3:-} != --payment-remainder-331 && ${3:-} != --upward-archive-332 ]]; then exit 64; fi
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent.XXXXXXXX")
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
bash "$plan/prepare.sh" "$root" "$sha" "$work/source" ${mode_args[@]+"${mode_args[@]}"}
profile=browser
case "$lane" in pol115-workbench|pol115-full|onboarding|procurement) profile=mobile ;; line-a|historical-takeover-a28) profile=api ;; esac
bash "$plan/build.sh" "$work/source" "$sha" "$profile" "$work/browser"
case "$lane" in
  line-a)
    line_a_args=()
    if [[ ${3:-} == --historical-settlement-334 ]]; then line_a_args=(original); fi
    bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser" ${line_a_args[@]+"${line_a_args[@]}"}
    ;;
  historical-takeover-a28) bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser" ;;
  task398-ledger-loss)
    variant=ledger-loss-330
    case "$3" in
      --payment-remainder-331) variant=ledger-loss-331 ;;
      --upward-archive-332) variant=ledger-loss-332 ;;
    esac
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" "$variant" ;;
  task398-standard)
    if [[ ${3:-} == --text-direct-330 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-330
    elif [[ ${3:-} == --payment-remainder-331 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-331
    elif [[ ${3:-} == --upward-archive-332 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-332
    elif [[ ${3:-} == --historical-settlement-334 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-334
    fi
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser"
    ;;
  cash-handover|principal-return|cash-transfer|project-advance) bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
  expense-execution|expense-finance|expense-receipt) bash "$plan/run-expense.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#expense-}" ;;
  payment-execution) bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  company-proxy) bash "$plan/run-task410-company-proxy.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  browser-partial) bash "$plan/browser-partial/run-browser-partial.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  browser-completion) bash "$plan/browser-completion/run-browser-completion.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  v7|invoice|pol279|pol280) bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol108-core|pol108-facts|pol108-impacts) bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#pol108-}" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol109) bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol115-full)
    for scope in pol115 spot; do
      bash "$plan/pol115/run-pol115-334.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope"
    done
    bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" --historical-settlement-334
    ;;
  pol115-workbench) bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pfq) bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol275)
    bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"}
    if [[ $# == 4 ]]; then
      predecessor=$4
      git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
      git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
      predecessor_worktree="$work/predecessor"
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
      --label "org.jiangkong.contract-finance.source-sha=$sha" \
      --label "org.jiangkong.contract-finance.context-sha256=$context_sha" \
      --label "org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN" "$work/warm/context"
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
