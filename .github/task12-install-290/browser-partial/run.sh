#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-browser-partial-290.XXXXXXXX")
bash "$plan/prepare.sh" "$root" "$CI_SOURCE_SHA" "$temp/prepared"
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/prepared/context"
exec bash "$plan/run-context.sh" "$(cat "$temp/image.id")" "$temp/prepared/product/predecessor" "$temp/evidence"
