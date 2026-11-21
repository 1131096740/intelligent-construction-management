#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 3 ]]
image=$1
product=$(cd "$2" && pwd -P)
evidence=$3
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
mkdir "$evidence"
evidence=$(cd "$evidence" && pwd -P)
mkdir -m 0777 "$evidence/owned"
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL   --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init   --tmpfs /tmp:rw,noexec,nosuid,size=512m   --mount "type=bind,src=$product,dst=/qualification/product,readonly"   --mount "type=bind,src=$evidence/owned,dst=/run/task398-browser"   --entrypoint node "$image" /qualification/install-only.cjs
