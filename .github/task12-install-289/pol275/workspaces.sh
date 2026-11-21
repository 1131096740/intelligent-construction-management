#!/bin/bash
set -euo pipefail
pol275=$(cd "$(dirname "$0")" && pwd -P)
root=$1
ref=$2
context=$3
mkdir "$context/workspace" "$context/legacy"
bash "$pol275/../settlement-workspace.sh" "$root" "$ref" "$context/workspace" settlement
install -m 644 "$pol275/base-evidence.cjs" "$context/workspace/services/api/prisma/pol275-original-evidence.cjs"
install -m 644 "$pol275/base-current.spec.ts" "$context/workspace/services/api/src/database/clearing-reconciliation-concurrency.spec.ts"
review=3cf11b6c46b301856b554598522213f0839ef595
[[ $(git -C "$root" rev-parse "$review^{tree}") == 886c3bb47cd65aae6f54b7eb46f24b026f240a64 ]]
git -C "$root" merge-base --is-ancestor "$review" 0a5b607cf912ffbb50237af2608ac8b2a5360c16
git -C "$root" archive "$review" package.json pnpm-workspace.yaml pnpm-lock.yaml scripts packages/shared-domain services/api apps/web-admin/package.json |
  tar xf - -C "$context/legacy"
install -m 644 "$pol275/legacy.spec.ts" "$context/legacy/services/api/src/database/clearing-reconciliation-legacy-compatibility.spec.ts"
python3 - "$pol275" "$context" <<'PY'
import hashlib,json,pathlib,sys
source,context=map(pathlib.Path,sys.argv[1:])
seals={'legacy':'6361048153810677f490fb4414adafedf016bee93b88779d11f98d78336474cc',
       'workspace':'c50eb6012f3398c958f6281d08e7e56a508a7a4ecf2f8dcdae7283a29d679431'}
for name,seal in seals.items():
    inventory=(source/(name+'-inputs.json')).read_bytes()
    if hashlib.sha256(inventory).hexdigest()!=seal:
        raise SystemExit('POL275_WORKSPACE_MANIFEST')
    root=context/name
    paths=sorted(root.rglob('*'))
    actual=[dict(path=p.relative_to(root).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()]
    if any(p.is_symlink() for p in paths) or actual!=json.loads(inventory):
        raise SystemExit('POL275_WORKSPACE_INPUT_BYTES')
PY
