#!/bin/bash
set -euo pipefail
[[ $# == 4 ]]
image=$1
product=$2
material=$3
successor=$4
for lane in fresh valid paid other; do
  if [[ $lane == fresh || $lane == valid ]]; then
    profile=positive
    inputs=$material
    entry="$lane.cjs"
  else
    profile=negative
    inputs="$material/$lane"
    entry=payment-retained-ci.cjs
  fi
  [[ -s "$material/$lane-hypothesis.txt" ]]
  args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
    --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
    --tmpfs /tmp:rw,noexec,nosuid,size=512m
    --mount "type=bind,src=$product,dst=/qualification/product,readonly"
    --mount "type=bind,src=$successor,dst=/qualification/successor.sql,readonly"
    --mount "type=bind,src=$material/$profile-installer.cjs,dst=/qualification/installer.cjs,readonly")
  for file in "$entry" retained-payment.cjs retained-payment.json; do
    args+=(--mount "type=bind,src=$inputs/$file,dst=/qualification/$file,readonly")
  done
  if [[ $lane == fresh ]]; then
    args+=(--mount "type=bind,src=$material/seed-readback.sql,dst=/qualification/seed-readback.sql,readonly"
      --mount "type=bind,src=$material/database-dynamic-gate-manifest.json,dst=/qualification/workspace/services/api/prisma/database-dynamic-gate-manifest.json,readonly")
    for file in payment-execution-concurrency.spec.ts task12-owned-280.test-support.ts; do
      args+=(--mount "type=bind,src=$material/$file,dst=/qualification/workspace/services/api/src/database/$file,readonly")
    done
  fi
  printf 'payment_execution/%s ' "$lane" >&2
  cat "$material/$lane-hypothesis.txt" >&2
  docker run "${args[@]}" --entrypoint node "$image" "/qualification/$entry"
done
