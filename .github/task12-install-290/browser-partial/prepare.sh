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
cp "$plan/runtime"/{owner-observation.cjs,approval-round-catalog.cjs,controlled-correction.cjs} "$out/context/"
node - "$input/profile.json" "$out/context/scope.json" <<'JS'
const fs=require('node:fs');
const p=require(process.argv[2]);
const keys=['tree','prefixCount','prefixLedgerSha256','terminal','expectedLedgerSha256'];
fs.writeFileSync(process.argv[3],JSON.stringify(Object.fromEntries(keys.map(k=>[k,p[k]])))+'\n');
JS
git -C "$root" archive "$ref" package.json pnpm-lock.yaml pnpm-workspace.yaml scripts packages/shared-domain services/api apps/web-admin |
  tar xf - -C "$out/context/workspace"
for file in database-dynamic-gate-manifest.json run-database-dynamic-gate-local.cjs; do
  relative="services/api/prisma/$file"
  git -C "$root" show "0a5b607cf912ffbb50237af2608ac8b2a5360c16:$relative" > "$out/context/workspace/$relative"
done
python3 "$plan/assemble.py" "$plan" "$previous" "$out/context"
node --check "$out/context/installer.cjs"
node --check "$out/context/workspace/services/api/prisma/run-task398-shared-standard-local.cjs"
printf '%s\n' 'COPY --chmod=644 successor.cjs scope.json successor.sql /qualification/' >> "$out/context/Dockerfile"
cat "$plan/workspace.Dockerfile" >> "$out/context/Dockerfile"
printf '%s\n' 'TASK398_BROWSER_PARTIAL_290_HOSTED_CONTEXT_READY_NO_DATABASE'
