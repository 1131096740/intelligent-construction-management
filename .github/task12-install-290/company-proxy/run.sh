#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-company-proxy-290.XXXXXXXX")
bash "$plan/../standard/prepare.sh" "$root" "$CI_SOURCE_SHA" "$temp/prepared"
(umask 022; python3 "$plan/stage.py" "$plan" "$temp/prepared/context" "$temp/overlays")
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/prepared/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --mount "type=bind,src=$temp/prepared/product/predecessor,dst=/qualification/product,readonly" \
  --entrypoint node "$image" /qualification/install-only.cjs company-proxy-repayment
