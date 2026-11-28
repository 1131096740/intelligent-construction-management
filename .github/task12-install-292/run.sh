#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-install-only-292.XXXXXXXX")
bash "$plan/prepare.sh" "$root" "$CI_SOURCE_SHA" "$temp/prepared"
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/prepared/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
[[ -z $(docker ps -q) ]]
if pgrep -x postgres >/dev/null; then exit 1; fi
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL   --security-opt no-new-privileges --user postgres --init --pids-limit 128 --memory 1g   --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m   --mount "type=bind,src=$temp/prepared/product/predecessor,dst=/qualification/product289,readonly"   --mount "type=bind,src=$temp/prepared/product/intermediate,dst=/qualification/product,readonly"   --entrypoint node "$image" /qualification/install-only.cjs
