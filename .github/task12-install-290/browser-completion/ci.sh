#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-browser-completion-290.XXXXXXXX")
group=task398_browser_completion
bash "$plan/prepare.sh" "$group" "$root" "$CI_SOURCE_SHA" "$plan/../browser-partial" "$temp/prepared"
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/prepared/context"
bash "$plan/run.sh" "$group" "$(cat "$temp/image.id")" "$temp/prepared" "$temp/evidence"
receipt=$(find "$temp/evidence/owned" -name receipt-complete.json -type f)
[[ -n $receipt && $receipt != *$'\n'* ]]
node "$plan/verify-receipts.cjs" "$temp/evidence/run.jsonl" "$(dirname "$receipt")"
