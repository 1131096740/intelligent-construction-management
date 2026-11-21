#!/bin/bash
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd -P)
image=$1
product=$2
api=/qualification/workspace/services/api
for lane in pre115-clean pre116-legacy duplicate cross-business replacement-child replacement-parent app; do
  docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
    --tmpfs /tmp:rw,noexec,nosuid,size=512m \
    --mount "type=bind,src=$product,dst=/qualification/product,readonly" \
    --mount "type=bind,src=$dir/installer.cjs,dst=/qualification/installer.cjs,readonly" \
    --mount "type=bind,src=$dir/task12-pfq-positive-fixtures.json,dst=/qualification/task12-pfq-positive-fixtures.json,readonly" \
    --mount "type=bind,src=$dir/task12-pfq-recovery.cjs,dst=/qualification/task12-pfq-recovery.cjs,readonly" \
    --mount "type=bind,src=$dir/task12-pfq-recovery.json,dst=/qualification/task12-pfq-recovery.json,readonly" \
    --mount "type=bind,src=$dir/task12-pfq-app.cjs,dst=$api/prisma/task12-pfq-app.cjs,readonly" \
    --mount "type=bind,src=$dir/task12-pfq-jest-wire.cjs,dst=$api/prisma/task12-pfq-jest-wire.cjs,readonly" \
    --mount "type=bind,src=$dir/project-financing-quota-concurrency.owned282.spec.ts,dst=$api/src/database/project-financing-quota-concurrency.owned282.spec.ts,readonly" \
    --mount "type=bind,src=$dir/entry.cjs,dst=/qualification/entry.cjs,readonly" \
    --entrypoint node "$image" /qualification/entry.cjs "$lane"
done
