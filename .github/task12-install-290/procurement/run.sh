#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 5 && ($1 == general16 || $1 == project11) && ($2 == --admission-only || $2 == --once) ]]
mode=$1
action=$2
image=$3
proof=$4
here=$(cd "$5" && pwd -P)
product="$here/product/predecessor"
cmp -s "$here/context/consumer.cjs" "$(dirname "$0")/plans/$mode/consumer.cjs"

[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}}')" == "$image linux/amd64" ]]
test -z "$(docker ps -q)"
mkdir -m 0700 "$proof"
args=(/qualification/entry.cjs)
if [[ $action == --admission-only ]]; then args+=("$action"); fi
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --mount "type=bind,src=$product,dst=/qualification/product,readonly" \
  --entrypoint node "$image" "${args[@]}" >"$proof/stdout.log" 2>"$proof/private.stderr"
