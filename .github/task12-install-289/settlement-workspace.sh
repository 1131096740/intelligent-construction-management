#!/bin/bash
set -euo pipefail
input=$(cd "$(dirname "$0")" && pwd -P)
root=$1
ref=$2
workspace=$3
mode=$4
case "$mode" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|settlement290) ;; *) exit 2 ;; esac
git -C "$root" archive "$ref" \
 package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs packages/shared-domain \
 services/api/package.json services/api/tsconfig.json services/api/jest.config.cjs services/api/tsconfig.build.json services/api/nest-cli.json \
 services/api/scripts/operational-write-freeze-policy.cjs services/api/scripts/operational-write-freeze-policy.d.cts \
 services/api/jest.task10-acceptance-paths.cjs services/api/jest.task09-task11-document-acceptance-paths.cjs \
 services/api/src services/api/prisma \
 services/api/assets/templates/{material-purchase-real-v1.docx,equipment-rental-real-v1.docx,labor-subcontract-real-v1.docx,generic-contract-v1.docx} | tar xf - -C "$workspace"
base=0a5b607cf912ffbb50237af2608ac8b2a5360c16
for file in database-dynamic-gate-manifest.json run-database-dynamic-gate-local.cjs; do
  path="services/api/prisma/$file"
  git -C "$root" show "$base:$path" > "$workspace/$path"
done
for file in task12-owned-280.test-support.ts contract-bill-batch-replace-concurrency.spec.ts contract-bill-transition-confirm-concurrency.spec.ts; do
  install -m 644 "$input/fixtures/$file" "$workspace/services/api/src/database/$file"
done
inventory="$input/workspace-inputs.json"
seal=3cab991f4d096e16c0b61b98ec1f69835445f197575dce5339cc4ba4e660bc8e
if [[ $mode == settlement290 ]]; then
  inventory=-
  seal=e36f3b846e6180a318244f19978494694e852b1285b2b3772a22d738e83d96f9
elif [[ $mode == template ]]; then
  file=contract-template-scenario-concurrency.spec.ts
  install -m 644 "$input/fixtures/$file" "$workspace/services/api/src/database/$file"
  inventory="$input/template-workspace-inputs.json"
  seal=46fa7e428321b7b9f7eb9e46ecbcf77fed897378e18eef0a41bac1f59f9c942c
elif [[ $mode == draft ]]; then
  install -m 644 "$input/fixtures/settlement-draft-lifecycle-concurrency.spec.ts" "$workspace/services/api/src/database/"
  install -m 644 "$input/fixtures/database-dynamic-gate-manifest.json" "$workspace/services/api/prisma/"
  inventory="$input/draft-workspace-inputs.json"
  seal=0537ad8ee4a2f4c7717b6bd07b759ce35ca9eadaac16aed6f3b2e2b2f99d7d4a
elif [[ $mode == pol108-* ]]; then
  install -m 644 "$input/fixtures/jest.runtime.config.cjs" "$workspace/services/api/"
  if [[ $mode == pol108-core ]]; then
    install -m 644 "$input/fixtures/operating-projection-postgresql.cases.ts" "$workspace/services/api/src/database/"
    inventory="$input/pol108-core-workspace-inputs.json"
    seal=c81593939d30983714e5d3331dbebd95b4fde887963882171ba09070f5acd966
  else
    inventory="$input/pol108-scale-workspace-inputs.json"
    seal=218aca1506364b8d7fb0a026ebe400d1da38849296bff8128329c2b219728ee6
  fi
elif [[ $mode == invoice ]]; then
  install -m 644 "$input/fixtures/invoice-ledger.postgres.spec.ts" "$workspace/services/api/src/invoice-ledger/"
  inventory="$input/invoice-workspace-inputs.json"
  seal=c4c0eb89c37ae486b101d2acff26433ef024b2efdb839cd7ae24a68ed6133d53
fi
python3 - "$inventory" "$workspace" "$seal" <<'PY'
import hashlib,json,pathlib,sys
inventory, workspace = map(pathlib.Path,sys.argv[1:3])
if str(inventory)!="-" and hashlib.sha256(inventory.read_bytes()).hexdigest()!=sys.argv[3]:
    raise SystemExit('SETTLEMENT_289_WORKSPACE_MANIFEST')
paths=sorted(workspace.rglob('*'))
if any(path.is_symlink() for path in paths):
    raise SystemExit('SETTLEMENT_289_WORKSPACE_LINK')
actual=[dict(path=p.relative_to(workspace).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()]
if str(inventory)=="-":
    if hashlib.sha256((json.dumps(actual,indent=2)+"\n").encode()).hexdigest()!=sys.argv[3]:
        raise SystemExit("SETTLEMENT_290_WORKSPACE_BYTES")
elif actual != json.loads(inventory.read_bytes()):
    raise SystemExit('SETTLEMENT_289_WORKSPACE_BYTES')
PY
