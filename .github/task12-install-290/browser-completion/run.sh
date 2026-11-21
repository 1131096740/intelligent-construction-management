#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 4 && $1 == task398_browser_completion ]] || exit 64
image=$2
output=$(cd "$3" && pwd -P)
evidence=$4
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 64
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}}') == "$image linux/amd64" ]] || exit 64
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.jiangkong.ci.group"}}') == task398_browser_completion ]] || exit 64

test -z "$(docker ps -q)" || exit 64
if pgrep -x postgres >/dev/null; then exit 1; fi
mkdir "$evidence"
evidence=$(cd "$evidence" && pwd -P)
mkdir -m 0777 "$evidence/owned"
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --mount "type=bind,src=$output/product/predecessor,dst=/qualification/product,readonly" \
  --mount "type=bind,src=$evidence/owned,dst=/run/task398-browser" \
  --entrypoint node "$image" /qualification/install-only.cjs >"$evidence/run.jsonl" 2>"$evidence/private.stderr"
