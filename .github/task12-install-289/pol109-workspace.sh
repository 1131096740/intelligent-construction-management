#!/bin/bash
set -euo pipefail
input=$(cd "$(dirname "$0")" && pwd -P)
root=$1
ref=$2
workspace=$3
git -C "$root" archive "$ref" package.json pnpm-workspace.yaml pnpm-lock.yaml scripts packages/shared-domain services/api apps/web-admin | tar xf - -C "$workspace"
base=0a5b607cf912ffbb50237af2608ac8b2a5360c16
for file in database-dynamic-gate-manifest.json run-database-dynamic-gate-local.cjs; do
  path="services/api/prisma/$file"
  git -C "$root" show "$base:$path" > "$workspace/$path"
done
install -m 644 "$input"/fixtures/task12-pol109-{ci,stage-browser,stage-workspace}.cjs "$workspace/services/api/prisma/"
install -m 644 "$input/fixtures/project-close-profit.owned282.http.pg.spec.ts" "$workspace/services/api/src/project-close-profit/"
node - "$input" "$workspace" <<'JS'
const fs=require('node:fs'), path=require('node:path'),[input,workspace]=process.argv.slice(2);
const {verifyWorkspace}=require(path.join(input,'pol109-workspace-proof.cjs'));
const manifest=path.join(input,'pol109-workspace-inputs.json');
verifyWorkspace(workspace,manifest);
const expected=JSON.parse(fs.readFileSync(manifest,'utf8')).map(row=>row.path).sort();
const actual=[];
function collect(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) collect(file);
    else actual.push(path.relative(workspace,file));
  }
}
collect(workspace);
require('node:assert/strict').deepEqual(actual.sort(),expected);
JS
