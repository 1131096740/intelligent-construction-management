#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 3 && $2 =~ ^[a-f0-9]{40}$ && -n ${JG_QUALIFICATION_LOCAL_RUN:-} ]] || exit 64
base_image=$1
candidate=$2
out=$3
repo=$(git rev-parse --show-toplevel)
[[ $(git -C "$repo" rev-parse "$candidate^{commit}") == "$candidate" ]] || exit 65
mkdir "$out"
out=$(cd "$out" && pwd -P)
mkdir "$out/workspace"
git -C "$repo" archive "$candidate" | tar -x -C "$out/workspace"
python3 - "$out/workspace/services/api/src/database/issue436-company-history-expense.pg.spec.ts" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
changes = [
 ('const databaseName = fullChain ? "jiangkong_line_a_real_db" :',
  'const databaseName = fullChain ? `jg_task01_${runId?.replaceAll("-", "")}` :'),
 ('data: { name: "合成 #436 不关联项目", code: tag, operatingLedgerEffectiveDate: new Date("2026-11-01") }',
  'data: { name: "合成 #436 不关联项目", code: tag }')
]
for old, new in changes:
    assert s.count(old) == 1
    s = s.replace(old, new)
p.write_text(s)
PY
shasum -a 256 "$out/workspace/services/api/src/database/issue436-company-history-expense.pg.spec.ts" > "$out/fixture.sha256"
cat > "$out/Dockerfile" <<'DOCKER'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY workspace/ /qualification/candidate/
RUN cp -a /qualification/workspace/node_modules /qualification/candidate/node_modules && cp -a /qualification/workspace/services/api/node_modules /qualification/candidate/services/api/node_modules && cp -a /qualification/workspace/packages/shared-domain/node_modules /qualification/candidate/packages/shared-domain/node_modules && cp -a /qualification/workspace/apps/web-admin/node_modules /qualification/candidate/apps/web-admin/node_modules
WORKDIR /qualification/candidate
RUN pnpm --filter @jiangkong/shared-domain build && pnpm --filter @jiangkong/api exec prisma generate
DOCKER
docker build --platform linux/amd64 --build-arg "BASE_IMAGE=$base_image" \
  --label "org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN" \
  --label "org.jiangkong.candidate-352=$candidate" --iidfile "$out/image.id" "$out"
