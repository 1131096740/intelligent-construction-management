#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-procurement-290.XXXXXXXX")
source "$plan/../../task12-install-295/contract-finance/local-build-images.sh"
qualification_image_scope "$temp"
trap 'qualification_image_exit "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for lane in general16 project11; do
  export PYTHONUTF8=1
  (umask 022; python3 "$plan/prepare.py" "$lane" "$root" "$CI_SOURCE_SHA" "$temp/$lane")
  docker build --platform linux/amd64 --iidfile "$temp/$lane-image.id" \
    --label "org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN" "$temp/$lane/context"
  image=$(cat "$temp/$lane-image.id")
  proof="$temp/$lane-proof"
  status=0
  bash "$plan/run.sh" "$lane" --once "$image" "$proof" "$temp/$lane" || status=$?
  if [[ -f $proof/stdout.log ]]; then
    jq -R -s -c '[split("\n")[] | fromjson? | select(type=="object")] | last | {status, failure, cleanup, installOnly290, sameInstancePostConsume}' "$proof/stdout.log"
  fi
  (( status == 0 )) || exit "$status"
done
