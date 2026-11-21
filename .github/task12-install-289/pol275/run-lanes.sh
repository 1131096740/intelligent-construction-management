#!/bin/bash
set -euo pipefail
pol275=$(cd "$(dirname "$0")" && pwd -P)
image=$1
product=$2
for lane in cold warm collision; do
  overlay=()
  if [[ $lane == warm ]]; then
    overlay+=(--mount "type=bind,src=$pol275/warm-pol275.cjs,dst=/qualification/pol275.cjs,readonly")
    overlay+=(--mount "type=bind,src=$pol275/warm-current.spec.ts,dst=/qualification/workspace/services/api/src/database/clearing-reconciliation-concurrency.spec.ts,readonly")
  elif [[ $lane == collision ]]; then
    overlay+=(--mount "type=bind,src=$pol275/collision-observation.cjs,dst=/qualification/collision-observation.cjs,readonly")
  fi
  docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
    --tmpfs /tmp:rw,noexec,nosuid,size=512m \
    --mount "type=bind,src=$product,dst=/qualification/product,readonly" \
    --mount "type=bind,src=$pol275/$lane-installer.cjs,dst=/qualification/installer.cjs,readonly" \
    --mount "type=bind,src=$pol275/$lane-evidence.cjs,dst=/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs,readonly" \
    --mount "type=bind,src=$pol275/entry.cjs,dst=/qualification/entry.cjs,readonly" \
    ${overlay[@]+"${overlay[@]}"} --entrypoint node "$image" /qualification/entry.cjs "$lane"
done
