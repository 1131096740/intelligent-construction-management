#!/bin/bash
set -euo pipefail
pol275=$(cd "$(dirname "$0")" && pwd -P)
root=$1
ref=$2
context=$3
mode=${4:-settlement}
[[ $# -ge 3 && $# -le 4 && ( $mode == settlement || $mode == settlement290 ) ]]
mkdir "$context/workspace" "$context/legacy"
bash "$pol275/../settlement-workspace.sh" "$root" "$ref" "$context/workspace" "$mode"
install -m 644 "$pol275/base-evidence.cjs" "$context/workspace/services/api/prisma/pol275-original-evidence.cjs"
install -m 644 "$pol275/base-current.spec.ts" "$context/workspace/services/api/src/database/clearing-reconciliation-concurrency.spec.ts"
review=3cf11b6c46b301856b554598522213f0839ef595
[[ $(git -C "$root" rev-parse "$review^{tree}") == 886c3bb47cd65aae6f54b7eb46f24b026f240a64 ]]
git -C "$root" merge-base --is-ancestor "$review" 0a5b607cf912ffbb50237af2608ac8b2a5360c16
git -C "$root" archive "$review" package.json pnpm-workspace.yaml pnpm-lock.yaml scripts packages/shared-domain services/api apps/web-admin/package.json |
  tar xf - -C "$context/legacy"
install -m 644 "$pol275/legacy.spec.ts" "$context/legacy/services/api/src/database/clearing-reconciliation-legacy-compatibility.spec.ts"
python3 - "$pol275" "$context" "$mode" <<'PY'
import hashlib,json,pathlib,sys
source,context=map(pathlib.Path,sys.argv[1:3])
mode=sys.argv[3]
seals={'legacy':'6361048153810677f490fb4414adafedf016bee93b88779d11f98d78336474cc',
       'workspace':'1376546fc9197ba09c4d3c8f8f7f285b83c07b32a48eee58d0ca8dbf83336bb1'}
for name,seal in seals.items():
    inventory=(source/(name+'-inputs.json')).read_bytes()
    if hashlib.sha256(inventory).hexdigest()!=seal:
        raise SystemExit('POL275_WORKSPACE_MANIFEST')
    root=context/name
    paths=sorted(root.rglob('*'))
    actual=[dict(path=p.relative_to(root).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()]
    if name=='workspace' and mode=='settlement290':
        expected='623abc6a2b0352cd26e9e674eb8ec67ccfe797afd993252ab559d5197ffafe0f'
        matched=hashlib.sha256((json.dumps(actual,indent=2)+'\n').encode()).hexdigest()==expected
    else:
        matched=actual==json.loads(inventory)
    if any(p.is_symlink() for p in paths) or not matched:
        raise SystemExit('POL275_WORKSPACE_INPUT_BYTES')
PY
