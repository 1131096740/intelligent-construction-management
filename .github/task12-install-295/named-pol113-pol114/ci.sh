#!/bin/bash
set -euo pipefail
umask 077
[[ ( $# == 1 || ( $# == 2 && ( $2 == --current-320 || $2 == --text-direct-330 || $2 == --payment-remainder-331 || $2 == --upward-archive-332 || $2 == --historical-settlement-334 || $2 == --expense-witness-346 ) ) ||
  ( $# == 3 && ( $2 == --historical-settlement-334 || $2 == --expense-witness-346 ) && $3 == --host-only ) ) && ( $1 == pol113 || $1 == pol114 ) ]]
mode=$1
mode_args=()
if [[ $# -ge 2 ]]; then mode_args=("$2"); fi
root=$(git rev-parse --show-toplevel)
ref=${CI_SOURCE_SHA:?missing exact CI source SHA}
[[ $ref == "$(git -C "$root" rev-parse HEAD)" && -z $(git -C "$root" status --porcelain --untracked-files=no) ]]
plan=$(cd "$(dirname "$0")" && pwd -P)
output=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-named-poly-295.XXXXXXXX")
bash "$root/.github/task12-install-295/contract-finance/prepare.sh" "$root" "$ref" "$output/prepared" ${mode_args[@]+"${mode_args[@]}"}
python3 "$plan/prepare-named295.py" "$root" "$output/prepared" "$output/generated"
printf '%s\n' "$output"
bash "$plan/run-named295.sh" "$mode" "$output/generated" "$output/prepared" "$ref" "$output/evidence" ${3:+"$3"}
if [[ ${3-} != --host-only ]]; then cat "$output/evidence/receipt.json"; fi
