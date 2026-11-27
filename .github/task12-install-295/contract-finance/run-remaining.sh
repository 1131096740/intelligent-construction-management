#!/bin/bash
set -euo pipefail
umask 077

partial_350=false
case $#:${2-}:${3-} in
  3:--signed-settlement-350:--host-only)
    [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64
    partial_350=true ;;
  *)
    [[ $# == 1 || ( $# == 2 && ( $2 == --current-320 || $2 == --text-direct-330 || $2 == --payment-remainder-331 || $2 == --upward-archive-332 || $2 == --historical-settlement-334 || $2 == --expense-witness-34[69] ) ) ||
      ( $# == 3 && $2 == --expense-witness-34[69] && $3 == --host-only ) ]] || exit 64 ;;
esac
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-dynamic.XXXXXXXX")
if [[ ${3-} != --host-only ]]; then
  source "$plan/local-build-images.sh"
  qualification_image_scope "$work"
  trap 'qualification_image_exit "$?"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

mode_args=()
if (( $# >= 2 )); then mode_args=("$2"); fi
bash "$plan/prepare.sh" "$root" "$sha" "$work/source" ${mode_args[@]+"${mode_args[@]}"}
build="$work/browser"
host_args=()
if [[ ${3-} == --host-only ]]; then
  host_args=(--host-only)
  build="$work"
else
  bash "$plan/build.sh" "$work/source" "$sha" browser "$build"
fi
args=("$root" "$work/source" "$sha" "$build")
expense_args=()
if [[ ${2:-} == --expense-witness-34[69] || $partial_350 == true ]]; then
  expense_args=("$2" ${host_args[@]+"${host_args[@]}"})
fi

# Special consumers still need their own 350-profile bindings. Record each one
# without promoting a partial host staging run to an aggregate result.
pending_lanes=()
run_special_lane() {
  local lane=$1
  shift
  if [[ $partial_350 == true ]]; then
    pending_lanes+=("$lane")
  else
    bash "$@" || exit "$?"
  fi
}

bash "$plan/run-remaining-cleanup.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
for lane in project-funding takeover-task1; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$build" bank "${@:2}"
bash "$plan/run-remaining-owner.sh" "${args[@]}" spot-material "${@:2}"
run_special_lane direct-capacity "$plan/run-remaining-direct-capacity.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
for lane in takeover-correction file-binding-manifest; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
if [[ ${2:-} == --expense-witness-34[69] || $partial_350 == true ]]; then
  run_special_lane file-binding-catalog "$plan/run-file-binding-catalog.sh" "${args[@]}" "${expense_args[@]}"
fi
bash "$plan/run-profile.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
for lane in generic-batch operating-ledger pol215 affiliate-subject business-definition participant-history payable-settlement; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
run_special_lane wage "$plan/run-remaining-wage.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
run_special_lane historical-wage "$plan/run-remaining-historical-wage.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
run_special_lane historical-financial "$plan/run-historical-financial.sh" "${args[@]}" ${expense_args[@]+"${expense_args[@]}"}
bash "$plan/run-remaining-owner.sh" "${args[@]}" fund-movement "${@:2}"

if [[ $partial_350 == true ]]; then
  printf 'REMAINING_DYNAMIC_350_HOST_INCOMPLETE sha=%s pending_lanes=%s\n' "$sha" "${pending_lanes[*]}" >&2
  exit 65
fi
