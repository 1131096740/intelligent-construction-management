#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 1 && ( $1 == cash-handover || $1 == principal-return ) ]]
lane=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-cash-principal-290.XXXXXXXX")
bash "$plan/../standard/prepare.sh" "$root" "$CI_SOURCE_SHA" "$temp/prepared"
(umask 022; python3 "$plan/stage.py" "$plan" "$temp/prepared/context" "$temp/overlays")
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/prepared/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --mount "type=bind,src=$temp/prepared/product/predecessor,dst=/qualification/product,readonly" \
  --mount "type=bind,src=$temp/overlays/entry.cjs,dst=/qualification/install-only.cjs,readonly" \
  --mount "type=bind,src=$temp/overlays/runner.cjs,dst=/qualification/workspace/services/api/prisma/run-task398-shared-standard-local.cjs,readonly" \
  --mount "type=bind,src=$temp/overlays/handover.spec.ts,dst=/qualification/workspace/services/api/src/database/task25-public-cash-handover.http.pg.spec.ts,readonly" \
  --mount "type=bind,src=$temp/overlays/app-inputs.json,dst=/qualification/app-inputs.json,readonly" \
  --entrypoint node "$image" /qualification/install-only.cjs "$lane"
