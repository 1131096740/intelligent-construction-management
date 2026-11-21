#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 3 ]]
root=$(cd "$1" && pwd -P)
ref=$2
out=$3
plan=$(cd "$(dirname "$0")" && pwd -P)
[[ $plan == "$root/.github/task12-install-292" ]]
previous="$root/.github/task12-install-289"
prior="$root/.github/task12-install-290"
mkdir "$out"
out=$(cd "$out" && pwd -P)
mkdir "$out/product" "$out/context"
node "$plan/materialize.cjs" "$root" "$out/product" "$ref"
node "$previous/verify.cjs" "$out/product/predecessor"
python3 "$previous/produce.py" "$root" "$ref" "$previous/historical-install-inputs.tar.gz" "$previous/installer.cjs" "$out/admission"
cp -R "$out/admission/source" "$out/context/"
cp "$out/admission"/{source-seal.txt,source-admission.json} "$out/context/"
cp "$previous"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json} "$out/context/"
cp "$out/product/successor.sql" "$out/context/"
python3 "$plan/stage.py" "$plan" "$out/context" "$prior/successor.cjs"
printf '%s\n' 'COPY --chmod=644 successor.cjs scope.json successor.sql tree-proof.json /qualification/' >> "$out/context/Dockerfile"
node - "$out/context" "$out/product" <<'JS'
const {join}=require('node:path');
const [ctx,product]=process.argv.slice(2);
const {admitSource}=require(join(ctx,'install-only.cjs'));
const fs=require('node:fs');
const proof=join(product,'..','product-proof');
fs.mkdirSync(proof,{mode:0o755});
fs.cpSync(join(product,'predecessor'),join(proof,'product289'),{recursive:true});
fs.cpSync(join(product,'intermediate'),join(proof,'product'),{recursive:true});
fs.copyFileSync(join(product,'successor.sql'),join(proof,'successor.sql'));
console.log(JSON.stringify(admitSource(proof,join(ctx,'source/services/api/prisma'),join(ctx,'source-seal.txt'))));
JS
printf '%s\n' 'EXACT_292_INSTALL_ONLY_HOSTED_CONTEXT_READY_NO_DATABASE'
