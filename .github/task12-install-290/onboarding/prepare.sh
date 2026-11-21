#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 3 ]]
root=$(cd "$1" && pwd -P)
ref=$2
out=$3
plan=$(cd "$(dirname "$0")" && pwd -P)
previous="$root/.github/task12-install-289"
input="$root/.github/task12-install-290"
mkdir "$out"
out=$(cd "$out" && pwd -P)
mkdir "$out/product" "$out/context" "$out/context/workspace" "$out/overlays"
node "$input/materialize.cjs" --materialize "$root" "$out/product" "$ref"
node "$previous/verify.cjs" "$out/product/predecessor"
python3 "$previous/produce.py" "$root" "$ref" "$previous/historical-install-inputs.tar.gz" "$previous/installer.cjs" "$out/admission"
cp -R "$out/admission/source" "$out/context/"
cp "$out/admission"/{source-seal.txt,source-admission.json} "$out/context/"
cp "$previous"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json} "$out/context/"
cp "$out/product/successor.sql" "$out/context/"
git -C "$root" archive "$ref" -- package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs   packages/shared-domain apps/web-admin services/api | tar xf - -C "$out/context/workspace"
python3 "$plan/stage.py" "$plan" "$out/context" "$out/overlays" "$input/successor.cjs"
cp "$out/context/preflight.cjs" "$out/context/install-only.cjs"
cat "$plan/workspace.Dockerfile" >> "$out/context/Dockerfile"
printf '%s\n' 'COPY --chmod=644 successor.cjs successor.sql scope.json lanes.json workspace-inputs.json verify-application-source.cjs preflight.cjs /qualification/' >> "$out/context/Dockerfile"
node - "$out" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2],ctx=path.join(root,'context');
const {verifyOutside289Inputs}=require(path.join(ctx,'installer.cjs'));
const {verifySql,expectedLedger}=require(path.join(ctx,'successor.cjs'));
const {verify}=require(path.join(ctx,'verify-application-source.cjs'));
const manifest=require(path.join(ctx,'lanes.json'));
const historical=path.join(ctx,'source/services/api/prisma');
const product=path.join(root,'product/predecessor/services/api/prisma');
verifySql(path.join(ctx,'successor.sql'));
const {ledger}=verifyOutside289Inputs(historical,product,fs.readFileSync(path.join(ctx,'source-seal.txt'),'utf8').trim());
assert.equal(expectedLedger(ledger).length,290);
const lanes=Object.keys(manifest);
assert.equal(lanes.length,7);
for(const lane of lanes) verify(path.join(ctx,'workspace'),lane,path.join(root,'overlays/lanes',lane,'fixtures'));
console.log(JSON.stringify({status:'ONBOARDING_290_HOSTED_CONTEXT_READY_NO_DATABASE',lanes,canonicalCases:59}));
JS
