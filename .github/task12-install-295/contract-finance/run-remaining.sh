#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 1 || ( $# == 2 && ( $2 == --current-320 || $2 == --text-direct-330 || $2 == --payment-remainder-331 || $2 == --upward-archive-332 || $2 == --historical-settlement-334 || $2 == --expense-witness-346 ) ) ]] || exit 64
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-remaining-dynamic.XXXXXXXX")
source "$plan/local-build-images.sh"
qualification_image_scope "$work"
trap 'qualification_image_exit "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash "$plan/prepare.sh" "$root" "$sha" "$work/source" "${@:2}"
bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
args=("$root" "$work/source" "$sha" "$work/browser")
remaining_346=()
if [[ ${2:-} == --expense-witness-346 ]]; then
  remaining_346=("$2")
fi
bash "$plan/run-remaining-cleanup.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
for lane in project-funding takeover-task1; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank "${@:2}"
bash "$plan/run-remaining-owner.sh" "${args[@]}" spot-material "${@:2}"
bash "$plan/run-remaining-direct-capacity.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
for lane in takeover-correction file-binding-manifest; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
if [[ ${2:-} == --expense-witness-346 ]]; then
  bash "$plan/run-file-binding-catalog.sh" "${args[@]}" "$2"
fi
bash "$plan/run-profile.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
for lane in generic-batch operating-ledger pol215 affiliate-subject business-definition participant-history payable-settlement; do
  bash "$plan/run-remaining-owner.sh" "${args[@]}" "$lane" "${@:2}"
done
bash "$plan/run-remaining-wage.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
bash "$plan/run-remaining-historical-wage.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
bash "$plan/run-historical-financial.sh" "${args[@]}" ${remaining_346[@]+"${remaining_346[@]}"}
bash "$plan/run-remaining-owner.sh" "${args[@]}" fund-movement "${@:2}"
