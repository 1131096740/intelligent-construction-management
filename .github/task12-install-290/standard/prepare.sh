#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 3 ]]
root=$(cd "$1" && pwd -P)
ref=$2
out=$3
plan=$(cd "$(dirname "$0")" && pwd -P)
(cd "$plan" && shasum -a 256 -c plan.sha256 >/dev/null)
previous="$root/.github/task12-install-289"
input="$root/.github/task12-install-290"
mkdir "$out"
out=$(cd "$out" && pwd -P)
mkdir "$out/product" "$out/context" "$out/context/workspace"
node "$input/materialize.cjs" --materialize "$root" "$out/product" "$ref"
node "$previous/verify.cjs" "$out/product/predecessor"
python3 "$previous/produce.py" "$root" "$ref" "$previous/historical-install-inputs.tar.gz" "$previous/installer.cjs" "$out/admission"
cp -R "$out/admission/source" "$out/context/"
cp "$out/admission"/{source-seal.txt,source-admission.json} "$out/context/"
cp "$previous"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json} "$out/context/"
cp "$input/successor.cjs" "$out/context/"
cp "$out/product/successor.sql" "$out/context/"
cp "$plan/runtime/entry.cjs" "$out/context/install-only.cjs"
cp "$plan/runtime"/{owner-observation.cjs,approval-round-catalog.cjs,controlled-correction.cjs,verify-behavior.cjs} "$out/context/"
node - "$input/profile.json" "$out/context/scope.json" <<'JS'
const fs=require('node:fs');
const p=require(process.argv[2]);
const keys=['tree','prefixCount','prefixLedgerSha256','terminal','expectedLedgerSha256'];
fs.writeFileSync(process.argv[3],JSON.stringify(Object.fromEntries(keys.map(k=>[k,p[k]])))+'\n');
JS
git -C "$root" archive "$ref" package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs packages/shared-domain services/api |
  tar xf - -C "$out/context/workspace"
python3 "$plan/assemble.py" "$plan" "$out/context"
node --check "$out/context/installer.cjs"
node --check "$out/context/workspace/services/api/prisma/run-task398-shared-standard-local.cjs"
node "$out/context/verify-behavior.cjs" "$out/context/workspace/services/api/src"
printf '%s\n' 'COPY --chmod=644 successor.cjs scope.json successor.sql /qualification/' >> "$out/context/Dockerfile"
cat "$plan/workspace.Dockerfile" >> "$out/context/Dockerfile"
printf '%s\n' 'TASK398_STANDARD_290_HOSTED_CONTEXT_READY_NO_DATABASE'
