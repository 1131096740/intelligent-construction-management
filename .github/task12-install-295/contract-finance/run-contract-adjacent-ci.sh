#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 2 ]] || exit 64
sha=$1
lane=$2
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent.XXXXXXXX")
bash "$plan/prepare.sh" "$root" "$sha" "$work/source"
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
  v7|invoice|pol279|pol280) bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
  pol108-core|pol108-facts|pol108-impacts) bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#pol108-}" ;;
  pol109) bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  pol115-workbench) bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  pfq) bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  pol275)
    bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work/browser"
    bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/browser" collision
    bash "$plan/pol275/prepare-warm-image.sh" "$root" "$work/source" "$sha" "$work/warm"
    context_sha=$(cat "$work/warm/context.sha256")
    docker build --platform linux/amd64 --target pol275-warm \
      --file "$work/warm/Dockerfile" --iidfile "$work/warm/image.id" \
      --build-arg "CI_SOURCE_SHA=$sha" --build-arg "CONTEXT_SHA256=$context_sha" "$work/warm/context"
    bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/warm" warm
    ;;
  onboarding) bash "$plan/onboarding/run-onboarding295.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  procurement)
    for kind in general16 project11; do
      bash "$plan/procurement/run-procurement295.sh" "$root" "$work/source" "$sha" "$work/browser" "$kind"
    done
    ;;
  *) bash "$plan/run-contract-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
esac
