#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 1 && ( $1 == pol113 || $1 == pol114 ) ]]
mode=$1
root=$(git rev-parse --show-toplevel)
ref=${CI_SOURCE_SHA:?missing exact CI source SHA}
[[ $ref == "$(git -C "$root" rev-parse HEAD)" && -z $(git -C "$root" status --porcelain --untracked-files=no) ]]
plan=$(cd "$(dirname "$0")" && pwd -P)
output=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-named-poly-295.XXXXXXXX")
bash "$root/.github/task12-install-295/contract-finance/prepare.sh" "$root" "$ref" "$output/prepared"
python3 "$plan/prepare-named295.py" "$root" "$output/prepared" "$output/generated"
printf '%s\n' "$output"
bash "$plan/run-named295.sh" "$mode" "$output/generated" "$output/prepared" "$ref" "$output/evidence"
cat "$output/evidence/receipt.json"
